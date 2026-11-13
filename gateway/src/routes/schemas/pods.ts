/**
 * Pod 读接口响应 schema（TypeBox）。
 *
 * E8-3：`GET /api/pods/:podId` → `PodDetailResponse`。
 * 计划里写的是 `pods.list`，但 catalog 从未登记过 Pod 列表端点（只有
 * `pods.get` / `pods.ensure` / `pods.lookup`，都是单 Pod 详情）——这里按计划的
 * 允许项换成 `pods.get`。
 *
 * E10-2：Pod 读接口 7 个 op（events / tasks / messages / goals / goal result /
 * review-items / cost），形状全部来自 handler 实际 wire：
 *   - pod.events.list          → `core/pod/pod-event-service.ts` `list()` → `{items, unread}`
 *   - pods.tasks.list          → `core/pod/pod-task-service.ts` `PodTaskView`（row + kind）
 *   - pods.messages.list       → `core/pod/pod-store.ts` `PodMessageRow`
 *   - pods.goals               → `core/pod/pod-view.ts` `PodGoalView`
 *   - pods.goals.result        → `core/pod/pod-result.ts` `PodGoalResult`（service 追加 worktree/acceptance）
 *   - pods.goals.reviewItems   → `core/pod/pod-review-service.ts` `list()` → `{revision, items}`
 *   - pods.cost                → `PodRouteDeps.cost()` → `{spentUsd, limitUsd}`
 *
 * 结构对齐 `@mafw/sdk` DTO（`contract-compat.checks.ts` 的 AssertEq 钉住字段/可选性）。
 * wire 上额外的 row 投影列（PodSession 的 `revision` / `generation`、PodMessage 的
 * `partsJson`、PodEvent 的 `refsJson` / `dedupeKey` / `wake*`、PodEvent 的 `projectId`）
 * 不写进 schema：它们是 DB 行投影的附加列，契约面只承诺 DTO（E8 先例）。
 *
 * `work.overview`（同一套 group/count 投影）见 `schemas/work.ts`。
 */
import { Type } from '@sinclair/typebox'

const PodStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('idle'),
  Type.Literal('paused'),
  Type.Literal('archived'),
])

const PodMemberRoleSchema = Type.Union([
  Type.Literal('lead'),
  Type.Literal('tech_lead'),
  Type.Literal('builder'),
  Type.Literal('reviewer'),
])

const PodMemberStatusSchema = Type.Union([
  Type.Literal('available'),
  Type.Literal('working'),
  Type.Literal('waiting'),
  Type.Literal('sleeping'),
  Type.Literal('retired'),
])

const PodGoalStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('active'),
  Type.Literal('done'),
  Type.Literal('aborted'),
])

const PodGoalVerdictSchema = Type.Union([
  Type.Literal('PASS'),
  Type.Literal('FAIL'),
  Type.Literal('MAX_RETRIES'),
  Type.Literal('ERROR'),
  Type.Literal('CANCELLED'),
])

const PodWorkBucketSchema = Type.Union([
  Type.Literal('needs_you'),
  Type.Literal('queued'),
  Type.Literal('in_progress'),
  Type.Literal('result_ready'),
  Type.Literal('ended'),
])

const PodQueueReasonSchema = Type.Union([
  Type.Literal('active_goal'),
  Type.Literal('paused'),
  Type.Literal('archived'),
  Type.Literal('budget'),
  Type.Literal('state_error'),
])

const PodGoalStageOwnerSchema = Type.Union([
  Type.Literal('person'),
  Type.Literal('team'),
  Type.Literal('system'),
])

const PodGoalStageKindSchema = Type.Union([
  Type.Literal('plan_approval'),
  Type.Literal('direction_review'),
  Type.Literal('question'),
  Type.Literal('blocked'),
  Type.Literal('queued'),
  Type.Literal('discussing'),
  Type.Literal('planning'),
  Type.Literal('probing'),
  Type.Literal('implementing'),
  Type.Literal('reviewing'),
  Type.Literal('result_notified'),
  Type.Literal('working'),
  Type.Literal('waiting'),
  Type.Literal('ended'),
])

const PodGoalStageActionTypeSchema = Type.Union([
  Type.Literal('open_plan_review'),
  Type.Literal('open_direction_review'),
  Type.Literal('open_question'),
  Type.Literal('open_discussion'),
  Type.Literal('open_goal'),
  Type.Literal('open_result'),
])

const PodGoalStageActionSchema = Type.Object({
  type: PodGoalStageActionTypeSchema,
  goalId: Type.String(),
  questionId: Type.Optional(Type.String()),
})

const PodGoalStageSchema = Type.Object({
  owner: PodGoalStageOwnerSchema,
  kind: PodGoalStageKindSchema,
  role: Type.Optional(PodMemberRoleSchema),
  queueReason: Type.Optional(PodQueueReasonSchema),
  action: Type.Optional(PodGoalStageActionSchema),
})

const PodPendingQuestionSchema = Type.Object({
  questionId: Type.String(),
  node: Type.Union([Type.Literal('plan'), Type.Literal('execute'), Type.Literal('review')]),
  questions: Type.Array(Type.String()),
})

const PodGoalProgressSchema = Type.Object({
  total: Type.Number(),
  done: Type.Number(),
  inProgress: Type.Number(),
  review: Type.Number(),
  failed: Type.Number(),
  skipped: Type.Number(),
})

const GoalSourceRefSchema = Type.Object({
  sessionID: Type.Optional(Type.String()),
  messageID: Type.Optional(Type.String()),
  snapshot: Type.String(),
  capturedAt: Type.String(),
  topicId: Type.Optional(Type.String()),
  messageRange: Type.Optional(Type.Object({
    from: Type.String(),
    to: Type.String(),
  })),
})

const PodGoalStrategySchema = Type.Union([
  Type.Literal('quick'),
  Type.Literal('collaborative'),
])

const PodGoalAssessmentSchema = Type.Union([
  Type.Literal('reviewed'),
  Type.Literal('unreviewed'),
])

const PodCurrentAssignmentSchema = Type.Object({
  assignmentId: Type.String(),
  role: Type.Union([Type.Literal('builder'), Type.Literal('reviewer')]),
  taskIds: Type.Array(Type.String()),
  attempt: Type.Number(),
})

export const PodGoalSchema = Type.Object({
  id: Type.String(),
  podId: Type.String(),
  goalId: Type.String(),
  status: PodGoalStatusSchema,
  title: Type.String(),
  phase: Type.Union([Type.String(), Type.Null()]),
  verdict: Type.Union([PodGoalVerdictSchema, Type.Null()]),
  stage: PodGoalStageSchema,
  pendingQuestion: Type.Optional(Type.Union([PodPendingQuestionSchema, Type.Null()])),
  bucket: Type.Optional(PodWorkBucketSchema),
  resultReady: Type.Boolean(),
  accepted: Type.Optional(Type.Boolean()),
  lastError: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  progress: Type.Optional(Type.Union([PodGoalProgressSchema, Type.Null()])),
  sourceRef: Type.Optional(Type.Union([GoalSourceRefSchema, Type.Null()])),
  strategy: Type.Optional(Type.Union([PodGoalStrategySchema, Type.Null()])),
  goalMode: Type.Optional(Type.Union([
    Type.Literal('quick'),
    Type.Literal('standard'),
    Type.Literal('standing'),
  ])),
  assessment: Type.Optional(Type.Union([PodGoalAssessmentSchema, Type.Null()])),
  currentAssignment: Type.Optional(Type.Union([PodCurrentAssignmentSchema, Type.Null()])),
  activeRevision: Type.Optional(Type.Number()),
  revision: Type.Optional(Type.Number()),
  priority: Type.Optional(Type.Number()),
  enqueuedAt: Type.String(),
  startedAt: Type.Union([Type.String(), Type.Null()]),
  endedAt: Type.Union([Type.String(), Type.Null()]),
})

const PodTaskKindSchema = Type.Union([
  Type.Literal('plan'),
  Type.Literal('note'),
  Type.Literal('external_request'),
])

const PodTaskStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('in_progress'),
  Type.Literal('blocked'),
  Type.Literal('review'),
  Type.Literal('done'),
  Type.Literal('failed'),
  Type.Literal('skipped'),
  Type.Literal('reopened'),
])

export const PodTaskSchema = Type.Object({
  id: Type.String(),
  podId: Type.String(),
  goalId: Type.Union([Type.String(), Type.Null()]),
  sourceKey: Type.String(),
  externalTaskId: Type.Union([Type.String(), Type.Null()]),
  kind: PodTaskKindSchema,
  title: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  ownerMemberId: Type.Union([Type.String(), Type.Null()]),
  status: PodTaskStatusSchema,
  dependenciesJson: Type.Union([Type.String(), Type.Null()]),
  artifactRefsJson: Type.Union([Type.String(), Type.Null()]),
  acceptanceJson: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})

const PodSessionScopeKindSchema = Type.Union([
  Type.Literal('project'),
  Type.Literal('discussion'),
  Type.Literal('probe'),
  Type.Literal('implementation'),
  Type.Literal('review'),
])

const PodSessionSchema = Type.Object({
  id: Type.String(),
  podId: Type.String(),
  memberId: Type.String(),
  goalId: Type.Union([Type.String(), Type.Null()]),
  node: Type.Union([Type.String(), Type.Null()]),
  sessionId: Type.String(),
  runtime: Type.Optional(Type.String()),
  status: Type.String(),
  transcriptRef: Type.Union([Type.String(), Type.Null()]),
  scopeKind: Type.Optional(Type.Union([PodSessionScopeKindSchema, Type.Null()])),
  createdAt: Type.String(),
  endedAt: Type.Union([Type.String(), Type.Null()]),
})

const PodMessageDeliverySchema = Type.Object({
  messageId: Type.String(),
  podId: Type.String(),
  memberId: Type.String(),
  deliveredAt: Type.Union([Type.String(), Type.Null()]),
  deliveredSessionId: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('delivered'),
    Type.Literal('failed'),
  ]),
  attempts: Type.Number(),
  lastError: Type.Union([Type.String(), Type.Null()]),
  nextRetryAt: Type.Union([Type.String(), Type.Null()]),
})

const PodSchema = Type.Object({
  id: Type.String(),
  projectDir: Type.String(),
  name: Type.String(),
  status: PodStatusSchema,
  configJson: Type.String(),
  activeGoalId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})

export const PodDetailResponse = Type.Object({
  pod: PodSchema,
  members: Type.Array(Type.Object({
    id: Type.String(),
    podId: Type.String(),
    role: PodMemberRoleSchema,
    displayName: Type.String(),
    agentName: Type.String(),
    modelProvider: Type.Union([Type.String(), Type.Null()]),
    modelId: Type.Union([Type.String(), Type.Null()]),
    status: PodMemberStatusSchema,
    configJson: Type.Union([Type.String(), Type.Null()]),
    createdAt: Type.String(),
    updatedAt: Type.String(),
  })),
  stageSupported: Type.Optional(Type.Boolean()),
  goals: Type.Array(PodGoalSchema),
  // 逐字段对齐 `core/pod/pod-stage.ts` `PodAttentionItem`（wire 比旧 DTO 宽：
  // 带 revision、6 种 kind，presence 聚合时还会附 podId/projectId）。
  attention: Type.Array(Type.Object({
    id: Type.String(),
    goalId: Type.String(),
    revision: Type.Number(),
    kind: Type.Union([
      Type.Literal('plan_approval'),
      Type.Literal('direction_review'),
      Type.Literal('question'),
      Type.Literal('blocked'),
      Type.Literal('review'),
      Type.Literal('failed'),
    ]),
    title: Type.String(),
    action: PodGoalStageActionSchema,
    podId: Type.Optional(Type.String()),
    projectId: Type.Optional(Type.String()),
  })),
  messageHealth: Type.Array(PodMessageDeliverySchema),
  tasks: Type.Array(PodTaskSchema),
  sessions: Type.Array(PodSessionSchema),
})

// ── E10-2：Pod 读接口 ───────────────────────────────────────────────────────

/**
 * `pod.events.list` item = `core/pod/pod-store.ts` `PodEventRow` 的契约面。
 * 行内 `refsJson` / `dedupeKey` / `wakeState` / `wakeAttempts` / `wakeAt` /
 * `wakeSessionId` / `projectId` 是存储与唤醒调度列（SDK DTO 不暴露），不建模。
 * `severity` / `reason` / `audience` 的取值域由 `core/pod/pod-event-model.ts` 的
 * 写入类型收窄（record() 只接受这三个联合），因此可安全枚举。
 */
const PodEventItemSchema = Type.Object({
  id: Type.String(),
  podId: Type.String(),
  goalId: Type.Union([Type.String(), Type.Null()]),
  revision: Type.Union([Type.Number(), Type.Null()]),
  kind: Type.String(),
  severity: Type.Union([
    Type.Literal('p1'),
    Type.Literal('p2'),
    Type.Literal('p3'),
  ]),
  reason: Type.Union([
    Type.Literal('decision'),
    Type.Literal('result'),
    Type.Literal('blocked'),
    Type.Literal('progress'),
    Type.Literal('message'),
  ]),
  title: Type.String(),
  summary: Type.Union([Type.String(), Type.Null()]),
  audience: Type.Union([
    Type.Literal('human'),
    Type.Literal('lead'),
    Type.Literal('none'),
  ]),
  state: Type.Union([Type.Literal('unread'), Type.Literal('seen')]),
  createdAt: Type.String(),
  seenAt: Type.Union([Type.String(), Type.Null()]),
})

/** `GET /api/pods/:podId/events` → `{items: PodEventRow[], unread}`。 */
export const PodEventsResponse = Type.Object({
  items: Type.Array(PodEventItemSchema),
  unread: Type.Number(),
})

/** `GET /api/pods/:podId/tasks` → `{items: PodTaskView[]}`（kind 由 goal/externalTaskId 投影）。 */
export const PodTasksResponse = Type.Object({
  items: Type.Array(PodTaskSchema),
})

/**
 * `GET /api/pods/:podId/messages` → `{items: PodMessageRow[]}`。
 * `partsJson`（A2A 多段原文）是存储列，DTO 不暴露；投递列恒为 `string | null`。
 */
const PodMessageSchema = Type.Object({
  id: Type.String(),
  podId: Type.String(),
  fromMemberId: Type.String(),
  toMemberId: Type.Union([Type.String(), Type.Null()]),
  kind: Type.String(),
  body: Type.String(),
  createdAt: Type.String(),
  readAt: Type.Union([Type.String(), Type.Null()]),
  protocol: Type.Union([Type.String(), Type.Null()]),
  externalMessageId: Type.Union([Type.String(), Type.Null()]),
  deliveredAt: Type.Union([Type.String(), Type.Null()]),
  deliveredSessionId: Type.Union([Type.String(), Type.Null()]),
})

export const PodMessagesResponse = Type.Object({
  items: Type.Array(PodMessageSchema),
})

/**
 * `GET /api/pods/:podId/goals` → `{items: PodGoalView[]}`（与 pods.get 的 goals 同源）。
 * `PodGoalView.stateMissing` 是视图内部的「state 文件缺失」标志（无 SDK/客户端消费者），
 * 与 E8 的 `pods.get` 一致不写进契约面；`PodGoalSchema` 的可选字段因此是 DTO 兼容面
 * （views() 实际恒发，见 pod-view.ts `buildPodGoalView`）。
 */
export const PodGoalsResponse = Type.Object({
  items: Type.Array(PodGoalSchema),
})

/** Goal Eval 单条条件（`core/goal/goal-eval.ts` `GoalEvalCondition`，5 字段全部必填）。 */
const PodGoalConditionSchema = Type.Object({
  id: Type.String(),
  statement: Type.String(),
  required: Type.Boolean(),
  evidence: Type.String(),
  method: Type.String(),
})

const PodGoalResultCheckSchema = Type.Object({
  conditionId: Type.String(),
  result: Type.Union([
    Type.Literal('pass'),
    Type.Literal('fail'),
    Type.Literal('skipped'),
  ]),
  evidence: Type.String(),
})

const PodGoalResultTaskSchema = Type.Object({
  taskId: Type.String(),
  result: Type.Union([
    Type.Literal('pass'),
    Type.Literal('fail'),
    Type.Literal('skipped'),
  ]),
  evidence: Type.String(),
})

/** `core/pod/pod-result.ts` `PodResultWorktree` → service 原样下发 revision worktree 元数据。 */
const PodGoalResultWorktreeSchema = Type.Object({
  dir: Type.String(),
  branch: Type.String(),
  baseBranch: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([
    Type.Literal('active'),
    Type.Literal('merged'),
    Type.Literal('abandoned'),
    Type.Literal('missing'),
  ]),
  mergeCommit: Type.Union([Type.String(), Type.Null()]),
  mergedAt: Type.Union([Type.String(), Type.Null()]),
})

/** 验收审计快照（`PodGoalAcceptanceView`）；只在人类验收后存在。 */
const PodGoalAcceptanceRecordSchema = Type.Object({
  forced: Type.Boolean(),
  acceptedAt: Type.String(),
  unresolvedReviewItemIds: Type.Array(Type.String()),
})

/**
 * `GET /api/pods/:podId/goals/:goalId/result` → `PodGoalResult`。
 *
 * `receipt` 是 driver 写入 `state.receiptPath` 的验收回执原文（`parseJson` 后的
 * 任意 JSON）——owner = goal driver/runtime，gateway 只透传，故为 schema-only
 * 边界（`unknown`），不建模内部结构。
 */
export const PodGoalResultResponse = Type.Object({
  goalId: Type.String(),
  revision: Type.Number(),
  verdict: Type.Union([PodGoalVerdictSchema, Type.Null()]),
  resultReady: Type.Boolean(),
  reviewed: Type.Boolean(),
  assessment: Type.Union([
    Type.Literal('reviewed'),
    Type.Literal('unreviewed'),
    Type.Null(),
  ]),
  goalAcceptance: Type.Array(Type.String()),
  goalConditions: Type.Array(PodGoalConditionSchema),
  goalResults: Type.Array(PodGoalResultCheckSchema),
  goalEvalValid: Type.Boolean(),
  failure: Type.Union([
    Type.Literal('review_missing'),
    Type.Literal('review_invalid'),
    Type.Literal('goal_eval_invalid'),
    Type.Null(),
  ]),
  tasks: Type.Array(PodGoalResultTaskSchema),
  reviewFeedback: Type.String(),
  // owner = goal driver（runtime-owned 回执 JSON）：gateway 只透传，不建模内部字段。
  receipt: Type.Union([Type.Unknown(), Type.Null()]),
  artifacts: Type.Array(Type.String()),
  worktree: Type.Union([PodGoalResultWorktreeSchema, Type.Null()]),
  acceptance: Type.Union([
    Type.Literal('pending'),
    Type.Literal('accepted'),
    Type.Literal('unavailable'),
  ]),
  /** worktree 缺失分支不写该字段（service 只附加 worktree 时同时给 acceptanceRecord）。 */
  acceptanceRecord: Type.Optional(Type.Union([PodGoalAcceptanceRecordSchema, Type.Null()])),
})

/** 人工评审锚点（`core/pod/pod-review-service.ts` `PodReviewAnchor` 判别联合）。 */
const PodReviewAnchorSchema = Type.Union([
  Type.Object({ kind: Type.Literal('quote'), quote: Type.String() }),
  Type.Object({
    kind: Type.Literal('jsonPath'),
    path: Type.String(),
    valueSummary: Type.String(),
  }),
  Type.Object({
    kind: Type.Literal('cell'),
    sheet: Type.Optional(Type.String()),
    ref: Type.String(),
    value: Type.String(),
  }),
  Type.Object({
    kind: Type.Literal('region'),
    x: Type.Number(),
    y: Type.Number(),
    w: Type.Number(),
    h: Type.Number(),
    slide: Type.Optional(Type.Number()),
  }),
])

const PodReviewItemSchema = Type.Object({
  id: Type.String(),
  podId: Type.String(),
  goalId: Type.String(),
  revision: Type.Number(),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('responded'),
    Type.Literal('resolved'),
  ]),
  rel: Type.String(),
  startLine: Type.Union([Type.Number(), Type.Null()]),
  endLine: Type.Union([Type.Number(), Type.Null()]),
  code: Type.String(),
  comment: Type.String(),
  anchor: Type.Union([PodReviewAnchorSchema, Type.Null()]),
  response: Type.Union([Type.String(), Type.Null()]),
  originItemId: Type.Union([Type.String(), Type.Null()]),
  originRevision: Type.Union([Type.Number(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  respondedAt: Type.Union([Type.String(), Type.Null()]),
  resolvedAt: Type.Union([Type.String(), Type.Null()]),
})

/** `GET /api/pods/:podId/goals/:goalId/review-items` → `{revision, items}`（缺省 revision = activeRevision）。 */
export const PodReviewItemsResponse = Type.Object({
  revision: Type.Number(),
  items: Type.Array(PodReviewItemSchema),
})

/** `GET /api/pods/:podId/cost` → 预算账本（金额单位 USD）。 */
export const PodCostResponse = Type.Object({
  spentUsd: Type.Number(),
  limitUsd: Type.Number(),
})
