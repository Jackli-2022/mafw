/**
 * Runtime 能力契约 —— gateway 与 agent runtime（opencode / claude / pi ...）之间的接缝。
 *
 * 设计原则：能力自声明 + fail-open 降级。runtime 加载时声明 capabilities，
 * gateway 按能力集开关功能：
 *   Tier 0（sessionApi + promptWhileBusy）→ 协作协议（Goal/问答/反馈）+ per-turn 记忆
 *   Tier 1（+ eventStream）→ 自治执行（Goal plan/execute/review）+ per-step 记忆
 *   Tier 2（+ opencode 形状 DTO 归一化输出）→ 桌面聊天面完整
 * 降级是声明式的：缺能力的 runtime 只影响功能丰富度，永不阻塞 agent 基本工作。
 */

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
}

export function fullCapabilities(): RuntimeCapabilities {
  return {
    sessionApi: true,
    promptWhileBusy: true,
    eventStream: true,
    nativeApprovals: true,
    providerConfigApi: true,
    perLlmCallTransform: true,
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
  };
}

// ─── 会话接口面（与现 OpencodeAdapter 方法面 1:1 一致） ─────────────────────

export interface SessionCreateOpts {
  directory?: string;
}

export interface SessionPromptOpts {
  sessionID: string;
  parts?: Array<{ type: string; text: string; [k: string]: any }>;
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

export interface RuntimeClient {
  session: {
    create(opts: SessionCreateOpts): Promise<{ id: string; [k: string]: any }>;
    promptAsync(opts: SessionPromptOpts): Promise<void>;
    prompt(opts: SessionPromptOpts): Promise<{ parts: any[]; [k: string]: any }>;
    messages(opts: SessionMessagesOpts): Promise<{ data: any[]; nextCursor?: string }>;
    get(opts: { sessionID: string }): Promise<any>;
    delete(opts: { sessionID: string }): Promise<void>;
    abort(opts: { sessionID: string }): Promise<void>;
    list(opts?: { directory?: string }): Promise<any[]>;
    todo(opts: { sessionID: string }): Promise<any[]>;
    children(opts: { sessionID: string }): Promise<any[]>;
    summarize(opts: SessionSummarizeOpts): Promise<any>;
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
}

export interface AgentRuntime extends RuntimeClient {
  /** runtime 标识，如 'opencode' */
  readonly name: string;
  readonly capabilities: RuntimeCapabilities;
  /** true = 外部托管（gateway 不 spawn/监管 serve 进程）。信息性字段，一期不接线。 */
  readonly external?: boolean;
  /** 健康探测（watchdog / adopt 判定用）；缺省时由调用方自管。 */
  healthCheck?(): Promise<boolean>;
}
