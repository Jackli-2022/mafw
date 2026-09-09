/**
 * Runtime 能力契约 —— gateway 与 agent runtime（opencode / claude / pi ...）之间的接缝。
 *
 * 设计原则：能力自声明 + fail-open 降级。runtime 加载时声明 capabilities，
 * gateway 按能力集开关功能：
 *   Tier 0（sessionApi + promptWhileBusy）→ 协作协议（Goal/问答/反馈）+ per-turn 记忆
 *   Tier 1（+ eventStream）→ 自治执行（Goal plan/execute/review）+ per-step 记忆
 *   Tier 2（+ opencode 形状 DTO 归一化输出）→ 桌面聊天面完整
 * 降级是声明式的：缺能力的 runtime 只影响功能丰富度，永不阻塞 agent 基本工作。
 *
 * 可选能力（不在 Tier 分级内，按需声明）：
 *   sessionStorageApi — 直读 runtime 私有存储列出会话（opencode 用 SQLite）
 *   agentConfigApi    — agent 定义安装（opencode 写 frontmatter markdown）
 *
 * 可选接口扩展（RuntimeClient 上的可选字段）：
 *   credentials  — { getApiKey(provider) } 凭据获取
 *   agents       — { install(name, definition) } agent 定义安装
 *   session.listByDirectory — 按目录列出会话
 *   external + getBaseUrl() — runtime 声明托管模式
 */
import type { AgentDefinition } from './agent-definition';

export interface RuntimeCapabilities {
  /** session.create/prompt/promptAsync/messages/... 全套会话 API */
  sessionApi: boolean;
  /** 可向会话追加消息（步进注入、wake 注入、Tier 0 的 recall 投递通道依赖） */
  promptWhileBusy: boolean;
  /** global.event() 全局事件流（步进注入/自动化触发器/桌面 SSE 依赖） */
  eventStream: boolean;
  /** runtime 原生 question/permission API（Approvals 透传依赖） */
  nativeApprovals: boolean;
  /** provider.list / app.agents / config.get|update（桌面设置页依赖） */
  providerConfigApi: boolean;
  /** 宿主插件提供 per-LLM-call messages transform（per-step recall；信息性声明，gateway 不直接消费） */
  perLlmCallTransform: boolean;
  /** runtime 提供 session.listByDirectory（直接按目录查会话，无需 session.list 全量拉取 + 客户端过滤） */
  sessionStorageApi?: boolean;
  /** runtime 提供 agent 定义安装（permission guardrails 等；缺省时跳过安装 + warn） */
  agentConfigApi?: boolean;
  /** runtime 拥有 agent 进程生命周期（Tier 1+），可提供 agentProcess.restart() 原语 */
  agentProcessApi?: boolean;
  /** runtime 提供无状态单次补全（completion.complete），供 scan/media 等无状态通道使用 */
  completionApi?: boolean;
}

export function fullCapabilities(): RuntimeCapabilities {
  return {
    sessionApi: true,
    promptWhileBusy: true,
    eventStream: true,
    nativeApprovals: true,
    providerConfigApi: true,
    perLlmCallTransform: true,
    sessionStorageApi: true,
    agentConfigApi: true,
    agentProcessApi: true,
    completionApi: true,
  };
}

export function minimalCapabilities(): RuntimeCapabilities {
  return {
    sessionApi: true,
    promptWhileBusy: true,
    eventStream: false,
    nativeApprovals: false,
    providerConfigApi: false,
    perLlmCallTransform: false,
    sessionStorageApi: false,
    agentConfigApi: false,
    agentProcessApi: false,
  };
}

// ─── 会话接口面（与现 OpencodeAdapter 方法面 1:1 一致） ─────────────────────

export interface SessionCreateOpts {
  directory?: string;
}

export interface SessionPromptOpts {
  sessionID: string;
  parts?: Array<{ type: string; text?: string; [k: string]: any }>;
  message?: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  system?: string;
  noReply?: boolean;
}

export interface SessionMessagesOpts {
  sessionID: string;
  limit?: number;
  before?: string;
}

export interface SessionSummarizeOpts {
  sessionID: string;
  providerID?: string;
  modelID?: string;
}

export interface SessionInfo {
  id: string;
  projectID: string;
  directory: string;
  title: string;
  /** Present on subagent/child sessions (Task tool dispatches); absent for top-level sessions. */
  parentID?: string;
  metadata?: Record<string, unknown>;
  time: { created: number; updated: number };
}

export interface RuntimeCredentials {
  getApiKey(provider: string): string | null;
}

// ─── 无状态补全通道（completionApi 能力） ──────────────────────────────────
// 契约语义：无状态——请求不携带 sessionID，实现方不得跨调用保留对话状态。
// cacheable 是提示非承诺：实现方映射到 provider 的 prompt-cache 机制
// （如 DashScope cache_control），映射不了则忽略（fail-open）。
// 媒体只有 image carrier；wire 格式改写（video_url/input_audio）是实现方内部细节。

export interface CompletionRequest {
  model: { providerID: string; modelID: string };
  system?: Array<{ text: string; cacheable?: boolean }>;
  user: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }   // data = base64（无 data: 前缀）
  >;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface CompletionResult {
  text: string;
  /** undefined = provider 未回传 usage；消费方据此跳过记账 */
  usage?: { input: number; cached: number; output: number };
}

export interface CompletionChannel {
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export interface RuntimeClient {
  session: {
    create(opts: SessionCreateOpts): Promise<{ id: string; [k: string]: any }>;
    promptAsync(opts: SessionPromptOpts): Promise<{ error?: any; response?: any } | void>;
    prompt(opts: SessionPromptOpts): Promise<{ parts: any[]; [k: string]: any }>;
    messages(opts: SessionMessagesOpts): Promise<{ data: any[]; nextCursor?: string }>;
    get(opts: { sessionID: string }): Promise<any>;
    delete(opts: { sessionID: string }): Promise<void>;
    /** Rename a session (flat { sessionID, title }); optional — opencode/pi implement it. */
    update?(opts: { sessionID: string; title: string }): Promise<any>;
    abort(opts: { sessionID: string }): Promise<void>;
    list(opts?: { directory?: string }): Promise<any[]>;
    listByDirectory?(directory: string, limit?: number): Promise<SessionInfo[]>;
    todo(opts: { sessionID: string }): Promise<any[]>;
    children(opts: { sessionID: string }): Promise<any[]>;
    summarize(opts: SessionSummarizeOpts): Promise<any>;
    permissionReply?(sessionID: string, requestId: string, approved: boolean): Promise<boolean>;
  };
  global: {
    event(): Promise<any>;
  };
  provider: {
    list(): Promise<{ all: any[]; connected: string[]; default: Record<string, string> }>;
  };
  app: {
    agents(): Promise<any[]>;
  };
  config: {
    get(): Promise<any>;
    update(config: any): Promise<any>;
  };
  /** 无状态补全通道（capabilities.completionApi = true 时必须提供） */
  completion?: CompletionChannel;
  credentials?: RuntimeCredentials;
  agents?: {
    install(name: string, definition: AgentDefinition): Promise<void>;
    remove?(name: string): Promise<void>;
  };
}

export interface AgentRuntime extends RuntimeClient {
  /** runtime 标识，如 'opencode' */
  readonly name: string;
  readonly capabilities: RuntimeCapabilities;
  /**
   * true = 外部托管（gateway 不 spawn/监管 serve 进程）。
   * When external=true: watchdog only probes health + reconnects event stream,
   * never kills or respawns the external process.
   */
  readonly external?: boolean;
  /** Returns the base URL of the serve process (external or owned). */
  getBaseUrl(): string;
  /** 健康探测（watchdog / adopt 判定用）；缺省时由调用方自管。 */
  healthCheck?(): Promise<boolean>;
  /**
   * Agent 进程重启原语（只有 runtime 自己知道如何重启自己的进程）。
   * 不负责事件流重订——由 gateway recoverServe 编排。
   */
  agentProcess?: {
    /** 杀掉 runtime 自带的 server 进程（opencode: kill serve 端口）。
     *  重生（respawn）由 gateway 编排：supervisor 经 spawnServe 原语重新拉起。 */
    restart(): Promise<void>;
    /** 拉起 runtime 自带的 server 进程（opencode: `opencode serve` sidecar，
     *  含 windowsHide）。进程内 runtime（pi）不提供——gateway 据此跳过 serve
     *  拉起（MCP-only 降级），不再硬编码任何具体 agent 的 spawn 细节。 */
    spawnServe?(opts: ServeSpawnOpts): Promise<ServeSpawnResult>;
  };
}

/** 拉起 runtime 自带 server 进程的选项。 */
export interface ServeSpawnOpts {
  host: string;
  port: number;
  timeoutMs?: number;
  onOutput?: (chunk: string) => void;
  onExit?: (code: number | null) => void;
}

/** startServe 的产物：url + 关闭原语。 */
export interface ServeSpawnResult {
  url: string;
  close(): void;
}
