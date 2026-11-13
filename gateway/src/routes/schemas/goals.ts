/**
 * E10b-1：Goal 读接口（5 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状；
 * `emit:openapi` 直接投影成 `responses.200.content['application/json'].schema`。
 * 形状来源（handler 是事实源）：
 *   - goals.list     → routes/dashboard.ts `goals.list`（activeGoals 投影）
 *   - goals.sessions → routes/goal-sessions.ts `handleGoalSessions`（goal_sessions 行 + 富化）
 *   - goals.plan     → routes/goal-plan.ts `handleGoalPlan` GET（PlanPackage + 内容哈希）
 *   - goals.timeline → routes/goal-timeline.ts `handleGoalTimeline`（state ⋈ goal_node_runs）
 *   - goals.source   → kernel.ts `goalSource()`（handoff provenance + 全文）
 *
 * 与 `@mafw/sdk` DTO 的等价性由 `contract-compat.checks.ts` 的编译期 AssertEq 钉住
 * （Goal / GoalSessionInfo / GoalPlanInfo / GoalTimeline / GoalNodeRunInfo / GoalSourceRef）。
 *
 * 关于 goals.list：`dashboard.ts` 的列表投影**不带** `currentWave` / `totalWaves`
 * （activeGoals 行只映射 goalId/phase/loop/nextAction/error/updatedAt），而
 * `goals.get` 的 `projectGoalView` 恒补齐这两个计数。同一个 `Goal` DTO 服务两个 op，
 * 因此计数在契约面是 optional（E10b-1 以 handler 为准的调整）。
 */
import { Type } from '@sinclair/typebox'

/** 与 `@mafw/sdk` `GoalSourceRef` 逐字段等价（pods.goals 的 sourceRef 同源）。 */
export const GoalSourceRefSchema = Type.Object({
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

/**
 * 计划审阅状态（`core/goal/state-v3.ts` `GoalStateV3.planApproval`）：
 * `id` / `feedback` / `decidedAt` 仅特定阶段出现；`revision` / `planHash` / `evalHash`
 * 是 Task 13 的内容绑定，legacy 记录可能缺失。
 */
export const GoalPlanApprovalSchema = Type.Object({
  id: Type.Optional(Type.String()),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('approved'),
    Type.Literal('rejected'),
  ]),
  feedback: Type.Optional(Type.String()),
  decidedAt: Type.Optional(Type.String()),
  round: Type.Number(),
  revision: Type.Optional(Type.Number()),
  planHash: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  evalHash: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

// ── goals.list ──────────────────────────────────────────────────────────────

/**
 * `GET /api/goals` → `{ goals }`。列表投影不带波次计数（见文件头说明），
 * `nextAction` 在状态缺失时被 handler 省略，`error` 恒为 `string | null`。
 */
const GoalSummarySchema = Type.Object({
  goalId: Type.String(),
  phase: Type.Union([Type.String(), Type.Null()]),
  loop: Type.Number(),
  currentWave: Type.Optional(Type.Number()),
  totalWaves: Type.Optional(Type.Number()),
  nextAction: Type.Optional(Type.String()),
  error: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.Union([Type.String(), Type.Null()]),
})

export const GoalListResponse = Type.Object({
  goals: Type.Array(GoalSummarySchema),
})

// ── goals.sessions ──────────────────────────────────────────────────────────

/**
 * `GET /api/goals/:id/sessions` → `{ sessions }`。行来自 `goal_sessions` 表
 * （sessionID/phase/loop 恒有）；`title` 与 `time` 是 runtime `session.get` 富化的
 * fail-open 字段——`time` 归 runtime 所有（opencode `{created, updated}`），
 * gateway 只原样透传，故按 SDK `GoalSessionInfo` 承诺的 created/updated 建模。
 */
export const GoalSessionsResponse = Type.Object({
  sessions: Type.Array(Type.Object({
    sessionID: Type.String(),
    phase: Type.String(),
    loop: Type.Number(),
    title: Type.Optional(Type.String()),
    time: Type.Optional(Type.Object({
      created: Type.Optional(Type.Number()),
      updated: Type.Optional(Type.Number()),
    })),
  })),
})

// ── goals.plan ──────────────────────────────────────────────────────────────

/**
 * 边界形状：`waves` 是 goal driver / plan skill 写入的 wave-plan 原子文
 * （`readFileSync(wavesPath)` 原样透传）。owner = goal-plan protocol artifact：
 * gateway 只校验「数组 + 每波有 id」并计算 `planHash`，任务字段随 driver 版本演进，
 * 不做静态建模。文件缺失/损坏时 handler 回 `null`。
 */
const PlanWavesBoundary = Type.Array(Type.Object({
  id: Type.String(),
}, { additionalProperties: true }))

/** Goal Eval 单条条件（`core/goal/goal-eval.ts` `validateGoalEval` 的规范化输出）。 */
const GoalEvalConditionSchema = Type.Object({
  id: Type.String(),
  statement: Type.String(),
  required: Type.Boolean(),
  evidence: Type.String(),
  method: Type.String(),
})

const GoalEvalMappingEntrySchema = Type.Object({
  tasks: Type.Optional(Type.Array(Type.String())),
  probes: Type.Optional(Type.Array(Type.String())),
  artifacts: Type.Optional(Type.Array(Type.String())),
})

/** `validateGoalEval()` 的产出：读取路径上无效文档降级为 `goalEval: null` + `goalEvalError`。 */
const GoalEvalSchema = Type.Object({
  outcome: Type.String(),
  conditions: Type.Array(GoalEvalConditionSchema),
  failureConditions: Type.Array(Type.String()),
  constraints: Type.Array(Type.String()),
  nonGoals: Type.Array(Type.String()),
  mapping: Type.Record(Type.String(), GoalEvalMappingEntrySchema),
})

/**
 * `GET /api/goals/:id/plan` → PlanPackage 读取视图。
 * `planHash` / `evalHash` 只在对应内容可读时计算（否则 null）；`stale` = 已批准内容
 * 与当前内容不一致（客户端据此判断「我看到的这一版」是否还能批准）。
 */
export const GoalPlanResponse = Type.Object({
  planReview: Type.Union([Type.Literal('auto'), Type.Literal('manual')]),
  planApproval: Type.Union([GoalPlanApprovalSchema, Type.Null()]),
  planFeedback: Type.Union([Type.String(), Type.Null()]),
  round: Type.Number(),
  revision: Type.Number(),
  waves: Type.Union([PlanWavesBoundary, Type.Null()]),
  wavePlanPath: Type.Union([Type.String(), Type.Null()]),
  wavesPath: Type.String(),
  goalEval: Type.Union([GoalEvalSchema, Type.Null()]),
  goalEvalPath: Type.Union([Type.String(), Type.Null()]),
  goalEvalError: Type.Union([Type.String(), Type.Null()]),
  planHash: Type.Union([Type.String(), Type.Null()]),
  evalHash: Type.Union([Type.String(), Type.Null()]),
  stale: Type.Boolean(),
})

// ── goals.timeline ──────────────────────────────────────────────────────────

/** 节点执行行（`goal_node_runs` ⋈ NodeRunRow，handler 已转 camelCase 并补 durationMs）。 */
const GoalNodeRunSchema = Type.Object({
  runId: Type.Number(),
  loop: Type.Number(),
  node: Type.String(),
  attempt: Type.Number(),
  status: Type.String(),
  sessionId: Type.Union([Type.String(), Type.Null()]),
  startedAt: Type.String(),
  finishedAt: Type.Union([Type.String(), Type.Null()]),
  durationMs: Type.Union([Type.Number(), Type.Null()]),
  outcome: Type.Union([Type.String(), Type.Null()]),
  error: Type.Union([Type.String(), Type.Null()]),
  tokensInput: Type.Union([Type.Number(), Type.Null()]),
  tokensOutput: Type.Union([Type.Number(), Type.Null()]),
  costUsd: Type.Union([Type.Number(), Type.Null()]),
})

/**
 * `GET /api/goals/:id/timeline` → 时间线聚合。
 * `artifacts.receipts` 是 execute 节点的 outcome 原值（未产出回执时为 `null`）。
 * `outcome` 是 goal_outcomes 行（owner = goal driver archive：DB 投影，每次
 * `getGoalOutcome()` 原样下发），未归档时 handler 省略整个字段。
 */
export const GoalTimelineResponse = Type.Object({
  goal: Type.Object({
    goalId: Type.String(),
    title: Type.String(),
    phase: Type.String(),
    round: Type.Number(),
    maxRounds: Type.Number(),
    verdict: Type.Union([Type.String(), Type.Null()]),
    nextNode: Type.String(),
    nextAction: Type.String(),
    lastError: Type.Union([Type.String(), Type.Null()]),
    updatedAt: Type.String(),
    planReview: Type.Union([Type.Literal('auto'), Type.Literal('manual')]),
    planApproval: Type.Union([GoalPlanApprovalSchema, Type.Null()]),
  }),
  nodes: Type.Array(GoalNodeRunSchema),
  artifacts: Type.Object({
    wavesPath: Type.String(),
    receipts: Type.Array(Type.Union([Type.String(), Type.Null()])),
    reviewsDir: Type.String(),
  }),
  outcome: Type.Optional(Type.Unknown()),
})

// ── goals.source ────────────────────────────────────────────────────────────

/**
 * `GET /api/goals/:id/source` → handoff provenance + 全文。
 * `sourceRef` 由 `pods.ts` 的 `normalizeGoalSourceRef` 在创建 goal 时写入；
 * `handoffPath` / `fullText` 只在 lead-handoff.md 实际存在时非 null。
 */
export const GoalSourceResponse = Type.Object({
  sourceRef: Type.Union([GoalSourceRefSchema, Type.Null()]),
  handoffPath: Type.Union([Type.String(), Type.Null()]),
  fullText: Type.Union([Type.String(), Type.Null()]),
})
