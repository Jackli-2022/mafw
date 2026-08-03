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
  messages(params: { path: { id: string }; query?: { limit?: number; before?: string } }): Promise<{ data: SessionMessagePart[]; nextCursor: string | null }>
  todo(params: { path: { id: string } }): Promise<{ data: Todo[] }>
  abort(params: { path: { id: string } }): Promise<void>
  prompt(params: { path: { id: string }; body: { parts: Array<{ type: 'text'; text: string }>; system?: string } }): Promise<{ parts: TextPart[] }>
  promptAsync(params: { path: { id: string }; body: { message: string } }): Promise<void>
  events(params: { path: { id: string } }): Promise<{ on(event: string, cb: (data: any) => void): void }>
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

export interface ConfigNamespace {
  get(key?: string): Promise<any>
  set(key: string, value: any): Promise<void>
}

export interface ChatNamespace {
  send(message: string, sessionID?: string): Promise<{ sessionID: string }>
  sendEnriched(message: string, sessionID?: string): Promise<{ sessionID: string }>
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
  getL5Axioms(topK?: number): Promise<Axiom[]>
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
  config: ConfigNamespace
  chat: ChatNamespace
  goals: GoalsNamespace
  memory: MemoryNamespace
  approvals: ApprovalsNamespace
  questions: QuestionsNamespace
  permissions: PermissionsNamespace
  triage: TriageNamespace
  automations: AutomationsNamespace
}

export interface MafwClientOptions {
  baseUrl?: string
}
