/**
 * P4-B 缂栬瘧鏈熷鎷嶏細overrides.json 鐨?responseSchema 缁?openapi-typescript 鐢熸垚
 * 鐨勫搷搴旂被鍨嬶紝蹇呴』涓庢墜鍐?DTO锛坱ypes.ts锛夌粨鏋勭瓑浠凤紙Equals锛夈€? *
 * schema 鏄墜鍐?DTO 鐨勫畬鏁磋浆褰曗€斺€斿瓧娈电己澶?required 閿欐爣/绫诲瀷婕傜Щ閮戒細鍦ㄨ繖閲岀孩銆? * 鐢ㄦ亽绛夊嚱鏁版妧宸у仛绮剧‘鐩哥瓑姣旇緝锛堝 never 涓嶅垎閰嶏紝闃茬┖娲為€氳繃锛夛紱
 * 鏂█閲囩敤鐩存帴璧嬪€硷紙Equals=false 鏃?`const x: false = true` 缂栬瘧蹇呯孩锛夈€? * tsconfig 鎺掗櫎 *.test.ts锛屾晠鏂█鏀炬簮鏂囦欢锛坱sc --noEmit / build 瀹堥棬锛夈€? */
import type { operations } from './api-schema.gen'
import type {
  Session, Goal, GoalSessionInfo, MemoryUnit, TriageItem, Approval, AutomationRule, QuestionRequest,
  DecisionList, AttentionList, PodDetail,
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
  // E10f-A session / task / terminal / usage read surface
  TaskEntity, TaskOutput, DiscoverySnapshot, DiscoverySkillContent, TerminalSessionList,
  MafwBackgroundOutput,
  // E10f-B project / runtime / metadata read surface
  MafwCommandDef, ManagerSessionInfo, Project, MediaPluginState, VoiceStatusResponse,
  ModelConfigState, ModelRef, EmbeddingConfigGetResponse, TtsNamespace, PluginClientSnapshot,
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
const CHECK_automations_list: AssertEq<GenAutomationRule, AutomationRule> = true
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
]
