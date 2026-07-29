import type {
  Session, Project, Goal, GoalCreateInput, GoalControlAction,
  MemoryUnit, MemoryFact, MemorySearchOptions, MergedSearchOptions,
  EnergyDistribution, Axiom, Approval, TriageItem, AutomationRule,
  ChatResult,
} from '../types'

export interface SessionNamespace {
  create(opts: { directory?: string; metadata?: Record<string, unknown> }): Promise<Session>
  promptAsync(opts: { sessionID: string; message: string }): Promise<void>
  prompt(opts: { path: { id: string }; body: { parts: Array<{ type: 'text'; text: string }>; system?: string } }): Promise<{ parts: any[] }>
  delete(opts: { sessionID: string } | { path: { id: string } }): Promise<void>
  list(projectID?: string): Promise<Session[]>
  get(id: string): Promise<Session | null>
  messages(sessionID: string, limit?: number, before?: string): Promise<any>
}

export interface ProjectNamespace {
  list(): Promise<Project[]>
  current(): Promise<Project | null>
  setCurrent(path: string): Promise<void>
}

export interface EventNamespace {
  subscribe(): Promise<{ on(event: string, cb: (data: any) => void): void }>
}

export interface ConfigNamespace {
  get(key?: string): Promise<any>
  set(key: string, value: any): Promise<void>
}

export interface ChatNamespace {
  send(message: string): Promise<ChatResult>
  sendEnriched(message: string): Promise<ChatResult>
}

export interface GoalsNamespace {
  list(): Promise<Goal[]>
  get(id: string): Promise<Goal | null>
  create(input: GoalCreateInput): Promise<{ goalId: string }>
  control(action: GoalControlAction): Promise<void>
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

export interface IMafwClient {
  session: SessionNamespace
  project: ProjectNamespace
  event: EventNamespace
  config: ConfigNamespace
  chat: ChatNamespace
  goals: GoalsNamespace
  memory: MemoryNamespace
  approvals: ApprovalsNamespace
  triage: TriageNamespace
  automations: AutomationsNamespace
}
