/**
 * Runtime 插件加载器 —— 扫描 ~/.mafw/runtime-plugins/*.js，校验契约形状，
 * fail-open（单个文件失败不影响其他插件与内置 opencode）。
 *
 * 模板复用 MediaPluginLoader，但刻意去掉热加载：runtime 热切换危险
 * （事件流/sidecar 建立在 runtime 之上），重启生效即可。
 */
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';
import { config } from '../config';
import { AgentRuntime, RuntimeCapabilities, minimalCapabilities } from './contract';

export interface RuntimePluginContext {
  /** fetch with 60s default timeout */
  fetch: (url: string, opts?: any) => Promise<Response>;
  log: typeof log;
  /** 读 config.yaml 的 runtime.pluginConfig[name] */
  pluginConfig(name: string): Record<string, any>;
}

export type RuntimeFactory = (ctx: RuntimePluginContext) => Promise<AgentRuntime>;

export interface RuntimePluginState {
  file: string;
  name?: string;
  status: 'ok' | 'error';
  error?: string;
  capabilities?: RuntimeCapabilities;
}

export class RuntimePluginLoader {
  private factories = new Map<string, RuntimeFactory>();
  private meta = new Map<string, { capabilities: RuntimeCapabilities; external: boolean }>();
  private state = new Map<string, RuntimePluginState>();

  constructor(private pluginsDir: string) {}

  async init(): Promise<void> {
    this.ensureDir();
    await this.scan();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      fs.writeFileSync(path.join(this.pluginsDir, 'README.md'), README_CONTENT);
      fs.writeFileSync(path.join(this.pluginsDir, 'example.js.disabled'), EXAMPLE_CONTENT);
      log.info(`[RuntimePluginLoader] Created ${this.pluginsDir}`);
    }
  }

  async scan(): Promise<void> {
    if (!fs.existsSync(this.pluginsDir)) return;
    const files = fs.readdirSync(this.pluginsDir).filter(f => f.endsWith('.js'));
    const seen = new Set<string>();
    const loadedNames = new Set<string>();
    for (const file of files.sort()) {
      await this.loadFile(file, loadedNames);
      seen.add(file);
    }
    for (const [file] of this.state) {
      if (!seen.has(file)) {
        const prev = this.state.get(file);
        if (prev?.name) {
          this.factories.delete(prev.name);
          this.meta.delete(prev.name);
        }
        this.state.delete(file);
      }
    }
  }

  private async loadFile(file: string, loadedNames: Set<string>): Promise<void> {
    const fullPath = path.join(this.pluginsDir, file);
    try {
      const cacheKey = require.resolve(fullPath);
      delete require.cache[cacheKey];
    } catch { /* first load */ }

    try {
      const mod = require(fullPath);
      const name = mod?.name;
      if (!name || typeof name !== 'string') {
        this.state.set(file, { file, status: 'error', error: 'missing name' });
        return;
      }
      if (typeof mod.createRuntime !== 'function') {
        this.state.set(file, { file, name, status: 'error', error: 'missing createRuntime(ctx)' });
        return;
      }
      if (loadedNames.has(name)) {
        this.state.set(file, { file, name, status: 'error', error: 'duplicate name' });
        log.warn(`[RuntimePluginLoader] ${file}: duplicate name '${name}', skipping`);
        return;
      }
      // 能力合并：插件声明覆盖在 Tier-0 基线之上
      const capabilities: RuntimeCapabilities = { ...minimalCapabilities(), ...(mod.capabilities || {}) };
      // 插件 runtime 一律视为外部托管（gateway 不 spawn/监管其进程）
      const external = mod.external !== false;
      this.factories.set(name, mod.createRuntime);
      this.meta.set(name, { capabilities, external });
      this.state.set(file, { file, name, status: 'ok', capabilities });
      loadedNames.add(name);
      log.info(`[RuntimePluginLoader] Loaded ${file} (${name})`);
    } catch (err: any) {
      const prev = this.state.get(file);
      this.state.set(file, { file, name: prev?.name, status: 'error', error: err.message });
      log.warn(`[RuntimePluginLoader] ${file} load error: ${err.message}`);
    }
  }

  /** 插件不存在或未通过校验时返回 undefined（调用方回退内置 opencode）。 */
  get(name: string): { createRuntime: RuntimeFactory; capabilities: RuntimeCapabilities; external: boolean } | undefined {
    const createRuntime = this.factories.get(name);
    const meta = this.meta.get(name);
    if (!createRuntime || !meta) return undefined;
    return { createRuntime, ...meta };
  }

  getState(): RuntimePluginState[] {
    return [...this.state.values()];
  }
}

export function createRuntimePluginContext(): RuntimePluginContext {
  return {
    fetch: (url: string, opts?: any) =>
      fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(60000) }),
    log,
    pluginConfig: (name: string) => (config.raw as any)?.runtime?.pluginConfig?.[name] ?? {},
  };
}

const README_CONTENT = `# Runtime Plugins

Place \`.js\` files here to plug a new agent runtime into the MAFW gateway.
Activate with config.yaml:

\`\`\`yaml
runtime:
  plugin: my-runtime        # matches module.exports.name
  pluginConfig: {}          # per-plugin config, read via ctx.pluginConfig(name)
\`\`\`

Or env: \`MAFW_RUNTIME_PLUGIN=my-runtime\`. Unknown/failed plugins fall back
to the builtin opencode runtime (fail-open).

## Plugin shape (CJS)

\`\`\`js
module.exports = {
  name: "my-runtime",
  // merged over Tier-0 defaults (sessionApi + promptWhileBusy already true)
  capabilities: {
    eventStream: false,
    nativeApprovals: false,
    providerConfigApi: false,
    perLlmCallTransform: false,
  },
  external: true,             // gateway never spawns plugin runtime processes
  async createRuntime(ctx) {
    // ctx.fetch / ctx.log / ctx.pluginConfig(name)
    return {
      name: "my-runtime",
      capabilities: { /* same object as above */ },
      session: {
        async create(opts) { /* {directory?} → {id} */ },
        async promptAsync(opts) { /* {sessionID, parts|message, ...} → void */ },
        async prompt(opts) { /* → {parts, ...} */ },
        async messages(opts) { /* {sessionID, limit?, before?} → {data, nextCursor?} */ },
        async get({ sessionID }) {},
        async delete({ sessionID }) {},
        async abort({ sessionID }) {},
        async list(opts) { return []; },
        async todo({ sessionID }) { return []; },
        async children({ sessionID }) { return []; },
        async summarize(opts) {},
      },
      global: { async event() { /* → {stream: AsyncIterable} */ } },
      provider: { async list() { return { all: [], connected: [], default: {} }; } },
      app: { async agents() { return []; } },
      config: { async get() { return {}; }, async update(c) { return c; } },
      async healthCheck() { return true; },
    };
  },
};
\`\`\`

Capabilities declared here gate gateway features declaratively: missing
capabilities disable the corresponding features (503 on gated endpoints,
skipped event subscription) — they never crash.
`;

const EXAMPLE_CONTENT = `// Rename to example.js to activate
module.exports = {
  name: "example",
  capabilities: { eventStream: false },
  async createRuntime(ctx) {
    ctx.log.info("[example-runtime] created");
    throw new Error("example plugin: implement createRuntime before activating");
  },
};
`;
