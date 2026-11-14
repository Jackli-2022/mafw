/**
 * E10g-W3：pod 域写接口的请求体 schema（`RouteDef.request`）。
 *
 * 只有声明，不做运行时校验：字段面逐项来自 `routes/pods.ts` /
 * `routes/pod-handlers.ts` / `routes/pod-collaboration.ts` /
 * `routes/pods-events-dispatch.ts` 的 handler 读取（`assertAccess(body)` 读
 * `actorSessionID`，其余字段各自守卫 + service 400）。条件必填（`fromMemberId` /
 * `title` / `objective|charter` / `text|message` / `feedback|reason`）用
 * description 表达，不伪造 oneOf。
 *
 * `pods.a2a`（`POST /a2a/pods/:podId`）不在本批：A2A 协议透传按 spec §1 排除，
 * 计入 W7 的 `REQUEST_EXCLUDED`。
 */
import { Type } from '@sinclair/typebox'
import {
  PodProbeAffectsSchema,
  PodProbeBudgetSchema,
  PodProbeScopeSchema,
  PodStatusSchema,
  PodTaskStatusSchema,
} from './pods'

/** `assertAccess` 的审计 actor：提供时按成员角色鉴权，缺省视为人类本地操作。 */
const ActorSessionID = Type.Optional(Type.String({ description: 'Member session acting on behalf of a role; absent = human/local caller.' }))

const GoalSourceSchema = Type.Union([
  Type.Literal('desktop'),
  Type.Literal('lead'),
  Type.Literal('a2a'),
  Type.Literal('automation'),
  Type.Literal('user'),
  Type.Literal('tui'),
  Type.Literal('agent'),
  Type.Literal('mobile'),
])

const GoalPrioritySchema = Type.Union([
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('critical'),
])

const GoalTaskTypeSchema = Type.Union([
  Type.Literal('feature'),
  Type.Literal('bugfix'),
  Type.Literal('refactor'),
  Type.Literal('research'),
  Type.Literal('docs'),
  Type.Literal('test'),
  Type.Literal('other'),
])

const GoalPlanReviewSchema = Type.Union([Type.Literal('manual'), Type.Literal('auto')])

const GoalMetricsSchema = Type.Record(Type.String(), Type.Object({
  target: Type.Optional(Type.Number()),
  unit: Type.Optional(Type.String()),
}, { additionalProperties: true }))

const GoalBudgetSchema = Type.Object({
  maxTurns: Type.Optional(Type.Number()),
  maxCostUsd: Type.Optional(Type.Number()),
})

/** `GoalSourceRef`（`core/goal/goal-intake.ts` `normalizeGoalSourceRef`）：三键全空 → 未写入。 */
const GoalSourceRefSchema = Type.Object({
  sessionID: Type.Optional(Type.String()),
  messageID: Type.Optional(Type.String()),
  snapshot: Type.Optional(Type.String({ description: 'Snapshot text; required by handoff.' })),
  topicId: Type.Optional(Type.String()),
  capturedAt: Type.Optional(Type.String()),
  messageRange: Type.Optional(Type.Object({
    from: Type.String(),
    to: Type.String(),
  })),
})

// ── pod lifecycle ─────────────────────────────────────────────────────────

// `pods.create`（POST /api/projects/:projectId/pod）与 `pods.lead.ensure` 使用
// `EmptyRequest`：前者按路径 projectId 调 `pods.ensure`，后者按路径 podId 调
// `ensureLead`，两者都不读 body（`?actorSessionID=` 走 query）。
// 使用方：`request: EmptyRequest, requestRequired: false`。

/** `PATCH /api/pods/:podId`（handler：routes/pods.ts 的 pod 分支）：`status` 必填。 */
export const PodUpdateRequest = Type.Object({
  status: PodStatusSchema,
})

// ── tasks ─────────────────────────────────────────────────────────────────

/**
 * `PATCH /api/pods/:podId/tasks/:taskId`（handler：routes/pods.ts 的 task 分支）。
 * 两种互斥模式（handler 400）：计划变更（`title` / `acceptance`，Lead 才能改）
 * 与状态变更（`status` / `ownerMemberId`）；`actorSessionID` 是鉴权 actor。
 * 三者都不给时 handler 走空 patch（无实际操作），契约仍声明为必填 body。
 */
export const PodTaskUpdateRequest = Type.Object({
  title: Type.Optional(Type.String()),
  acceptance: Type.Optional(Type.Array(Type.String())),
  status: Type.Optional(PodTaskStatusSchema),
  ownerMemberId: Type.Optional(Type.String()),
  actorSessionID: ActorSessionID,
})

/** `DELETE /api/pods/:podId/tasks/:taskId`：body 只用于 Lead actor 鉴权，可缺省。 */
export const PodTaskDeleteRequest = Type.Object({
  actorSessionID: ActorSessionID,
})

// ── messages ──────────────────────────────────────────────────────────────

const PodMessageKindSchema = Type.Union([
  Type.Literal('note'),
  Type.Literal('request'),
  Type.Literal('review'),
  Type.Literal('decision'),
  Type.Literal('escalation'),
])

/**
 * `POST /api/pods/:podId/messages`（handler：routes/pods.ts 的 messages 分支）。
 * `kind` 必须是 MESSAGE_KINDS 之一，`body` trim 后非空（service 400）；
 * `fromMemberId` 在缺少 `actorSessionID` 时必填（二选一，带 actor 时不得与 actor 不符）。
 * `notify:true` 要求同时给 `toMemberId`（否则 400）。
 */
export const PodMessageCreateRequest = Type.Object({
  kind: PodMessageKindSchema,
  body: Type.String({ minLength: 1 }),
  fromMemberId: Type.Optional(Type.String({ description: 'Required when actorSessionID is absent.' })),
  toMemberId: Type.Optional(Type.String()),
  notify: Type.Optional(Type.Boolean({ description: 'Requires toMemberId; triggers immediate delivery.' })),
  actorSessionID: ActorSessionID,
})

/** `POST /api/pods/:podId/messages/:messageId/delivery/retry`：body 只用于 Lead actor 鉴权。 */
export const PodMessageDeliveryRetryRequest = Type.Object({
  actorSessionID: ActorSessionID,
})

/** `POST .../delivery/dismiss`：`memberId` 必填（缺 → 400）；actor 可选。 */
export const PodMessageDeliveryDismissRequest = Type.Object({
  memberId: Type.String({ minLength: 1 }),
  actorSessionID: ActorSessionID,
})

// 以下动作 body 被完全忽略：
//   - `pods.messages.read` → 只用路径 messageId（读标记）
//   - `pods.wake` / `pods.sleep` → 只切 pod status（wake 额外 promote 队列）
//   - `pod.events.seen` → 只用路径 id
// 使用方：`request: EmptyRequest, requestRequired: false`。

/** `POST /api/pods/:podId/events/seen`：handler 要求 `goalId` + 有限数字 `revision`（缺 → 400）。 */
export const PodEventsSeenAllRequest = Type.Object({
  goalId: Type.String({ minLength: 1 }),
  revision: Type.Number(),
})

// ── goals ─────────────────────────────────────────────────────────────────

/**
 * `POST /api/pods/:podId/goals`（handler：routes/pods.ts 的 goals 分支）。
 * `title` 必填、`objective` 或 `charter` 至少一个（否则 400）；`source` 必须在
 * 白名单内（未知值 400）；`sourceRef` 由 `normalizeGoalSourceRef` 归一化。
 * 有 Tech Lead 时走讨论 Goal（revision 1 discussing），否则走 legacy intake。
 */
export const PodGoalCreateRequest = Type.Object({
  title: Type.String({ minLength: 1 }),
  objective: Type.Optional(Type.String({ description: 'Required unless charter is present.' })),
  charter: Type.Optional(Type.String({ description: 'Required unless objective is present.' })),
  source: Type.Optional(GoalSourceSchema),
  sourceRef: Type.Optional(GoalSourceRefSchema),
  acceptance: Type.Optional(Type.Array(Type.String())),
  boundaries: Type.Optional(Type.Array(Type.String())),
  metrics: Type.Optional(GoalMetricsSchema),
  priority: Type.Optional(GoalPrioritySchema),
  maxLoops: Type.Optional(Type.Integer({ minimum: 1 })),
  budget: Type.Optional(GoalBudgetSchema),
  taskType: Type.Optional(GoalTaskTypeSchema),
  planReview: Type.Optional(GoalPlanReviewSchema),
  handoff: Type.Optional(Type.Union([Type.Literal('current-topic'), Type.Literal('none')])),
  topicId: Type.Optional(Type.String()),
  actorSessionID: ActorSessionID,
})

/**
 * `POST /api/pods/:podId/goals/handoff`（handler：routes/pods.ts 的 handoff 分支）。
 * Lead 授权创建：`sourceRef.snapshot` 必填（否则 400），`source` 固定 `lead`，
 * 因此 body 里不接受 `source` / `metrics` / `maxLoops` / `budget` / `handoff`。
 */
export const PodGoalHandoffRequest = Type.Object({
  title: Type.String({ minLength: 1 }),
  objective: Type.Optional(Type.String({ description: 'Required unless charter is present.' })),
  charter: Type.Optional(Type.String({ description: 'Required unless objective is present.' })),
  sourceRef: Type.Object({
    sessionID: Type.Optional(Type.String()),
    messageID: Type.Optional(Type.String()),
    snapshot: Type.String({ minLength: 1 }),
    topicId: Type.Optional(Type.String()),
    capturedAt: Type.Optional(Type.String()),
    messageRange: Type.Optional(Type.Object({
      from: Type.String(),
      to: Type.String(),
    })),
  }),
  acceptance: Type.Optional(Type.Array(Type.String())),
  boundaries: Type.Optional(Type.Array(Type.String())),
  priority: Type.Optional(GoalPrioritySchema),
  taskType: Type.Optional(GoalTaskTypeSchema),
  planReview: Type.Optional(GoalPlanReviewSchema),
})

/** `DELETE /api/pods/:podId/goals/:goalId`：body 只用于 Lead actor 鉴权，可缺省。 */
export const PodGoalCancelRequest = Type.Object({
  actorSessionID: ActorSessionID,
})

/**
 * `POST /api/pods/:podId/goals/:goalId/accept`（human-only）。
 * `confirm:true` 必填（否则 400）；`revision` 必须是正整数；`force` /
 * `riskAcknowledged` 布尔。携带 `actorSessionID` 一律 403（agent 不得合并）。
 */
export const PodGoalAcceptRequest = Type.Object({
  confirm: Type.Literal(true),
  revision: Type.Optional(Type.Integer({ minimum: 1 })),
  force: Type.Optional(Type.Boolean()),
  riskAcknowledged: Type.Optional(Type.Boolean()),
})

/**
 * `POST /api/pods/:podId/goals/:goalId/reject`：`feedback` 或 `reason` 至少一个
 * 非空（否则 400）；`actorSessionID` 用于 Lead 鉴权。
 */
export const PodGoalRejectRequest = Type.Object({
  feedback: Type.Optional(Type.String({ description: 'Required unless reason is present.' })),
  reason: Type.Optional(Type.String({ description: 'Required unless feedback is present.' })),
  actorSessionID: ActorSessionID,
})

/**
 * `POST /api/pods/:podId/goals/:goalId/direction-decision`（handler：
 * routes/pod-collaboration.ts）。`mode` 缺省时 handler 推断（有 options 无决定 →
 * `needs_user`，否则 `decided`）；`request` 是 `needs_user` 的别名。
 * `needs_user` 要求至少一个 option；`decided` / `clear` 要求 `userWords` 或
 * `optionId`（否则 400）。`revision` 必须是正整数。
 */
export const PodGoalDirectionRequest = Type.Object({
  mode: Type.Optional(Type.Union([
    Type.Literal('decided'),
    Type.Literal('clear'),
    Type.Literal('needs_user'),
    Type.Literal('request'),
  ])),
  revision: Type.Optional(Type.Integer({ minimum: 1 })),
  reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  userWords: Type.Optional(Type.String()),
  optionId: Type.Optional(Type.String()),
  options: Type.Optional(Type.Array(Type.Object({
    id: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    summary: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    risks: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  }))),
  actorSessionID: ActorSessionID,
})

/**
 * `POST /api/pods/:podId/goals/:goalId/tech-lead/messages`（handler：
 * routes/pod-collaboration.ts）。`text` 或 `message` 至少一个 trim 后非空；
 * `parts` 只保留 `{type:'text', text}`（`synthetic:true` 透传），超出前 8 条的
 * 部分由 `normalizeTechLeadParts` 静默丢弃 —— 截断而非拒绝，故不声明 maxItems。
 */
export const PodTechLeadMessageRequest = Type.Object({
  text: Type.Optional(Type.String({ description: 'Required unless message is present.' })),
  message: Type.Optional(Type.String({ description: 'Alias of text.' })),
  parts: Type.Optional(Type.Array(Type.Object({
    type: Type.Literal('text'),
    text: Type.String(),
    synthetic: Type.Optional(Type.Boolean()),
  }), { description: 'Text parts only; the handler keeps the first 8 and drops the rest.' })),
  actorSessionID: ActorSessionID,
})

/** 单条探针输入（`ProbeRequestInput` 去掉 podId/goalId，两者来自路径）。 */
const PodProbeInputSchema = Type.Object({
  question: Type.String({ minLength: 1 }),
  hypothesis: Type.String({ minLength: 1 }),
  scope: PodProbeScopeSchema,
  budget: PodProbeBudgetSchema,
  evidenceRequired: Type.Optional(Type.Array(Type.String())),
  affects: Type.Optional(PodProbeAffectsSchema),
  revision: Type.Optional(Type.Integer({ minimum: 1 })),
})

/**
 * `POST /api/pods/:podId/goals/:goalId/probes`（handler：routes/pod-collaboration.ts）。
 * 两种形态：body 本身是一条探针（`question`/`hypothesis`/`scope`/`budget` 由
 * service 校验，缺 → 400），或 `{probes:[...]}` 批量（>1 条需要 `requestMany`）。
 * 批量形态下顶层字段因此全部 optional——单条形态缺字段会由 service 拒绝。
 */
export const PodProbeCreateRequest = Type.Object({
  probes: Type.Optional(Type.Array(PodProbeInputSchema, { minItems: 1 })),
  question: Type.Optional(Type.String()),
  hypothesis: Type.Optional(Type.String()),
  scope: Type.Optional(PodProbeScopeSchema),
  budget: Type.Optional(PodProbeBudgetSchema),
  evidenceRequired: Type.Optional(Type.Array(Type.String())),
  affects: Type.Optional(PodProbeAffectsSchema),
  revision: Type.Optional(Type.Integer({ minimum: 1 })),
  actorSessionID: ActorSessionID,
})

// ── review items（human-only） ─────────────────────────────────────────────

/**
 * `POST /api/pods/:podId/goals/:goalId/review-items`（human-only）。
 * `items` 1..50 条（service 400）；每条 `rel` / `comment` 必填，`anchor` 是
 * 锚点 JSON（quote / jsonPath / cell / region，handler 原样序列化存储）。
 * `revision` 必须等于 active revision（否则 409）。
 */
export const PodReviewItemsCreateRequest = Type.Object({
  items: Type.Array(Type.Object({
    rel: Type.String({ minLength: 1 }),
    comment: Type.String({ minLength: 1 }),
    startLine: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    endLine: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    code: Type.Optional(Type.String()),
    anchor: Type.Optional(Type.Unknown({ description: 'PodReviewAnchor: quote / jsonPath / cell / region (stored verbatim).' })),
  }), { minItems: 1, maxItems: 50 }),
  revision: Type.Optional(Type.Integer({ minimum: 1 })),
})

/** `.../review-items/:itemId/resolve` 与 `.../reopen`：`note` 可选，body 可缺省。 */
export const PodReviewItemActionRequest = Type.Object({
  note: Type.Optional(Type.String()),
})

// ── memory ────────────────────────────────────────────────────────────────

/**
 * `POST /api/pods/:podId/memory`（handler：routes/pods.ts 的 memory 分支）。
 * `file` 必须是 POD|MEMORY|GLOSSARY（否则 400）；`content` 缺省写入空文件。
 */
export const PodMemoryWriteRequest = Type.Object({
  file: Type.Union([
    Type.Literal('POD'),
    Type.Literal('MEMORY'),
    Type.Literal('GLOSSARY'),
  ]),
  content: Type.Optional(Type.String()),
})

