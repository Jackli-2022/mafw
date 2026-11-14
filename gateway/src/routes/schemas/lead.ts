/**
 * E10c-1：Lead 工作集诊断读接口（2 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状；
 * `emit:openapi` 直接投影成 `responses.200.content['application/json'].schema`。
 * 形状来源（handler 是事实源）：
 *   - lead.workingSet → routes/lead-topics.ts `handleWorkingSet`（`WorkingSet` + topics 投影）
 *   - lead.recall     → routes/lead-topics.ts `handleRecall`（`recallTopics` 候选，只读诊断）
 *
 * 两个都是 developer diagnostic 面（tags: lead），不注入、不写库；SDK 不调用，
 * 无对应 DTO 可做 AssertEq，等价性由 `tests/unit/api-contract.test.ts` 钉住。
 * 两路由恒 200（working set 关闭时 recall 回空候选数组），无错误体需建模。
 */
import { Type } from '@sinclair/typebox'

/** `core/lead/lead-topic-store.ts` `LeadTopicState`。 */
const LeadTopicStateSchema = Type.Union([
  Type.Literal('resident'),
  Type.Literal('warm'),
  Type.Literal('cold'),
  Type.Literal('archived'),
])

/**
 * `LeadTopicView`（`toView`）——对外 topic 投影：不含 session id / 索引行，
 * `summary` 与 `resumedFrom` 是 DB 可空列 → `string | null`。
 */
const LeadTopicViewSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  summary: Type.Union([Type.String(), Type.Null()]),
  state: LeadTopicStateSchema,
  lastActiveAt: Type.String(),
  goalId: Type.String(),
  resumedFrom: Type.Union([Type.String(), Type.Null()]),
})

// ── lead.workingSet ─────────────────────────────────────────────────────────

/**
 * `GET /api/lead/working-set?projectDir=` —— `selectWorkingSet()` 的五个 id 桶
 * （resident / warm / cold / pinned / evicted，均为 topic id 数组）加上 `topics`
 * 全量视图投影（`handleWorkingSet` 的 `{...ws, topics}`）。
 */
export const LeadWorkingSetResponse = Type.Object({
  resident: Type.Array(Type.String()),
  warm: Type.Array(Type.String()),
  cold: Type.Array(Type.String()),
  pinned: Type.Array(Type.String()),
  evicted: Type.Array(Type.String()),
  topics: Type.Array(LeadTopicViewSchema),
})

// ── lead.recall ─────────────────────────────────────────────────────────────

/**
 * `core/lead/topic-recall.ts` `RecallCandidate`：确定性 page-fault 匹配结果，
 * `score` 已 `toFixed(3)` 归一，`matches` 是命中的 query token（≥1 条，低置信候选
 * 在 `recallTopics` 内就被丢弃）。
 */
const RecallCandidateSchema = Type.Object({
  topicId: Type.String(),
  title: Type.String(),
  score: Type.Number(),
  matches: Type.Array(Type.String()),
})

/** `GET /api/lead/recall?projectDir=&q=` —— 诊断候选；永不注入、永不写库。 */
export const LeadRecallResponse = Type.Object({
  candidates: Type.Array(RecallCandidateSchema),
})
