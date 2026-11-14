/**
 * E10h-R2：pod 域写接口（25 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/pods.ts`（pod / tasks / messages / goals / review-items / memory）
 *   - `routes/pod-collaboration.ts`（tech-lead / direction / probes / reject）
 *   - `routes/pod-events.ts` + `routes/pods-events-dispatch.ts`（pod.events.*）
 *   - `routes/pod-a2a.ts`（A2A JSON-RPC 协议边界）
 *
 * 默认复用读侧同形 DTO：`PodDetailResponse`（create / update / wake / sleep）、
 * `PodTaskSchema`、`PodMessageSchema`、`PodGoalSchema`、`PodReviewItemSchema`、
 * `PodProbesResponse`。只有 handler 真的发出读侧没有的形状时才新写：任务删除回执、
 * Goal 创建/打回/方向/验收结果、`PodGoalRow`（cancel 的 `{goal}` 是**行**不是视图）、
 * 交付状态枚举、A2A 开放边界。
 *
 * 三处「契约比 SDK 类型更贴 handler」的故意收窄/放宽（客户端不得据此反推）：
 *   1. `pods.goals.cancel` 的 `goal` 是 `PodGoalRow`（`pod-store.ts`），不是
 *      `PodGoal` 视图——没有 `title` / `phase` / `stage` / `resultReady`；
 *   2. `pods.messages.delivery.retry` 原样透传 `deliver()` 的三态，含 `skipped`
 *      （`create` 分支把 `skipped` 映射成 `disabled`，两者不同）；
 *   3. `pods.a2a` 的 200 是 A2A JSON-RPC 信封，字段面归协议所有（开放对象）。
 */
import { Type } from '@sinclair/typebox'
import { GoalSourceRefSchema } from './goals'
import {
  PodDetailResponse,
  PodGoalRevisionStatusSchema,
  PodGoalSchema,
  PodGoalStatusSchema,
  PodGoalVerdictSchema,
  PodMessageSchema,
  PodProbesResponse,
  PodQueueReasonSchema,
  PodReviewItemSchema,
  PodTaskSchema,
} from './pods'

// ── pod 生命周期 ────────────────────────────────────────────────────────────

/**
 * `POST /api/projects/:projectId/pod`（handler：`routes/pods.ts` 的 projectPod 分支
 * → `PodService.ensure` → `enrichPodDetail`）：与 `pods.get` 严格同形（非 lead 成员
 * 只是把 `sessions` 清空，字段面不变）——直接复用读侧 schema。
 */
export const PodCreateResponse = PodDetailResponse

/** `PATCH /api/pods/:podId`（handler 同上 pod 分支 → `updateStatus` + `enrichPodDetail`）。 */
export const PodUpdateResponse = PodDetailResponse

/** `POST /api/pods/:podId/wake`（handler：同上 wake/sleep 分支；wake 额外 `goals.promote`）。 */
export const PodWakeResponse = PodDetailResponse

/** `POST /api/pods/:podId/sleep`（handler 同上；只切 `status: 'idle'`）。 */
export const PodSleepResponse = PodDetailResponse

/**
 * `POST /api/pods/:podId/lead/ensure`（handler：`PodService.ensureLead`）：
 * `{podId, projectDir, sessionId}`。注意 `sessionId` 是小写 d——与 `pods.goals.*`
 * 的 `sessionID` 不同，两个字段名都按 handler 原样声明。
 */
export const PodLeadEnsureResponse = Type.Object({
  podId: Type.String(),
  projectDir: Type.String(),
  sessionId: Type.String(),
})

// ── tasks ──────────────────────────────────────────────────────────────────

/**
 * `POST /api/pods/:podId/tasks`（handler：`routes/pods.ts` 的 tasks 分支）：
 * plan task 与 manual task 都回 `{task}`，条目是列表同一个 `PodTask` 视图
 * （`PodTaskService.addPlanTask` / `createManual` → `withKind()`）。
 */
export const PodTaskCreateResponse = Type.Object({
  task: PodTaskSchema,
})

/** `PATCH /api/pods/:podId/tasks/:taskId`（handler：同上 task 分支 → `editTitle` / `editPlanTask` / `updateTask`）。 */
export const PodTaskUpdateResponse = Type.Object({
  task: PodTaskSchema,
})

/**
 * `DELETE /api/pods/:podId/tasks/:taskId`（handler：`PodTaskService.deleteTask`）：
 * `{deleted:{goalId, externalTaskId}}`——只回被删行的两个外键（`null` 表示原本没有），
 * 不回任务本体。
 */
export const PodTaskDeleteResponse = Type.Object({
  deleted: Type.Object({
    goalId: Type.Union([Type.String(), Type.Null()]),
    externalTaskId: Type.Union([Type.String(), Type.Null()]),
  }),
})

// ── messages ───────────────────────────────────────────────────────────────

/**
 * `pods.messages.create` 的交付结果：`deliver()` 的 `skipped` 被 handler 映射成
 * `disabled`（未启用投递 / 无 toMemberId / 已投递过）。
 */
const PodMessageCreateDeliverySchema = Type.Union([
  Type.Literal('delivered'),
  Type.Literal('pending'),
  Type.Literal('disabled'),
])

/**
 * `POST /api/pods/:podId/messages`（handler：`routes/pods.ts` 的 messages 分支）：
 * 不带 `notify:true` 只回 `{message}`；带 notify 时追加 `delivery`。
 */
export const PodMessageCreateResponse = Type.Object({
  message: PodMessageSchema,
  delivery: Type.Optional(PodMessageCreateDeliverySchema),
})

/** `POST /api/pods/:podId/messages/:messageId/read`（handler → `PodMessageService.markRead`）。 */
export const PodMessageReadResponse = Type.Object({
  message: PodMessageSchema,
})

/**
 * `POST .../delivery/retry`（handler → `delivery.retryFailure`）：原样透传
 * `deliver()` 的 `'delivered' | 'pending' | 'skipped'`——这里**不是** DTO 的
 * `PodDeliveryState`（那个是 `delivered|pending|disabled`），handler 没有做映射。
 */
export const PodMessageDeliveryRetryResponse = Type.Object({
  delivery: Type.Union([
    Type.Literal('delivered'),
    Type.Literal('pending'),
    Type.Literal('skipped'),
  ]),
})

/** `POST .../delivery/dismiss`（handler → `delivery.dismissFailure`）：删掉失败投递行是否命中。 */
export const PodMessageDeliveryDismissResponse = Type.Object({
  dismissed: Type.Boolean(),
})

// ── goals ──────────────────────────────────────────────────────────────────

/**
 * `pods.goals.create` / `pods.goals.handoff` 的 `status`：Tech Lead 分支回
 * revision 状态 `discussing`，legacy intake 分支回队列结果 `started` / `queued`。
 */
const PodGoalCreateStatusSchema = Type.Union([
  Type.Literal('started'),
  Type.Literal('queued'),
  Type.Literal('discussing'),
])

/**
 * `POST /api/pods/:podId/goals`（handler：`routes/pods.ts` 的 goals 分支）。
 *
 * 两个分支共用同一组键，但必填面不同：
 *   - Tech Lead 讨论 Goal（有 `techLead` deps）：带 `podId` / `revision` /
 *     `stage:'discussing'` / `sessionID` / `queueReason:null`，可选 `sourceRef` /
 *     `handoffPath`；
 *   - legacy intake：只有 `{goalId, status, queueReason, goal}`（`status` 是
 *     `enqueue.status`，`queueReason` 是队列原因）。
 * 因此只把两分支都必发的四键声明为 required，其余 optional（不伪造 anyOf）。
 */
export const PodGoalCreateResponse = Type.Object({
  podId: Type.Optional(Type.String({ description: 'Tech Lead / handoff branches only; the legacy intake branch omits it.' })),
  goalId: Type.String(),
  status: PodGoalCreateStatusSchema,
  revision: Type.Optional(Type.Number({ description: 'Tech Lead / handoff branches only (new revision, always 1 on create).' })),
  stage: Type.Optional(Type.Literal('discussing')),
  queueReason: Type.Union([PodQueueReasonSchema, Type.Null()]),
  sessionID: Type.Optional(Type.Union([Type.String(), Type.Null()], {
    description: 'Tech Lead session; null when session provisioning failed (see sessionError).',
  })),
  sourceRef: Type.Optional(GoalSourceRefSchema),
  handoffPath: Type.Optional(Type.String()),
  sessionError: Type.Optional(Type.String()),
  promptError: Type.Optional(Type.String()),
  goal: PodGoalSchema,
})

/**
 * `POST /api/pods/:podId/goals/handoff`（handler：同上 handoff 分支）：
 * 只有 Tech Lead 一条路径（`source: 'lead'`），故 `podId` / `revision` /
 * `stage` / `sessionID` 恒在，`queueReason` 恒为字面量 `null`（`createGoal`
 * 不排队，直接 discussing）。
 */
export const PodGoalHandoffResponse = Type.Object({
  podId: Type.String(),
  goalId: Type.String(),
  status: Type.Literal('discussing'),
  revision: Type.Number(),
  stage: Type.Literal('discussing'),
  queueReason: Type.Null(),
  sessionID: Type.Union([Type.String(), Type.Null()]),
  goal: PodGoalSchema,
  sourceRef: Type.Optional(GoalSourceRefSchema),
  handoffPath: Type.Optional(Type.String()),
  sessionError: Type.Optional(Type.String()),
  promptError: Type.Optional(Type.String()),
})

/**
 * `core/pod/pod-store.ts` `PodGoalRow`：`pod_goals` 表的行（不是 `PodGoalView`）。
 * `pods.goals.cancel`（`PodGoalService.cancelQueued`）与 `pods.goals.list` 的
 * 旧投影共用它——没有 `title` / `phase` / `stage` / `resultReady` / `bucket`。
 */
const PodGoalRowSchema = Type.Object({
  id: Type.String(),
  podId: Type.String(),
  goalId: Type.String(),
  status: PodGoalStatusSchema,
  verdict: Type.Union([PodGoalVerdictSchema, Type.Null()]),
  /** 当前 revision（legacy Goal 恒为 1）。 */
  activeRevision: Type.Number(),
  priority: Type.Number(),
  enqueuedAt: Type.String(),
  startedAt: Type.Union([Type.String(), Type.Null()]),
  endedAt: Type.Union([Type.String(), Type.Null()]),
})

/**
 * `DELETE /api/pods/:podId/goals/:goalId`（handler → `PodGoalService.cancelQueued`，
 * 只有 `queued` 的 Goal 可取消，否则 409）：`{goal}` 是**行**，不是视图。
 */
export const PodGoalCancelResponse = Type.Object({
  goal: PodGoalRowSchema,
})

// ── review items（human-only）─────────────────────────────────────────────

/** `POST /api/pods/:podId/goals/:goalId/review-items`（handler → `PodReviewService.createItems`）。 */
export const PodReviewItemCreateResponse = Type.Object({
  items: Type.Array(PodReviewItemSchema),
})

/** `POST .../review-items/:itemId/resolve`（handler → `PodReviewService.resolve`）。 */
export const PodReviewItemResolveResponse = Type.Object({
  item: PodReviewItemSchema,
})

/** `POST .../review-items/:itemId/reopen`（handler → `PodReviewService.reopen`）。 */
export const PodReviewItemReopenResponse = Type.Object({
  item: PodReviewItemSchema,
})

// ── goal acceptance（human-only）───────────────────────────────────────────

/**
 * `POST /api/pods/:podId/goals/:goalId/accept`（handler → `PodGoalService.acceptResult`）：
 * `PodGoalAcceptResult` 本体——人类验收 = 把 revision worktree 合进 base branch，
 * 回 merge 回执。`forced` / `unresolvedReviewItemIds` 只在带 `force` 且存在未解决
 * review item 时出现。
 */
export const PodGoalAcceptResponse = Type.Object({
  podId: Type.String(),
  goalId: Type.String(),
  revision: Type.Number(),
  branch: Type.String(),
  mergeCommit: Type.String(),
  mergedAt: Type.String(),
  forced: Type.Optional(Type.Boolean()),
  unresolvedReviewItemIds: Type.Optional(Type.Array(Type.String())),
})

// ── memory ─────────────────────────────────────────────────────────────────

/** `POST /api/pods/:podId/memory`（handler → `PodMemoryService.writeMemory`）：回写入的绝对路径。 */
export const PodMemoryWriteResponse = Type.Object({
  path: Type.String(),
})

// ── tech lead / direction / probes / reject ────────────────────────────────

/**
 * `POST /api/pods/:podId/goals/:goalId/tech-lead/messages`（handler：
 * `PodTechLeadService.prompt`）：`PodTechLeadPromptResult`——回实际发给 Tech Lead
 * 的正文（ContextManifest + 用户文本），不是会话历史。
 */
export const PodTechLeadMessageResponse = Type.Object({
  goalId: Type.String(),
  revision: Type.Number(),
  sessionID: Type.String(),
  text: Type.String(),
})

/** `core/goal/direction-decision.ts` `DirectionOption`（append-only 决策快照里的候选项）。 */
const DirectionOptionSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  summary: Type.Union([Type.String(), Type.Null()]),
  risks: Type.Array(Type.String()),
})

/** `DirectionReviewRequest`：一次 needs_user 请求。 */
const DirectionReviewRequestSchema = Type.Object({
  id: Type.String(),
  options: Type.Array(DirectionOptionSchema),
  reason: Type.Union([Type.String(), Type.Null()]),
  requestedAt: Type.String(),
  requestedBy: Type.Union([Type.String(), Type.Null()]),
  revision: Type.Union([Type.Number(), Type.Null()]),
})

/** `DirectionDecision`：一次用户/Lead 的裁定（userWords 逐字保存）。 */
const DirectionDecisionSchema = Type.Object({
  id: Type.String(),
  optionId: Type.Union([Type.String(), Type.Null()]),
  userWords: Type.String(),
  reason: Type.Union([Type.String(), Type.Null()]),
  source: Type.String(),
  revision: Type.Union([Type.Number(), Type.Null()]),
  decidedAt: Type.String(),
  options: Type.Array(DirectionOptionSchema),
})

/** `DirectionState`：单 revision 的方向状态（`direction.json` 的 revisions 值）。 */
const DirectionStateSchema = Type.Object({
  version: Type.Number(),
  goalId: Type.String(),
  revision: Type.Number(),
  status: Type.Union([
    Type.Literal('none'),
    Type.Literal('pending'),
    Type.Literal('decided'),
  ]),
  options: Type.Array(DirectionOptionSchema),
  requests: Type.Array(DirectionReviewRequestSchema),
  decisions: Type.Array(DirectionDecisionSchema),
  updatedAt: Type.Union([Type.String(), Type.Null()]),
})

/**
 * `POST /api/pods/:podId/goals/:goalId/direction-decision`（handler：
 * `routes/pod-collaboration.ts` → `PodDirectionService.request` / `decide` /
 * `markClear`）：`PodDirectionResult` + 规划启动旁账。
 *
 * `needs_user` 分支恒 `planningStarted:false`；`decided` / `clear` 分支尝试
 * `startPlanning`，失败时**不回滚**用户方向，只追加 `planningError`（可观测）。
 */
export const PodGoalDirectionResponse = Type.Object({
  podId: Type.String(),
  goalId: Type.String(),
  revision: Type.Number(),
  revisionStatus: PodGoalRevisionStatusSchema,
  directionStatus: Type.Union([
    Type.Literal('none'),
    Type.Literal('pending'),
    Type.Literal('decided'),
  ]),
  state: DirectionStateSchema,
  decision: Type.Union([DirectionDecisionSchema, Type.Null()]),
  artifactPath: Type.String(),
  planningStarted: Type.Boolean(),
  planningError: Type.Optional(Type.String()),
})

/**
 * `POST /api/pods/:podId/goals/:goalId/probes`（handler → `ProbesService.request` /
 * `requestMany`）：单条与批量都回 `{items}`，条目与 `pods.goals.probes`（GET）同源。
 */
export const PodProbeCreateResponse = PodProbesResponse

/**
 * `POST /api/pods/:podId/goals/:goalId/reject`（handler → `PodGoalService.rejectResult`）：
 * `PodRejectResult`——打回后同一个 Goal 以 revision N+1 重开（`status` 仍由 revision
 * 状态机给出，当前实现恒为 `discussing`）；`previous` 是旧 revision 的收尾结果。
 */
export const PodGoalRejectResponse = Type.Object({
  podId: Type.String(),
  goalId: Type.String(),
  revision: Type.Number(),
  status: PodGoalRevisionStatusSchema,
  priority: Type.Number(),
  feedback: Type.String(),
  archivedState: Type.Union([Type.String(), Type.Null()]),
  previous: Type.Object({
    revision: Type.Number(),
    closed: Type.Boolean(),
    alreadyTerminal: Type.Boolean(),
    missing: Type.Boolean(),
  }),
  sessionID: Type.Union([Type.String(), Type.Null()]),
  sessionError: Type.Optional(Type.String()),
})

// ── pod events（人侧查收）──────────────────────────────────────────────────

/**
 * `POST /api/pods/:podId/events/:id/seen`（handler：`routes/pod-events.ts`
 * `markSeen` → `{ok:true, changed}`）：`changed=false` 表示事件不存在或已是 seen
 * （仍是 200，不是 404）。
 */
export const PodEventSeenResponse = Type.Object({
  ok: Type.Literal(true),
  changed: Type.Boolean(),
})

/**
 * `POST /api/pods/:podId/events/seen`（handler 同上 `markSeenAll`）：
 * `changed` 是本次置为 seen 的条数（goal+revision 范围内幂等）。
 */
export const PodEventSeenAllResponse = Type.Object({
  ok: Type.Literal(true),
  changed: Type.Number(),
})

// ── A2A（协议边界）───────────────────────────────────────────────────────

/**
 * `POST /a2a/pods/:podId`（handler：`routes/pod-a2a.ts` →
 * `PodA2AAgent.handleJsonRpc`，原样透传 status/headers/body）。
 *
 * owner = A2A 协议：200 体是 JSON-RPC 2.0 信封（`{jsonrpc:'2.0', id, result}` 或
 * 流式首帧），字段面随 A2A 方法演进，gateway 只转发不解释，故为开放对象而不是
 * 排除项（仍是 JSON 200 schema）。
 */
export const PodA2AResponse = Type.Object({}, {
  additionalProperties: true,
  description: 'A2A JSON-RPC 2.0 envelope; fields are owned by the A2A protocol and forwarded verbatim.',
})
