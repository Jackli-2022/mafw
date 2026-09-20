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
  /** runtime 提供会话分支原语（fork/revert；unrevert 视实现可选——pi 不提供） */
  sessionBranchApi?: boolean;
  /** runtime 原生强制执行 SessionPromptOpts.maxTurns/maxCostUsd（声明后 gateway 不再挂 BudgetGuard） */
  turnBudgetApi?: boolean;
  /** runtime 提供原生 question API（question.list/reply/reject） */
  questionApi?: boolean;
  /** runtime 提供会话 diff 与工作区 patch 应用（session.diff / vcs.diff / vcs.apply；opencode v2 独有） */
  diffApi?: boolean;
  /** runtime 支持按 directory 创建会话（worktree 并行隔离前提；opencode 天然支持） */
  worktreeApi?: boolean;
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
    sessionBranchApi: true,
    diffApi: true,
    worktreeApi: true,
    // opencode 适配器不转发 maxTurns/maxCostUsd（SDK 无对应字段）——预算由
    // gateway 侧 BudgetGuard 承担；声明 true 会让 attachBudgetGuardForGoal
    // 跳过挂载，goal 预算在默认 runtime 上完全失效。
    turnBudgetApi: false,
    questionApi: true,
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
    sessionBranchApi: false,
    turnBudgetApi: false,
    questionApi: false,
    diffApi: false,
    worktreeApi: false,
  };
}

// ─── 会话接口面（与现 OpencodeAdapter 方法面 1:1 一致） ─────────────────────

export interface SessionCreateOpts {
  directory?: string;
}

export interface SessionPromptOpts {
  sessionID: string;
  /** 消息部件。{type:'file', url, mime?, filename?} 为一等媒体附件载体（dataURL 或
   *  工件引用），mime 决定模态（image/video/audio）——runtime 必须作为多模态输入
   *  递给模型，不得文本拍平丢弃。 */
  parts?: Array<{ type: string; text?: string; [k: string]: any }>;
  message?: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  system?: string;
  /** busy 会话的消息投递时机：'steer'=当前工具批后送达（纠偏），'followup'=全部完成后。
   *  opencode 无原生概念（忽略声明）；pi 映射 streamingBehavior（busy 时生效）。 */
  delivery?: 'steer' | 'followup';
  /** 期望本条消息触发 LLM 回复。false = 落历史免回复（opencode noReply 语义）。
   *  pi 无原生等价——全路径降级为普通消息（busy 时 followUp），每会话 warn 一次。 */
  expectReply?: boolean;
  /** @deprecated 用 expectReply: false 替代；消费方迁移完成后删除 */
  noReply?: boolean;
  /** 回合数上限（一次 prompt 内 agentic loop 步数）；超出即中止。原生支持见 turnBudgetApi。 */
  maxTurns?: number;
  /** 本次 prompt 的美元成本上限；超出即中止。原生支持见 turnBudgetApi。 */
  maxCostUsd?: number;
}

/**
 * 回合结果信封——session.prompt() 的返回超集。字段取不到 = undefined
 * （不是错误）；error 存在时 parts 原样返回（不抛异常，与现状一致）。
 */
export interface PromptResultEnvelope {
  parts: any[];
  /** runtime 原生 finish reason（opencode AssistantMessage.finish） */
  finish?: string;
  /** undefined = runtime 未回传；消费方据此跳过记账 */
  usage?: {
    input: number;
    output: number;
    cached?: number;
    reasoning?: number;
    costUsd?: number;
  };
  error?: { name: string; message: string };
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
  /** 约束输出为 JSON Schema。实现方映射到自己 provider 的机制（OpenAI response_format）；
   *  映射不了则忽略（fail-open）——结果仍可能非 JSON，消费方自解析兜底。 */
  responseFormat?: {
    type: 'json_schema';
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
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
    prompt(opts: SessionPromptOpts): Promise<PromptResultEnvelope & { [k: string]: any }>;
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
    /** 回复权限请求。'once'=仅本次放行；'always'=放行并持久化规则（opencode 原生规则 /
     *  pi session 级动态 allowlist）；'reject'=拒绝。message 为给 agent 的可选说明。
     *  签名为 P1 破坏性变更（原 boolean approved）；方法可选性仅约束未实现审批的 runtime。 */
    permissionReply?(
      sessionID: string,
      requestId: string,
      reply: 'once' | 'always' | 'reject',
      message?: string,
    ): Promise<boolean>;
    /** 待审批权限请求列表（ApprovalCard 轮询用）。opencode：serve /permission 列表；
     *  pi：ApprovalBridge pending map。返回形状与 gateway-sdk PermissionRequest 对齐
     *  （{id, sessionID, permission, patterns, metadata?, tool?}）。未实现 → 调用方 fail-open 空列表。 */
    permissionList?(opts?: { directory?: string }): Promise<any[]>;
    /** 原生 question 通道（questionApi 能力）。opencode 实现；pi 无 question API 不实现。
     *  answers 为 string[][]——每个问题一组答案选项（与 opencode QuestionAnswer 对齐）。
     *  directory：opencode serve 的 workspace 路由用（V1 原生路由 workspace-scoped）。 */
    question?: {
      list(opts?: { directory?: string }): Promise<any[]>;
      reply(opts: { requestID: string; answers: string[][]; directory?: string }): Promise<void>;
      reject(opts: { requestID: string; directory?: string }): Promise<void>;
    };
    /**
     * 分叉为新会话：原会话不动，新会话携带截至 messageID（缺省=当前末尾）的历史。
     * pi 实现经 SessionManager.createBranchedSession + 新 AgentSession。
     */
    fork?(opts: { sessionID: string; messageID?: string }): Promise<{ id: string }>;
    /**
     * 消息级回退。opencode：撤回该点之后的消息并回滚文件改动（可 unrevert 恢复）；
     * pi：映射为 SessionManager.branch() 原地移动 leaf——不回滚文件、不可逆，
     * 语义弱于 opencode，调用方不得假设文件回滚。
     */
    revert?(opts: { sessionID: string; messageID: string; partID?: string }): Promise<void>;
    /** 撤销 revert（仅 opencode；pi 不实现——方法缺席即能力缺失） */
    unrevert?(opts: { sessionID: string }): Promise<void>;
    /**
     * 会话文件变更 diff（diffApi 能力）。opencode v2 `session.diff`——返回某会话
     * （可选锚定 messageID）导致的文件变更快照。pi 不实现。
     */
    diff?(opts: { sessionID: string; messageID?: string }): Promise<
      Array<{ file?: string; patch?: string; additions?: number; deletions?: number; status?: string }>
    >;
    /**
     * 工作区 git 原语（diffApi 能力；opencode v2 独有）。apply 将 patch 落到
     * runtime 工作区（用于 hunk 级反向回退）；diff 返回工作区/分支级 diff。
     */
    vcs?: {
      diff?(opts?: { mode?: 'git' | 'branch' }): Promise<any[]>;
      apply?(opts: { patch: string }): Promise<void>;
    };
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
  /**
   * 健康检测唯一真相源（watchdog / adopt / supervisor 全部经此；gateway 不自带探测）。
   * 语义 = "agent 后端活着"——serve 型 runtime 探测 serve，进程内 runtime 探测自身引擎。
   */
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
     *  拉起（MCP-only 降级），不再硬编码任何具体 agent 的 spawn 细节。
     *  host/port 缺省由 runtime 自定（serve 端口是实现细节）；sidecar 报告的
     *  实际 URL 由 runtime 吸收（getBaseUrl/healthCheck 随之更新）。 */
    spawnServe?(opts: ServeSpawnOpts): Promise<ServeSpawnResult>;
    /** 清场原语：杀掉遗留的 server 端口占用者（opencode: killServePort）。
     *  gateway 不感知端口号——动态端口下"按配置端口杀"由 runtime 收敛。 */
    killServe?(): void;
  };
}

/** 拉起 runtime 自带 server 进程的选项。host/port 缺省 = runtime 自定。 */
export interface ServeSpawnOpts {
  host?: string;
  port?: number;
  timeoutMs?: number;
  onOutput?: (chunk: string) => void;
  onExit?: (code: number | null) => void;
}

/** startServe 的产物：url + 关闭原语。 */
export interface ServeSpawnResult {
  url: string;
  close(): void;
}
