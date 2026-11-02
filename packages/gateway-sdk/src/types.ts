// ============================================================
// Core types (aligned with @opencode-ai/sdk subset)
// ============================================================

// Task 3：background jobs 复用 Task 1 的 View DTO（单一事实源在 view-dto.ts）
import type { MafwBackgroundJob, MafwMessage } from './view-dto'

/**
 * 会话列表/详情条目。
 * 规范字段（`status` / `reverted` / `model`）来自 gateway 的 `MafwSession` 投影，
 * 是客户端唯一权威；`title`/`time`/`projectID` 等中性字段保留。
 */
export interface Session {
  id: string
  projectID: string
  directory: string
  title: string
  time: { created: number; updated: number }
  parentID?: string
  /** 规范运行态（opencode: time.busy > time.idle / 原生 status；pi: unknown）。 */
  status?: import('./view-dto').MafwSessionStatus
  /** 规范回退状态（原生 `revert` 不再由客户端读取）。 */
  reverted?: import('./view-dto').MafwSessionRevert
  model?: import('./view-dto').MafwModelRef
  agent?: string
}

export interface Project {
  id: string
  worktree: string
}

export interface TextPart {
  id: string
  sessionID: string
  messageID: string
  type: 'text'
  text: string
}

export class MethodNotSupportedError extends Error {
  constructor(method: string) {
    super(`Method not supported by Gateway: ${method}`)
    this.name = 'MethodNotSupportedError'
  }
}

// ============================================================
// MAFW-specific types
// ============================================================

export interface Goal {
  goalId: string
  phase: string
  loop: number
  currentWave: number
  totalWaves: number
  nextAction?: string
  updatedAt?: string
}

export interface GoalCreateInput {
  goalId: string
  title: string
  charter: string
  metrics?: string[]
  boundaries?: string[]
  maxLoops?: number
}

export interface GoalControlAction {
  action: 'PAUSE' | 'ABORT' | 'FORCE_PHASE' | 'RESET_PARAMETRIC'
  goalId: string
  targetPhase?: string
}

export interface MemoryUnit {
  id: string
  type: 'episodic' | 'semantic' | 'procedural' | 'global'
  primary_abstraction: string
  cue_anchors: string[]
  memory_value: string
  energy: number
  salience?: number
  created_at?: string
}

export interface MemoryFact {
  source: 'parametric' | 'harmonic'
  type: string
  content: string
  energy: number
}

export interface StickyNote {
  id: string
  type: string
  primary_abstraction: string
  memory_value: string
  energy: number
  created_at?: string
  sticky_until?: string
}

export interface StickyNoteBudget {
  max: number
  maxChars: number
  used: number
}

/** GET /api/memory/stats — every field is optional (fail-open endpoint). */
export interface MemoryStats {
  embedding?: { provider: string; model?: string; vectors: number; indexEntries: number; coverage: number } | null
  consolidation?: { judged: number; updates: number; creates: number; skipped: number; updateRatio: number } | null
  routing?: Record<string, unknown> | null
  reconsolidation?: { eligible: number } | null
  pipelines?: Array<{ name: string; lastRunAt?: string; lastSuccessAt?: string; lastCounts?: Record<string, number>; ok?: boolean; stale?: boolean }>
  coactivation?: Record<string, unknown> | null
  abstractionLevels?: Record<string, number>
  /** A4 hit-proxy labeling counters (10s-cached file read). */
  fok?: { injections: number; redemptions: number; samples: number; hitRate: number | null } | null
  /** A3 retrieval event stream counters. */
  retrievalEvents?: { pending: number; needTracked: number } | null
}

export interface ModelUsageStat {
  provider: string | null
  model: string
  turns: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  estimatedCost: number | null
}

export interface ModelUsageWindows {
  today: ModelUsageStat[]
  '7d': ModelUsageStat[]
  '30d': ModelUsageStat[]
  all: ModelUsageStat[]
}

export interface MergedSearchOptions {
  query: string
  maxFacts?: number
}

export interface EnergyDistribution {
  critical: number
  high: number
  medium: number
  low: number
  total: number
}

export interface Axiom {
  id: string
  content: string
  energy: number
}

export interface L5Heuristic {
  id: string
  pattern: string
  trigger_context: string[]
  success_rate?: number
  source_goal_ids?: string[]
  energy: number
  created_at?: string
}

export interface Approval {
  id: string
  goalId: string
  question: string
  status: 'pending' | 'answered' | 'expired'
  createdAt: string
}

// ── Questions (AskCard) — mirrors opencode QuestionV1 ──

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionInfo {
  question: string
  header?: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  tool?: { messageID: string; callID: string }
}

// ── Permissions (PermissionCard) — mirrors opencode PermissionV1 ──

export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
  always?: string[]
  tool?: { messageID: string; callID: string }
}

export interface TriageItem {
  id: string
  goalId: string
  reason: string
  severity: 'low' | 'medium' | 'high'
  createdAt: string
  state?: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'REJECTED'
}

export interface AutomationRule {
  id: string
  enabled: boolean
  name?: string
  trigger?: { schedule: string; timezone: string }
  action?: { type: string }
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface Todo {
  id: string
  content: string
  status: string
  priority: string
}

export interface TrajectoryTokens {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface TrajectoryTurn {
  projectID?: string
  turnID: number
  turnStartMs: number
  turnEndMs: number | null
  durationMs: number | null
  toolCount: number
  toolErrorCount: number
  reasoningCount: number
  agentSwitchCount: number
  tokens: TrajectoryTokens
  cost: number
  finish: string | null
  model: string | null
  agent: string | null
  userText: string
}

export interface TrajectoryEvent {
  id?: number
  projectID?: string
  turnID: number
  seq: number
  eventType: string
  toolName?: string
  callID?: string
  toolState?: 'running' | 'completed' | 'error'
  agent?: string
  model?: string
  inputSummary?: string
  outputSummary?: string
  error?: string
  tokens?: TrajectoryTokens
  cost?: number
  finish?: string
  timeMs: number
  durationMs?: number
}

export interface TrajectoryResponse {
  turns: TrajectoryTurn[]
  events: TrajectoryEvent[]
}

export interface GatewayStatus {
  state: 'stopped' | 'starting' | 'ready' | 'failed'
  port: number | null
  url: string | null
  error: string | null
}

// ============================================================
// Namespace interfaces (aligned with @opencode-ai/sdk v2)
// ============================================================

export interface QueueItem {
  id: string
  sessionID: string
  text?: string
  parts?: Array<{ type: string; text?: string; [k: string]: unknown }>
  agent?: string
  model?: { providerID: string; modelID: string }
  expectReply?: boolean
  idempotencyKey?: string
  thinkingLevel?: ThinkingLevel
  variant?: string
  enqueuedAt: string
  source: string
}

export type SessionConfigCategory = 'mode' | 'agent' | 'model' | 'model_config' | 'thought_level'

export interface SessionConfigState {
  mode: 'read-only' | 'auto' | 'full-access'
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  thinkingLevel?: ThinkingLevel
}

export interface SessionNamespace {
  /** worktree: true|'<slug>' → git worktree add + 会话绑定隔离目录（切片 4；worktreeApi runtime-only） */
  create(params?: { directory?: string; metadata?: Record<string, unknown>; worktree?: boolean | string }): Promise<Session & { worktree?: { dir: string; branch: string } }>
  get(params: { path: { id: string } }): Promise<Session>
  list(params?: { query?: { projectID?: string } }): Promise<Session[]>
  delete(params: { path: { id: string } }): Promise<void>
  rename(params: { path: { id: string }; body: { title: string } }): Promise<void>
  /** MAFW flat 历史（View DTO `{id,role,content,...}`）；默认且唯一形状。 */
  messages(params: { path: { id: string }; query?: { limit?: number; before?: string } }): Promise<{ data: MafwMessage[]; nextCursor: string | null }>
  /** 认知门（spec 2026-10-22-cognition-gate-rewrite）：POST /api/cognition/gate */
  cognitionGate(params: { body: Record<string, unknown> }): Promise<unknown>
  cognitionRewrite(params: { body: Record<string, unknown> }): Promise<{ content: unknown[] }>
  cognitionRules(): Promise<{ rules: unknown[]; errors: string[] }>
  todo(params: { path: { id: string } }): Promise<{ data: Todo[] }>
  children(params: { path: { id: string } }): Promise<any[]>
  structured(params: { path: { id: string } }): Promise<any>
  submitStructured(params: { body: { sessionID: string; data: unknown } }): Promise<{ ok: boolean; errors: string[] }>
  switchAgent(params: { path: { id: string }; body: { agent: string } }): Promise<void>
  switchModel(params: { path: { id: string }; body: { model: { providerID: string; modelID: string }; variant?: string } }): Promise<void>
  abort(params: { path: { id: string } }): Promise<void>
  /** Gateway 服务端 inbox（batch 5 UI）：busy 会话的排队快照/取消/清空。 */
  queueList(params: { path: { id: string } }): Promise<{ items: QueueItem[] }>
  queueCancel(params: { path: { id: string; itemId: string } }): Promise<{ cancelled: string }>
  queueClear(params: { path: { id: string } }): Promise<{ cleared: number }>
  config(params: { path: { id: string } }): Promise<SessionConfigState>
  setConfig(params: { path: { id: string }; body: { category: SessionConfigCategory; value: unknown } }): Promise<SessionConfigState>
  prompt(params: { path: { id: string }; body: { parts: Array<{ type: 'text'; text: string }>; system?: string; outputSchema?: { name?: string; schema: Record<string, unknown>; retryCount?: number } } }): Promise<{ parts: TextPart[]; structured?: unknown; structuredError?: string }>
  promptAsync(params: { path: { id: string }; body: { message?: string; parts?: Record<string, unknown>[]; agent?: string; model?: { providerID: string; modelID: string }; outputSchema?: { name?: string; schema: Record<string, unknown>; retryCount?: number }; delivery?: 'queue' | 'steer' | 'followup'; idempotencyKey?: string; expectReply?: boolean; thinkingLevel?: ThinkingLevel; variant?: string } }): Promise<void>
  trajectory(params: { path: { id: string }; query?: { limit?: number; before_turn?: number; rebuild?: boolean } }): Promise<TrajectoryResponse>
  events(params: { path: { id: string } }): Promise<{ on(event: string, cb: (data: any) => void): void }>
  command(params: { path: { id: string }; body: { command: string; arguments?: string; agent?: string; model?: { providerID: string; modelID: string } } }): Promise<void>
  fork(params: { path: { id: string }; body?: { messageID?: string } }): Promise<{ session: Session }>
  revert(params: { path: { id: string }; body: { messageID: string; partID?: string } }): Promise<void>
  unrevert(params: { path: { id: string } }): Promise<void>
  /** 会话文件变更快照（切片 2；diffApi runtime-only，opencode） */
  diff(params: { path: { id: string }; query?: { messageID?: string } }): Promise<{ files: FileDiffInfo[] }>
  /** 逐 hunk 回退：传原 patch + 选中 hunk 下标（0-based），gateway 反转后 vcs.apply */
  revertDiff(params: { path: { id: string }; body: { patches: Array<{ file?: string; patch: string; hunkIndices: number[] }> } }): Promise<{ reverted: number }>
  /** T2-1：手动创建检查点（messageID 缺省=最后一条已持久化消息；tree=最后已知 snapshot.end） */
  checkpoint(params: { path: { id: string }; body?: { messageID?: string } }): Promise<{ checkpoint: SessionCheckpoint }>
  /** T2-1：检查点列表（倒序） */
  checkpoints(params: { path: { id: string } }): Promise<{ checkpoints: SessionCheckpoint[] }>
  /** T2-1：三态恢复（session=截断历史 / files=回工作区 / both=全部；confirm 必填） */
  restoreCheckpoint(params: { path: { id: string; checkpointId: string }; body: { scope: CheckpointScope; confirm: true } }): Promise<CheckpointRestoreResult>
  /** T2-2：暂停当前回合（忙时；abort + 续跑简报） */
  suspend(params: { path: { id: string }; body?: { reason?: string } }): Promise<{ run: RunState }>
  /** T2-2：恢复暂停的回合（合成续跑提示） */
  resume(params: { path: { id: string }; body?: { runId?: string } }): Promise<{ run: RunState; prompted: true }>
  /** T2-2：查询活跃 run（无则 null） */
  run(params: { path: { id: string } }): Promise<{ run: RunState | null }>
  /** T2-2：放弃暂停（清闸门并续发队列） */
  discardRun(params: { path: { id: string }; body?: { runId?: string } }): Promise<{ run: RunState }>
  /** T2-3：注入类型化 data part（`data-<name>`；同 id 渐进更新；transient 不入历史） */
  data(params: { path: { id: string }; body: { name: string; id?: string; data: unknown; transient?: boolean; messageID?: string } }): Promise<{ part: DataPart }>
  /** 手动压缩会话（TUI /compact；runtime summarize 薄代理）。 */
  summarize(params: { path: { id: string }; body?: { providerID?: string; modelID?: string } }): Promise<void>
  /** 会话 token/成本汇总（GET /api/sessions/:id/token-summary）。 */
  tokenSummary(params: { path: { id: string } }): Promise<{
    totalTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
    totalCost: number
    turnCount: number
    avgTokensPerTurn: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  }>
  /** 会话/项目/全局用量汇总（GET /api/usage/summary）。 */
  usageSummary(params: { query?: { sessionID?: string; projectID?: string } }): Promise<{
    session: { totalTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }; totalCost: number; turnCount: number; avgTokensPerTurn: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } } | null
    project: { totalTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }; totalCost: number; turnCount: number; sessionCount: number } | null
    global: { totalTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }; totalCost: number; turnCount: number; sessionCount: number } | null
  }>
  /** 用量 dashboard（GET /api/usage；分模型窗口见 modelStats）。 */
  usage(params?: { sessionID?: string; projectID?: string }): Promise<{
    summary: any
    memory: any
    providers: any[]
    modelStats?: { windows: ModelUsageWindows }
    updatedAt: number
  }>
  usagePlugins(): Promise<{ plugins: { file: string; name?: string; status: string; error?: string; overridden: boolean }[] }>
  usagePluginsReload(): Promise<{ ok: boolean; plugins: any[] }>
  usagePluginsCreate(body: { template?: string; values?: Record<string, any>; name?: string; source?: string }): Promise<{ ok: boolean; name?: string; error?: string; plugins?: any[] }>
  usagePluginSource(name: string): Promise<{ source?: string; origin?: string; builtin?: boolean; error?: string }>
  usagePluginSourceSave(name: string, source: string): Promise<{ ok: boolean; error?: string }>
  usagePluginDelete(name: string): Promise<{ ok: boolean; error?: string }>
  usagePluginTest(name: string): Promise<{ ok: boolean; result?: any; error?: string }>
  /** 把当前回合的工具执行转为后台任务（v2 反代；transport 直连）。 */
  background(params: { path: { id: string } }): Promise<void>
}

/** 会话文件变更条目（opencode SnapshotFileDiff 归一化）。 */
export interface FileDiffInfo {
  file?: string
  patch?: string
  additions?: number
  deletions?: number
  status?: string
}

// ── T2-1 checkpoints ──

export type CheckpointScope = 'session' | 'files' | 'both'

/** gateway 服务端检查点（auto=turn 完成时记录 / manual=用户手动）。 */
export interface SessionCheckpoint {
  id: string
  sessionID: string
  projectDir: string
  /** restore 后历史保留到该消息（含）为止。 */
  anchorMessageID: string
  /** checkpoint 工作区树；null=该边界无文件状态（仅对话可恢复）。 */
  snapshotTree: string | null
  /** 创建时的 untracked 清单（restore 残留报告的基线）。 */
  untracked: string[]
  kind: 'auto' | 'manual'
  createdAt: string
  /** Experience Contract：前端直接渲染的恢复动作，不再自行推导 runtime 语义。 */
  actions?: {
    restoreConversation: import('./experience-contract').ActionDescriptor
    restoreFiles: import('./experience-contract').ActionDescriptor
    restoreBoth: import('./experience-contract').ActionDescriptor
  }
}

export interface CheckpointRestoreResult {
  scope: CheckpointScope
  /** both + 无文件状态：降级为仅对话截断。 */
  filesSkipped?: boolean
  /** restore 后仍不在 checkpoint 清单里的 untracked（只报告不删除）。 */
  leftoverUntracked?: string[]
  /** files restore 的后悔药 checkpoint id。 */
  preRestoreCheckpointId?: string
}

// ── T2-2 runs (soft suspend) ──

export type RunStatus = 'suspended' | 'resumed' | 'completed' | 'failed' | 'cancelled'

export interface ResumeBrief {
  lastUserText: string
  lastAssistantTail: string
  anchorMessageID: string
  queuedCount: number
}

export interface RunState {
  id: string
  sessionID: string
  projectDir: string
  status: RunStatus
  reason?: string
  brief: ResumeBrief
  createdAt: string
  suspendedAt: string
  resumedAt?: string
  finishedAt?: string
}

// ── T2-3 data parts ──

/** AI SDK 6 data part：type 为 `data-<name>`；同 id 调和；transient 不入历史。 */
export interface DataPart {
  id: string
  type: `data-${string}`
  data: unknown
  transient?: boolean
  sessionID?: string
  messageID?: string
  native?: Record<string, unknown>
}

// ── MCP status (W4 v1, CLI-backed) ──
export type McpServerState = 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'unknown'
export interface McpServerEntry {
  name: string
  status: McpServerState
  detail?: string
  /** 配置来源（runtime 合并后返回；opencode 适配器实现）。 */
  type?: 'local' | 'remote'
  url?: string
  command?: string[]
  source?: string
  disabled?: boolean
}
export interface McpNamespace {
  /** 官方 CLI `opencode mcp list` 解析结果（serve 2.1 HTTP 无 MCP 运行时端点）。 */
  servers(): Promise<McpServerEntry[]>
  /** 运行时连接（不改配置；serve 2.1 v2: POST /api/experimental/mcp/:server/connect）。 */
  connect(name: string): Promise<unknown>
  /** 运行时断开（不改配置）。 */
  disconnect(name: string): Promise<unknown>
  /** B4：持久化写入 — dry-run（不写盘）。 */
  previewServer(input: McpServerConfigInput): Promise<McpConfigPreview>
  /** B4：删除预览（返回 token，不写盘）。 */
  previewRemoveServer(name: string): Promise<McpConfigPreview>
  /** B4：持久化写入 — 提交（token + confirm）。 */
  applyServer(input: McpServerConfigInput & { token: string; confirm: true }): Promise<McpConfigResult>
  /** B4：删除配置项（token + confirm；先文件后运行时）。 */
  removeServer(name: string, opts: { token: string; confirm: true }): Promise<McpConfigResult>
  /** B4：只回滚 mcp.servers 子树。 */
  restoreConfig(opts: { token: string; confirm: true; backupPath?: string }): Promise<McpConfigResult>
}

export interface McpServerConfigInput {
  name: string
  type: 'remote' | 'local'
  url?: string
  command?: string[]
  overwrite?: boolean
  replace?: boolean
}

export interface McpConfigPreview {
  token: string
  target: string
  diff: string
  backup?: string
  preserved?: string[]
  warnings?: string[]
}

export interface McpConfigResult {
  applied: boolean
  runtimeApplied: boolean
  backup?: string
  error?: string
}

// ── Discovery (T2-5 capability discovery) ──

export interface DiscoveryWarning {
  source: 'commands' | 'skills' | 'instructions'
  message: string
}

export interface DiscoveryCommand {
  name: string
  aliases?: string[]
  description: string
  argumentHint?: string
  category?: 'goals' | 'session' | 'memory' | 'custom' | 'runtime'
  destructive?: boolean
  source: 'mafw' | 'custom' | 'runtime'
  scope: 'gateway' | 'user' | 'project' | 'runtime'
  runtime?: boolean
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  subtask?: boolean
}

export interface DiscoverySkill {
  id: string
  name: string
  description?: string
  slash: boolean
  scope: 'user' | 'project' | 'path'
  location?: string
  contentLength: number
}

export interface DiscoveryInstruction {
  id: string
  path: string
  scope: 'global' | 'project' | 'nested'
  kind: 'agents-md'
  bytes: number
  mtime: string
}

export interface DiscoverySnapshot {
  sessionID: string
  directory: string
  revision: string
  commandsRevision: string
  generatedAt: string
  commands: DiscoveryCommand[]
  skills: DiscoverySkill[]
  instructions: DiscoveryInstruction[]
  degraded: boolean
  degradedReason?: 'capability_absent' | 'runtime_error' | 'partial' | 'instructions_error'
  warnings: DiscoveryWarning[]
}

export interface DiscoverySkillContent extends DiscoverySkill {
  content: string
}

export interface DiscoveryNamespace {
  get(sessionID: string, params?: { directory?: string; force?: boolean }): Promise<DiscoverySnapshot>
  refresh(sessionID: string, params?: { directory?: string }): Promise<DiscoverySnapshot>
  skill(sessionID: string, key: string, params?: { directory?: string; force?: boolean }): Promise<DiscoverySkillContent>
}

// ── MAFW native commands (desktop slash panel) ──

/** MAFW 命令元数据（GET /api/mafw-commands，注册表清单） */
export interface MafwCommandDef {
  name: string
  aliases?: string[]
  description: string
  /** 补全提示，如 '<问题>'、'<worktree路径> [strategy]' */
  argumentHint?: string
  category: 'goals' | 'session' | 'memory' | 'custom'
  /** 破坏性操作：客户端据此弹确认 */
  destructive?: boolean
  kind: 'builtin' | 'custom'
  /** custom：来源文件绝对路径 */
  source?: string
}

export interface MafwCommandResult {
  ok: boolean
  message?: string
  text?: string
  error?: string
  sessionID?: string
  added?: number
  conflicts?: number
  skipped?: number
  details?: unknown
}

export interface MafwCommandsNamespace {
  run(params: { command: string; args?: string; sessionID?: string }): Promise<MafwCommandResult>
}

export interface ManagerSessionInfo {
  projectDir: string
  sessionId: string
  createdAt?: string | null
}

export interface ManagerRotateResult {
  success: boolean
  sessionId: string
  previousSessionId?: string
  created: 'initial' | 'rotated'
}

export interface ManagerNamespace {
  session(projectDir?: string): Promise<ManagerSessionInfo | null>
  rotate(projectDir: string, reason?: string): Promise<ManagerRotateResult>
}

export interface ProjectNamespace {
  list(): Promise<Project[]>
  current(): Promise<Project>
  setCurrent(path: string): Promise<void>
}

export interface EventNamespace {
  subscribe(): Promise<{ on(event: string, cb: (data: any) => void): void }>
  subscribeToSession(sessionID: string): Promise<{ on(event: string, cb: (data: any) => void): void }>
  /** SSE 连接状态（onopen/onerror 维护；供监督器健康轮询）。 */
  connected(): boolean
  /** SSE 端点 URL（契约归 SDK：renderer 直连 EventSource 时用此构造，不自己拼字符串）。 */
  url(sessionID?: string): string
}

export interface RuntimeNamespace {
  /** Get active runtime identity, capabilities, and plugin scan state. */
  get(): Promise<{
    active: { name: string; capabilities: Record<string, boolean> }
    plugins: { file: string; name?: string; status: string; error?: string; capabilities?: Record<string, boolean> }[]
  }>
  /**
   * Switch active runtime plugin.
   * @param plugin - Plugin name (empty string switches to builtin opencode).
   */
  switch(plugin: string): Promise<{
    success: boolean
    active: { name: string; capabilities: Record<string, boolean> }
    envOverride: boolean
  }>
  /** Restart the agent runtime (opencode serve). Interrupts in-flight prompts. */
  restartAgent(): Promise<{ success: boolean; mode: string }>
}

export interface ConfigNamespace {
  get(key?: string): Promise<any>
  set(key: string, value: any): Promise<void>
}

export interface RuntimeConfigNamespace {
  get(): Promise<any>
  update(config: Record<string, unknown>): Promise<any>
}

export interface ModelRef {
  providerID: string
  modelID: string
}

export interface MediaModelRef {
  provider?: string
  model?: string
}

export interface AvailableModel {
  id: string
  name: string
}

export interface AvailableProvider {
  providerID: string
  providerName: string
  models: AvailableModel[]
}

export interface ModelConfigState {
  recall: { workerModel: ModelRef }
  media: {
    provider?: string
    model?: string
    image?: MediaModelRef
    video?: MediaModelRef
    audio?: MediaModelRef
  }
  /** W1/W5a：goal 编排节点模型覆盖（空对 = 身份内置模型）。 */
  goal?: { nodeModel?: ModelRef | null }
  /** null → provider 列表不可用（前端回退文本输入）。 */
  available: AvailableProvider[] | null
}

export interface ModelConfigUpdate {
  recall?: ModelRef
  media?: {
    provider?: string
    model?: string
    image?: MediaModelRef
    video?: MediaModelRef
    audio?: MediaModelRef
  }
  goal?: ModelRef
}

export interface ModelConfigNamespace {
  get(): Promise<ModelConfigState>
  update(opts: ModelConfigUpdate): Promise<{ success: boolean; recall: ModelConfigState['recall']; media: ModelConfigState['media']; goal?: ModelConfigState['goal'] }>
}

export interface EmbeddingConfigState {
  provider: 'off' | 'local' | 'dashscope'
  engine: 'onnx' | 'llamacpp'
  model: string
  dimensions: number
  threads: number
  llamacpp: { gpu: string; threads: number; contextSize: number; batchSize: number }
}

export interface EmbeddingRuntimeState {
  active: string | null
  vectors: number
  indexEntries: number
  coverage: number
}

export interface EmbeddingConfigGetResponse {
  current: EmbeddingConfigState
  runtime: EmbeddingRuntimeState
  available: { providers: string[]; engines: string[]; gpus: string[] }
}

export interface EmbeddingConfigUpdate {
  provider?: 'off' | 'local' | 'dashscope'
  engine?: 'onnx' | 'llamacpp'
  model?: string
  threads?: number
  llamacpp?: { gpu?: string; threads?: number; contextSize?: number; batchSize?: number }
}

export interface EmbeddingConfigNamespace {
  get(): Promise<EmbeddingConfigGetResponse>
  update(opts: EmbeddingConfigUpdate): Promise<{ success: boolean; current: EmbeddingConfigState; runtime: EmbeddingRuntimeState; note?: string }>
}

export interface ChatNamespace {
  send(message: string, sessionID?: string): Promise<{ sessionID: string }>
  sendEnriched(opts: { message: string; sessionID?: string; parts?: Record<string, unknown>[]; agent?: string; model?: { providerID: string; modelID: string } }): Promise<{ sessionID: string }>
}

export interface ProvidersNamespace {
  /** 规范 provider 列表（`models` 恒为数组）；`default`/`connected` 为信封附加信息。 */
  list(): Promise<{
    items: import('./view-dto').MafwProvider[]
    default?: Record<string, string>
    connected?: string[]
  }>
}

export interface AgentsNamespace {
  /** 规范 agent 列表（`MafwAgent`）。 */
  list(): Promise<import('./view-dto').MafwAgent[]>
}

export interface GoalSessionInfo {
  sessionID: string
  phase: string
  loop: number
  title?: string
  time?: { created?: number; updated?: number }
}

export interface GoalNodeRunInfo {
  runId: number
  loop: number
  node: string
  attempt: number
  status: string
  sessionId: string | null
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  outcome: string | null
  error: string | null
  tokensInput: number | null
  tokensOutput: number | null
  costUsd: number | null
}

export interface GoalTimeline {
  goal: {
    goalId: string
    title: string
    phase: string
    round: number
    maxRounds: number
    verdict: string | null
    nextNode: string
    nextAction: string
    lastError: string | null
    updatedAt: string
    /** W1 计划审阅状态（泳道「待批准」徽标数据源）。 */
    planReview?: 'auto' | 'manual'
    planApproval?: {
      id?: string
      status: 'pending' | 'approved' | 'rejected'
      feedback?: string
      decidedAt?: string
      round: number
    } | null
  }
  nodes: GoalNodeRunInfo[]
  artifacts: { wavesPath: string; receipts: string[]; reviewsDir: string }
  outcome?: unknown
}

/** W1 计划审阅：GET /api/goals/:id/plan 响应。 */
export interface GoalPlanInfo {
  planReview: 'auto' | 'manual'
  planApproval: {
    id?: string
    status: 'pending' | 'approved' | 'rejected'
    feedback?: string
    decidedAt?: string
    round: number
  } | null
  planFeedback: string | null
  round: number
  waves: unknown
  wavePlanPath: string | null
}

export interface GoalsNamespace {
  list(): Promise<Goal[]>
  get(id: string): Promise<Goal | null>
  validate(input: GoalCreateInput): Promise<{ goalId: string }>
  control(action: GoalControlAction): Promise<void>
  /** goal → sessions 映射（编排可视化下钻）。 */
  sessions(goalId: string): Promise<GoalSessionInfo[]>
  /** goal 作用域问答回复（desktop QuestionWidget）。与 /api/questions/:id/reply（原生 question API）是两套通道。 */
  respondQuestion(goalId: string, questionId: string, input: { type: 'answer' | 'cancel'; answer?: string }): Promise<{ status: string }>
  /** 节点级执行 trace 聚合（编排可视化）。 */
  timeline(goalId: string): Promise<GoalTimeline>
  /** W1 计划审阅：当前计划内容 + 审批状态。 */
  plan(goalId: string): Promise<GoalPlanInfo>
  /** W1 批准当前计划（解锁驻留，进 execute）。必须携带当前一次性 approvalId。 */
  approvePlan(goalId: string, approvalId?: string): Promise<{ success: boolean }>
  /** W1 驳回当前计划（feedback 注入下一版 plan）。必须携带当前一次性 approvalId（legacy 记录可省略）。 */
  rejectPlan(goalId: string, approvalId: string | undefined, feedback: string): Promise<{ success: boolean }>
  /** 节点重跑（execute 需 confirm）。 */
  retryNode(goalId: string, runId: number, opts?: { confirm?: boolean }): Promise<{ success: boolean; runId: number }>
}

export interface MemorySearchOptions {
  query: string
  topK?: number
  goalId?: string
  /** 检索器：默认 bm25；'token' 子串回退；'hybrid' BM25+dense RRF（需 embedding 开启） */
  retriever?: 'bm25' | 'token' | 'hybrid'
}

export interface MemoryNamespace {
  search(opts: MemorySearchOptions): Promise<MemoryUnit[]>
  mergedSearch(opts: MergedSearchOptions): Promise<MemoryFact[]>
  getEnergyDistribution(): Promise<EnergyDistribution>
  getL5Axioms(topK?: number): Promise<{ axioms: Axiom[]; heuristics: L5Heuristic[] }>
  delete(id: string): Promise<void>
  listSticky(): Promise<{ entries: StickyNote[]; budget: StickyNoteBudget }>
  setSticky(id: string, sticky: boolean, stickyDays?: number): Promise<void>
}

export interface ApprovalsNamespace {
  list(): Promise<Approval[]>
  /** decision 决定 或 文本回答（无 goalId 的 MCP ask_user 问题，写 user-questions JSON） */
  respond(id: string, input: 'approve' | 'reject' | { answer: string }): Promise<void>
}

export interface TriageNamespace {
  list(): Promise<TriageItem[]>
  dismiss(id: string): Promise<void>
  confirm(id: string): Promise<void>
  reject(id: string): Promise<void>
  propose(id: string, suggestion: 'confirm' | 'reject', reason: string, priority?: 'high' | 'medium' | 'low'): Promise<{ success: boolean; message?: string }>
}

export interface AutomationDraftInput {
  id: string
  trigger: { schedule: string; timezone?: string }
  skill?: string
  action?: { type: 'triage' | 'goal'; template?: string; auto_confirm?: boolean }
  goal_defaults?: { maxLoops?: number }
}

export interface AutomationsNamespace {
  list(): Promise<AutomationRule[]>
  toggle(id: string, enabled: boolean): Promise<void>
  /** 起草规则（enabled=false 落盘，需手动启用） */
  draft(input: AutomationDraftInput): Promise<{ id: string; valid: boolean; errors?: string[] }>
}

export interface QuestionsNamespace {
  list(directory?: string): Promise<QuestionRequest[]>
  reply(id: string, answers: string[][]): Promise<void>
  reject(id: string): Promise<void>
}

// ── Durable tasks (Batch 4) ────────────────────────────────────────────────

export type TaskKind = 'shell' | 'subagent'
export type TaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled'

export interface TaskEntity {
  id: string
  kind: TaskKind
  parentSessionID: string
  childSessionID?: string
  shellID?: string
  title: string
  status: TaskStatus
  directory?: string
  createdAt: number
  updatedAt: number
  finishedAt?: number
  exitCode?: number
  error?: string
  metadata?: Record<string, unknown>
}

export interface TaskSubmitInput {
  kind: TaskKind
  parentSessionID: string
  title?: string
  command?: string
  cwd?: string
  timeout?: number
  prompt?: string
  agent?: string
  description?: string
  model?: { providerID: string; modelID: string }
  outputSchema?: { name?: string; schema: Record<string, unknown>; retryCount?: number }
}

export interface TaskOutput {
  output: string
  cursor: number
  size: number
  truncated: boolean
}

export interface TasksNamespace {
  submit(input: TaskSubmitInput): Promise<TaskEntity>
  list(query?: { parentSessionID?: string; status?: string }): Promise<TaskEntity[]>
  get(id: string): Promise<TaskEntity>
  cancel(id: string): Promise<TaskEntity>
  message(id: string, message: string): Promise<void>
  output(id: string, query?: { cursor?: number; limit?: number }): Promise<TaskOutput>
}

/**
 * 中性后台作业（Task 3）：TaskService / runtime shell / 子代理三源合并后的只读视图。
 * 状态机与游标语义由 MAFW 定义（`MafwBackgroundJob` 见 view-dto）。
 */
export interface MafwBackgroundOutput {
  /** 下一次读取的起点（按字节推进）。 */
  cursor: number
  data: string
  truncated: boolean
}

export interface BackgroundJobsNamespace {
  list(sessionID: string): Promise<MafwBackgroundJob[]>
  output(sessionID: string, id: string, cursor?: number): Promise<MafwBackgroundOutput>
  cancel(sessionID: string, id: string): Promise<MafwBackgroundJob>
}

export interface BackgroundNamespace {
  jobs: BackgroundJobsNamespace
}

// ============================================================
// Terminal (neutral PTY, mafw-terminal/1)
// ============================================================

export interface TerminalSessionDto {
  id: string
  /** 归属仅在已知时给出（本进程/运行时明确），未知时省略。 */
  directory?: string
  title?: string
  status: 'running' | 'exited' | 'unknown'
  cwd?: string
}

export interface TerminalSessionList {
  protocol: string
  supported: boolean
  sessions: TerminalSessionDto[]
}

export interface TerminalSessionCreateInput {
  directory: string
  cwd?: string
  cols?: number
  rows?: number
  title?: string
}

export interface TerminalConnectTicket {
  protocol: string
  /** MAFW 不透明票据（单次使用、短 TTL、绑定 pty id + directory）。 */
  ticket: string
  /** 相对路径 + ticket query；客户端与 gateway base 拼接后升级为 ws(s)。 */
  url: string
  expiresAt: number
}

export interface TerminalNamespace {
  /** 列出目录下活动 PTY（runtime 不支持时 supported:false + 空列表）。 */
  list(opts?: { directory?: string }): Promise<TerminalSessionList>
  /** 创建 PTY（不支持时抛 HTTP 503）。 */
  create(opts: TerminalSessionCreateInput): Promise<{ protocol: string; id: string }>
  /** 关闭并删除 PTY。 */
  remove(id: string, opts?: { directory?: string }): Promise<{ ok: boolean }>
  /** 签发一次性连接票据（loopback-only）。 */
  connectTicket(id: string, opts: { directory: string }): Promise<TerminalConnectTicket>
}

export type PodStatus = 'active' | 'idle' | 'paused' | 'archived'
export type PodMemberRole = 'lead' | 'tech_lead' | 'builder' | 'reviewer'
export type PodMemberStatus = 'available' | 'working' | 'waiting' | 'sleeping' | 'retired'
export type PodGoalStatus = 'queued' | 'active' | 'done' | 'aborted'
export type PodTaskStatus = 'pending' | 'in_progress' | 'blocked' | 'review' | 'done' | 'failed' | 'skipped' | 'reopened'
export type PodGoalVerdict = 'PASS' | 'FAIL' | 'MAX_RETRIES' | 'ERROR' | 'CANCELLED'
export type PodQueueReason = 'active_goal' | 'paused' | 'archived' | 'budget' | 'state_error'
export type PodTaskKind = 'plan' | 'note' | 'external_request'
export type PodGoalStageOwner = 'person' | 'team' | 'system'
export type PodGoalStageKind =
  | 'plan_approval'
  | 'direction_review'
  | 'question'
  | 'blocked'
  | 'queued'
  | 'discussing'
  | 'planning'
  | 'probing'
  | 'implementing'
  | 'reviewing'
  | 'result_notified'
  | 'working'
  | 'waiting'
  | 'ended'
export type PodGoalStageActionType =
  | 'open_plan_review'
  | 'open_direction_review'
  | 'open_question'
  | 'open_discussion'
  | 'open_goal'
  | 'open_result'
export interface PodGoalStage {
  owner: PodGoalStageOwner
  kind: PodGoalStageKind
  /** 这一步由哪个 Pod 角色负责（person 阶段 = 提交产物/被审阅的角色）。 */
  role?: PodMemberRole
  queueReason?: PodQueueReason
  action?: {
    type: PodGoalStageActionType
    goalId: string
    questionId?: string
  }
}
export interface PodAttentionItem {
  id: string
  goalId: string
  kind: 'plan_approval' | 'direction_review' | 'question' | 'blocked'
  title: string
  action: NonNullable<PodGoalStage['action']>
}

export interface Pod {
  id: string
  projectDir: string
  name: string
  status: PodStatus
  configJson: string
  activeGoalId: string | null
  createdAt: string
  updatedAt: string
}

export interface PodMember {
  id: string
  podId: string
  role: PodMemberRole
  displayName: string
  agentName: string
  modelProvider: string | null
  modelId: string | null
  status: PodMemberStatus
  configJson: string | null
  createdAt: string
  updatedAt: string
}

export interface PodGoal {
  id: string
  podId: string
  goalId: string
  status: PodGoalStatus
  title: string
  phase: string | null
  verdict: PodGoalVerdict | null
  stage: PodGoalStage
  resultReady: boolean
  enqueuedAt: string
  startedAt: string | null
  endedAt: string | null
}

export interface PodTask {
  id: string
  podId: string
  goalId: string | null
  sourceKey: string
  externalTaskId: string | null
  kind: PodTaskKind
  title: string
  description: string | null
  ownerMemberId: string | null
  status: PodTaskStatus
  dependenciesJson: string | null
  artifactRefsJson: string | null
  /** waves 任务验收标准镜像（JSON string[]）；随计划投影刷新。旧 gateway 可能缺省。 */
  acceptanceJson?: string | null
  createdAt: string
  updatedAt: string
}

export interface PodMessage {
  id: string
  podId: string
  fromMemberId: string
  toMemberId: string | null
  kind: string
  body: string
  createdAt: string
  readAt: string | null
  protocol?: string | null
  externalMessageId?: string | null
  deliveredAt?: string | null
  deliveredSessionId?: string | null
}

export interface PodSession {
  id: string
  podId: string
  memberId: string
  goalId: string | null
  node: string | null
  sessionId: string
  status: string
  transcriptRef: string | null
  createdAt: string
  endedAt: string | null
}

export interface PodMessageDelivery {
  messageId: string
  podId: string
  memberId: string
  deliveredAt: string | null
  deliveredSessionId: string | null
  status: 'pending' | 'delivered' | 'failed'
  attempts: number
  lastError: string | null
  nextRetryAt: string | null
}

export interface PodGoalResult {
  goalId: string
  verdict: PodGoalVerdict | null
  resultReady: boolean
  goalAcceptance: string[]
  tasks: Array<{ taskId: string; result: 'pass' | 'fail' | 'skipped'; evidence: string }>
  reviewFeedback: string
  receipt: unknown | null
  artifacts: string[]
}

export interface PodCreateGoalInput {
  title: string
  objective?: string
  /** Goal 章程（objective 的替代或补充；二者至少一个）。 */
  charter?: string
  acceptance?: string[]
  boundaries?: string[]
  metrics?: Record<string, { target?: number; unit?: string }>
  priority?: 'low' | 'medium' | 'high' | 'critical'
  maxLoops?: number
  budget?: { maxTurns?: number; maxCostUsd?: number }
  taskType?: 'feature' | 'bugfix' | 'refactor' | 'research' | 'docs' | 'test' | 'other'
  planReview?: 'auto' | 'manual'
  /** 入口来源（request.json 的 source/authorization.source 原样持久化；缺省 desktop）。 */
  source?: 'desktop' | 'lead' | 'a2a' | 'automation' | 'user' | 'tui' | 'agent'
  /** 调用者会话（提供时必须是该项目 Lead）。 */
  actorSessionID?: string
}

export interface PodCreateGoalResult {
  goalId: string
  /** `discussing` = 直接讨论 Goal（Tech Lead 会话已启动，NodeDriver 尚未运行）。 */
  status: 'started' | 'queued' | 'discussing'
  queueReason: PodQueueReason | null
  /** 讨论 Goal 的 revision（缺省 1）。 */
  revision?: number
  stage?: 'discussing'
  /** Tech Lead 隐藏会话 id（会话建立失败时为 null）。 */
  sessionID?: string | null
  sessionError?: string
  promptError?: string
  goal: PodGoal
}

export interface PodDetail {
  pod: Pod
  members: PodMember[]
  /** false when an older gateway omits the v3 stage/attention projection. */
  stageSupported?: boolean
  goals: PodGoal[]
  attention: PodAttentionItem[]
  messageHealth: PodMessageDelivery[]
  tasks: PodTask[]
  sessions: PodSession[]
}

/** Delivery outcome reported by `POST /api/pods/:podId/messages` when `notify` is set. */
export type PodDeliveryState = 'delivered' | 'pending' | 'disabled'

// ── Task 18: collaboration DTOs (Tech Lead discussion / direction / probes / revisions) ──

/** Goal revision lifecycle (append-only reject loop). */
export type PodGoalRevisionStatus =
  | 'discussing'
  | 'direction_review'
  | 'planning'
  | 'plan_review'
  | 'queued'
  | 'implementing'
  | 'reviewing'
  | 'completed'
  | 'aborted'
  | 'discarded'

export type PodGoalDirectionStatus = 'none' | 'pending' | 'decided'

/** A single Goal revision row (old revisions are never rewritten). */
export interface PodGoalRevision {
  id: string
  podId: string
  goalId: string
  revision: number
  status: PodGoalRevisionStatus
  verdict: PodGoalVerdict | null
  directionStatus: PodGoalDirectionStatus
  directionJson: string | null
  planHash: string | null
  evalHash: string | null
  feedback: string | null
  priority: number
  enqueuedAt: string
  startedAt: string | null
  endedAt: string | null
}

export interface PodDirectionOption {
  id: string
  title: string
  summary: string | null
  risks: string[]
}

/** A user/Tech Lead direction decision (append-only; user words are preserved verbatim). */
export interface PodDirectionDecision {
  id: string
  optionId: string | null
  userWords: string
  reason: string | null
  source: string
  revision: number | null
  decidedAt: string
  options: PodDirectionOption[]
}

export interface PodDirectionReviewRequest {
  id: string
  options: PodDirectionOption[]
  reason: string | null
  requestedAt: string
  requestedBy: string | null
  revision: number | null
}

export interface PodDirectionState {
  version: number
  goalId: string
  revision: number
  status: PodGoalDirectionStatus
  options: PodDirectionOption[]
  requests: PodDirectionReviewRequest[]
  decisions: PodDirectionDecision[]
  updatedAt: string | null
}

/** `POST /api/pods/:podId/goals/:goalId/direction-decision` body. */
export interface PodDirectionDecisionInput {
  /** `decided` (user words) | `clear` (direction is unambiguous) | `needs_user` (real divergence). */
  mode?: 'decided' | 'clear' | 'needs_user'
  userWords?: string
  optionId?: string
  options?: Array<{ id: string; title: string; summary?: string | null; risks?: string[] }>
  reason?: string
  revision?: number
  actorSessionID?: string
}

export interface PodDirectionResult {
  podId: string
  goalId: string
  revision: number
  revisionStatus: PodGoalRevisionStatus
  directionStatus: PodGoalDirectionStatus
  state: PodDirectionState
  decision: PodDirectionDecision | null
  artifactPath: string
  /** `decided`/`clear` 后是否成功启动了规划（needs_user 恒 false）。 */
  planningStarted?: boolean
  planningError?: string
}

/** Tech Lead discussion history for the active revision. */
export interface PodTechLeadHistory {
  goalId: string
  revision: number
  sessionID: string | null
  messages: unknown[]
  nextCursor?: string
  sessionError?: string
}

export interface PodTechLeadPrompt {
  goalId: string
  revision: number
  sessionID: string
  /** 实际发送的正文（ContextManifest + 用户文本）。 */
  text: string
}

export type PodProbeStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
export type PodProbeConclusion = 'supports' | 'refutes' | 'inconclusive'

export interface PodProbeScope {
  /** 相对隔离工作区根的允许路径；`.` = 整个工作区。 */
  paths: string[]
  /** 允许的命令类别（read/build/test/format/install/shell）。 */
  commandClasses: string[]
  network: boolean
  credentials: string[]
}

export interface PodProbeBudget {
  maxMinutes: number
  maxUsd: number
}

export interface PodProbeAffects {
  planAssertions?: string[]
  evalMethods?: string[]
  options?: string[]
}

export interface PodProbeRequest {
  id: string
  podId: string
  goalId: string
  revision: number
  question: string
  hypothesis: string
  scope: PodProbeScope
  budget: PodProbeBudget
  evidenceRequired: string[]
  affects: PodProbeAffects
}

export interface PodProbeReport {
  probeId: string
  conclusion: PodProbeConclusion
  commands: string[]
  keyOutput: string
  repro: string[]
  remainingAssumptions: string[]
  impact: { plan?: string; goalEval?: string }
}

/** Persisted Spike probe (request/report + scheduling state). */
export interface PodProbe {
  id: string
  podId: string
  goalId: string
  revision: number
  status: PodProbeStatus
  request: PodProbeRequest
  report: PodProbeReport | null
  error: string | null
  requestPath: string
  reportPath: string | null
  createdAt: string
  startedAt: string | null
  endedAt: string | null
}

/** `POST /api/pods/:podId/goals/:goalId/probes` item (single or `{ probes: [...] }`). */
export interface PodProbeInput {
  revision?: number
  question: string
  hypothesis: string
  scope: PodProbeScope
  budget: PodProbeBudget
  evidenceRequired: string[]
  affects?: PodProbeAffects
  actorSessionID?: string
}

/** Reject result: the same Goal reopened as revision N+1 (discussing). */
export interface PodRejectResult {
  podId: string
  goalId: string
  revision: number
  status: PodGoalRevisionStatus
  priority: number
  feedback: string
  archivedState: string | null
  previous: { revision: number; closed: boolean; alreadyTerminal: boolean; missing: boolean }
  /** 恢复/重建的 Tech Lead 讨论会话。 */
  sessionID: string | null
  sessionError?: string
}


export interface PodNamespace {
  ensure(projectID: string): Promise<PodDetail>
  lookup(projectID: string): Promise<PodDetail>
  create(projectID: string): Promise<PodDetail>
  get(podID: string): Promise<PodDetail>
  update(podID: string, body: { status: PodStatus }): Promise<PodDetail>
  createGoal(podID: string, body: PodCreateGoalInput): Promise<PodCreateGoalResult>
  result(podID: string, goalID: string): Promise<PodGoalResult>
  cancelGoal(podID: string, goalID: string): Promise<{ goal: PodGoal }>
  pause(podID: string): Promise<PodDetail>
  resume(podID: string): Promise<PodDetail>
  listTasks(podID: string): Promise<{ items: PodTask[] }>
  createTask(podID: string, body: { goalId?: string; title: string; ownerMemberId?: string; actorSessionID?: string; plan?: boolean; waveId?: string; acceptance?: string[] }): Promise<{ task: PodTask }>
  deleteTask(podID: string, taskID: string, body?: { actorSessionID?: string }): Promise<{ deleted: { goalId: string | null; externalTaskId: string | null } }>
  updateTask(podID: string, taskID: string, body: { status?: PodTaskStatus; ownerMemberId?: string; title?: string; acceptance?: string[]; actorSessionID?: string }): Promise<{ task: PodTask }>
  listMessages(podID: string): Promise<{ items: PodMessage[] }>
  sendMessage(podID: string, body: { fromMemberId?: string; toMemberId?: string; kind: 'note'|'request'|'review'|'decision'|'escalation'; body: string; actorSessionID?: string; notify?: boolean }): Promise<{ message: PodMessage; delivery?: PodDeliveryState }>
  markRead(podID: string, messageID: string): Promise<{ message: PodMessage }>
  retryDelivery(podID: string, messageID: string): Promise<{ delivery: PodDeliveryState }>
  dismissDelivery(podID: string, messageID: string, memberID: string): Promise<{ dismissed: boolean }>
  wake(podID: string): Promise<PodDetail>
  sleep(podID: string): Promise<PodDetail>
  cost(podID: string): Promise<{ spentUsd: number; limitUsd: number }>
  goals(podID: string): Promise<{ items: PodGoal[] }>
  transcript(podID: string, sessionID: string): Promise<{ transcript: unknown }>
  readMemory(podID: string, node?: 'plan' | 'execute' | 'review'): Promise<{ context: string | null }>
  readMemoryFile(podID: string, file: 'POD' | 'MEMORY' | 'GLOSSARY'): Promise<{ content: string | null }>
  writeMemory(podID: string, body: { file: 'POD' | 'MEMORY' | 'GLOSSARY'; content: string; actorSessionID?: string }): Promise<{ path: string }>
  /** Tech Lead discussion for the active revision (GET ensures the hidden session exists). */
  techLead(podID: string, goalID: string, limit?: number): Promise<PodTechLeadHistory>
  sendTechLeadMessage(podID: string, goalID: string, text: string, body?: { actorSessionID?: string }): Promise<PodTechLeadPrompt>
  directionDecision(podID: string, goalID: string, body: PodDirectionDecisionInput): Promise<PodDirectionResult>
  probes(podID: string, goalID: string, filter?: { revision?: number; status?: PodProbeStatus }): Promise<{ items: PodProbe[] }>
  createProbe(podID: string, goalID: string, body: PodProbeInput | PodProbeInput[]): Promise<{ items: PodProbe[] }>
  rejectResult(podID: string, goalID: string, feedback: string, body?: { actorSessionID?: string }): Promise<PodRejectResult>
  revisions(podID: string, goalID: string): Promise<{ items: PodGoalRevision[] }>
}

/** 持久审批规则（切片 1：~/.mafw/permission-rules.json）。 */
export interface PermissionRule {
  tool: string
  /** 尾部 `*` 表示前缀匹配；缺省 = 工具级 */
  pattern?: string
  action: 'allow'
}

export interface PermissionsNamespace {
  list(): Promise<PermissionRequest[]>
  reply(id: string, reply: 'once' | 'always' | 'reject', message?: string, persist?: boolean | 'tool' | 'prefix'): Promise<void>
  /**
   * per-session 审批模式（gateway kv 持久）。三档预设：read-only（只读工具放行、变更必问）/
   * auto（工作区内自由、危险问、25 次预算回落 read-only）/ full-access（全放）。
   * legacy 'manual' 由 gateway 归一化 read-only。
   */
  getMode(sessionID: string): Promise<{ mode: 'read-only' | 'auto' | 'full-access'; autoApprovals: number; budget: number }>
  setMode(sessionID: string, mode: 'read-only' | 'auto' | 'full-access'): Promise<void>
  /** 持久规则（~/.mafw/permission-rules.json；切片 1 起的规则唯一存储） */
  listRules(): Promise<{ entries: PermissionRule[] }>
  addRule(rule: { tool: string; pattern?: string }): Promise<{ success: boolean; entries: PermissionRule[] }>
  removeRule(rule: { tool: string; pattern?: string }): Promise<{ success: boolean; entries: PermissionRule[] }>
  /** legacy 白名单（config.yaml approval 段；gateway 双读过渡，新代码用 rules） */
  listAllowlist(): Promise<{ entries: Array<{ tool: string; prefix?: string }> }>
  addAllowlist(entry: { tool: string; prefix?: string }): Promise<{ success: boolean; entries: Array<{ tool: string; prefix?: string }> }>
  removeAllowlist(entry: { tool: string; prefix?: string }): Promise<{ success: boolean; entries: Array<{ tool: string; prefix?: string }> }>
}

// ============================================================
// MafwClient — full client interface
// ============================================================

export interface MafwClient {
  session: SessionNamespace
  project: ProjectNamespace
  event: EventNamespace
  runtime: RuntimeNamespace
  experience: {
    actions(sessionID?: string, params?: { directory?: string }): Promise<import('./experience-contract').ExperienceActionsResponse>
  }
  config: ConfigNamespace
  runtimeConfig: RuntimeConfigNamespace
  models: ModelConfigNamespace
  embedding: EmbeddingConfigNamespace
  chat: ChatNamespace
  goals: GoalsNamespace
  memory: MemoryNamespace
  approvals: ApprovalsNamespace
  questions: QuestionsNamespace
  tasks: TasksNamespace
  /** Task 3：三源统一的后台作业 façade（`background.jobs.list/output/cancel`）。 */
  background: BackgroundNamespace
  terminal: TerminalNamespace
  pod: PodNamespace
  permissions: PermissionsNamespace
  providers: ProvidersNamespace
  agents: AgentsNamespace
  triage: TriageNamespace
  automations: AutomationsNamespace
  media: MediaNamespace
  tts: TtsNamespace
  voice: VoiceNamespace
  discovery: DiscoveryNamespace
  mafwCommands: MafwCommandsNamespace
  manager: ManagerNamespace
}

export interface MafwClientOptions {
  baseUrl?: string
  /** Injectable fetch for tests / custom transports (defaults to global fetch). */
  fetchImpl?: typeof fetch
}

// ============================================================
// Media (A2A Media Agent)
// ============================================================

export interface MediaTask {
  id: string
  contextId: string
  state: string
}

export interface MediaPluginState {
  file: string
  name?: string
  status: 'ok' | 'error'
  error?: string
  modalities?: string[]
}

export interface MediaNamespace {
  /** List media engine plugins (status + modalities). */
  plugins(): Promise<{ plugins: MediaPluginState[] }>
  /**
   * Switch media engine per modality.
   * @param opts - Engine overrides (top-level engine and/or per-modality).
   */
  switch(opts: {
    engine?: string
    image?: { engine?: string }
    video?: { engine?: string }
    audio?: { engine?: string }
  }): Promise<{
    success: boolean
    media: {
      engine?: string
      image?: { engine?: string; model?: string }
      video?: { engine?: string; model?: string }
      audio?: { engine?: string; model?: string }
    }
  }>
  /** Create an A2A vision task from an image (data URL) + initial question. */
  createTask: (opts: { dataUrl?: string; artifactId?: string; mediaType?: string; question?: string }) => Promise<MediaTask>
  /** 二进制媒体上传（raw octet-stream，?type=）。返回 artifact 引用（供 createTask artifactId 路径）。 */
  upload: (input: { bytes: Uint8Array; mediaType: string }) => Promise<{ artifactId: string }>
  /** 上传 + 建 A2A 任务一次往返（?type=&question=）。 */
  uploadAndCreate: (input: { bytes: Uint8Array; mediaType: string; question?: string }) => Promise<{ id: string; contextId: string; state: string; artifactId?: string; mediaType?: string; size?: number }>
  /** 工件 URL（TTS 音频/上传媒体）。契约归 SDK：renderer 直连 <audio src> 时用此构造。 */
  artifactUrl: (id: string) => string
}

// ============================================================
// TTS (MiMo-V2.5-TTS speech synthesis)
// ============================================================

export interface TtsResult {
  artifactId: string
  voice: string
  mime: string
  url: string
}

export interface VoiceNamespace {
  /** Voice runtime v2 status: config + registered ASR engines. */
  status: () => Promise<{ ok: boolean; config: any; engines: any[] }>
}

export interface TtsNamespace {
  /** Synthesize speech from text (preset voice, wav). Returns artifact reference. */
  speak: (opts: { text: string; voice?: string; style?: string }) => Promise<TtsResult>
  /** Preset voice list + model info (desktop voice picker). */
  voices: () => Promise<{ voices: { id: string; label: string; lang: string }[]; models: { id: string; description: string }[]; defaultVoice: string; defaultModel: string }>
  /** Streaming TTS (SSE, PCM16 24kHz mono): async iterable of base64 chunks. */
  speakStream: (opts: { text: string; voice?: string; style?: string }) => AsyncGenerator<{ data: string; voice: string }>
  /** 流式 TTS 端点 URL（契约归 SDK：IPC 无法克隆 SSE 流，renderer 直连 fetch 时用此构造）。 */
  streamUrl: () => string
}
