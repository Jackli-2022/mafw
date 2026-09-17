/**
 * P4-B 缂栬瘧鏈熷鎷嶏細overrides.json 鐨?responseSchema 缁?openapi-typescript 鐢熸垚
 * 鐨勫搷搴旂被鍨嬶紝蹇呴』涓庢墜鍐?DTO锛坱ypes.ts锛夌粨鏋勭瓑浠凤紙Equals锛夈€? *
 * schema 鏄墜鍐?DTO 鐨勫畬鏁磋浆褰曗€斺€斿瓧娈电己澶?required 閿欐爣/绫诲瀷婕傜Щ閮戒細鍦ㄨ繖閲岀孩銆? * 鐢ㄦ亽绛夊嚱鏁版妧宸у仛绮剧‘鐩哥瓑姣旇緝锛堝 never 涓嶅垎閰嶏紝闃茬┖娲為€氳繃锛夛紱
 * 鏂█閲囩敤鐩存帴璧嬪€硷紙Equals=false 鏃?`const x: false = true` 缂栬瘧蹇呯孩锛夈€? * tsconfig 鎺掗櫎 *.test.ts锛屾晠鏂█鏀炬簮鏂囦欢锛坱sc --noEmit / build 瀹堥棬锛夈€? */
import type { operations } from './api-schema.gen'
import type {
  Session, Goal, GoalSessionInfo, MemoryUnit, TriageItem, Approval, AutomationRule, QuestionRequest,
} from './types'

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

export const CONTRACT_COMPAT_CHECKS = [
  CHECK_session_list, CHECK_session_get, CHECK_goals_list, CHECK_goals_get, CHECK_goals_sessions,
  CHECK_memory_search, CHECK_triage_list, CHECK_approvals_list, CHECK_automations_list, CHECK_questions_list,
]
