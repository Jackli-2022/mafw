import type {
  Session, Project, Goal, GoalCreateInput, GoalControlAction, GoalSessionInfo,
  MemoryUnit, MemorySearchOptions, MergedSearchOptions,
  EnergyDistribution, Axiom, L5Heuristic, StickyNote, ModelUsageWindows,
  Approval, TriageItem, AutomationRule, GatewayStatus,
  QuestionRequest, PermissionRequest,
  ModelConfigState, ModelConfigUpdate,
  EmbeddingConfigState, EmbeddingConfigGetResponse, EmbeddingRuntimeState, EmbeddingConfigUpdate,
} from "@mafw/sdk"
import type { PluginEntry, RenderRequest, RenderResponse } from "../shared/ui-plugins"

export type MafwAPI = {
  notify: (opts: { title: string; body: string }) => Promise<boolean>

  gateway: {
    info: () => Promise<GatewayStatus>
    start: () => Promise<GatewayStatus>
    restart: () => Promise<GatewayStatus>
    update: () => Promise<{ ok: boolean; error?: string }>
    logsPath: () => Promise<string>
    onStateChange: (cb: (status: GatewayStatus) => void) => () => void
    onHealthChange: (cb: (health: { healthy: boolean; failures: number }) => void) => () => void
  }

  files: {
    list: () => Promise<string[]>
  }

  windows: {
    create: () => Promise<{ ok: boolean; error?: string }>
  }

  exportSession: (opts: { filename: string; markdown: string }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>

  sessions: {
    list: (projectID?: string) => Promise<Session[]>
    create: (opts?: { directory?: string; metadata?: Record<string, unknown>; worktree?: boolean | string }) => Promise<Session & { worktree?: { dir: string; branch: string } }>
    get: (id: string) => Promise<Session | null>
    messages: (sessionID: string, limit?: number, before?: string) => Promise<any>
    todo: (sessionID: string) => Promise<{ data: any[] }>
    children: (sessionID: string) => Promise<any[]>
    abort: (sessionID: string) => Promise<void>
    fork: (sessionID: string, messageID?: string) => Promise<{ session: { id: string } }>
    revert: (sessionID: string, messageID: string) => Promise<void>
    unrevert: (sessionID: string) => Promise<void>
    diff: (sessionID: string, messageID?: string) => Promise<{ files: Array<{ file?: string; patch?: string; additions?: number; deletions?: number; status?: string }> }>
    revertDiff: (sessionID: string, patches: Array<{ file?: string; patch: string; hunkIndices: number[] }>) => Promise<{ reverted: number }>
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
    /** gateway 命令注册表清单（含用户自定义命令） */
    list: () => Promise<Array<{ name: string; aliases?: string[]; description: string; argumentHint?: string; category: 'goals' | 'session' | 'memory' | 'custom'; destructive?: boolean; kind: 'builtin' | 'custom'; source?: string }>>
  }

  manager: {
    session: (projectDir?: string) => Promise<{ projectDir: string; sessionId: string; createdAt?: string | null } | null>
    rotate: (projectDir: string, reason?: string) => Promise<{ success: boolean; sessionId: string; previousSessionId?: string; created: 'initial' | 'rotated' }>
  }

  projects: {
    list: () => Promise<Project[]>
    current: () => Promise<Project | null>
    setCurrent: (path: string) => Promise<void>
    openDirectory: () => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
  }

  goals: {
    list: () => Promise<Goal[]>
    get: (id: string) => Promise<Goal | null>
    validate: (input: GoalCreateInput) => Promise<{ goalId: string }>
    control: (action: GoalControlAction) => Promise<void>
    sessions: (id: string) => Promise<GoalSessionInfo[]>
    respondQuestion: (goalId: string, questionId: string, input: { type: 'answer' | 'cancel'; answer?: string }) => Promise<{ status: string }>
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
    respond: (id: string, input: 'approve' | 'reject' | { answer: string }) => Promise<void>
  }

  questions: {
    list: () => Promise<QuestionRequest[]>
    reply: (id: string, answers: string[][]) => Promise<void>
    reject: (id: string) => Promise<void>
  }

  permissions: {
    list: () => Promise<PermissionRequest[]>
    reply: (id: string, reply: 'once' | 'always' | 'reject', message?: string, persist?: boolean | 'tool' | 'prefix') => Promise<void>
    getMode: (sessionID: string) => Promise<{ mode: 'read-only' | 'auto' | 'full-access'; autoApprovals: number; budget: number }>
    setMode: (sessionID: string, mode: 'read-only' | 'auto' | 'full-access') => Promise<void>
    listRules: () => Promise<{ entries: Array<{ tool: string; pattern?: string; action: 'allow' }> }>
    addRule: (rule: { tool: string; pattern?: string }) => Promise<{ success: boolean; entries: Array<{ tool: string; pattern?: string; action: 'allow' }> }>
    removeRule: (rule: { tool: string; pattern?: string }) => Promise<{ success: boolean; entries: Array<{ tool: string; pattern?: string; action: 'allow' }> }>
    listAllowlist: () => Promise<{ entries: Array<{ tool: string; prefix?: string }> }>
    addAllowlist: (entry: { tool: string; prefix?: string }) => Promise<{ success: boolean; entries: Array<{ tool: string; prefix?: string }> }>
    removeAllowlist: (entry: { tool: string; prefix?: string }) => Promise<{ success: boolean; entries: Array<{ tool: string; prefix?: string }> }>
  }

  triage: {
    list: () => Promise<TriageItem[]>
    dismiss: (id: string) => Promise<void>
    confirm: (id: string) => Promise<void>
    reject: (id: string) => Promise<void>
    propose: (id: string, suggestion: 'confirm' | 'reject', reason: string, priority?: 'high' | 'medium' | 'low') => Promise<{ success: boolean; message?: string }>
  }

  automations: {
    list: () => Promise<AutomationRule[]>
    toggle: (id: string, enabled: boolean) => Promise<void>
    draft: (input: { id: string; trigger: { schedule: string; timezone?: string }; skill?: string; action?: { type: 'triage' | 'goal'; template?: string; auto_confirm?: boolean }; goal_defaults?: { maxLoops?: number } }) => Promise<{ id: string; valid: boolean; errors?: string[] }>
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
    /** Artifact 下载/播放 URL（SDK 契约：renderer 不自己拼 /a2a/artifacts/）。 */
    artifactUrl: (id: string) => Promise<string>
  }

  tts: {
    speak: (opts: { text: string; voice?: string; style?: string }) => Promise<{ artifactId: string; voice: string; mime: string; url: string }>
    voices: () => Promise<{ voices: { id: string; label: string; lang: string }[]; models: { id: string; description: string }[]; defaultVoice: string; defaultModel: string }>
    /** 流式 TTS 端点 URL（IPC 无法克隆 SSE 流，renderer 直连 fetch 时用此取 URL）。 */
    streamUrl: () => Promise<string>
    /** barge-in 打断：取消该 session 全部在途 TTS 合成。 */
    interrupt: (sessionId: string) => Promise<{ ok: boolean; cancelled: number }>
  }

  event: {
    /** SSE 端点 URL（带/不带 sessionID），renderer 直连 EventSource 用。 */
    url: (sessionID?: string) => Promise<string>
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

  plugins: {
    list(): Promise<{ plugins: { type: 'runtime' | 'media' | 'usage' | 'ui'; name: string; file: string; status: 'enabled' | 'disabled' | 'error' | 'config-disabled'; error?: string; size: number; mtime: string; builtin?: boolean; overridden?: boolean; pluginType?: string }[] }>
    install(input: { filename: string; type?: 'runtime' | 'media' | 'usage' | 'ui'; bytes: Uint8Array; overwrite?: boolean }): Promise<any>
    enable(type: 'runtime' | 'media' | 'usage' | 'ui', filename: string): Promise<any>
    disable(type: 'runtime' | 'media' | 'usage' | 'ui', filename: string): Promise<any>
    delete(type: 'runtime' | 'media' | 'usage' | 'ui', filename: string): Promise<{ ok: true }>
  }

  uiPlugins: {
    list(): Promise<PluginEntry[]>
    render(req: RenderRequest): Promise<RenderResponse>
    status(): Promise<{ entries: PluginEntry[]; dir?: string; lastLoad: { loaded: string[]; failed: Record<string, string> } }>
    reload(): Promise<{ loaded: string[]; failed: Record<string, string> }>
    onChange(cb: () => void): () => void
  }

  opencodeConfig: {
    get: () => Promise<any>
    update: (config: Record<string, unknown>) => Promise<any>
  }

  /** @deprecated Use typed methods above instead. */
  invoke: (namespace: string, method: string, ...args: unknown[]) => Promise<unknown>
}
