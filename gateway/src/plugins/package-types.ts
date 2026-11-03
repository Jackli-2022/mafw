import type { log } from '../core/utils/logger';
import type { PromptFn } from '../media/media-service';
import type { AgentRuntime, RuntimeCapabilities, RuntimeCredentials } from '../runtime/contract';
import type { UsageStatsProvider } from '../usage/plugin-context';
import type {
  PluginActionDescriptor,
  PluginEventDescriptor,
  PluginJsonSchema,
  PluginUiContribution,
} from '@mafw/plugin-contract';

/** 统一插件包上下文 —— 三个 legacy ctx（usage/media/runtime）的超集。 */
export interface PluginPackageContext {
  log: typeof log;
  /** fetch，默认 60s 超时 */
  fetch: (url: string, opts?: RequestInit) => Promise<Response>;
  /** 读 opencode auth.json 的 provider key（经 runtime credentials 链） */
  apiKey: (provider: string) => string | null;
  /** plugins.<name>.config；缺省回退 legacy 三段 pluginConfig（usage→media→runtime），全缺省 {} */
  pluginConfig: () => Record<string, any>;
  /** 包自身的配置写入口（仅能写 plugins.<package>.config）。 */
  config: PluginPackageConfigApi;
  credentials?: RuntimeCredentials;
  projectDir: string;
  gatewayPort: number;
  usage: UsageStatsProvider;
  /** 向全部 UI 通道（SSE/WS/推送）广播自定义事件。type 必须是本包已注册的
   *  'plugin:<name>:<event>'；未注册/canonical/外命名空间/schema 失败的发射
   *  一律丢弃并记诊断（Host 包装，见 package-context.withPluginEmit）。 */
  emit: (event: PluginEmitEvent) => void;
  /**
   * 注册本包在 `activate()` 里创建的外部副作用清理（timer / listener /
   * 自建 watcher / 缓存等）。
   *
   * 清理归该 candidate 的 RegistrationBag：reload/replace/disable/delete
   * 时执行一次，LIFO（最近注册的先执行），单个 disposer 失败只记诊断。
   * candidate 被丢弃或离线 check 结束时同样执行——`activate()` 里拿到的资源
   * 必须在这里释放，否则会跟随旧 revision 泄漏。
   *
   * @throws Error 宿主未提供 RegistrationBag（非 PluginHost 场景）。
   */
  effect: (dispose: () => void | Promise<void>) => void;
}

/**
 * `ctx.emit` 的中性信封：`properties` 是 event.properties（经声明 schema 校验），
 * `sessionID` 可选。`properties` 缺省时其余顶层键按旧扁平形态收作 properties。
 */
export interface PluginEmitEvent {
  type: string;
  properties?: Record<string, unknown>;
  sessionID?: string;
  [key: string]: unknown;
}

/** 只允许改自己命名空间的配置 API（Host 注入 config.persistOverrides）。 */
export interface PluginPackageConfigApi {
  /**
   * 浅合并写入 `plugins.<package>.config.<key>`。
   *
   * 补丁本身永远落在包命名空间之下——传入 `{ server: ... }` 只会得到
   * `plugins.<package>.config.server`，不可能改到顶层配置键。
   *
   * @throws TypeError 补丁不是纯对象、含原型污染键、循环引用或非 JSON 值。
   * @throws Error 宿主未提供配置持久化能力。
   */
  update: (patch: Record<string, unknown>) => void;
}

export interface MediaContributionSpec {
  /** 缺省 = 包名 */
  name?: string;
  modalities: string[];
  createPrompt?: (ctx: PluginPackageContext) => Promise<PromptFn>;
  engine?: 'pi';
  fixPayload?: (payload: any) => any;
}

export interface RuntimeContributionSpec {
  /** 缺省 = 包名 */
  name?: string;
  capabilities?: Partial<RuntimeCapabilities>;
  external?: boolean;
  createRuntime: (ctx: PluginPackageContext) => Promise<AgentRuntime>;
}

export interface TtsContributionSpec {
  /** 缺省 = 包名 */
  name?: string;
  capabilities: import('../tts/types').TtsCapabilities;
  voices(): import('../tts/types').TtsVoice[];
  synthesize(ctx: PluginPackageContext, text: string, opts: import('../tts/types').TtsOpts): Promise<Buffer>;
  synthesizeStream?(ctx: PluginPackageContext, text: string, opts: import('../tts/types').TtsOpts, signal: AbortSignal): AsyncIterable<import('../tts/types').PcmChunk>;
}

export interface PluginContributions {
  /** legacy usage 插件模块形状：{ name, type?, plan?, fetch(ctx), configSchema? } */
  usage?: Record<string, any>;
  media?: MediaContributionSpec;
  runtime?: RuntimeContributionSpec;
  tts?: TtsContributionSpec;
  /** v1 仅登记展示，不激活（desktop 进程侧加载不变） */
  uiTools?: Record<string, unknown>;
}

/**
 * Host-side action declaration (never serialized to Desktop).
 *
 * `handler` stays in the gateway process; only `inputSchema` / `outputSchema` /
 * metadata are projected into the client descriptor.
 */
export interface PluginActionDeclaration {
  title?: string;
  description?: string;
  /** 标准 JSON Schema（2020-12，无远程 $ref），调用前校验 input。 */
  inputSchema?: PluginJsonSchema;
  /** 标准 JSON Schema（2020-12，无远程 $ref），返回后校验 output。 */
  outputSchema?: PluginJsonSchema;
  /** 缺省 PLUGIN_UI_LIMITS.defaultActionTimeoutMs，上限 maxActionTimeoutMs。 */
  timeoutMs?: number;
  handler: (
    input: unknown,
    call: { sessionID?: string; signal: AbortSignal },
  ) => unknown;
}

/**
 * Host-side event declaration.
 *
 * `schema` is the same field name the client descriptor uses for the event
 * payload schema: one concept, not two. The design document's `payloadSchema`
 * spelling is accepted as an input alias and normalized into `schema`.
 */
export interface PluginEventDeclaration {
  /** 必须是 `plugin:<package>:<event>`；canonical 事件名一律拒绝。 */
  type: string;
  title?: string;
  description?: string;
  /** event.properties 的 JSON Schema（2020-12，无远程 $ref）。 */
  schema?: PluginJsonSchema;
  /** @deprecated 设计文档拼写别名；等价于 `schema`，两者不可同时声明。 */
  payloadSchema?: PluginJsonSchema;
  scope?: 'global' | 'session';
}

/** `activate()` 的完整返回形状：legacy 贡献 + 统一声明式贡献。 */
export interface UnifiedPluginContributions extends PluginContributions {
  /** 声明式 UI 贡献；纯 Host 包可省略。 */
  ui?: PluginUiContribution;
  /** action 名（包内唯一，不含 `:`）→ Host 声明。 */
  actions?: Record<string, PluginActionDeclaration>;
  /** 本包 `plugin:<package>:*` 事件声明。 */
  events?: PluginEventDeclaration[];
}

/** 校验并投影后的单个 action。 */
export interface ActivatedAction {
  name: string;
  /** 可序列化 DTO（无 handler）。 */
  descriptor: PluginActionDescriptor;
  /** Host 声明（含 handler）。 */
  declaration: PluginActionDeclaration;
}

/** 校验并投影后的单个事件。 */
export interface ActivatedEvent {
  /** 可序列化 DTO。 */
  descriptor: PluginEventDescriptor;
  declaration: PluginEventDeclaration;
}

/**
 * `activate()` 返回值的规范化结果：legacy 贡献原样保留，统一贡献被拆成
 * 「可下发给 Desktop 的 DTO」与「仅留在 gateway 的声明」两半。
 */
export interface ActivatedContributions {
  ui: PluginUiContribution;
  actions: ActivatedAction[];
  events: ActivatedEvent[];
  /** usage/media/runtime/tts/uiTools 原对象（PluginHost 负责各自校验）。 */
  legacy: PluginContributions;
}

export interface RuntimePackageEntry {
  name: string;
  createRuntime: (ctx: any) => Promise<AgentRuntime>;
  capabilities: Partial<RuntimeCapabilities>;
  external: boolean;
  source: string;
}

export interface UsagePackageEntry {
  mod: Record<string, any>;
  source: string;
}

export interface MediaPackageEntry {
  name: string;
  prompt: PromptFn;
  modalities: string[];
  source: string;
}

export interface TtsPackageEntry {
  name: string;
  engine: import('../tts/types').TtsEngine;
  source: string;
}

export interface PackageManifest {
  name: string;
  version?: string;
  main?: string;
}

export interface PackageDescriptor {
  name: string;
  mainFile: string;
  manifest?: PackageManifest;
  /** 目录包时的子目录绝对路径（watcher 用） */
  pkgDir?: string;
}

export interface PackageState {
  name: string;
  source: string;
  status: 'ok' | 'error';
  error?: string;
  contributions: string[];
  version?: string;
  /**
   * Revision token (`<gatewayBootId>:<counter>`) of the committed activation.
   * Absent when the package never committed (first load failed).
   */
  revision?: string;
  /**
   * Pending candidate revision. Present while a changed package that owns the
   * active runtime waits for an explicit apply; the old revision stays active.
   */
  pendingRevision?: string;
  /** Content fingerprint of the committed activation (Host diagnostics). */
  fingerprint?: string;
}
