import type {
  Session, Project, Goal, GoalCreateInput, GoalControlAction,
  MemoryUnit, MemorySearchOptions, MergedSearchOptions,
  EnergyDistribution, Axiom, L5Heuristic, StickyNote, ModelUsageWindows,
  Approval, TriageItem, AutomationRule, GatewayStatus,
  QuestionRequest, PermissionRequest,
  ModelConfigState, ModelConfigUpdate,
  EmbeddingConfigState, EmbeddingConfigGetResponse, EmbeddingRuntimeState, EmbeddingConfigUpdate,
} from "@mafw/sdk"
import type { PluginEntry, RenderRequest, RenderResponse } from "../shared/ui-plugins"

export type MafwAPI = {
  gateway: {
    info: () => Promise<GatewayStatus>
    start: () => Promise<GatewayStatus>
    restart: () => Promise<GatewayStatus>
    logsPath: () => Promise<string>
    onStateChange: (cb: (status: GatewayStatus) => void) => () => void
  }

  sessions: {
    list: (projectID?: string) => Promise<Session[]>
    create: (opts?: { directory?: string; metadata?: Record<string, unknown> }) => Promise<Session>
    get: (id: string) => Promise<Session | null>
    messages: (sessionID: string, limit?: number, before?: string) => Promise<any>
    todo: (sessionID: string) => Promise<{ data: any[] }>
    children: (sessionID: string) => Promise<any[]>
    abort: (sessionID: string) => Promise<void>
    delete: (id: string) => Promise<void>
    rename: (id: string, title: string) => Promise<void>
    trajectory: (sessionID: string, query?: { limit?: number; before_turn?: number; rebuild?: boolean }) => Promise<{ turns: any[]; events: any[] }>
    tokenSummary: (sessionID: string) => Promise<{
      totalTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
      totalCost: number
      turnCount: number
      avgTokensPerTurn: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
    }>
    usageSummary: (sessionID?: string, projectID?: string) => Promise<{
      session: { totalTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }; totalCost: number; turnCount: number; avgTokensPerTurn: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } } | null
      project: { totalTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }; totalCost: number; turnCount: number; sessionCount: number } | null
      global: { totalTokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }; totalCost: number; turnCount: number; sessionCount: number } | null
    }>
    usage: (sessionID?: string, projectID?: string) => Promise<{
      summary: { session: any; project: any; global: any }
      providers: any[]
      modelStats?: { windows: ModelUsageWindows }
      updatedAt: number
    }>
    usagePlugins: () => Promise<{ plugins: { file: string; name?: string; status: string; error?: string; overridden: boolean }[] }>
    usagePluginsReload: () => Promise<{ ok: boolean; plugins: any[] }>
    usagePluginsCreate: (body: { template?: string; values?: Record<string, any>; name?: string; source?: string }) => Promise<{ ok: boolean; name?: string; error?: string; plugins?: any[] }>
    usagePluginSource: (name: string) => Promise<{ source?: string; origin?: string; builtin?: boolean; error?: string }>
    usagePluginSourceSave: (name: string, source: string) => Promise<{ ok: boolean; error?: string }>
    usagePluginDelete: (name: string) => Promise<{ ok: boolean; error?: string }>
    usagePluginTest: (name: string) => Promise<{ ok: boolean; result?: any; error?: string }>
    openUsagePluginsDir: () => Promise<void>
    promptAsync: (opts: { sessionID: string; message?: string; parts?: Record<string, unknown>[]; agent?: string; model?: { providerID: string; modelID: string } }) => Promise<void>
    command: (opts: { sessionID: string; command: string; arguments?: string; agent?: string; model?: { providerID: string; modelID: string } }) => Promise<void>
  }

  command: {
    list: (directory?: string) => Promise<any[]>
  }

  skill: {
    list: (directory?: string) => Promise<any[]>
  }

  mafwCommands: {
    run: (opts: { command: string; args?: string; sessionID?: string }) => Promise<{ ok: boolean; message?: string; text?: string; error?: string; sessionID?: string; added?: number; conflicts?: number; skipped?: number }>
  }

  manager: {
    session: (projectDir?: string) => Promise<{ projectDir: string; sessionId: string; createdAt?: string | null } | null>
    rotate: (projectDir: string, reason?: string) => Promise<{ success: boolean; sessionId: string; previousSessionId?: string; created: 'initial' | 'rotated' }>
  }

  projects: {
    list: () => Promise<Project[]>
    current: () => Promise<Project | null>
    setCurrent: (path: string) => Promise<void>
  }

  goals: {
    list: () => Promise<Goal[]>
    get: (id: string) => Promise<Goal | null>
    validate: (input: GoalCreateInput) => Promise<{ goalId: string }>
    control: (action: GoalControlAction) => Promise<void>
  }

  memory: {
    search: (opts: MemorySearchOptions) => Promise<MemoryUnit[]>
    mergedSearch: (opts: MergedSearchOptions) => Promise<any[]>
    delete: (id: string) => Promise<void>
    getEnergyDistribution: () => Promise<EnergyDistribution>
    getL5Axioms: (topK?: number) => Promise<{ axioms: Axiom[]; heuristics: L5Heuristic[] }>
    listSticky: () => Promise<{ entries: StickyNote[]; budget: { max: number; maxChars: number; used: number } }>
    setSticky: (id: string, sticky: boolean, stickyDays?: number) => Promise<void>
  }

  approvals: {
    list: () => Promise<Approval[]>
    respond: (id: string, decision: 'approve' | 'reject') => Promise<void>
  }

  questions: {
    list: () => Promise<QuestionRequest[]>
    reply: (id: string, answers: string[][]) => Promise<void>
    reject: (id: string) => Promise<void>
  }

  permissions: {
    list: () => Promise<PermissionRequest[]>
    reply: (id: string, reply: 'once' | 'always' | 'reject', message?: string) => Promise<void>
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
    send: (message: string, sessionID?: string) => Promise<{ sessionID: string }>
    sendEnriched: (opts: { message: string; sessionID?: string; parts?: Record<string, unknown>[]; agent?: string; model?: { providerID: string; modelID: string } }) => Promise<{ sessionID: string }>
  }

  media: {
    createTask: (opts: { dataUrl?: string; artifactId?: string; mediaType?: string; question?: string }) => Promise<{ id: string; contextId: string; state: string }>
    uploadBinary: (bytes: ArrayBuffer, mediaType: string) => Promise<string>
    uploadAndCreate: (opts: { bytes: ArrayBuffer; mediaType: string; question?: string }) => Promise<{ id: string; contextId: string; state: string; artifactId: string; mediaType: string; size: number }>
    plugins: () => Promise<{ plugins: { file: string; name?: string; status: string; error?: string; modalities?: string[] }[] }>
    switch: (opts: { engine?: string; image?: { engine?: string }; video?: { engine?: string }; audio?: { engine?: string } }) => Promise<{ success: boolean; media: { engine?: string; image?: { engine?: string; model?: string }; video?: { engine?: string; model?: string }; audio?: { engine?: string; model?: string } } }>
  }

  tts: {
    speak: (opts: { text: string; voice?: string; style?: string }) => Promise<{ artifactId: string; voice: string; mime: string; url: string }>
    voices: () => Promise<{ voices: { id: string; label: string; lang: string }[]; models: { id: string; description: string }[]; defaultVoice: string; defaultModel: string }>
  }

  providers: {
    list: () => Promise<{ all: Record<string, any>[]; default?: Record<string, string>; connected?: string[] } | null>
  }

  agents: {
    list: () => Promise<any[]>
  }

  config: {
    get: (key?: string) => Promise<any>
    set: (key: string, value: any) => Promise<void>
  }

  models: {
    get: () => Promise<ModelConfigState>
    update: (opts: ModelConfigUpdate) => Promise<{ success: boolean; recall: ModelConfigState['recall']; media: ModelConfigState['media'] }>
  }

  embedding: {
    get: () => Promise<EmbeddingConfigGetResponse>
    update: (opts: EmbeddingConfigUpdate) => Promise<{ success: boolean; current: EmbeddingConfigState; runtime: EmbeddingRuntimeState; note?: string }>
  }
  runtime: {
    get: () => Promise<{ active: { name: string; capabilities: Record<string, boolean> }; plugins: { file: string; name?: string; status: string; error?: string; capabilities?: Record<string, boolean> }[] }>
    switch: (plugin: string) => Promise<{ success: boolean; active: { name: string; capabilities: Record<string, boolean> }; envOverride: boolean }>
    restartAgent: () => Promise<{ success: boolean; mode: string }>
  }

  uiPlugins: {
    list(): Promise<PluginEntry[]>
    render(req: RenderRequest): Promise<RenderResponse>
    onChange(cb: () => void): () => void
  }

  opencodeConfig: {
    get: () => Promise<any>
    update: (config: Record<string, unknown>) => Promise<any>
  }

  /** @deprecated Use typed methods above instead. */
  invoke: (namespace: string, method: string, ...args: unknown[]) => Promise<unknown>
}
