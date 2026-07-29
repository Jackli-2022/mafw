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

export interface SessionNamespace {
  create(opts: { directory?: string; metadata?: Record<string, unknown> }): Promise<Session>
  promptAsync(opts: { sessionID: string; message: string }): Promise<void>
  prompt(opts: { path: { id: string }; body: { parts: Array<{ type: 'text'; text: string }>; system?: string } }): Promise<{ parts: TextPart[] }>
  delete(opts: { sessionID: string } | { path: { id: string } }): Promise<void>
  list(): Promise<Session[]>
  get(id: string): Promise<Session>
}

export interface ProjectNamespace {
  list(): Promise<Project[]>
  current(): Promise<Project>
  setCurrent(path: string): Promise<void>
}

export interface EventNamespace {
  subscribe(opts?: {}): Promise<{ on(event: string, cb: (data: any) => void): void }>
}

export interface ConfigNamespace {
  get(key: string): Promise<any>
  set(key: string, value: any): Promise<void>
}

export interface GoalsNamespace {
  list(): Promise<Goal[]>
  get(id: string): Promise<Goal | null>
  create(input: GoalCreateInput): Promise<{ goalId: string }>
}

export interface MemorySearchOptions {
  query: string
  topK?: number
  goalId?: string
}

export interface MemoryNamespace {
  search(opts: MemorySearchOptions): Promise<MemoryUnit[]>
  getEnergyDistribution(): Promise<EnergyDistribution>
  getL5Axioms(topK?: number): Promise<Axiom[]>
}

export interface ApprovalsNamespace {
  list(): Promise<Approval[]>
  respond(id: string, decision: 'approve' | 'reject'): Promise<void>
}

export interface TriageNamespace {
  list(): Promise<TriageItem[]>
}

export interface AutomationsNamespace {
  list(): Promise<AutomationRule[]>
  toggle(id: string, enabled: boolean): Promise<void>
}

// ============================================================
// GatewayClient — full client interface
// ============================================================

export interface GatewayClient {
  // Core (aligned with @opencode-ai/sdk)
  session: SessionNamespace
  project: ProjectNamespace
  event: EventNamespace
  config: ConfigNamespace

  // MAFW extensions
  goals: GoalsNamespace
  memory: MemoryNamespace
  approvals: ApprovalsNamespace
  triage: TriageNamespace
  automations: AutomationsNamespace
}

export interface GatewayClientOptions {
  baseUrl?: string
}
