/**
 * RuntimeChannels: everything a runtime exposes outside the turn protocol.
 * All blocks are optional; a missing block means the surface is unsupported
 * (ENODEV / 503), never a runtime-specific fallback.
 */

export interface AdapterSession {
  id: string;
  status?: string;
  title?: string;
  directory?: string;
  parentID?: string;
  model?: unknown;
  time?: { created?: number; updated?: number };
}

export interface AdapterMessage {
  id?: string;
  sessionID?: string;
  role: 'user' | 'assistant';
  content?: unknown[];
  time?: { created?: number; updated?: number; completed?: number };
}

export interface AdapterPart {
  id?: string;
  sessionID?: string;
  messageID?: string;
  type: string;
}

export interface AdapterProvider {
  id: string;
  name?: string;
  models: unknown[];
  connected?: boolean;
}

export interface AdapterAgent {
  id: string;
  label: string;
  source?: string;
  selectable?: boolean;
}

export interface AdapterQuestionRequest {
  id: string;
  sessionID: string;
  questions: unknown[];
}

export interface AdapterDiff {
  file: string;
  patch?: string;
  additions?: number;
  deletions?: number;
  status?: string;
}

export interface RuntimeChannels {
  tools?: {
    registerTools(factory: (sessionID: string) => unknown[]): void | Promise<void>;
    nativeTools?(): unknown[];
  };
  session?: {
    list?(opts?: { directory?: string }): Promise<AdapterSession[]>;
    listByDirectory?(directory: string, limit?: number): Promise<AdapterSession[]>;
    get?(sessionID: string): Promise<AdapterSession>;
    update?(sessionID: string, patch: { title?: string }): Promise<void>;
    delete?(sessionID: string): Promise<void>;
    abort?(sessionID: string): Promise<void>;
    /** Session todo/plan snapshot (agent task list). Missing = unsupported. */
    todo?(sessionID: string): Promise<unknown[]>;
    /** Child (subagent) sessions. Missing = unsupported. */
    children?(sessionID: string): Promise<AdapterSession[]>;
    /** Compact/summarize a session. Missing = unsupported. */
    summarize?(input: { sessionID: string; providerID?: string; modelID?: string }): Promise<unknown>;
    /** Switch the session's agent for subsequent turns. */
    switchAgent?(sessionID: string, agent: string): Promise<void>;
    /** Switch the session's model for subsequent turns. */
    switchModel?(sessionID: string, model: import('./transport.ts').RuntimeModelRef): Promise<void>;
    /** Switch the reasoning/thinking level for subsequent turns. */
    setThinkingLevel?(sessionID: string, level: import('./transport.ts').ThinkingLevel): Promise<void>;
    /** Pending native permission requests (approval cards). */
    permissionList?(opts?: { directory?: string }): Promise<unknown[]>;
    /** Move a blocking tool call to the background. */
    background?(sessionID: string): Promise<void>;
  };
  messages?: {
    list(sessionID: string, opts?: { limit?: number; before?: string }): Promise<{ data: AdapterMessage[]; nextCursor?: string }>;
    normalize?(raw: unknown[]): AdapterMessage[];
  };
  providers?: {
    list(): Promise<{ all: AdapterProvider[]; connected: string[]; default: Record<string, string> }>;
  };
  agents?: {
    list(): Promise<AdapterAgent[]>;
    install(name: string, definition: unknown): Promise<void>;
    remove?(name: string): Promise<void>;
  };
  branch?: {
    fork?(sessionID: string, messageID?: string): Promise<{ sessionID: string }>;
    revert?(sessionID: string, messageID: string, opts?: { files?: boolean }): Promise<void>;
    unrevert?(sessionID: string): Promise<void>;
  };
  diff?: {
    get?(sessionID: string, messageID?: string): Promise<AdapterDiff[]>;
    vcsDiff?(opts?: { mode?: 'git' | 'branch' }): Promise<AdapterDiff[]>;
    vcsApply?(patch: string): Promise<void>;
  };
  question?: {
    list(opts?: { directory?: string }): Promise<AdapterQuestionRequest[]>;
    reply(opts: { requestID: string; answers: string[][]; directory?: string }): Promise<void>;
    reject(opts: { requestID: string; directory?: string }): Promise<void>;
  };
  completion?: {
    complete(req: unknown): Promise<unknown>;
  };
  shell?: {
    create(opts: { command: string; cwd?: string; timeout?: number }): Promise<{ shellID: string }>;
    get(shellID: string): Promise<unknown>;
    output(shellID: string, opts?: { cursor?: number; limit?: number }): Promise<unknown>;
    remove(shellID: string): Promise<void>;
  };
  mediaSession?: {
    create(opts: { directory: string }): Promise<{ sessionID: string }>;
  };
}

/**
 * v2 channels. Payloads are concrete neutral DTOs; native wire formats
 * (MCP JSONC, PTY frames, instruction snapshots) stay behind the adapter.
 */
export interface RuntimeMcpStatusInfo {
  name: string;
  status: 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'unknown';
  detail?: string;
  type?: 'local' | 'remote';
  url?: string;
  command?: string[];
  source?: string;
  disabled?: boolean;
}

export interface RuntimeMcpServerConfigInput {
  name: string;
  type: 'remote' | 'local';
  /** remote 必填 */
  url?: string;
  /** local 必填（非空字符串数组） */
  command?: string[];
  /** 同名覆盖（缺省 → 冲突错误） */
  overwrite?: boolean;
  /** type 变更时显式替换（缺省 → 冲突错误） */
  replace?: boolean;
}

export interface RuntimeMcpConfigPreview {
  /** 乐观锁令牌（文件内容哈希），apply/remove/restore 必须回传。 */
  token: string;
  /** 展示给用户的目标文件绝对路径。 */
  target: string;
  /** 已掩码的统一 diff。 */
  diff: string;
  /** 预计备份文件名（无既有文件时缺省）。 */
  backup?: string;
  /** 覆盖时保留的未暴露字段。 */
  preserved?: string[];
  warnings?: string[];
}

export interface RuntimeMcpConfigResult {
  /** 配置文件已持久化。 */
  applied: boolean;
  /** 运行时立即生效（尽力）。 */
  runtimeApplied: boolean;
  backup?: string;
  error?: string;
}

export interface RuntimeMcpConfigChannel {
  /** dry-run：计算 diff/token，不写盘。 */
  preview(input: RuntimeMcpServerConfigInput): Promise<RuntimeMcpConfigPreview>;
  /** dry-run：删除预览（返回 token 与移除后的 diff，不写盘）。 */
  previewRemove(name: string): Promise<RuntimeMcpConfigPreview>;
  /** 提交写入（token 不匹配 → etag_mismatch）。 */
  apply(input: RuntimeMcpServerConfigInput & { token: string; confirm: true }): Promise<RuntimeMcpConfigResult>;
  /** 删除配置项（先文件后运行时）。 */
  remove(name: string, opts: { token: string; confirm: true }): Promise<RuntimeMcpConfigResult>;
  /** 只回滚 mcp.servers 子树（外科式恢复）。 */
  restore(opts: { token: string; confirm: true; backupPath?: string }): Promise<RuntimeMcpConfigResult>;
}

export interface RuntimeMcpChannel {
  list(opts?: { directory?: string }): Promise<RuntimeMcpStatusInfo[]>;
  connect?(name: string, opts?: { directory?: string }): Promise<boolean>;
  disconnect?(name: string, opts?: { directory?: string }): Promise<boolean>;
  /** Adapter-owned config surface (mcpConfigApi); typed but adapter-owned. */
  config?: RuntimeMcpConfigChannel;
}

export interface RuntimeDiscoveryCommand {
  name: string;
  description?: string;
  agent?: string;
  template?: string;
  subtask?: boolean;
  model?: { id: string; providerID: string; variant?: string };
}

export interface RuntimeDiscoverySkill {
  id: string;
  name: string;
  description?: string;
  slash?: boolean;
  location?: string;
  contentLength: number;
}

export interface RuntimeDiscoverySkillContent extends RuntimeDiscoverySkill {
  content: string;
}

export interface RuntimeDiscoveryWarning {
  source: 'commands' | 'skills';
  message: string;
}

export interface RuntimeDiscoveryResult {
  commands: RuntimeDiscoveryCommand[];
  skills: RuntimeDiscoverySkill[];
  warnings: RuntimeDiscoveryWarning[];
}

export interface RuntimeDiscoveryRoots {
  /** Directories the gateway may write/read for skills (opencode: ~/.config/opencode/skills). */
  skillRoots?: string[];
  /** Directories for instruction files (opencode: the config dir). */
  instructionRoots?: string[];
}

export interface RuntimeDiscoveryChannel {
  list(opts: { directory: string }): Promise<RuntimeDiscoveryResult>;
  loadSkill?(opts: { directory: string; key: string }): Promise<RuntimeDiscoverySkillContent | null>;
  /** Host-facing roots so gateway core stops hardcoding vendor config paths. */
  roots?(): RuntimeDiscoveryRoots;
}

export interface RuntimeInstructionEntry {
  key: string;
  value: unknown;
}

/** MAFW terminal surface: create options (PTY ownership follows the session directory). */
export interface RuntimePtyCreateOpts {
  /** 会话/工作区目录（PTY 归属，与 session directory 同规则）。 */
  directory: string;
  /** PTY 起始 cwd；缺省 = directory。 */
  cwd?: string;
  cols?: number;
  rows?: number;
  title?: string;
}

export interface RuntimePtyInfo {
  id: string;
  title?: string;
  /** Native shell/command label, when the runtime exposes it. */
  command?: string;
  cwd?: string;
  status?: 'running' | 'exited' | 'unknown';
}

export interface RuntimePtyConnection {
  /** Native WebSocket URL (gateway-process only; never leaked to clients). */
  url: string;
  id?: string;
  ticket?: string;
  protocol?: string;
  /** Gateway/proxy auth headers required by the socket handshake. */
  headers?: Record<string, string>;
  /** Resume cursor (adapter frame format). */
  cursor?: unknown;
}

/** Native payload → neutral inbound event (adapter-owned frame decoding). */
export type RuntimePtyInbound =
  | { kind: 'output'; data: string }
  | { kind: 'meta'; event: string; payload?: unknown }
  | { kind: 'close'; code?: number; reason?: string }
  | { kind: 'ignore' };

export interface RuntimePtyChannel {
  create(opts: RuntimePtyCreateOpts): Promise<{ id: string }>;
  connect(opts: { id: string; directory?: string }): Promise<RuntimePtyConnection>;
  resize(opts: { id: string; directory?: string; cols: number; rows: number }): Promise<void>;
  remove(opts: { id: string; directory?: string }): Promise<void>;
  list?(opts?: { directory?: string }): Promise<RuntimePtyInfo[]>;
  /** Native frame decoding stays adapter-owned and opaque. */
  decodeInbound?(data: unknown): RuntimePtyInbound[];
  encodeInput?(data: string): unknown;
}

export interface RuntimeSnapshotTreeChannel {
  locate(opts: { projectID?: string; start: string; end: string }): Promise<string | null>;
}

export interface RuntimeBackgroundChannel {
  toBackground?(sessionID: string): Promise<void>;
  list?(): Promise<unknown[]>;
  cancel?(jobID: string): Promise<void>;
}

export interface RuntimeChannelsV2 {
  mcp?: RuntimeMcpChannel;
  discovery?: RuntimeDiscoveryChannel;
  instructions?: {
    list(sessionID: string): Promise<RuntimeInstructionEntry[]>;
    put(sessionID: string, key: string, value: unknown): Promise<void>;
    remove(sessionID: string, key: string): Promise<void>;
  };
  pty?: RuntimePtyChannel;
  checkpoint?: RuntimeSnapshotTreeChannel;
  background?: RuntimeBackgroundChannel;
}

