/**
 * E8-3 `GET /api/pods/:podId` 响应 schema（TypeBox）。
 *
 * 计划里写的是 `pods.list`，但 catalog 从未登记过 Pod 列表端点（只有
 * `pods.get` / `pods.ensure` / `pods.lookup`，都是单 Pod 详情）——这里按计划的
 * 允许项换成 `pods.get`。
 *
 * 形状来源：`routes/pods.ts` GET `/api/pods/:podId` → `enrichPodDetail()`，
 * 结构对齐 `@mafw/sdk` 的 `PodDetail`（`contract-compat.checks.ts` 的 AssertEq
 * 钉住字段/可选性）。wire 上额外的 row 字段（例如 PodSession 的 `revision` /
 * `generation`）不写进 schema：它们是 DB 行投影的附加列，契约面只承诺 DTO。
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

const PodGoalSchema = Type.Object({
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

const PodTaskSchema = Type.Object({
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
