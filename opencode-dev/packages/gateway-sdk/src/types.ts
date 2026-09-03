// ============================================================
// Core types (aligned with @opencode-ai/sdk subset)
// ============================================================

export interface Session {
  id: string
  projectID: string
  directory: string
  title: string
  time: { created: number; updated: number }
  parentID?: string
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
  goalId: string
  reason: string
  severity: 'low' | 'medium' | 'high'
  createdAt: string
}

export interface AutomationRule {
  id: string
  enabled: boolean
  name?: string
  trigger?: { schedule: string; timezone: string }
  action?: { type: string }
}

export interface SessionMessageInfo {
  id: string
  sessionID: string
  role: 'user' | 'assistant'
  parentID?: string
  time: { created: number; updated?: number }
}

export interface SessionMessagePart {
  id: string
  messageID: string
  sessionID: string
  type: string
  text?: string
}

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

export interface SessionNamespace {
  create(params?: { directory?: string; metadata?: Record<string, unknown> }): Promise<Session>
  get(params: { path: { id: string } }): Promise<Session>
  list(params?: { query?: { projectID?: string } }): Promise<Session[]>
  delete(params: { path: { id: string } }): Promise<void>
  rename(params: { path: { id: string }; body: { title: string } }): Promise<void>
  messages(params: { path: { id: string }; query?: { limit?: number; before?: string } }): Promise<{ data: SessionMessagePart[]; nextCursor: string | null }>
  todo(params: { path: { id: string } }): Promise<{ data: Todo[] }>
  children(params: { path: { id: string } }): Promise<any[]>
  abort(params: { path: { id: string } }): Promise<void>
  prompt(params: { path: { id: string }; body: { parts: Array<{ type: 'text'; text: string }>; system?: string } }): Promise<{ parts: TextPart[] }>
  promptAsync(params: { path: { id: string }; body: { message?: string; parts?: Record<string, unknown>[]; agent?: string; model?: { providerID: string; modelID: string } } }): Promise<void>
  trajectory(params: { path: { id: string }; query?: { limit?: number; before_turn?: number; rebuild?: boolean } }): Promise<TrajectoryResponse>
  events(params: { path: { id: string } }): Promise<{ on(event: string, cb: (data: any) => void): void }>
  command(params: { path: { id: string }; body: { command: string; arguments?: string; agent?: string; model?: { providerID: string; modelID: string } } }): Promise<void>
}

// ── Commands & skills (opencode serve shapes) ──

export interface CommandInfo {
  name: string
  description?: string
  agent?: string
  model?: string
  source?: "command" | "mcp" | "skill" | "builtin"
  template?: string
  subtask?: boolean
  hints?: Record<string, unknown>
}

export interface SkillInfo {
  name: string
  description?: string
  slash?: boolean
  location?: string
  content?: string
}

export interface CommandNamespace {
  list(directory?: string): Promise<CommandInfo[]>
}

export interface SkillNamespace {
  list(directory?: string): Promise<SkillInfo[]>
}

// ── MAFW native commands (desktop slash panel) ──

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

export interface OpenCodeConfigNamespace {
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
}

export interface ModelConfigNamespace {
  get(): Promise<ModelConfigState>
  update(opts: ModelConfigUpdate): Promise<{ success: boolean; recall: ModelConfigState['recall']; media: ModelConfigState['media'] }>
}

export interface EmbeddingConfigState {
  provider: 'off' | 'local' | 'dashscope'
  engine: 'onnx' | 'llamacpp'
  model: string
  dimensions: number
  threads: number
  llamacpp: { gpu: string; threads: number; contextSize: number }
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
  llamacpp?: { gpu?: string; threads?: number; contextSize?: number }
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
  list(): Promise<{ all: Record<string, any>[]; default?: Record<string, string>; connected?: string[] } | null>
}

export interface AgentsNamespace {
  list(): Promise<any[]>
}

export interface GoalsNamespace {
  list(): Promise<Goal[]>
  get(id: string): Promise<Goal | null>
  validate(input: GoalCreateInput): Promise<{ goalId: string }>
  control(action: GoalControlAction): Promise<void>
}

export interface MemorySearchOptions {
  query: string
  topK?: number
  goalId?: string
}

export interface MemoryNamespace {
  search(opts: MemorySearchOptions): Promise<MemoryUnit[]>
  mergedSearch(opts: MergedSearchOptions): Promise<MemoryFact[]>
  getEnergyDistribution(): Promise<EnergyDistribution>
  getL5Axioms(topK?: number): Promise<{ axioms: Axiom[]; heuristics: L5Heuristic[] }>
  delete(id: string): Promise<void>
}

export interface ApprovalsNamespace {
  list(): Promise<Approval[]>
  respond(id: string, decision: 'approve' | 'reject'): Promise<void>
}

export interface TriageNamespace {
  list(): Promise<TriageItem[]>
  dismiss(id: string): Promise<void>
  confirm(id: string): Promise<void>
  reject(id: string): Promise<void>
}

export interface AutomationsNamespace {
  list(): Promise<AutomationRule[]>
  toggle(id: string, enabled: boolean): Promise<void>
}

export interface QuestionsNamespace {
  list(): Promise<QuestionRequest[]>
  reply(id: string, answers: string[][]): Promise<void>
  reject(id: string): Promise<void>
}

export interface PermissionsNamespace {
  list(): Promise<PermissionRequest[]>
  reply(id: string, reply: 'once' | 'always' | 'reject', message?: string): Promise<void>
}

// ============================================================
// MafwClient — full client interface
// ============================================================

export interface MafwClient {
  session: SessionNamespace
  project: ProjectNamespace
  event: EventNamespace
  runtime: RuntimeNamespace
  config: ConfigNamespace
  opencodeConfig: OpenCodeConfigNamespace
  models: ModelConfigNamespace
  embedding: EmbeddingConfigNamespace
  chat: ChatNamespace
  goals: GoalsNamespace
  memory: MemoryNamespace
  approvals: ApprovalsNamespace
  questions: QuestionsNamespace
  permissions: PermissionsNamespace
  providers: ProvidersNamespace
  agents: AgentsNamespace
  triage: TriageNamespace
  automations: AutomationsNamespace
  media: MediaNamespace
  tts: TtsNamespace
  command: CommandNamespace
  skill: SkillNamespace
  mafwCommands: MafwCommandsNamespace
  manager: ManagerNamespace
}

export interface MafwClientOptions {
  baseUrl?: string
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

export interface TtsNamespace {
  /** Synthesize speech from text (preset voice, wav). Returns artifact reference. */
  speak: (opts: { text: string; voice?: string; style?: string }) => Promise<TtsResult>
  /** Preset voice list + model info (desktop voice picker). */
  voices: () => Promise<{ voices: { id: string; label: string; lang: string }[]; models: { id: string; description: string }[]; defaultVoice: string; defaultModel: string }>
  /** Streaming TTS (SSE, PCM16 24kHz mono): async iterable of base64 chunks. */
  speakStream: (opts: { text: string; voice?: string; style?: string }) => AsyncGenerator<{ data: string; voice: string }>
}
