/**
 * Legacy opencode driver shapes.
 *
 * The gateway's `runtime/contract.ts` owns the *legacy* `AgentRuntime` /
 * `RuntimeClient` interface for one more release. The driver moved into this
 * package (Plan 6 Task 6) and must not import the gateway, so the structural
 * subset it implements lives here. Neutral DTOs that already have a named
 * contract export (discovery, PTY, MCP, thinking levels) are re-used from
 * `@mafw/runtime-contract` instead of duplicated.
 *
 * `RuntimeCredentials` stays a local mirror: the contract's factory context
 * declares it inline, without a named export.
 */
import type {
  EventMappingEntry,
  MafwMessage,
} from '@mafw/runtime-core';
import type {
  RuntimeAgentDefinition,
  RuntimeCapabilities,
  RuntimeDiscoveryChannel,
  RuntimeMcpChannel,
  RuntimeMcpConfigChannel,
  RuntimeProviderTransport,
  RuntimePtyChannel,
  RuntimeSnapshotTreeChannel,
} from '@mafw/runtime-contract';

/** Provider credential lookup (`RuntimeFactoryContext.credentials` shape). */
export interface RuntimeCredentials {
  getApiKey(provider: string): string | null;
}

export type { RuntimeAgentDefinition as AgentDefinition };
export type {
  RuntimeCapabilities,
  RuntimeDiscoveryCommand as RuntimeCommandInfo,
  RuntimeDiscoverySkill as RuntimeSkillInfo,
  RuntimeDiscoverySkillContent as RuntimeSkillContent,
  RuntimeDiscoveryResult,
  RuntimeDiscoveryWarning,
} from '@mafw/runtime-contract';

/** MAFW terminal protocol identifier (frames are gateway-owned). */
export const MAFW_TERMINAL_PROTOCOL = 'mafw-terminal/1';

/** Provider transport returned by `RuntimeHostSurface.resolveProviderTransport`. */
export type { RuntimeProviderTransport };

// ─── 会话接口面（与 gateway runtime/contract.ts 1:1 一致） ───────────────────

export interface SessionCreateOpts {
  /** 会话工作目录。**必填、绝对路径**——由 gateway 每次显式提供。 */
  directory: string;
  /** 2.1 原生父子会话（subagent / goal wave）；缺省顶层会话。 */
  parentID?: string;
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface SessionPromptOpts {
  sessionID: string;
  parts?: Array<{ type: string; text?: string; [k: string]: any }>;
  message?: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  variant?: string;
  thinkingLevel?: ThinkingLevel;
  system?: string;
  delivery?: 'steer' | 'followup' | 'queue';
  idempotencyKey?: string;
  expectReply?: boolean;
  maxTurns?: number;
  maxCostUsd?: number;
  outputSchema?: unknown;
}

export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'tool_use'
  | 'refusal'
  | 'cancelled'
  | 'error'
  | 'unknown';

export interface PromptResultEnvelope {
  parts: any[];
  finish?: string;
  stopReason?: StopReason;
  structured?: unknown;
  structuredError?: string;
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
  parentID?: string;
  depth?: number;
  metadata?: Record<string, unknown>;
  time: { created: number; updated: number };
}

// ─── 工具注册通道 ────────────────────────────────────────────────────────────

/** Legacy tool semantic classes (gateway `tool-classes.ts` owns the union). */
export type ToolClass =
  | 'readonly'
  | 'search'
  | 'file-edit'
  | 'shell'
  | 'subagent'
  | 'web'
  | 'plan'
  | 'other';

export interface NativeToolDeclaration {
  name: string;
  toolClass: ToolClass;
  canonical?: string;
}

export interface RuntimeTools {
  registerTools(factory: (sessionId: string) => unknown[]): Promise<void>;
  nativeTools(): NativeToolDeclaration[];
}

// ─── 无状态补全通道 ──────────────────────────────────────────────────────────

export interface CompletionRequest {
  model: { providerID: string; modelID: string };
  system?: Array<{ text: string; cacheable?: boolean }>;
  user: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }
  >;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  responseFormat?: {
    type: 'json_schema';
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface CompletionResult {
  text: string;
  usage?: { input: number; cached: number; output: number };
}

export interface CompletionChannel {
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

// ─── Agent process primitives ───────────────────────────────────────────────

export interface ServeSpawnOpts {
  host?: string;
  port?: number;
  rootDir?: string;
  timeoutMs?: number;
  onOutput?: (chunk: string) => void;
  onExit?: (code: number | null) => void;
}

export interface ServeSpawnResult {
  url: string;
  close(): void;
}

// ─── Legacy client / runtime shape ──────────────────────────────────────────

export interface RuntimeClient {
  session: {
    create(opts: SessionCreateOpts): Promise<{ id: string; [k: string]: any }>;
    promptAsync(opts: SessionPromptOpts): Promise<{ error?: any; response?: any } | void>;
    prompt(opts: SessionPromptOpts): Promise<PromptResultEnvelope & { [k: string]: any }>;
    messages(opts: SessionMessagesOpts): Promise<{ data: any[]; nextCursor?: string }>;
    normalizeMessages?(raw: any[]): MafwMessage[];
    get(opts: { sessionID: string }): Promise<any>;
    delete(opts: { sessionID: string }): Promise<void>;
    update?(opts: { sessionID: string; title: string }): Promise<any>;
    abort(opts: { sessionID: string }): Promise<void>;
    background?(opts: { sessionID: string }): Promise<void>;
    list(opts?: { directory?: string }): Promise<any[]>;
    listByDirectory?(directory: string, limit?: number): Promise<SessionInfo[]>;
    todo(opts: { sessionID: string }): Promise<any[]>;
    children(opts: { sessionID: string }): Promise<any[]>;
    switchAgent?(opts: { sessionID: string; agent: string }): Promise<void>;
    switchModel?(opts: {
      sessionID: string;
      model: { providerID: string; modelID: string };
      variant?: string;
    }): Promise<void>;
    setThinkingLevel?(opts: { sessionID: string; level: ThinkingLevel }): Promise<void>;
    summarize(opts: SessionSummarizeOpts): Promise<any>;
    permissionReply?(
      sessionID: string,
      requestId: string,
      reply: 'once' | 'always' | 'reject',
      message?: string,
    ): Promise<boolean>;
    permissionList?(opts?: { directory?: string }): Promise<any[]>;
    question?: {
      list(opts?: { directory?: string }): Promise<any[]>;
      reply(opts: { requestID: string; answers: string[][]; directory?: string }): Promise<void>;
      reject(opts: { requestID: string; directory?: string }): Promise<void>;
    };
    fork?(opts: { sessionID: string; messageID?: string }): Promise<{ id: string }>;
    revert?(opts: { sessionID: string; messageID: string; partID?: string; files?: boolean }): Promise<void>;
    unrevert?(opts: { sessionID: string }): Promise<void>;
    diff?(opts: { sessionID: string; messageID?: string }): Promise<
      Array<{ file?: string; patch?: string; additions?: number; deletions?: number; status?: string }>
    >;
    vcs?: {
      diff?(opts?: { mode?: 'git' | 'branch' }): Promise<any[]>;
      apply?(opts: { patch: string }): Promise<void>;
    };
    instructions?: {
      list(sessionID: string, opts?: { signal?: AbortSignal }): Promise<Array<{ key: string; value: unknown }>>;
      put(sessionID: string, key: string, value: unknown, opts?: { signal?: AbortSignal }): Promise<void>;
      remove(sessionID: string, key: string, opts?: { signal?: AbortSignal }): Promise<void>;
    };
  };
  shell?: {
    create(opts: {
      command: string; cwd?: string; timeout?: number; metadata?: Record<string, unknown>; directory?: string;
    }): Promise<any>;
    get(opts: { shellID: string; directory?: string }): Promise<any>;
    output(opts: {
      shellID: string; directory?: string; cursor?: number; limit?: number;
    }): Promise<any>;
    remove(opts: { shellID: string; directory?: string }): Promise<void>;
  };
  pty?: RuntimePtyChannel;
  global: {
    event(): Promise<any>;
  };
  provider: {
    list(): Promise<{ all: any[]; connected: string[]; default: Record<string, string> }>;
  };
  app: {
    agents(): Promise<any[]>;
  };
  discovery?: RuntimeDiscoveryChannel;
  snapshotTree?: RuntimeSnapshotTreeChannel;
  /** Dedicated media-analysis carrier (absent for opencode: stateless completion). */
  mediaSession?: { create(opts: { directory: string }): Promise<{ id: string }> };
  mcp?: RuntimeMcpChannel & { config?: RuntimeMcpConfigChannel };
  config: {
    get(): Promise<any>;
    update(config: any): Promise<any>;
  };
  tools: RuntimeTools;
  completion?: CompletionChannel;
  credentials?: RuntimeCredentials;
  agents?: {
    install(name: string, definition: RuntimeAgentDefinition): Promise<void>;
    remove?(name: string): Promise<void>;
  };
}

/**
 * The legacy `AgentRuntime` surface the definition bridge consumes: the client
 * channels plus the process/diagnostic fields only the composition root reads.
 */
export interface OpencodeRuntime extends RuntimeClient {
  readonly name: string;
  capabilities: RuntimeCapabilities;
  readonly semantics?: Record<string, Record<string, unknown>>;
  readonly external?: boolean;
  getBaseUrl(): string;
  healthCheck?(): Promise<boolean>;
  agentProcess?: {
    restart(): Promise<void>;
    spawnServe?(opts: ServeSpawnOpts): Promise<ServeSpawnResult>;
    killServe?(): void;
  };
  resolveEventEntry?(): Promise<EventMappingEntry>;
  activeDialect?: string;
  dispose?(): Promise<void> | void;
  /** Serve proxy headers (Basic auth) — adapter-owned, gateway reads via host. */
  proxyHeaders?(): Record<string, string>;
  /** Provider transport for pre-activation judge/scan (adapter-owned config). */
  resolveProviderTransport?(
    providerID: string,
  ): RuntimeProviderTransport | Promise<RuntimeProviderTransport>;
}

/** Full capability surface for the builtin opencode driver. */
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
    // opencode 2.1 的 revert 是 stage+commit，commit 后不可逆（无 unrevert）
    revertUndoApi: false,
    checkpointApi: true,
    runStateApi: true,
    diffApi: true,
    worktreeApi: true,
    // opencode 适配器不转发 maxTurns/maxCostUsd（SDK 无对应字段）——预算由
    // gateway 侧 BudgetGuard 承担；声明 true 会让 attachBudgetGuardForGoal
    // 跳过挂载，goal 预算在默认 runtime 上完全失效。
    turnBudgetApi: false,
    questionApi: true,
    instructionsApi: true,
    discoveryApi: true,
    mcpApi: true,
    mcpConfigApi: true,
    steerApi: true,
    pluginCreatorApi: true,
  };
}
