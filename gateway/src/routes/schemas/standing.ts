/**
 * E10f-C：Standing goal 读接口（2 ops）的 code-first 响应 schema。
 *
 * 只做 OpenAPI 投影（`RouteDef.response`），不改变 handler wire：
 *   - standingGoals.list → routes/standing-goals.ts `handleListStandingGoals`（`deps.list()`）
 *   - standingGoals.runs → 同文件 `handleListRuns`（`deps.runs(id)`）
 *
 * 形状事实源是 `core/standing/standing-types.ts` 的 `StandingGoal` / `GoalRun`
 * （store 行到该类型的映射在 `core/standing/standing-store.ts`）。两者都是稳定
 * SDK DTO（`StandingGoalView` / `GoalRunView`），等价性由
 * `contract-compat.checks.ts` 的 AssertEq 钉住——字段删/加/可空性漂移会编译失败。
 *
 * 503（layer 关闭）/ 404（goal 不存在）是错误信封，不属于 200 形态。
 */
import { Type } from '@sinclair/typebox'

/** `StandingTriggerType`：cron 由调度器算下次触发，event 由 event layer 触发，manual 只接受人工 run。 */
const StandingTriggerTypeSchema = Type.Union([
  Type.Literal('cron'),
  Type.Literal('event'),
  Type.Literal('manual'),
])

/**
 * `StandingTrigger`：`schedule`/`timezone` 只对 cron 有值，`eventKinds`/`filter`
 * 只对 event 有值；四者都是 optional（store 原样 JSON 解析，缺列即缺键）。
 */
export const StandingTriggerSchema = Type.Object({
  id: Type.String(),
  type: StandingTriggerTypeSchema,
  schedule: Type.Optional(Type.String()),
  timezone: Type.Optional(Type.String()),
  eventKinds: Type.Optional(Type.Array(Type.String())),
  filter: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

/**
 * `StandingTemplate`：Goal 草稿模板。`planReview` 决定计划是否需要人工批准，
 * `acceptance` / `boundaries` 进入 Goal 的验收与边界。
 */
export const StandingTemplateSchema = Type.Object({
  taskType: Type.Optional(Type.Union([
    Type.Literal('feature'),
    Type.Literal('bug'),
    Type.Literal('research'),
    Type.Literal('refactor'),
    Type.Literal('ops'),
  ])),
  acceptance: Type.Optional(Type.Array(Type.String())),
  boundaries: Type.Optional(Type.Array(Type.String())),
  planReview: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('manual')])),
})

/** `StandingBudget`：turns / 单次成本 / 日成本三档预算，单位由键名表达。 */
export const StandingBudgetSchema = Type.Object({
  perRunTurns: Type.Optional(Type.Number()),
  perRunCostUsd: Type.Optional(Type.Number()),
  perDayCostUsd: Type.Optional(Type.Number()),
})

/** `StandingGoal`（`standing-types.ts`）—— 触发、模板、预算与运行状态的持久行投影。 */
export const StandingGoalSchema = Type.Object({
  id: Type.String(),
  projectDir: Type.String(),
  title: Type.String(),
  objective: Type.String(),
  template: StandingTemplateSchema,
  triggers: Type.Array(StandingTriggerSchema),
  state: Type.Union([
    Type.Literal('active'),
    Type.Literal('paused'),
    Type.Literal('stopped'),
  ]),
  /** 状态变更原因（pause/stop 写入）；历史行可能没有该键。 */
  stateReason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  concurrency: Type.Number(),
  cooldownMs: Type.Number(),
  budget: StandingBudgetSchema,
  approval: Type.Union([
    Type.Literal('auto'),
    Type.Literal('plan'),
    Type.Literal('confirm'),
  ]),
  createdBy: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  lastRunAt: Type.Union([Type.String(), Type.Null()]),
  nextRunAt: Type.Union([Type.String(), Type.Null()]),
})

/** `GET /api/standing-goals?projectDir=`。 */
export const StandingGoalListResponse = Type.Object({
  items: Type.Array(StandingGoalSchema),
})

/**
 * `GoalRun`（`standing-types.ts`）—— 一次触发到归档的运行行。
 * `payload` / `result` 归触发源与执行器所有（event payload、执行摘要），
 * 两侧都只声明开放对象（`{ [key: string]: unknown }`）。
 */
export const GoalRunSchema = Type.Object({
  id: Type.String(),
  standingGoalId: Type.String(),
  triggerType: StandingTriggerTypeSchema,
  /** 去重键（event idempotencyKey / cron 时间点 / manual 人工键）。 */
  triggerKey: Type.String(),
  payload: Type.Record(Type.String(), Type.Unknown()),
  status: Type.Union([
    Type.Literal('queued'),
    Type.Literal('triaging'),
    Type.Literal('running'),
    Type.Literal('waiting_person'),
    Type.Literal('done'),
    Type.Literal('failed'),
    Type.Literal('skipped'),
  ]),
  mode: Type.Union([
    Type.Literal('goal'),
    Type.Literal('report'),
    Type.Literal('action'),
    Type.Literal('skip'),
    Type.Null(),
  ]),
  rationale: Type.Union([Type.String(), Type.Null()]),
  goalId: Type.Union([Type.String(), Type.Null()]),
  sessionId: Type.Union([Type.String(), Type.Null()]),
  worktree: Type.Union([Type.String(), Type.Null()]),
  result: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  costUsd: Type.Union([Type.Number(), Type.Null()]),
  tokens: Type.Union([Type.Number(), Type.Null()]),
  startedAt: Type.Union([Type.String(), Type.Null()]),
  endedAt: Type.Union([Type.String(), Type.Null()]),
})

/** `GET /api/standing-goals/:id/runs`。 */
export const StandingGoalRunsResponse = Type.Object({
  items: Type.Array(GoalRunSchema),
})
