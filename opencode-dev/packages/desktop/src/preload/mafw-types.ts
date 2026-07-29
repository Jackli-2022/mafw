import type {
  Session, Project, Goal, GoalCreateInput, GoalControlAction,
  MemoryUnit, MemorySearchOptions, MergedSearchOptions,
  Approval, TriageItem, AutomationRule, GatewayStatus,
} from "../../../../mafw-sdk/src"

export type MafwAPI = {
  gateway: {
    info: () => Promise<GatewayStatus>
    start: () => Promise<GatewayStatus>
    restart: () => Promise<GatewayStatus>
    onStateChange: (cb: (status: GatewayStatus) => void) => () => void
  }

  sessions: {
    list: (projectID?: string) => Promise<Session[]>
    create: (opts?: { directory?: string; metadata?: Record<string, unknown> }) => Promise<Session>
    get: (id: string) => Promise<Session | null>
    messages: (sessionID: string, limit?: number, before?: string) => Promise<any>
    delete: (id: string) => Promise<void>
    promptAsync: (opts: { sessionID: string; message: string }) => Promise<void>
  }

  projects: {
    list: () => Promise<Project[]>
    current: () => Promise<Project | null>
    setCurrent: (path: string) => Promise<void>
  }

  goals: {
    list: () => Promise<Goal[]>
    get: (id: string) => Promise<Goal | null>
    create: (input: GoalCreateInput) => Promise<{ goalId: string }>
    control: (action: GoalControlAction) => Promise<void>
  }

  memory: {
    search: (opts: MemorySearchOptions) => Promise<MemoryUnit[]>
    mergedSearch: (opts: MergedSearchOptions) => Promise<any[]>
    delete: (id: string) => Promise<void>
  }

  approvals: {
    list: () => Promise<Approval[]>
    respond: (id: string, decision: 'approve' | 'reject') => Promise<void>
  }

  triage: {
    list: () => Promise<TriageItem[]>
    dismiss: (id: string) => Promise<void>
    confirm: (id: string) => Promise<void>
    reject: (id: string) => Promise<void>
  }

  automations: {
    list: () => Promise<AutomationRule[]>
    toggle: (id: string, enabled: boolean) => Promise<void>
  }

  chat: {
    send: (message: string) => Promise<{ sessionID: string }>
    sendEnriched: (message: string) => Promise<{ sessionID: string }>
  }

  config: {
    get: (key?: string) => Promise<any>
    set: (key: string, value: any) => Promise<void>
  }

  /** @deprecated Use typed methods above instead. */
  invoke: (namespace: string, method: string, ...args: unknown[]) => Promise<unknown>
}
