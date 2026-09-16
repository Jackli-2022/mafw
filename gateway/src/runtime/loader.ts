/**
 * Runtime 插件加载器 —— 扫描 ~/.mafw/runtime-plugins/*.js，校验契约形状，
 * fail-open（单个文件失败不影响其他插件与内置 opencode）。
 *
 * 模板复用 MediaPluginLoader。支持 POST /api/runtime/reload 重扫插件文件
 * （清 require.cache 后重新 require）。运行时热切换由 runtime-switch.ts
 * 的 POST /api/runtime/switch 处理（进程内重建 + 事件流重订阅，无需重启）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';
import { config } from '../config';
import { AgentRuntime, RuntimeCapabilities, RuntimeCredentials, minimalCapabilities } from './contract';
import type { RuntimePackageEntry } from '../plugins/package-types';

export interface RuntimePluginContext {
  /** fetch with 60s default timeout */
  fetch: (url: string, opts?: any) => Promise<Response>;
  log: typeof log;
  /** 读 config.yaml 的 runtime.pluginConfig[name] */
  pluginConfig(name: string): Record<string, any>;
  /** runtime 凭据（media/pi 认证链优先走这里） */
  credentials?: RuntimeCredentials;
  /** 当前项目目录（pi 等内置件此前直读 config.raw.paths.projectDir） */
  projectDir?: string;
  /** gateway API 端口（pi getBaseUrl 此前直读 config.server.apiPort） */
  gatewayPort?: number;
}

export type RuntimeFactory = (ctx: RuntimePluginContext) => Promise<AgentRuntime>;

export interface RuntimePluginState {
  file: string;
  name?: string;
  status: 'ok' | 'error';
  error?: string;
  capabilities?: RuntimeCapabilities;
  /** filename-stem alias key registered for hub "激活" (absent when stem === name). */
  alias?: string;
}

export class RuntimePluginLoader {
  private factories = new Map<string, RuntimeFactory>();
  private meta = new Map<string, { capabilities: RuntimeCapabilities; external: boolean }>();
  private state = new Map<string, RuntimePluginState>();
  private builtins = new Map<string, { factory: RuntimeFactory; capabilities: RuntimeCapabilities; external: boolean }>();
  private packageEntries = new Map<string, RuntimePackageEntry>();

  constructor(private pluginsDir: string) {}

  /** 注册内置插件（优先级低于文件插件）。 */
  registerBuiltin(name: string, factory: RuntimeFactory, capabilities: RuntimeCapabilities, external: boolean): void {
    this.builtins.set(name, { factory, capabilities, external });
  }

  async init(): Promise<void> {
    this.ensureDir();
    await this.scan();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir, { recursive: true });
      fs.writeFileSync(path.join(this.pluginsDir, 'README.md'), README_CONTENT);
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
        if (prev?.alias) {
          this.factories.delete(prev.alias);
          this.meta.delete(prev.alias);
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
      loadedNames.add(name);
      // Filename-stem alias: the plugin hub addresses runtime plugins by
      // filename stem (statEntry baseName) while switch/createRuntime
      // validate by module.exports.name — register both so hub "激活" works
      // regardless of the declared name. The real module name always wins
      // (unconditional set above overwrites an earlier stem alias), and an
      // alias never shadows a builtin.
      const stem = file.replace(/\.js$/, '');
      let alias: string | undefined;
      if (stem !== name && !this.factories.has(stem) && !this.builtins.has(stem)) {
        this.factories.set(stem, mod.createRuntime);
        this.meta.set(stem, { capabilities, external });
        alias = stem;
      }
      this.state.set(file, { file, name, status: 'ok', capabilities, alias });
      log.info(`[RuntimePluginLoader] Loaded ${file} (${name})${alias ? ` [alias: ${alias}]` : ''}`);
    } catch (err: any) {
      const prev = this.state.get(file);
      this.state.set(file, { file, name: prev?.name, status: 'error', error: err.message });
      log.warn(`[RuntimePluginLoader] ${file} load error: ${err.message}`);
    }
  }

  /** PluginHost 推送的包贡献。查找顺序：legacy 文件 > 包 > 内置。scan() 不影响。 */
  setPackageEntries(entries: RuntimePackageEntry[]): void {
    this.packageEntries = new Map(entries.map((e) => [e.name, e]));
  }

  /** 插件不存在或未通过校验时返回 undefined（调用方回退内置 opencode）。文件插件优先于内置。 */
  get(name: string): { createRuntime: RuntimeFactory; capabilities: RuntimeCapabilities; external: boolean } | undefined {
    const createRuntime = this.factories.get(name);
    const meta = this.meta.get(name);
    if (createRuntime && meta) return { createRuntime, ...meta };
    const pkg = this.packageEntries.get(name);
    if (pkg) {
      return {
        createRuntime: pkg.createRuntime,
        capabilities: { ...minimalCapabilities(), ...pkg.capabilities },
        external: pkg.external,
      };
    }
    const builtin = this.builtins.get(name);
    if (builtin) return { createRuntime: builtin.factory, ...builtin };
    return undefined;
  }

  /** 已注册内置件名（builtin 文件件不在其中，opencode 为恒等默认由 index.ts 注入 hub）。 */
  getBuiltinNames(): string[] {
    return [...this.builtins.keys()];
  }

  getState(): RuntimePluginState[] {
    for (const [name, b] of this.builtins) {
      this.state.set(`builtin:${name}`, { file: `builtin:${name}`, name, status: 'ok', capabilities: b.capabilities });
    }
    for (const [name, p] of this.packageEntries) {
      this.state.set(`package:${name}`, {
        file: `package:${name}`, name, status: 'ok',
        capabilities: { ...minimalCapabilities(), ...p.capabilities },
      });
    }
    return [...this.state.values()];
  }
}

export function createRuntimePluginContext(
  credentials?: RuntimeCredentials,
  extra?: { projectDir?: string; gatewayPort?: number },
): RuntimePluginContext {
  return {
    fetch: (url: string, opts?: any) =>
      fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(60000) }),
    log,
    pluginConfig: (name: string) => (config.raw as any)?.runtime?.pluginConfig?.[name] ?? {},
    credentials,
    projectDir: extra?.projectDir,
    gatewayPort: extra?.gatewayPort,
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
    // optional (not in tier hierarchy):
    sessionStorageApi: false,  // direct session storage access
    agentConfigApi: false,     // agent definition installation
  },
  external: true,             // gateway never spawns plugin runtime processes
  async createRuntime(ctx) {
    // ctx.fetch / ctx.log / ctx.pluginConfig(name) / ctx.apiKey(name)
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
        // optional (requires sessionStorageApi capability):
        // async listByDirectory(directory, limit) { return []; },
      },
      global: { async event() { /* → {stream: AsyncIterable} */ } },
      provider: { async list() { return { all: [], connected: [], default: {} }; } },
      app: { async agents() { return []; } },
      config: { async get() { return {}; }, async update(c) { return c; } },
      getBaseUrl() { return "http://127.0.0.1:4096"; },
      async healthCheck() { return true; },
      // optional:
      // credentials: { getApiKey(provider) { return null; } },
      // agents: { async install(name, definition) {}, async remove(name) {} },
    };
  },
};
\`\`\`

Capabilities declared here gate gateway features declaratively: missing
capabilities disable the corresponding features (503 on gated endpoints,
skipped event subscription) — they never crash.
`;
