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
import { isKnownEventType } from './event-telemetry';
import { checkEventFields } from './event-field-contract';
import { EventMappingEntry, validateEventMappings, hasEventDeclarations } from './event-mapper';
import type { RuntimePackageEntry } from '../plugins/package-types';

export interface RuntimePluginContext {
  /** fetch with 60s default timeout */
  fetch: (url: string, opts?: any) => Promise<Response>;
  log: typeof log;
  /** 读 config.yaml 的 runtime.pluginConfig[name] */
  pluginConfig(name: string): Record<string, any>;
  /** runtime 凭据（media/pi 认证链优先走这里） */
  credentials?: RuntimeCredentials;
  /** 项目根（**绝对路径**；runtime 实例创建时的当前项目快照）。
   *  **启动期信息**，不用于 session cwd —— 建会话一律用 opts.directory（契约必填）。 */
  projectDir?: string;
  /** Runtime server 启动根目录（**绝对路径**，固定 `~/.mafw/runtime-root`）。
   *  供插件启动/定位自己的 server；**不用于 session cwd**。 */
  rootDir?: string;
  /** gateway API 端口（pi getBaseUrl 此前直读 config.server.apiPort） */
  gatewayPort?: number;
  /** 事件构造与校验助手（L3 构造期防线）。 */
  events: {
    /** 构造形状 A 信封；未知 type 打 warn（构造点第一秒可见）但不阻断（fail-open）。 */
    make(type: string, props?: Record<string, any>, sessionID?: string): { payload: { type: string; properties: Record<string, any> } };
    /** 字段契约检查（同 dry-event 端点的 warnings；空数组 = 无警告）。 */
    check(evt: object): string[];
  };
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
  private meta = new Map<string, { capabilities: RuntimeCapabilities; external: boolean } & EventMappingEntry>();
  private state = new Map<string, RuntimePluginState>();
  private builtins = new Map<string, { factory: RuntimeFactory; capabilities: RuntimeCapabilities; external: boolean } & EventMappingEntry>();
  private packageEntries = new Map<string, RuntimePackageEntry>();
  /** canonical 词汇表（校验 eventMappings.to 用）——index.ts 注入，避免 loader 依赖矩阵。 */
  private canonicalTypes: ReadonlySet<string> = new Set();

  constructor(private pluginsDir: string) {}

  setCanonicalTypes(types: ReadonlySet<string>): void {
    this.canonicalTypes = types;
  }

  /** 注册内置插件（优先级低于文件插件）。extras 携带事件映射声明（纯数据）。 */
  registerBuiltin(
    name: string,
    factory: RuntimeFactory,
    capabilities: RuntimeCapabilities,
    external: boolean,
    extras?: EventMappingEntry,
  ): void {
    this.builtins.set(name, { factory, capabilities, external, ...(extras ?? {}) });
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
        log.error(`[RuntimePluginLoader] ${file}: missing 'name' export — plugin NOT registered`);
        return;
      }
      if (typeof mod.createRuntime !== 'function') {
        this.state.set(file, { file, name, status: 'error', error: 'missing createRuntime(ctx)' });
        log.error(`[RuntimePluginLoader] ${file} (${name}): missing createRuntime(ctx) export — plugin NOT registered`);
        return;
      }
      if (loadedNames.has(name)) {
        this.state.set(file, { file, name, status: 'error', error: 'duplicate name' });
        log.warn(`[RuntimePluginLoader] ${file}: duplicate name '${name}', skipping`);
        return;
      }
      // 能力合并：插件声明覆盖在 Tier-0 基线之上
      const capabilities: RuntimeCapabilities = { ...minimalCapabilities(), ...(mod.capabilities || {}) };
      // 事件映射声明（纯数据）：eventSource + eventMappings + transformEvent
      const eventExtras: EventMappingEntry = {
        eventSource: mod.eventSource,
        eventMappings: Array.isArray(mod.eventMappings) ? mod.eventMappings : undefined,
        transformEvent: typeof mod.transformEvent === 'function' ? mod.transformEvent : undefined,
      };
      // 加载期校验：未知 canonical to / 坏路径 → eventStream 能力降级 + error 状态（fail-open，仍注册）
      let mappingIssues: string[] = [];
      try {
        mappingIssues = validateEventMappings(eventExtras, this.canonicalTypes);
      } catch (err: any) {
        mappingIssues = [`event mapping validation threw: ${err.message}`];
      }
      // B1 default-deny 前置：声明 eventStream 却无任何翻译声明 → 原生流会被整条拦截，
      // 与其静默全灭不如加载期降级（声明翻译行或 canonicalIdentity() 恒等行后再开）。
      if (capabilities.eventStream && !hasEventDeclarations(eventExtras)) {
        capabilities.eventStream = false;
        mappingIssues.push('eventStream capability declared but no eventMappings/transformEvent — default-deny would drop the entire native stream; capability downgraded (declare translations or identity rows via canonicalIdentity())');
      }
      if (mappingIssues.length > 0) {
        for (const i of mappingIssues) log.warn(`[RuntimePluginLoader] ${file}: ${i}`);
        capabilities.eventStream = false;
      }
      // 事件注册交叉校验：声明了映射面但事件流关闭 / 死配置——不强制降级
      // （runtime 可能直发 canonical 事件），但记 error 状态让 hub 可见。
      const crossIssues: string[] = [];
      const hasMappings = (eventExtras.eventMappings?.length ?? 0) > 0;
      if (hasMappings && !capabilities.eventStream) {
        crossIssues.push('eventMappings declared but capabilities.eventStream is false — mappings never applied');
      }
      if (eventExtras.transformEvent && !capabilities.eventStream) {
        crossIssues.push('transformEvent declared but capabilities.eventStream is false — never invoked');
      }
      if (eventExtras.eventSource && !hasMappings && !eventExtras.transformEvent) {
        crossIssues.push('eventSource declared but neither eventMappings nor transformEvent — dead config');
      }
      for (const i of crossIssues) log.warn(`[RuntimePluginLoader] ${file}: ${i}`);
      const issues = [...mappingIssues, ...crossIssues];
      // 插件 runtime 一律视为外部托管（gateway 不 spawn/监管其进程）
      const external = mod.external !== false;
      this.factories.set(name, mod.createRuntime);
      this.meta.set(name, { capabilities, external, ...eventExtras });
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
        this.meta.set(stem, { capabilities, external, ...eventExtras });
        alias = stem;
      }
      this.state.set(file, {
        file, name,
        status: issues.length > 0 ? 'error' : 'ok',
        error: issues.length > 0 ? issues.join('; ') : undefined,
        capabilities, alias,
      });
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
  get(name: string): ({ createRuntime: RuntimeFactory; capabilities: RuntimeCapabilities; external: boolean } & EventMappingEntry) | undefined {
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
  extra?: { projectDir?: string; gatewayPort?: number; rootDir?: string },
): RuntimePluginContext {
  return {
    fetch: (url: string, opts?: any) =>
      fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(60000) }),
    log,
    pluginConfig: (name: string) => (config.raw as any)?.runtime?.pluginConfig?.[name] ?? {},
    credentials,
    projectDir: extra?.projectDir,
    rootDir: extra?.rootDir,
    gatewayPort: extra?.gatewayPort,
    events: {
      make: (type: string, props?: Record<string, any>, sessionID?: string) => {
        if (!isKnownEventType(type)) {
          log.warn(
            `[ctx.events] plugin constructing UNKNOWN event type '${type}' — desktop renders nothing; ` +
            `map to a canonical type or use 'plugin:<name>:<event>' (this warn fires at the emit call site)`,
          );
        }
        return {
          payload: {
            type,
            properties: sessionID ? { ...(props || {}), sessionID } : { ...(props || {}) },
          },
        };
      },
      check: (evt: object) => checkEventFields(evt as any),
    },
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
  // merged over Tier-0 defaults (sessionApi + promptWhileBusy already true;
  // the tools registration channel is REQUIRED — hard validation rejects
  // plugins without it)
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
      // REQUIRED (Tier-0): tool registration channel — MAFW basic tools reach
      // your agents through this. Store the factory; call it per session and
      // register each {name, label, description, parameters, execute} into
      // your runtime's native tool registry (parameters is JSON Schema).
      tools: {
        async registerTools(factory) { myRuntime.toolFactory = factory; },
        nativeTools() {
          return [
            { name: 'my_read', toolClass: 'readonly' },
            // toolClass: readonly|search|file-edit|shell|subagent|web|plan
          ];
        },
      },
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

## Event mappings (declarative native → canonical)

Declare how your runtime's native events map onto the canonical vocabulary
(see packages/gateway-sdk/src/events.ts). No hand-written translation layer:

\`\`\`js
module.exports = {
  name: "my-runtime",
  capabilities: { eventStream: true },
  eventSource: { typePath: "$.type", sessionIdPath: "$.sessionID" },
  eventMappings: [
    { from: ["turn_done"], to: "turn.completed", passProperties: "$.properties" },
    { from: "turn_failed", to: "turn.failed", passProperties: "$.properties" },
    { from: "token", to: "part.delta",
      fields: { "part.type": { const: "text" }, "part.text": { path: "$.text" } } },
    { from: "step_end", to: "part.updated",
      fields: { "part.type": { const: "step-finish" },
                "part.messageID": { template: "my_{$.sessionID}" } } },
    { from: "heartbeat", to: "drop" },
  ],
  // Escape hatch: state machines, 1→N fan-out, side effects. Called only when
  // no mapping matches. Return null to drop, an array to fan out.
  transformEvent(raw) { return null; },
  async createRuntime(ctx) { /* ... */ },
};
\`\`\`

Match priority: eventMappings (array order — includes \`drop\` rows and
\`canonicalIdentity()\`-derived identity rows) → transformEvent (guarded) →
dropped + unmatched counter. There is NO canonical passthrough branch: a
runtime emitting same-named canonical events registers identity rows via
canonicalIdentity('$.payload.properties') (vocabulary single source).
Load-time validation rejects unknown canonical targets / malformed paths /
eventStream-without-declarations (plugin's eventStream capability degrades,
fail-open). Drop counters: GET /api/runtime .translationDrops (unmatched =
monitoring signal; suppressed = declared drop / transformEvent null).
`;
