/**
 * E10h-R3：lead 域写接口（7 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/lead-boundaries.ts`（accept / merge / undo / observe）
 *   - `routes/lead-topics.ts`（compact / topics.resume / topics.fork）
 *
 * 与 SDK 的关系（`LeadNamespace`）：
 *   - `lead.compact` / `lead.topics.resume` / `lead.topics.fork` 与 SDK
 *     `LeadCompactResult` / `{sessionID,resumedFrom}` / `{goalId,sessionID?}` 逐字段等价
 *     （`contract-compat.checks.ts` 的 AssertEq 钉住）；
 *   - accept / merge / undo 的 wire 是 `LeadBoundaryService` 的 `BoundaryDecision`
 *     （`{status, toTopicId?}`），SDK 用一个三态联合的 `LeadBoundaryDecision`
 *     覆盖三 op。本契约按 **每个 op 的实际分支** 分别固定 `status` 字面量，并要求
 *     accept 必带 `toTopicId`——比 SDK 类型更精确，故不加 AssertEq。
 *
 * 错误体（400 / 404 / 409 / 503）不属于 200 形态。
 */
import { Type } from '@sinclair/typebox'

// ── boundaries ──────────────────────────────────────────────────────────────

/**
 * `core/lead/topic-boundary.ts` `BoundaryTrigger`——检测器只会产出这五个值
 * （`detectBoundary` 的显式/语义/空闲/目标关闭/关键词分支）。
 */
const LeadBoundaryTriggerSchema = Type.Union([
  Type.Literal('explicit'),
  Type.Literal('semantic'),
  Type.Literal('idle'),
  Type.Literal('goal_closed'),
  Type.Literal('keyword'),
])

/** `BoundaryProposal`：`reason` 是检测器给用户看的一句话依据（恒有）。 */
const LeadBoundaryProposalSchema = Type.Object({
  trigger: LeadBoundaryTriggerSchema,
  confidence: Type.Number(),
  reason: Type.String(),
})

/**
 * `POST /api/lead/topics/:id/boundaries/:bid/accept`（handler：`handleAcceptBoundary`
 * → `LeadBoundaryService.accept`）：在话题尾部拆出新 topic，`toTopicId` 是新 topic id
 * （幂等分支回已存在的那个，仍是 string）。已 merged/undone 的边界是 409。
 */
export const LeadBoundaryAcceptResponse = Type.Object({
  status: Type.Literal('accepted'),
  toTopicId: Type.String(),
})

/**
 * `POST /api/lead/topics/:id/boundaries/:bid/merge`（同上 → `merge`）：
 * `{status:'merged'}`——不产生新 topic，故无 `toTopicId`。
 */
export const LeadBoundaryMergeResponse = Type.Object({
  status: Type.Literal('merged'),
})

/**
 * `POST /api/lead/topics/:id/boundaries/:bid/undo`（同上 → `undo`）：
 * `{status:'undone'}`；已 accepted 的边界不可撤销（409）。
 */
export const LeadBoundaryUndoResponse = Type.Object({
  status: Type.Literal('undone'),
})

/**
 * `POST /api/lead/boundaries/observe`（handler：`routes/lead-boundaries.ts`）：
 * 观察是 advisory 且**永不失败**，三个出口同形：
 *   - 缺 sessionID / text 或未接线 observe → `{proposed:false}`；
 *   - 命中阈值 → `{proposed:true, proposal}`；
 *   - 观察器抛错 → `{proposed:false, error}`（错误只作为字段，不升 status）。
 * `proposal` 在未命中时可能为 `null`（`!!proposal` 已经把它折进 `proposed`）。
 */
export const LeadBoundaryObserveResponse = Type.Object({
  proposed: Type.Boolean(),
  proposal: Type.Optional(Type.Union([LeadBoundaryProposalSchema, Type.Null()])),
  error: Type.Optional(Type.String()),
})

// ── compact / topics ────────────────────────────────────────────────────────

/**
 * `POST /api/lead/compact`（handler：`handleCompact` → `compactTopic`）：
 * 换出 resident 消息后回四个统计键（≡ SDK `LeadCompactResult`）；
 * 未找到 topic 是 404，working set / compaction 关闭是 503。
 */
export const LeadCompactResponse = Type.Object({
  topicId: Type.String(),
  beforeTokens: Type.Number(),
  afterTokens: Type.Number(),
  evictedMessageIds: Type.Array(Type.String()),
})

/**
 * `POST /api/lead/topics/:id/resume`（handler：`handleResumeTopic` → `deps.resume`）：
 * `{sessionID, resumedFrom}`——`resumedFrom` 是源 topic id，可能是 null（新建会话）。
 */
export const LeadTopicResumeResponse = Type.Object({
  sessionID: Type.String(),
  resumedFrom: Type.Union([Type.String(), Type.Null()]),
})

/**
 * `POST /api/lead/topics/:id/fork`（handler：`handleForkTopic` → `deps.fork`）：
 * `{goalId, sessionID?}`——fork 只保证创建 Goal，`sessionID` 在服务只建 Goal
 * 不建会话时缺省或为 null，故 optional + nullable。
 */
export const LeadTopicForkResponse = Type.Object({
  goalId: Type.String(),
  sessionID: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})
