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
} from './types'
import type { MafwClient } from './client'
import type { MafwDiff, MafwPermissionRequest } from './view-dto'

/** 鐢熸垚褰㈢姸锛歳esponses.200.content['application/json'] 涓嬬洿鎺ュ唴鑱?schema 灞炴€э紙鏃?schema: 鍖呰锛夈€?*/
type Resp<S> = S extends { responses: { 200: { content: { 'application/json': infer C } } } } ? C : never
type ItemOf<S, K extends string> = S extends Record<K, infer T> ? (T extends readonly (infer X)[] ? X : T) : never

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
]
