import type {
  Session, Project, Goal, GoalCreateInput, GoalControlAction, GoalSessionInfo, GoalTimeline, GoalPlanInfo,
  MemoryUnit, MemorySearchOptions, MergedSearchOptions,
  EnergyDistribution, Axiom, L5Heuristic, StickyNote, ModelUsageWindows, MemoryStats,
  Approval, TriageItem, AutomationRule, GatewayStatus,
  QuestionRequest, PermissionRequest,
  TaskEntity, TaskSubmitInput, TaskOutput, QueueItem, SessionConfigState, SessionConfigCategory,
  MafwBackgroundJob, MafwBackgroundOutput,
  PodNamespace, WorkNamespace,
  ModelConfigState, ModelConfigUpdate,
  EmbeddingConfigState, EmbeddingConfigGetResponse, EmbeddingRuntimeState, EmbeddingConfigUpdate,
  SessionCheckpoint, CheckpointScope, CheckpointRestoreResult, RunState, DataPart,
  ExperienceActionsResponse,
  MafwMessage, DiscoverySnapshot, DiscoverySkillContent,
  MafwAgent, MafwProvider,
  PluginClientSnapshot, PluginsListResult, PluginPackageInstallResult, PluginPackageUpdateResult,
  PluginCheckResult,
  VoiceStatusResponse,
} from "@mafw/sdk"
import type { PluginEntry, RenderRequest, RenderResponse } from "../shared/ui-plugins"
import type { TerminalEvent, TerminalProbe, TerminalSessionInfo } from "../shared/terminal-session"
import type { SshHostProfile, SshHostProfileInput, SshSecretInput } from "../shared/ssh-host"

/** B4：MCP 配置写入 DTO（与 @mafw/sdk 对齐） */
export interface McpServerConfigInput {
  name: string
  type: "remote" | "local"
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
    /** MAFW flat 历史（View DTO：content = 部件数组，无 {info,parts} 信封）。 */
    messages: (sessionID: string, limit?: number, before?: string) => Promise<{ data: MafwMessage[]; nextCursor: string | null }>
    todo: (sessionID: string) => Promise<{ data: any[] }>
    children: (sessionID: string) => Promise<any[]>
    switchAgent: (id: string, agent: string) => Promise<void>
    switchModel: (id: string, model: { providerID: string; modelID: string }) => Promise<void>
    abort: (sessionID: string) => Promise<void>
    queueList: (sessionID: string) => Promise<{ items: QueueItem[] }>
    queueCancel: (sessionID: string, itemId: string) => Promise<{ cancelled: string }>
    queueClear: (sessionID: string) => Promise<{ cleared: number }>
    config: (sessionID: string) => Promise<SessionConfigState>
    setConfig: (sessionID: string, body: { category: SessionConfigCategory; value: unknown }) => Promise<SessionConfigState>
    fork: (sessionID: string, messageID?: string) => Promise<{ session: { id: string } }>
    revert: (sessionID: string, messageID: string) => Promise<void>
    unrevert: (sessionID: string) => Promise<void>
    background: (sessionID: string) => Promise<void>
    diff: (sessionID: string, messageID?: string) => Promise<{ files: Array<{ file?: string; patch?: string; additions?: number; deletions?: number; status?: string }> }>
    revertDiff: (sessionID: string, patches: Array<{ file?: string; patch: string; hunkIndices: number[] }>) => Promise<{ reverted: number }>
    checkpoint: (sessionID: string, messageID?: string) => Promise<{ checkpoint: SessionCheckpoint }>
    checkpoints: (sessionID: string) => Promise<{ checkpoints: SessionCheckpoint[] }>
    restoreCheckpoint: (sessionID: string, checkpointId: string, scope: CheckpointScope) => Promise<CheckpointRestoreResult>
    suspend: (sessionID: string, reason?: string) => Promise<{ run: RunState }>
    resume: (sessionID: string, runId?: string) => Promise<{ run: RunState; prompted: true }>
    run: (sessionID: string) => Promise<{ run: RunState | null }>
    discardRun: (sessionID: string, runId?: string) => Promise<{ run: RunState }>
    data: (sessionID: string, body: { name: string; id?: string; data: unknown; transient?: boolean; messageID?: string }) => Promise<{ part: DataPart }>
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
    promptAsync: (opts: { sessionID: string; message?: string; parts?: Record<string, unknown>[]; agent?: string; model?: { providerID: string; modelID: string }; delivery?: 'queue' | 'steer' | 'followup'; idempotencyKey?: string; expectReply?: boolean; thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'; variant?: string }) => Promise<void>
    command: (opts: { sessionID: string; command: string; arguments?: string; agent?: string; model?: { providerID: string; modelID: string } }) => Promise<void>
  }

  /** T2-5 能力发现（commands/skills/AGENTS 单一来源；唯一命令/技能读取面）。 */
  discovery: {
    get: (sessionID: string, opts?: { directory?: string; force?: boolean }) => Promise<DiscoverySnapshot>
    refresh: (sessionID: string, opts?: { directory?: string }) => Promise<DiscoverySnapshot>
    skill: (sessionID: string, key: string, opts?: { directory?: string; force?: boolean }) => Promise<DiscoverySkillContent>
  }

  /** W4 v1：MCP 服务器状态（runtime 合并后的中立 DTO）。 */
  mcp: {
    servers: () => Promise<Array<{
      name: string
      status: string
      detail?: string
      type?: 'local' | 'remote'
      url?: string
      command?: string[]
      source?: string
      disabled?: boolean
    }>>
    /** B3.1：运行时连接/断开（不改配置）。 */
    connect: (name: string) => Promise<unknown>
    disconnect: (name: string) => Promise<unknown>
    /** B4：配置持久化（gateway 门面 → runtime 适配器）。 */
    previewServer: (input: McpServerConfigInput) => Promise<McpConfigPreview>
    previewRemoveServer: (name: string) => Promise<McpConfigPreview>
    applyServer: (input: McpServerConfigInput & { token: string; confirm: true }) => Promise<McpConfigResult>
    removeServer: (name: string, opts: { token: string; confirm: true }) => Promise<McpConfigResult>
    restoreConfig: (opts: { token: string; confirm: true; backupPath?: string }) => Promise<McpConfigResult>
  }

  // B4：MCP 配置写入 DTO（与 @mafw/sdk 对齐）

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
    timeline: (id: string) => Promise<GoalTimeline>
    plan: (id: string) => Promise<GoalPlanInfo>
    approvePlan: (goalId: string, approvalId?: string) => Promise<{ success: boolean }>
    rejectPlan: (goalId: string, approvalId: string | undefined, feedback: string) => Promise<{ success: boolean }>
    retryNode: (goalId: string, runId: number, opts?: { confirm?: boolean }) => Promise<{ success: boolean; runId: number }>
  }

  memory: {
    search: (opts: MemorySearchOptions) => Promise<MemoryUnit[]>
    mergedSearch: (opts: MergedSearchOptions) => Promise<any[]>
    delete: (id: string) => Promise<void>
    getEnergyDistribution: () => Promise<EnergyDistribution>
    getL5Axioms: (topK?: number) => Promise<{ axioms: Axiom[]; heuristics: L5Heuristic[] }>
    listSticky: () => Promise<{ entries: StickyNote[]; budget: { max: number; maxChars: number; used: number } }>
    setSticky: (id: string, sticky: boolean, stickyDays?: number) => Promise<void>
    setPinned: (id: string, pinned: boolean) => Promise<void>
    stats: () => Promise<MemoryStats>
  }

  approvals: {
    list: () => Promise<Approval[]>
    respond: (id: string, input: 'approve' | 'reject' | { answer: string }) => Promise<void>
  }

  questions: {
    list: (directory?: string) => Promise<QuestionRequest[]>
    reply: (id: string, answers: string[][]) => Promise<void>
    reject: (id: string) => Promise<void>
  }

  tasks: {
    submit: (input: TaskSubmitInput) => Promise<TaskEntity>
    list: (query?: { parentSessionID?: string; status?: string }) => Promise<TaskEntity[]>
    get: (id: string) => Promise<TaskEntity>
    cancel: (id: string) => Promise<TaskEntity>
    message: (id: string, message: string) => Promise<void>
    output: (id: string, query?: { cursor?: number; limit?: number }) => Promise<TaskOutput>
  }

  /** Task 3：三源统一的后台作业中性面（runtime shell / MAFW task / 子代理）。 */
  background: {
    jobs: {
      list: (sessionID: string) => Promise<MafwBackgroundJob[]>
      output: (sessionID: string, id: string, cursor?: number) => Promise<MafwBackgroundOutput>
      cancel: (sessionID: string, id: string) => Promise<MafwBackgroundJob>
    }
  }

  /** 中性 gateway 终端（mafw-terminal/1）不在此暴露：main 进程本地适配器消费
   *  `/api/terminal/sessions`，renderer 只经工作台 `terminal` IPC 控制会话。 */

  work: WorkNamespace
  pod: PodNamespace

  /** 托盘/OS 通知点击 → 打开 Goal（跨项目时先切项目）。 */
  navigate: {
    onGoal: (cb: (target: import("../shared/navigate-goal").NavigateGoalTarget) => void) => () => void
  }

  /** 常驻 presence 的立即轮询（renderer 收到 pod.event 时催一次，不等 15s）。 */
  presence: {
    refresh: () => Promise<void>
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
    remove: (id: string) => Promise<void>
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

  voice: {
    /** 语音运行时 v2 状态：配置 + 已注册 ASR 引擎 + routing（duplex 开关在 config.duplexV1）。 */
    status: () => Promise<VoiceStatusResponse>
    /** 双工语音流 WS URL（renderer 不自己拼 gateway URL）。 */
    wsUrl: () => Promise<string>
  }

  event: {
    /** SSE 端点 URL（带/不带 sessionID），renderer 直连 EventSource 用。 */
    url: (sessionID?: string) => Promise<string>
  }

  providers: {
    list: () => Promise<{ items: MafwProvider[]; default?: Record<string, string>; connected?: string[] }>
  }

  agents: {
    list: () => Promise<MafwAgent[]>
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
    get: () => Promise<{ active: { name: string; capabilities: Record<string, boolean>; envOverride?: boolean }; plugins: { file: string; name?: string; status: string; error?: string; capabilities?: Record<string, boolean> }[] }>
    switch: (plugin: string) => Promise<{ success: boolean; active: { name: string; capabilities: Record<string, boolean> }; envOverride: boolean }>
    restartAgent: () => Promise<{ success: boolean; mode: string }>
  }
  experience: {
    actions: (sessionID?: string, opts?: { directory?: string }) => Promise<ExperienceActionsResponse>
  }

  /**
   * 工作台 L2 终端：本地 PTY + SSH 会话。
   * 中性 gateway 终端（mafw-terminal/1 CRUD/ticket）由 main 进程本地适配器消费，
   * 不经 renderer/preload 暴露（避免与工作台终端 IPC 语义混淆）。
   */
  terminal: {
    probeV2: () => Promise<TerminalProbe>
    sessions: {
      list: () => Promise<TerminalSessionInfo[]>
      attachLocal: (directory: string) => Promise<TerminalSessionInfo>
      createSsh: (input: { id?: string; hostId: string }) => Promise<TerminalSessionInfo>
      restore: (input: { id: string; hostId: string }) => Promise<TerminalSessionInfo>
      attach: (sessionId: string, key: string) => Promise<{ ok: boolean; replayed: boolean }>
      detach: (sessionId: string, key: string) => Promise<void>
      input: (sessionId: string, data: string) => Promise<void>
      resize: (sessionId: string, cols: number, rows: number) => Promise<void>
      close: (sessionId: string) => Promise<void>
      kill: (sessionId: string) => Promise<void>
      reconnect: (sessionId: string) => Promise<void>
    }
    hosts: {
      list: () => Promise<SshHostProfile[]>
      save: (profile: SshHostProfileInput, secret?: SshSecretInput) => Promise<SshHostProfile>
      remove: (id: string) => Promise<void>
      test: (profile: SshHostProfileInput, secret?: SshSecretInput) => Promise<{ ok: boolean; error?: string }>
    }
    hostkey: {
      respond: (input: { requestId: string; action: 'trust' | 'trust-and-save' | 'replace' | 'reject' }) => Promise<void>
    }
    prompt: {
      respond: (input: { requestId: string; answers?: string[] }) => Promise<void>
    }
    openExternal: (directory: string) => Promise<void>
    onEvent: (cb: (ev: TerminalEvent) => void) => () => void
  }

  plugins: {
    list(): Promise<PluginsListResult>
    client(): Promise<PluginClientSnapshot>
    /** Native directory picker for package install (main owns the dialog). */
    chooseDirectory(): Promise<{ path: string | null; error?: string }>
    installPackage(input: { path: string; overwrite?: boolean; requestId?: string }): Promise<PluginPackageInstallResult>
    check(input: { path: string }): Promise<PluginCheckResult>
    apply(name: string): Promise<PluginPackageUpdateResult>
    reload(name: string): Promise<PluginPackageUpdateResult>
    invoke(name: string, action: string, input?: unknown, sessionID?: string): Promise<unknown>
    enablePackage(name: string): Promise<PluginPackageUpdateResult>
    disablePackage(name: string): Promise<PluginPackageUpdateResult>
    removePackage(name: string): Promise<PluginPackageUpdateResult>
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

  runtimeConfig: {
    get: () => Promise<any>
    update: (config: Record<string, unknown>) => Promise<any>
  }
}
