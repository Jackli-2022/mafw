/**
 * P4-B 缂栬瘧鏈熷鎷嶏細overrides.json 鐨?responseSchema 缁?openapi-typescript 鐢熸垚
 * 鐨勫搷搴旂被鍨嬶紝蹇呴』涓庢墜鍐?DTO锛坱ypes.ts锛夌粨鏋勭瓑浠凤紙Equals锛夈€? *
 * schema 鏄墜鍐?DTO 鐨勫畬鏁磋浆褰曗€斺€斿瓧娈电己澶?required 閿欐爣/绫诲瀷婕傜Щ閮戒細鍦ㄨ繖閲岀孩銆? * 鐢ㄦ亽绛夊嚱鏁版妧宸у仛绮剧‘鐩哥瓑姣旇緝锛堝 never 涓嶅垎閰嶏紝闃茬┖娲為€氳繃锛夛紱
 * 鏂█閲囩敤鐩存帴璧嬪€硷紙Equals=false 鏃?`const x: false = true` 缂栬瘧蹇呯孩锛夈€? * tsconfig 鎺掗櫎 *.test.ts锛屾晠鏂█鏀炬簮鏂囦欢锛坱sc --noEmit / build 瀹堥棬锛夈€? */
import type { operations } from './api-schema.gen'
import type {
  Session, Goal, GoalSessionInfo, MemoryUnit, TriageItem, Approval, AutomationRule, QuestionRequest,
  DecisionList, DecisionRecord, AttentionList, PodDetail,
  // E10-1 session read surface
  QueueItem, SessionConfigState, Todo, SessionCheckpointListItem, SubagentList, SessionNamespace,
  // E10-2 pod / work read surface
  PodGoal, PodTask, PodMessage, PodEventItem, PodGoalResult, PodReviewItemList, PodWorkOverview,
  PodNamespace,
  // E10b-1 goal / pod-goal read surface
  GoalPlanInfo, GoalTimeline, GoalNodeRunInfo, PodTechLeadHistory, PodProbe, PodGoalRevision,
  // E10b-2 human-gate / permission read surface
  PermissionsNamespace,
  // E10c-1 memory read surface
  T1SearchHit,
  // E10d-1 memory extra / pod read surface
  MemoryFact, EnergyDistribution, Axiom, L5Heuristic, PodWorktreeDiff,
  // E10e-1 metadata / registry read surface
  McpServerEntry, PluginsListResult,
  // E10h-R5 mcp / plugin / runtime / platform write responses
  McpConfigPreview, McpConfigResult, PluginCheckResult, PluginPackageInstallResult,
  PluginPackageUpdateResult, PluginWebTicket, ManagerRotateResult,
  // E10f-A session / task / terminal / usage read surface
  TaskEntity, TaskOutput, DiscoverySnapshot, DiscoverySkillContent, TerminalSessionList,
  MafwBackgroundOutput,
  // E10f-B project / runtime / metadata read surface
  MafwCommandDef, ManagerSessionInfo, Project, MediaPluginState, VoiceStatusResponse,
  ModelConfigState, ModelRef, EmbeddingConfigGetResponse, TtsNamespace, PluginClientSnapshot,
  // E10h-R6 chat / media write responses
  ChatNamespace, MediaNamespace, TtsResult,
  // E10f-C goal / lead / event / automation / pod read surface
  AutomationRuleListItem, StandingGoalView, GoalRunView,
  LeadTopicView, LeadTopicIndexMessage, LeadBoundaryView, EventSourceView, LeadCompactResult,
  // E10h-R1 session write responses (same DTOs as their read twins)
  RunState, CheckpointRestoreResult, DataPart, SubagentRecord,
  // E10h-R2 pod / task / terminal write responses
  PodLeadEnsureResult, PodTechLeadPrompt, PodGoalAcceptResult, PodRejectResult, TerminalConnectTicket,
  // E10h-R4 event / automation / human-gate write responses
  PermissionRule, EventsNamespace, AutomationsNamespace, TriageNamespace,
} from './types'
import type { RuntimeContractResponse } from './runtime-contract'
import type { MafwClient } from './client'
import type { MafwDiff, MafwPermissionRequest, MafwAgent, MafwProvider, MafwBackgroundJob } from './view-dto'
import type { ExperienceActionsResponse } from './experience-contract'

/** 鐢熸垚褰㈢姸锛歳esponses.200.content['application/json'] 涓嬬洿鎺ュ唴鑱?schema 灞炴€э紙鏃?schema: 鍖呰锛夈€?*/
type Resp<S> = S extends { responses: { 200: { content: { 'application/json': infer C } } } } ? C : never
type ItemOf<S, K extends string> = S extends Record<K, infer T> ? (T extends readonly (infer X)[] ? X : T) : never
/** 联合响应的数组分支（分发通过裸类型参数生效，供 manager.session 的双形态使用）。 */
type ArrayBranch<T> = T extends readonly (infer X)[] ? X : never

/** 鎭掔瓑鍑芥暟鎶€宸х殑绮剧‘鐩哥瓑锛堥潪鍒嗛厤锛宯ever 瀹夊叏锛夈€?*/
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
/** 鏂█绫诲瀷锛氱浉绛?鈫?true 鍙祴鍊硷紱涓嶇瓑 鈫?鐩爣绫诲瀷鎼哄甫 ["MISMATCH", 鐢熸垚, 鎵嬪啓]锛岄敊璇俊鎭洿鎺ユ墦鍗板弻鏂?diff銆?*/
type AssertEq<A, B> = Equals<A, B> extends true ? true : ['MISMATCH', A, B]

type GenSession = ItemOf<Resp<operations['session.list']>, 'sessions'>
type GenGoal = ItemOf<Resp<operations['goals.list']>, 'goals'>
type GenGoalSession = ItemOf<Resp<operations['goals.sessions']>, 'sessions'>
type GenMemoryUnit = ItemOf<Resp<operations['memory.search']>, 'results'>
type GenTriageItem = ItemOf<Resp<operations['triage.list']>, 'items'>
type GenApproval = ItemOf<Resp<operations['approvals.list']>, 'approvals'>
type GenAutomationRule = ItemOf<Resp<operations['automations.list']>, 'rules'>
type GenQuestionRequest = ItemOf<Resp<operations['questions.list']>, 'items'>

const CHECK_session_list: AssertEq<GenSession, Session> = true
const CHECK_session_get: AssertEq<Resp<operations['session.get']>, Session> = true
const CHECK_goals_list: AssertEq<GenGoal, Goal> = true
const CHECK_goals_get: AssertEq<Resp<operations['goals.get']>, Goal> = true
const CHECK_goals_sessions: AssertEq<GenGoalSession, GoalSessionInfo> = true
const CHECK_memory_search: AssertEq<GenMemoryUnit, MemoryUnit> = true
const CHECK_triage_list: AssertEq<GenTriageItem, TriageItem> = true
const CHECK_approvals_list: AssertEq<GenApproval, Approval> = true
const CHECK_automations_list: AssertEq<GenAutomationRule, AutomationRuleListItem> = true
const CHECK_questions_list: AssertEq<GenQuestionRequest, QuestionRequest> = true

// E8-3: 核心读接口的 code-first response schema 与 SDK DTO 逐字段等价。
const CHECK_decisions_list: AssertEq<Resp<operations['decisions.list']>, DecisionList> = true
const CHECK_attention_list: AssertEq<Resp<operations['attention.list']>, AttentionList> = true
const CHECK_pods_get: AssertEq<Resp<operations['pods.get']>, PodDetail> = true

// E10-1: session 读接口（8 ops）—— schema 是 handler wire 的转写，DTO 必须同步。
type GenQueueItem = ItemOf<Resp<operations['session.queue.list']>, 'items'>
/**
 * `parts` 是客户端 prompt payload 边界（owner: view-dto part 联合；gateway 原样入队），
 * 故按 session.messages 的先例只锁最小承诺（type/text + 开放索引），其余字段仍整体等价。
 */
const CHECK_session_queue_list_item: AssertEq<Omit<GenQueueItem, 'parts'>, Omit<QueueItem, 'parts'>> = true
type GenQueuePart = NonNullable<GenQueueItem['parts']>[number]
const CHECK_session_queue_part_type: AssertEq<GenQueuePart['type'], string> = true
const CHECK_session_queue_part_boundary: AssertEq<GenQueuePart extends Record<string, unknown> ? true : false, true> = true
const CHECK_session_config: AssertEq<Resp<operations['session.config']>, SessionConfigState> = true
const CHECK_session_todo_item: AssertEq<ItemOf<Resp<operations['session.todo']>, 'data'>, Todo> = true
const CHECK_session_checkpoints_item: AssertEq<
  ItemOf<Resp<operations['session.checkpoints']>, 'checkpoints'>,
  SessionCheckpointListItem
> = true
const CHECK_session_subagents: AssertEq<
  Resp<operations['session.subagents.list']>,
  SubagentList
> = true
const CHECK_session_diff_item: AssertEq<
  ItemOf<Resp<operations['session.diff']>, 'files'>,
  MafwDiff
> = true
/** tokenSummary 无独立命名 DTO：锁 client `session.tokenSummary` 的内联返回类型。 */
type SdkTokenSummary = Awaited<ReturnType<SessionNamespace['tokenSummary']>>
const CHECK_session_token_summary: AssertEq<Resp<operations['session.tokenSummary']>, SdkTokenSummary> = true

// E10-2: pod / work 读接口（8 ops）—— schema 是 handler wire 的转写，DTO 必须同步。
type GenPodEventItem = ItemOf<Resp<operations['pod.events.list']>, 'items'>
const CHECK_pod_events_list_item: AssertEq<GenPodEventItem, PodEventItem> = true
type GenPodTaskItem = ItemOf<Resp<operations['pods.tasks.list']>, 'items'>
const CHECK_pods_tasks_list_item: AssertEq<GenPodTaskItem, PodTask> = true
type GenPodMessageItem = ItemOf<Resp<operations['pods.messages.list']>, 'items'>
const CHECK_pods_messages_list_item: AssertEq<GenPodMessageItem, PodMessage> = true
type GenPodGoalItem = ItemOf<Resp<operations['pods.goals']>, 'items'>
const CHECK_pods_goals_item: AssertEq<GenPodGoalItem, PodGoal> = true
const CHECK_pods_goal_result: AssertEq<Resp<operations['pods.goals.result']>, PodGoalResult> = true
const CHECK_pods_review_items: AssertEq<Resp<operations['pods.goals.reviewItems']>, PodReviewItemList> = true
/** cost 无独立命名 DTO：锁 client `pod.cost` 的内联返回类型。 */
type SdkPodCost = Awaited<ReturnType<PodNamespace['cost']>>
const CHECK_pods_cost: AssertEq<Resp<operations['pods.cost']>, SdkPodCost> = true
/** work.overview 的 groups/counts 五桶键集与 `PodWorkBucket` 一一对应。 */
const CHECK_work_overview: AssertEq<Resp<operations['work.overview']>, PodWorkOverview> = true

// E10b-1: goal / pod-goal 读接口（8 ops）—— schema 是 handler wire 的转写，DTO 必须同步。
const CHECK_goals_plan: AssertEq<Resp<operations['goals.plan']>, GoalPlanInfo> = true
const CHECK_goals_timeline: AssertEq<Resp<operations['goals.timeline']>, GoalTimeline> = true
const CHECK_goals_timeline_node: AssertEq<ItemOf<Resp<operations['goals.timeline']>, 'nodes'>, GoalNodeRunInfo> = true
/** goals.source 无命名 DTO：锁 client `goals.source` 的现有内联返回类型。 */
type SdkGoalSource = Awaited<ReturnType<MafwClient['goals']['source']>>
const CHECK_goals_source: AssertEq<Resp<operations['goals.source']>, SdkGoalSource> = true
const CHECK_pods_tech_lead: AssertEq<Resp<operations['pods.goals.techLead']>, PodTechLeadHistory> = true
type GenPodProbeItem = ItemOf<Resp<operations['pods.goals.probes']>, 'items'>
const CHECK_pods_probes_item: AssertEq<GenPodProbeItem, PodProbe> = true
type GenPodGoalRevisionItem = ItemOf<Resp<operations['pods.goals.revisions']>, 'items'>
const CHECK_pods_revisions_item: AssertEq<GenPodGoalRevisionItem, PodGoalRevision> = true

// E10b-2: human-gate / permission 读接口（7 ops）—— 三个 override 转 code-first。
// Approval / QuestionRequest / TriageItem 的 AssertEq（上方 CHECK_*）保持；
// 其中 TriageItem 按 handler wire 重塑（磁盘 triage JSON），Approval 的 legacy 可选字段同步。
type GenPermissionItem = ItemOf<Resp<operations['permissions.list']>, 'items'>
const CHECK_permissions_list_item: AssertEq<GenPermissionItem, MafwPermissionRequest> = true
/** getMode / listAllowlist / listRules 无独立命名 DTO：锁 PermissionsNamespace 的返回类型。 */
type SdkPermissionMode = Awaited<ReturnType<PermissionsNamespace['getMode']>>
const CHECK_permissions_get_mode: AssertEq<Resp<operations['permissions.getMode']>, SdkPermissionMode> = true
type SdkAllowlist = Awaited<ReturnType<PermissionsNamespace['listAllowlist']>>
const CHECK_permissions_allowlist: AssertEq<Resp<operations['permissions.listAllowlist']>, SdkAllowlist> = true
type SdkRules = Awaited<ReturnType<PermissionsNamespace['listRules']>>
const CHECK_permissions_rules: AssertEq<Resp<operations['permissions.listRules']>, SdkRules> = true

// E10c-1: memory.search 从 override 转 code-first —— results 仍是 MemoryUnit（CHECK_memory_search），
// 新增的 t1Results（layer=t1|both 才出现）与 T1SearchHit 逐字段等价；memory.get 无 SDK DTO（internal）。
type GenT1SearchHit = NonNullable<Resp<operations['memory.search']>['t1Results']>[number]
const CHECK_memory_search_t1_item: AssertEq<GenT1SearchHit, T1SearchHit> = true

// E10d-1: memory 扩展 / lead.context / pod 读接口（8 ops）—— schema 是 handler wire 的转写。
type GenMemoryFact = ItemOf<Resp<operations['memory.mergedSearch']>, 'results'>
const CHECK_memory_merged_search_item: AssertEq<GenMemoryFact, MemoryFact> = true
const CHECK_memory_energy_distribution: AssertEq<
  Resp<operations['memory.getEnergyDistribution']>,
  EnergyDistribution
> = true
type GenL5Axiom = ItemOf<Resp<operations['memory.getL5Axioms']>, 'axioms'>
const CHECK_memory_l5_axiom: AssertEq<GenL5Axiom, Axiom> = true
type GenL5Heuristic = ItemOf<Resp<operations['memory.getL5Axioms']>, 'heuristics'>
const CHECK_memory_l5_heuristic: AssertEq<GenL5Heuristic, L5Heuristic> = true
/** listSticky 无单一命名 DTO：锁 client `memory.listSticky` 的返回类型（entries + budget）。 */
type SdkSticky = Awaited<ReturnType<MafwClient['memory']['listSticky']>>
const CHECK_memory_list_sticky: AssertEq<Resp<operations['memory.listSticky']>, SdkSticky> = true
/** lead.context 是 host 注入面（tags: internal），SDK 不调用 → 无 DTO，schema-only。 */
const CHECK_pods_lookup: AssertEq<Resp<operations['pods.lookup']>, PodDetail> = true
const CHECK_pods_worktree_diff: AssertEq<Resp<operations['pods.goals.worktree.diff']>, PodWorktreeDiff> = true
/**
 * `transcript` 归 runtime 所有（part 判别联合随 runtime 演进）→ 锁边界：
 * 外层对象只有一个 `transcript` 键，值是 `unknown`（与 client 内联返回类型逐字段等价）。
 */
type SdkPodTranscript = Awaited<ReturnType<PodNamespace['transcript']>>
const CHECK_pods_transcript: AssertEq<Resp<operations['pods.transcript']>, SdkPodTranscript> = true

// E10e-1: metadata / registry read surface（8 ops）—— schema 是 handler wire 的转写。
// agents / providers / mcp / plugins 有 SDK DTO（AssertEq）；skills / tools / config /
// scheduler 无 SDK client（tags: internal 或返回 any）→ schema-only。
type GenAgentItem = ItemOf<Resp<operations['agents.list']>, 'items'>
const CHECK_agents_list_item: AssertEq<GenAgentItem, MafwAgent> = true
type GenProviderItem = ItemOf<Resp<operations['providers.list']>, 'items'>
const CHECK_providers_list_item: AssertEq<GenProviderItem, MafwProvider> = true
/** provider 信封残余（default / connected）与 client 的返回类型逐键对齐。 */
type GenProviderEnvelope = Resp<operations['providers.list']>
const CHECK_providers_list_connected: AssertEq<GenProviderEnvelope['connected'], string[] | undefined> = true
const CHECK_providers_list_default: AssertEq<
  GenProviderEnvelope['default'],
  Record<string, string> | undefined
> = true
type GenMcpServer = ItemOf<Resp<operations['mcp.servers']>, 'servers'>
const CHECK_mcp_servers_item: AssertEq<GenMcpServer, McpServerEntry> = true
const CHECK_plugins_list: AssertEq<Resp<operations['plugins.list']>, PluginsListResult> = true

// E10f-A: session / task / terminal / usage 读接口（16 ops）—— schema 是 handler wire 的转写。
/**
 * `tasks.*` 的公开生命周期面 ≡ `TaskEntity`；`publicTask()` 额外下发的输出快照旁账
 * （`outputCursor` / `outputSize` / `outputTruncated`）SDK DTO 不暴露，故按 Omit 锁等价。
 */
type GenTask = ItemOf<Resp<operations['tasks.list']>, 'items'>
const CHECK_tasks_list_item: AssertEq<
  Omit<GenTask, 'outputCursor' | 'outputSize' | 'outputTruncated'>,
  TaskEntity
> = true
const CHECK_tasks_get: AssertEq<Resp<operations['tasks.get']>, GenTask> = true
const CHECK_tasks_output_cursor: AssertEq<GenTask['outputCursor'], number | undefined> = true
const CHECK_tasks_output_size: AssertEq<GenTask['outputSize'], number | undefined> = true
const CHECK_tasks_output_truncated: AssertEq<GenTask['outputTruncated'], boolean | undefined> = true

// E10h-P0: the first two write responses are the same DTOs as their read twins.
// `tasks.submit` returns `publicTask(task)` — byte-identical to `tasks.get`.
const CHECK_tasks_submit: AssertEq<Resp<operations['tasks.submit']>, GenTask> = true
/**
 * `session.create` = the created session view + an optional worktree envelope.
 * The SDK client already promises `Session & { worktree?: {dir,branch} }`; this
 * pins the catalog schema to that promise field for field. Split into halves
 * (session side / worktree side) because the composite flattens the intersection
 * in the generated type — same reason `CHECK_tasks_list_item` uses `Omit`.
 */
const CHECK_session_create_session_half: AssertEq<
  Omit<Resp<operations['session.create']>, 'worktree'>,
  Session
> = true
const CHECK_session_create_worktree: AssertEq<
  Resp<operations['session.create']>['worktree'],
  { dir: string; branch: string } | undefined
> = true

// E10h-R1: session 写响应 —— 与读侧 DTO 同形的直接复用，其余按 handler wire 字面锁。
const CHECK_session_config_set: AssertEq<Resp<operations['session.config.set']>, SessionConfigState> = true
const CHECK_session_suspend: AssertEq<Resp<operations['session.suspend']>, { run: RunState }> = true
const CHECK_session_resume: AssertEq<
  Resp<operations['session.resume']>,
  { run: RunState; prompted: true }
> = true
const CHECK_session_discard_run: AssertEq<Resp<operations['session.discardRun']>, { run: RunState }> = true
/** createManual 回 SessionCheckpoint 本体（无 Experience actions，列表才投影）。 */
const CHECK_session_checkpoint_created: AssertEq<
  ItemOf<Resp<operations['session.checkpoint']>, 'checkpoint'>,
  Omit<SessionCheckpointListItem, 'actions'>
> = true
const CHECK_session_restore_checkpoint: AssertEq<
  Resp<operations['session.restoreCheckpoint']>,
  CheckpointRestoreResult
> = true
/** `type` 是 `data-${string}` 模板字面量，schema 侧只能承诺前缀 pattern → 分开锁。 */
type GenDataPart = ItemOf<Resp<operations['session.data']>, 'part'>
const CHECK_session_data_part: AssertEq<Omit<GenDataPart, 'type'>, Omit<DataPart, 'type'>> = true
const CHECK_session_data_part_type: AssertEq<GenDataPart['type'], string> = true
const CHECK_session_prompt: AssertEq<
  Resp<operations['session.prompt']>,
  Awaited<ReturnType<SessionNamespace['prompt']>>
> = true
const CHECK_session_subagent_spawn: AssertEq<Resp<operations['session.subagents.spawn']>, SubagentRecord> = true
const CHECK_session_queue_clear: AssertEq<Resp<operations['session.queue.clear']>, { cleared: number }> = true
const CHECK_session_queue_cancel: AssertEq<Resp<operations['session.queue.cancel']>, { cancelled: string }> = true
const CHECK_structured_submit: AssertEq<
  Resp<operations['structured.submit']>,
  { ok: boolean; errors: string[] }
> = true

// E10h-R2: pod / task / terminal / background 写响应。复用读侧 DTO 的直接锁等价；
// 其余按 handler wire 字面新写——`pods.goals.cancel` 的 `{goal}` 是 `PodGoalRow`
// （不是视图）、`pods.messages.delivery.retry` 透传含 `skipped`、`terminal.remove`
// 的 `ok` 是字面量 true，因此这三处**故意**不绑 SDK 的宽松类型（见 schema 注释）。
const CHECK_pods_create: AssertEq<Resp<operations['pods.create']>, PodDetail> = true
const CHECK_pods_update: AssertEq<Resp<operations['pods.update']>, PodDetail> = true
const CHECK_pods_wake: AssertEq<Resp<operations['pods.wake']>, PodDetail> = true
const CHECK_pods_sleep: AssertEq<Resp<operations['pods.sleep']>, PodDetail> = true
const CHECK_pods_lead_ensure: AssertEq<Resp<operations['pods.lead.ensure']>, PodLeadEnsureResult> = true
const CHECK_pods_tasks_create: AssertEq<
  Resp<operations['pods.tasks.create']>,
  Awaited<ReturnType<PodNamespace['createTask']>>
> = true
const CHECK_pods_tasks_update: AssertEq<
  Resp<operations['pods.tasks.update']>,
  Awaited<ReturnType<PodNamespace['updateTask']>>
> = true
const CHECK_pods_tasks_delete: AssertEq<
  Resp<operations['pods.tasks.delete']>,
  Awaited<ReturnType<PodNamespace['deleteTask']>>
> = true
const CHECK_pods_messages_create: AssertEq<
  Resp<operations['pods.messages.create']>,
  Awaited<ReturnType<PodNamespace['sendMessage']>>
> = true
const CHECK_pods_messages_read: AssertEq<
  Resp<operations['pods.messages.read']>,
  Awaited<ReturnType<PodNamespace['markRead']>>
> = true
const CHECK_pods_messages_dismiss: AssertEq<
  Resp<operations['pods.messages.delivery.dismiss']>,
  Awaited<ReturnType<PodNamespace['dismissDelivery']>>
> = true
const CHECK_pods_memory_write: AssertEq<
  Resp<operations['pods.memory.write']>,
  Awaited<ReturnType<PodNamespace['writeMemory']>>
> = true
const CHECK_pods_review_items_create: AssertEq<
  Resp<operations['pods.goals.reviewItems.create']>,
  Awaited<ReturnType<PodNamespace['createReviewItems']>>
> = true
const CHECK_pods_review_items_resolve: AssertEq<
  Resp<operations['pods.goals.reviewItems.resolve']>,
  Awaited<ReturnType<PodNamespace['resolveReviewItem']>>
> = true
const CHECK_pods_review_items_reopen: AssertEq<
  Resp<operations['pods.goals.reviewItems.reopen']>,
  Awaited<ReturnType<PodNamespace['reopenReviewItem']>>
> = true
const CHECK_pods_tech_lead_message: AssertEq<
  Resp<operations['pods.goals.techLead.messages']>,
  PodTechLeadPrompt
> = true
const CHECK_pods_probes_create: AssertEq<
  Resp<operations['pods.goals.probes.create']>,
  Awaited<ReturnType<PodNamespace['createProbe']>>
> = true
const CHECK_pods_reject: AssertEq<Resp<operations['pods.goals.reject']>, PodRejectResult> = true
const CHECK_pods_accept: AssertEq<Resp<operations['pods.goals.accept']>, PodGoalAcceptResult> = true
/** cancel 回迁移后的 task 本体（与 `tasks.get` 同形），不是 `{ok:true}`。 */
const CHECK_tasks_cancel: AssertEq<Resp<operations['tasks.cancel']>, GenTask> = true
const CHECK_terminal_create: AssertEq<
  Resp<operations['terminal.create']>,
  { protocol: string; id: string }
> = true
const CHECK_terminal_connect_ticket: AssertEq<
  Resp<operations['terminal.connectTicket']>,
  TerminalConnectTicket
> = true
/** 取消后台作业回中性 job 行（与 list item 同形，不是 task 原始 DTO）。 */
const CHECK_background_cancel: AssertEq<Resp<operations['background.jobs.cancel']>, MafwBackgroundJob> = true

// E10h-R3: goal / decision / lead / standing / cognition 写响应。
// 只有「wire 与 SDK DTO 逐字段等价」的 op 加 AssertEq；常量回执（`{status:'paused'}`、
// `{success:true}`、`{status:'ok'}`）比 SDK 的 `{status:string}` / `{success:boolean}` /
// void 更精确，`goals.validate` 比 SDK 的 `{goalId}` 多两个字段——这些都按 handler 声明，
// 故意**不放宽**到 SDK 类型，故不加 AssertEq（见 R3-report.md 的 concerns）。

/** decision 四个动作同形 `{record}`，record 复用 `decisions.list` 的 `DecisionRecord`。 */
const CHECK_decisions_draft: AssertEq<Resp<operations['decisions.draft']>, { record: DecisionRecord }> = true
const CHECK_decisions_confirm: AssertEq<Resp<operations['decisions.confirm']>, { record: DecisionRecord }> = true
const CHECK_decisions_shelve: AssertEq<Resp<operations['decisions.shelve']>, { record: DecisionRecord }> = true
const CHECK_decisions_reopen: AssertEq<Resp<operations['decisions.reopen']>, { record: DecisionRecord }> = true

/**
 * `lead.compact` 回四个统计键（≡ SDK `LeadCompactResult`）；
 * `lead.topics.resume` / `lead.topics.fork` 与 `LeadNamespace` 的返回等价。
 * accept / merge / undo 的 wire 是 `BoundaryDecision`（每 op 一个 status 字面量），
 * 比 SDK 三态联合更精确，故不加 AssertEq。
 */
const CHECK_lead_compact: AssertEq<Resp<operations['lead.compact']>, LeadCompactResult> = true
const CHECK_lead_topic_resume: AssertEq<
  Resp<operations['lead.topics.resume']>,
  { sessionID: string; resumedFrom: string | null }
> = true
const CHECK_lead_topic_fork: AssertEq<
  Resp<operations['lead.topics.fork']>,
  { goalId: string; sessionID?: string | null }
> = true

/** standing 生命周期复用读侧实体：`{goal}` ≡ `StandingGoalView`，`{run}` ≡ `GoalRunView`。 */
const CHECK_standing_goal_create: AssertEq<Resp<operations['standingGoals.create']>, { goal: StandingGoalView }> = true
const CHECK_standing_goal_update: AssertEq<Resp<operations['standingGoals.update']>, { goal: StandingGoalView }> = true
const CHECK_standing_goal_pause: AssertEq<Resp<operations['standingGoals.pause']>, { goal: StandingGoalView }> = true
const CHECK_standing_goal_resume: AssertEq<Resp<operations['standingGoals.resume']>, { goal: StandingGoalView }> = true
const CHECK_standing_goal_stop: AssertEq<Resp<operations['standingGoals.stop']>, { goal: StandingGoalView }> = true
const CHECK_standing_goal_run: AssertEq<Resp<operations['standingGoals.run']>, { run: GoalRunView }> = true
const CHECK_goal_run_approve: AssertEq<Resp<operations['goalRuns.approve']>, { run: GoalRunView }> = true

// E10h-R4: event / automation / human-gate 写响应。
// 只锁「wire 与 SDK DTO 逐字段等价」的 op：`approvals.respond`、`questions.reply|reject`、
// `triage.dismiss|confirm|reject`、`automations.toggle|remove`、`permissions.reply|replyRuntime`、
// `permissions.setMode` 在 SDK 侧都声明为 `Promise<void>`（客户端只关心 2xx），没有可比的
// DTO；`events.sources.patch` / `events.subscriptions.delete` 的 `{ok:true}` 比 SDK 的
// `{ok:boolean}` 更精确 —— 这些都不加 AssertEq（见 R4-report.md 的 concerns）。

/** `events.sources.create` 与 `events.sources.list` 的 item 是同一个 `sourceView()` 投影。 */
const CHECK_events_sources_create: AssertEq<Resp<operations['events.sources.create']>, EventSourceView> = true

/** `events.threads.close` 回的是 `EventLayerService.closeThread()` 的三键计数。 */
const CHECK_events_close_thread: AssertEq<
  Resp<operations['events.threads.close']>,
  Awaited<ReturnType<EventsNamespace['closeThread']>>
> = true

/** `event.publish` 是 fire-and-forget：SDK `event.publish()` 的 `{ok:true}` 与 wire 同形。 */
const CHECK_event_publish: AssertEq<Resp<operations['event.publish']>, { ok: true }> = true

/**
 * `automations.draft` 的 `errors` 在 wire 上恒存在（空数组 = 校验通过），
 * SDK 声明为 optional —— 用 `Required` 把差额锁在「只多不少」的方向。
 */
const CHECK_automations_draft: AssertEq<
  Resp<operations['automations.draft']>,
  Required<Awaited<ReturnType<AutomationsNamespace['draft']>>>
> = true

/** `triage.propose` 的 `message` 同理：两个 200 分支都写，SDK 声明 optional。 */
const CHECK_triage_propose: AssertEq<
  Resp<operations['triage.propose']>,
  Required<Awaited<ReturnType<TriageNamespace['propose']>>>
> = true

/** allowlist / rules 的写入回执与 SDK 手写 DTO 逐字段等价（`entries` 是写入后的全量）。 */
const CHECK_permissions_add_rule: AssertEq<
  Resp<operations['permissions.addRule']>,
  Awaited<ReturnType<PermissionsNamespace['addRule']>>
> = true
const CHECK_permissions_add_allowlist: AssertEq<
  Resp<operations['permissions.addAllowlist']>,
  Awaited<ReturnType<PermissionsNamespace['addAllowlist']>>
> = true

/**
 * 删除回执的 `success` 是字面量 `true`（未命中走 404），比 SDK 的 `boolean` 更精确，
 * 因此只锁 `entries` 段（写入/删除后都是同一份 `PermissionRule` / allowlist 行）。
 */
const CHECK_permissions_remove_rule_entries: AssertEq<
  Resp<operations['permissions.removeRule']>['entries'],
  PermissionRule[]
> = true
const CHECK_permissions_remove_allowlist_entries: AssertEq<
  Resp<operations['permissions.removeAllowlist']>['entries'],
  Array<{ tool: string; prefix?: string }>
> = true

// E10h-R5: mcp / plugin / runtime / platform 写响应。
// 只锁「wire 与 SDK DTO 逐字段等价」的 op：`mcp.connect|disconnect`（SDK 回
// `unknown`）、`plugins.apply` 的额外三键、`runtime.dryEvent|conformance`、
// `runtime.config.update`（SDK 回 `unknown`）、`config.set|project.setCurrent`
// （SDK `Promise<void>`）、`mafwCommands.run`（命令自定义键）都没有可比 DTO，
// 因此只做字段级/单段锁定（见 R5-report.md 的 concerns）。

/** `RuntimeMcpConfigPreview`：token/target/diff 恒在，backup/preserved/warnings 可选。 */
const CHECK_mcp_config_preview: AssertEq<Resp<operations['mcp.configPreview']>, McpConfigPreview> = true
const CHECK_mcp_config_preview_remove: AssertEq<
  Resp<operations['mcp.configPreviewRemove']>,
  McpConfigPreview
> = true

/** `RuntimeMcpConfigResult`：applied 与 runtimeApplied 是两个独立布尔。 */
const CHECK_mcp_config_apply: AssertEq<Resp<operations['mcp.configApply']>, McpConfigResult> = true
const CHECK_mcp_config_remove: AssertEq<Resp<operations['mcp.configRemove']>, McpConfigResult> = true
const CHECK_mcp_config_restore: AssertEq<Resp<operations['mcp.configRestore']>, McpConfigResult> = true

/** `plugins.install` 的 200 是 `plugins.list` 的 item（同一个 `statEntry()` 投影）。 */
const CHECK_plugins_install: AssertEq<
  Resp<operations['plugins.install']>,
  PluginsListResult['plugins'][number]
> = true

/** installPackage 的 `application` / `saved` 与 SDK `PluginPackageInstallResult` 同义。 */
const CHECK_plugins_install_package_application: AssertEq<
  Resp<operations['plugins.installPackage']>['application'],
  PluginPackageInstallResult['application']
> = true
const CHECK_plugins_install_package_saved: AssertEq<
  Resp<operations['plugins.installPackage']>['saved'],
  PluginPackageInstallResult['saved']
> = true

/** check 的 200 就是 SDK 的 `PluginCheckResult`（`ok:false` 也是 200）。 */
const CHECK_plugins_check: AssertEq<Resp<operations['plugins.check']>, PluginCheckResult> = true

/**
 * enable / disable 是 package|legacy 的判别式联合；legacy 分支按 `file` 判别后
 * 必须与 `plugins.list` 的 item 逐字段等价（package 分支见 concerns：SDK 少
 * `runtimeSwitchRequired` / `runtimeName` 两键）。
 */
type GenPluginToggle = Resp<operations['plugins.enable']>
const CHECK_plugins_enable_legacy: AssertEq<
  Extract<GenPluginToggle, { file: string }>,
  PluginsListResult['plugins'][number]
> = true
const CHECK_plugins_disable_legacy: AssertEq<
  Extract<Resp<operations['plugins.disable']>, { file: string }>,
  PluginsListResult['plugins'][number]
> = true
const CHECK_plugins_disable_legacy_matches_enable: AssertEq<
  Extract<Resp<operations['plugins.disable']>, { file: string }>,
  Extract<GenPluginToggle, { file: string }>
> = true

/** `plugins.apply` 的 `active` 与 SDK `PluginPackageUpdateResult['active']` 等价。 */
const CHECK_plugins_apply_active: AssertEq<
  NonNullable<Resp<operations['plugins.apply']>['active']>,
  NonNullable<PluginPackageUpdateResult['active']>
> = true
const CHECK_plugins_apply_runtime_switch: AssertEq<
  NonNullable<Resp<operations['plugins.apply']>['runtimeSwitch']>,
  NonNullable<PluginPackageUpdateResult['runtimeSwitch']>
> = true

/** `plugins.webTicket` 的凭证对与 SDK `PluginWebTicket` 逐字段等价。 */
const CHECK_plugins_web_ticket: AssertEq<Resp<operations['plugins.webTicket']>, PluginWebTicket> = true

/**
 * `runtime.switch` 的 `success` 是字面量 `true`（失败走 400/409/500），故只锁
 * `active` 与 `envOverride`（SDK 把它们声明在一个内联对象里）。
 */
const CHECK_runtime_switch_active: AssertEq<
  Resp<operations['runtime.switch']>['active'],
  { name: string; capabilities: Record<string, boolean> }
> = true
const CHECK_runtime_switch_env_override: AssertEq<
  Resp<operations['runtime.switch']>['envOverride'],
  boolean
> = true
const CHECK_runtime_restart_mode: AssertEq<Resp<operations['runtime.restartAgent']>['mode'], string> = true

/** `runtime.reload` 的 plugins item 与 `runtime.get` 的同一段等价（同一 loader 投影）。 */
const CHECK_runtime_reload_plugins: AssertEq<
  Resp<operations['runtime.reload']>['plugins'],
  Resp<operations['runtime.get']>['plugins']
> = true

/**
 * `manager.rotate` 的 `success` 同样是字面量 `true`；其余四键与 SDK
 * `ManagerRotateResult` 逐字段等价。
 */
const CHECK_manager_rotate_fields: AssertEq<
  Omit<Resp<operations['manager.rotate']>, 'success'>,
  Omit<ManagerRotateResult, 'success'>
> = true

/** `models.update` 的 recall / media 段是 `models.get` 的同一投影（写后读回）。 */
const CHECK_models_update_recall: AssertEq<
  Resp<operations['models.update']>['recall'],
  ModelConfigState['recall']
> = true
const CHECK_models_update_media: AssertEq<
  Resp<operations['models.update']>['media'],
  ModelConfigState['media']
> = true

/**
 * `tasks.output` 是 runtime shell 的透传边界（四键 optional + 开放索引）；这里仍锁
 * 「SDK 认的四个字段类型不变」，让透传不能把 TaskOutput 的 wire 语义改掉。
 */
type GenTaskOutput = Resp<operations['tasks.output']>
const CHECK_tasks_output_fields: AssertEq<
  Required<Pick<GenTaskOutput, 'output' | 'cursor' | 'size' | 'truncated'>>,
  TaskOutput
> = true

/** `session.trajectory` 无 SDK 等价 DTO（SDK TrajectoryTurn 是缺 sessionID/provider 的 legacy 子集）。 */
/** `session.run` 与 client 的 `session.run()` 返回类型逐字段等价（run 可为 null）。 */
const CHECK_session_run: AssertEq<
  Resp<operations['session.run']>,
  Awaited<ReturnType<SessionNamespace['run']>>
> = true
const CHECK_session_discovery: AssertEq<Resp<operations['session.discovery']>, DiscoverySnapshot> = true
const CHECK_session_discovery_skill: AssertEq<
  Resp<operations['session.discoverySkill']>,
  DiscoverySkillContent
> = true

/**
 * `experience.actions`：动作键集与 SDK `EXPERIENCE_ACTION_IDS` 一致；描述符除
 * `operationId`（gateway 侧 E3-4 新增，SDK DTO 尚未跟进）外逐字段等价。
 * `minClientVersion` handler 恒发，SDK DTO 声明为 optional → 两侧分别锁。
 */
type GenExperience = Resp<operations['experience.actions']>
type GenExperienceAction = NonNullable<GenExperience['actions']['checkpoint.restore']>
type SdkExperienceAction = NonNullable<ExperienceActionsResponse['actions']['checkpoint.restore']>
const CHECK_experience_action: AssertEq<Omit<GenExperienceAction, 'operationId'>, SdkExperienceAction> = true
const CHECK_experience_action_operation_id: AssertEq<
  GenExperienceAction['operationId'],
  string | undefined
> = true
const CHECK_experience_keys: AssertEq<
  keyof GenExperience,
  keyof ExperienceActionsResponse
> = true
const CHECK_experience_action_ids: AssertEq<
  keyof GenExperience['actions'],
  keyof ExperienceActionsResponse['actions']
> = true
const CHECK_experience_min_client_version: AssertEq<GenExperience['minClientVersion'], string> = true
const CHECK_experience_session_id: AssertEq<GenExperience['sessionID'], string | undefined> = true

/** `background.jobs.*` 出口只有中性 DTO：item ≡ MafwBackgroundJob，output ≡ MafwBackgroundOutput。 */
type GenBackgroundJob = ItemOf<Resp<operations['background.jobs.list']>, 'items'>
const CHECK_background_jobs_list_item: AssertEq<GenBackgroundJob, MafwBackgroundJob> = true
const CHECK_background_jobs_output: AssertEq<
  Resp<operations['background.jobs.output']>,
  MafwBackgroundOutput
> = true

/** `terminal.list` 只发 MAFW DTO + protocol（runtime 原生 PTY 形状不进 wire）。 */
const CHECK_terminal_list: AssertEq<Resp<operations['terminal.list']>, TerminalSessionList> = true

// E10f-B: project / runtime / metadata 读接口（16 ops）—— schema 是 handler wire 的转写。
type GenCommand = ItemOf<Resp<operations['mafwCommands.list']>, 'commands'>
const CHECK_mafw_commands_list_item: AssertEq<GenCommand, MafwCommandDef> = true

/**
 * `manager.session` 是双形态 200：带 `?projectDir=` 是单对象，无过滤是数组。
 * DTO 只描述"行"（`ManagerSessionInfo`）；handler 恒发 `createdAt`（缺失补 null），
 * 故字段级锁 createdAt 的 null 性，其余键按 Omit 等价。
 */
type GenManagerSession = ArrayBranch<Resp<operations['manager.session']>>
const CHECK_manager_session_keys: AssertEq<keyof GenManagerSession, keyof ManagerSessionInfo> = true
const CHECK_manager_session_fields: AssertEq<
  Omit<GenManagerSession, 'createdAt'>,
  Omit<ManagerSessionInfo, 'createdAt'>
> = true
const CHECK_manager_session_created_at: AssertEq<GenManagerSession['createdAt'], string | null> = true

/** `project.current` 在 SDK `Project` 之外多带注册期 `mafwDir`。 */
type GenCurrentProject = NonNullable<Resp<operations['project.current']>['project']>
const CHECK_project_current_project: AssertEq<Omit<GenCurrentProject, 'mafwDir'>, Project> = true
const CHECK_project_current_mafw_dir: AssertEq<GenCurrentProject['mafwDir'], string> = true

/** `runtime.get`：能力位与未知事件遥测是 runtime/gateway 的开放键集（deep 值域不锁）。 */
type GenRuntimeGet = Resp<operations['runtime.get']>
const CHECK_runtime_get_capabilities: AssertEq<GenRuntimeGet['active']['capabilities'], Record<string, boolean>> = true
const CHECK_runtime_get_unknown_events: AssertEq<
  GenRuntimeGet['unknownEvents'],
  Record<string, Record<string, number>>
> = true

/**
 * `runtime.contract` 与 SDK 的边界 DTO 逐字段等价（manifest 顶层形状 + coverage 边界；
 * surface/capability 条目内部归契约包所有，两侧都只声明开放对象）。
 */
const CHECK_runtime_contract: AssertEq<Resp<operations['runtime.contract']>, RuntimeContractResponse> = true

/**
 * `plugins.client`：顶层快照只有 revision + plugins；描述符内部归 `@mafw/plugin-contract`
 * 所有（schema 用边界对象）→ 只锁外层键集与 revision 类型。
 */
type GenPluginsClient = Resp<operations['plugins.client']>
const CHECK_plugins_client_keys: AssertEq<keyof GenPluginsClient, keyof PluginClientSnapshot> = true
const CHECK_plugins_client_revision: AssertEq<GenPluginsClient['revision'], string> = true

/** `models.get`：recall / media / available 与 SDK `ModelConfigState` 等价。 */
type GenModelsGet = Resp<operations['models.get']>
const CHECK_models_get_recall: AssertEq<GenModelsGet['recall'], ModelConfigState['recall']> = true
const CHECK_models_get_media: AssertEq<GenModelsGet['media'], ModelConfigState['media']> = true
const CHECK_models_get_available: AssertEq<GenModelsGet['available'], ModelConfigState['available']> = true
/** goal 段增量：SDK 只声明 nodeModel，handler 还发 techLeadModel（P0-4）。 */
const CHECK_models_get_goal_node: AssertEq<
  GenModelsGet['goal']['nodeModel'],
  NonNullable<ModelConfigState['goal']>['nodeModel']
> = true
const CHECK_models_get_goal_tech_lead: AssertEq<
  GenModelsGet['goal']['techLeadModel'],
  ModelRef | null | undefined
> = true

/** `media.plugins` 行 ≡ SDK `MediaPluginState`。 */
type GenMediaPlugin = ItemOf<Resp<operations['media.plugins']>, 'plugins'>
const CHECK_media_plugins_item: AssertEq<GenMediaPlugin, MediaPluginState> = true

/**
 * `tts.voices`：SDK 返回类型是 wire 的子集（缺 engine / capabilities / engines），
 * 故按子集字段锁等价（voices / models / 默认值），其余字段 schema-only。
 */
type SdkTtsVoices = Awaited<ReturnType<TtsNamespace['voices']>>
type GenTtsVoices = Resp<operations['tts.voices']>
const CHECK_tts_voices_voices: AssertEq<GenTtsVoices['voices'], SdkTtsVoices['voices']> = true
const CHECK_tts_voices_models: AssertEq<GenTtsVoices['models'], SdkTtsVoices['models']> = true
const CHECK_tts_voices_default_voice: AssertEq<GenTtsVoices['defaultVoice'], string> = true
const CHECK_tts_voices_default_model: AssertEq<GenTtsVoices['defaultModel'], string> = true

/** `voice.status`（config + engines + routing）与 SDK `VoiceStatusResponse` 逐字段等价。 */
const CHECK_voice_status: AssertEq<Resp<operations['voice.status']>, VoiceStatusResponse> = true

/** `embedding.get`（current + runtime + available）与 SDK `EmbeddingConfigGetResponse` 等价。 */
const CHECK_embedding_get: AssertEq<Resp<operations['embedding.get']>, EmbeddingConfigGetResponse> = true

// fileHistory.list / runtime.config.get / python.status / agent.capabilities /
// media.resolveTask 没有 SDK client（tags: internal，或 handler 返回 any）→ schema-only。

// usage（session.usage / usagePluginsList / usagePluginSourceGet）无稳定 SDK DTO：
// client 的 `usage()` 把 summary/memory/providers 声明成 any，`usagePlugins()` 仍是
// `{plugins:[{overridden}]}` 旧形状，`usagePluginSource()` 把 200/403/404 混成一个类型
// → 三者 schema-only（tag: internal 之外没有可对齐的生成类型）。

// ── E10f-C：goal / lead / event / automation / pod 读接口 ──────────────────

/**
 * `lead.topics.list` / `lead.topics.get` / `lead.boundaries.list`：wire 与 SDK
 * `LeadTopicView` / `LeadTopicIndexMessage` / `LeadBoundaryView` 逐字段等价
 * （`LeadBoundaryView.text` 是 E10f-C 补上的——该字段一直在 wire 上）。
 */
const CHECK_lead_topics_list_item: AssertEq<ItemOf<Resp<operations['lead.topics.list']>, 'items'>, LeadTopicView> = true
const CHECK_lead_topic_get: AssertEq<
  Resp<operations['lead.topics.get']>,
  { topic: LeadTopicView; messages: LeadTopicIndexMessage[] }
> = true
const CHECK_lead_boundaries_item: AssertEq<ItemOf<Resp<operations['lead.boundaries.list']>, 'items'>, LeadBoundaryView> = true

/**
 * `standingGoals.list` / `standingGoals.runs`：行与 `StandingGoalView` / `GoalRunView`
 * 逐字段等价；`payload` / `result` 是开放对象（触发源与执行器所有），两侧同形。
 */
const CHECK_standing_goals_list_item: AssertEq<
  ItemOf<Resp<operations['standingGoals.list']>, 'items'>,
  StandingGoalView
> = true
const CHECK_standing_goals_runs_item: AssertEq<
  ItemOf<Resp<operations['standingGoals.runs']>, 'items'>,
  GoalRunView
> = true

/**
 * `automations.get`：规则段与 `automations.list` 共用同一本体 → Omit 掉派生字段后
 * 必须与 SDK `AutomationRule` 等价（list 行另由 CHECK_automations_list 锁定）。
 */
type GenAutomationGet = Resp<operations['automations.get']>
const CHECK_automations_get_rule: AssertEq<Omit<GenAutomationGet, 'nextTriggers' | 'history'>, AutomationRule> = true

/**
 * `events.sources.list` 行与 SDK `EventSourceView` 等价（handler 的 `sourceView()`
 * 投影掉了 projectDir/config/createdAt）。thread/trigger/subscription/delivery 四个
 * 读面是 store 行原样下发（带存储列），SDK 的 *View 是手写窄声明 → schema-only。
 */
const CHECK_events_sources_item: AssertEq<ItemOf<Resp<operations['events.sources.list']>, 'items'>, EventSourceView> = true

/** `pods.ensure` 与 `pods.get` / `pods.lookup` 同 wire（`enrichPodDetail()`）→ 同一 PodDetail。 */
const CHECK_pods_ensure: AssertEq<Resp<operations['pods.ensure']>, PodDetail> = true

/**
 * `pods.memory.get` 双分支：`{content}` ↔ `pod.readMemoryFile()`，`{context}` ↔
 * `pod.readMemory()`（两者都是内联返回类型，故用 ReturnType 比较）。
 */
type GenPodMemory = Resp<operations['pods.memory.get']>
const CHECK_pods_memory_file: AssertEq<
  Extract<GenPodMemory, { content: unknown }>,
  Awaited<ReturnType<PodNamespace['readMemoryFile']>>
> = true
const CHECK_pods_memory_context: AssertEq<
  Extract<GenPodMemory, { context: unknown }>,
  Awaited<ReturnType<PodNamespace['readMemory']>>
> = true

// orchestration.outcomes / automations.history 是 internal 运维面（SDK/desktop 不调用，
// 行是 gateway.db 的 snake_case `SELECT *`）→ schema-only。

/**
 * session.messages：`data` 的 part 判别联合由 view-dto 契约拥有，schema 只承诺
 * SDK 边界守卫 `MafwMessageShape` 认可的形状；游标必须与 client 的
 * `{ data, nextCursor: string | null }` 对齐（不能退化成 optional）。
 */
type GenMessages = Resp<operations['session.messages']>
type GenMessage = GenMessages['data'][number]
const CHECK_session_messages_cursor: AssertEq<GenMessages['nextCursor'], string | null> = true
// part 判别联合归 view-dto 所有；这里只锁边界守卫认的最小承诺（role + part.type）。
const CHECK_session_messages_role: AssertEq<GenMessage['role'], 'user' | 'assistant'> = true
const CHECK_session_messages_part_type: AssertEq<NonNullable<GenMessage['content']>[number]['type'], string> = true

// E10h-R6: memory / media / tts / chat / devices 写响应。
// 大部分 op 在 SDK 侧没有可比 DTO（`memory.add|setSticky|delete|merge` 回
// `void` 或 internal、`obs.capture` / `python.*` / `tools.execute` /
// `eval.chatCompletions` / `llm.compress` / `devices.*` / `skills.deopt` /
// `media.analyzeAudio` 都不经 SDK），保持 schema-only；下列几处可逐字段锁等价。

/** chat 的两个入口都只 promise sessionID（SDK 的类型就是 wire 的全部）。 */
const CHECK_chat_send: AssertEq<
  Resp<operations['chat.send']>,
  Awaited<ReturnType<ChatNamespace['send']>>
> = true
const CHECK_chat_send_enriched: AssertEq<
  Resp<operations['chat.sendEnriched']>,
  Awaited<ReturnType<ChatNamespace['sendEnriched']>>
> = true

/**
 * `tts.speak` 的 wire ≡ SDK `TtsResult`，只有 `mime` 更精确：handler 写死
 * `audio/wav`（SDK 声明的是 `string`），因此拆两半锁。
 */
const CHECK_tts_speak: AssertEq<
  Omit<Resp<operations['tts.speak']>, 'mime'>,
  Omit<TtsResult, 'mime'>
> = true
const CHECK_tts_speak_mime: AssertEq<Resp<operations['tts.speak']>['mime'], 'audio/wav'> = true

/** SDK `upload()` 只读 artifactId（client 的返回类型就是这一把键）。 */
const CHECK_media_upload_artifact: AssertEq<
  Resp<operations['media.upload']>['artifactId'],
  Awaited<ReturnType<MediaNamespace['upload']>>['artifactId']
> = true

/**
 * `uploadAndCreate` handler 恒发六个键，SDK 把三份旁账声明成 optional →
 * `Required` 把差额锁在「只多不少」的方向；`state` 单独锁（handler 写死
 * `TASK_STATE_WORKING`，SDK 只声明 `string`）。
 */
const CHECK_media_upload_and_create: AssertEq<
  Omit<Resp<operations['media.uploadAndCreate']>, 'state'>,
  Omit<Required<Awaited<ReturnType<MediaNamespace['uploadAndCreate']>>>, 'state'>
> = true
const CHECK_media_upload_and_create_state: AssertEq<
  Resp<operations['media.uploadAndCreate']>['state'],
  'TASK_STATE_WORKING'
> = true

/**
 * `media.createTaskApi` 与 SDK `createTask()` 是**同一个任务窄投影**
 * （`{id,contextId,state}`；SDK 从 A2A 信封里解析出的也正是这三键）。
 */
const CHECK_media_create_task_api: AssertEq<
  Resp<operations['media.createTaskApi']>,
  Awaited<ReturnType<MediaNamespace['createTask']>>
> = true

/** reload 的 plugins 段 ≡ `media.plugins()` 的行（同一 `getState()` 投影）。 */
const CHECK_media_plugins_reload: AssertEq<
  Resp<operations['media.pluginsReload']>['plugins'],
  MediaPluginState[]
> = true

/** `embedding.update` 的 current / runtime 是写后读回 → 与 `embedding.get` 等价。 */
const CHECK_embedding_update_current: AssertEq<
  Resp<operations['embedding.update']>['current'],
  EmbeddingConfigGetResponse['current']
> = true
const CHECK_embedding_update_runtime: AssertEq<
  Resp<operations['embedding.update']>['runtime'],
  EmbeddingConfigGetResponse['runtime']
> = true

export const CONTRACT_COMPAT_CHECKS = [
  CHECK_session_list, CHECK_session_get, CHECK_goals_list, CHECK_goals_get, CHECK_goals_sessions,
  CHECK_memory_search, CHECK_triage_list, CHECK_approvals_list, CHECK_automations_list, CHECK_questions_list,
  CHECK_decisions_list, CHECK_attention_list, CHECK_pods_get,
  CHECK_session_messages_cursor, CHECK_session_messages_role, CHECK_session_messages_part_type,
  // E10-1
  CHECK_session_queue_list_item, CHECK_session_queue_part_type, CHECK_session_queue_part_boundary,
  CHECK_session_config, CHECK_session_todo_item,
  CHECK_session_checkpoints_item, CHECK_session_subagents, CHECK_session_diff_item,
  CHECK_session_token_summary,
  // E10-2
  CHECK_pod_events_list_item, CHECK_pods_tasks_list_item, CHECK_pods_messages_list_item,
  CHECK_pods_goals_item, CHECK_pods_goal_result, CHECK_pods_review_items, CHECK_pods_cost,
  CHECK_work_overview,
  // E10b-1
  CHECK_goals_plan, CHECK_goals_timeline, CHECK_goals_timeline_node, CHECK_goals_source,
  CHECK_pods_tech_lead, CHECK_pods_probes_item, CHECK_pods_revisions_item,
  // E10b-2
  CHECK_permissions_list_item, CHECK_permissions_get_mode, CHECK_permissions_allowlist,
  CHECK_permissions_rules,
  // E10c-1
  CHECK_memory_search_t1_item,
  // E10d-1
  CHECK_memory_merged_search_item, CHECK_memory_energy_distribution,
  CHECK_memory_l5_axiom, CHECK_memory_l5_heuristic, CHECK_memory_list_sticky,
  CHECK_pods_lookup, CHECK_pods_worktree_diff, CHECK_pods_transcript,
  // E10e-1
  CHECK_agents_list_item, CHECK_providers_list_item, CHECK_providers_list_connected,
  CHECK_providers_list_default, CHECK_mcp_servers_item, CHECK_plugins_list,
  // E10f-A
  CHECK_tasks_list_item, CHECK_tasks_get,
  CHECK_tasks_output_cursor, CHECK_tasks_output_size, CHECK_tasks_output_truncated,
  CHECK_tasks_output_fields, CHECK_session_run, CHECK_session_discovery, CHECK_session_discovery_skill,
  CHECK_experience_action, CHECK_experience_action_operation_id, CHECK_experience_keys,
  CHECK_experience_action_ids, CHECK_experience_min_client_version, CHECK_experience_session_id,
  CHECK_background_jobs_list_item, CHECK_background_jobs_output, CHECK_terminal_list,
  // E10f-B
  CHECK_mafw_commands_list_item, CHECK_manager_session_keys, CHECK_manager_session_fields,
  CHECK_manager_session_created_at, CHECK_project_current_project, CHECK_project_current_mafw_dir,
  CHECK_runtime_get_capabilities, CHECK_runtime_get_unknown_events, CHECK_runtime_contract,
  CHECK_plugins_client_keys, CHECK_plugins_client_revision,
  CHECK_models_get_recall, CHECK_models_get_media, CHECK_models_get_available,
  CHECK_models_get_goal_node, CHECK_models_get_goal_tech_lead, CHECK_media_plugins_item,
  CHECK_tts_voices_voices, CHECK_tts_voices_models, CHECK_tts_voices_default_voice,
  CHECK_tts_voices_default_model, CHECK_voice_status, CHECK_embedding_get,
  // E10f-C
  CHECK_lead_topics_list_item, CHECK_lead_topic_get, CHECK_lead_boundaries_item,
  CHECK_standing_goals_list_item, CHECK_standing_goals_runs_item,
  CHECK_automations_get_rule, CHECK_events_sources_item, CHECK_pods_ensure,
  CHECK_pods_memory_file, CHECK_pods_memory_context,
  // E10h-R1
  CHECK_session_config_set, CHECK_session_suspend, CHECK_session_resume, CHECK_session_discard_run,
  CHECK_session_checkpoint_created, CHECK_session_restore_checkpoint,
  CHECK_session_data_part, CHECK_session_data_part_type, CHECK_session_prompt,
  CHECK_session_subagent_spawn, CHECK_session_queue_clear, CHECK_session_queue_cancel,
  CHECK_structured_submit,
  // E10h-R2
  CHECK_pods_create, CHECK_pods_update, CHECK_pods_wake, CHECK_pods_sleep,
  CHECK_pods_lead_ensure, CHECK_pods_tasks_create, CHECK_pods_tasks_update,
  CHECK_pods_tasks_delete, CHECK_pods_messages_create, CHECK_pods_messages_read,
  CHECK_pods_messages_dismiss, CHECK_pods_memory_write, CHECK_pods_review_items_create,
  CHECK_pods_review_items_resolve, CHECK_pods_review_items_reopen,
  CHECK_pods_tech_lead_message, CHECK_pods_probes_create, CHECK_pods_reject,
  CHECK_pods_accept, CHECK_tasks_cancel, CHECK_terminal_create,
  CHECK_terminal_connect_ticket, CHECK_background_cancel,
  // E10h-R3
  CHECK_decisions_draft, CHECK_decisions_confirm, CHECK_decisions_shelve, CHECK_decisions_reopen,
  CHECK_lead_compact, CHECK_lead_topic_resume, CHECK_lead_topic_fork,
  CHECK_standing_goal_create, CHECK_standing_goal_update, CHECK_standing_goal_pause,
  CHECK_standing_goal_resume, CHECK_standing_goal_stop, CHECK_standing_goal_run,
  CHECK_goal_run_approve,
  // E10h-R4
  CHECK_events_sources_create, CHECK_events_close_thread, CHECK_event_publish,
  CHECK_automations_draft, CHECK_triage_propose,
  CHECK_permissions_add_rule, CHECK_permissions_add_allowlist,
  CHECK_permissions_remove_rule_entries, CHECK_permissions_remove_allowlist_entries,
  // E10h-R5
  CHECK_mcp_config_preview, CHECK_mcp_config_preview_remove,
  CHECK_mcp_config_apply, CHECK_mcp_config_remove, CHECK_mcp_config_restore,
  CHECK_plugins_install, CHECK_plugins_install_package_application, CHECK_plugins_install_package_saved,
  CHECK_plugins_check, CHECK_plugins_enable_legacy, CHECK_plugins_disable_legacy,
  CHECK_plugins_disable_legacy_matches_enable, CHECK_plugins_apply_active,
  CHECK_plugins_apply_runtime_switch, CHECK_plugins_web_ticket,
  CHECK_runtime_switch_active, CHECK_runtime_switch_env_override, CHECK_runtime_restart_mode,
  CHECK_runtime_reload_plugins, CHECK_manager_rotate_fields,
  CHECK_models_update_recall, CHECK_models_update_media,
  // E10h-R6
  CHECK_chat_send, CHECK_chat_send_enriched, CHECK_tts_speak, CHECK_tts_speak_mime,
  CHECK_media_upload_artifact, CHECK_media_upload_and_create, CHECK_media_upload_and_create_state,
  CHECK_media_create_task_api,
  CHECK_media_plugins_reload, CHECK_embedding_update_current, CHECK_embedding_update_runtime,
]
