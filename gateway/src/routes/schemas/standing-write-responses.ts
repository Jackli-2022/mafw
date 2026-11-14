/**
 * E10h-R3：standing goal 写接口（7 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 * `routes/standing-goals.ts` 的 `handleCreateStandingGoal` / `handleUpdateStandingGoal` /
 * `handlePause|Resume|StopStandingGoal` / `handleRunStandingGoal` / `handleApproveRun`。
 * 六个生命周期动作都回 `{goal}`，run / approve 回 `{run}`——实体本身直接复用
 * `schemas/standing.ts` 的读侧 `StandingGoalSchema` / `GoalRunSchema`（同一 store 行投影）。
 *
 * 503（layer 关闭）/ 404 / 409（run 未被接纳、非 waiting_person）是错误信封，
 * 不属于 200 形态。
 */
import { Type } from '@sinclair/typebox'
import { GoalRunSchema, StandingGoalSchema } from './standing'

/**
 * `POST /api/standing-goals`（create）、`PATCH /api/standing-goals/:id`（update）、
 * `POST /api/standing-goals/:id/{pause,resume,stop}`：handler 一律回
 * `{goal: service.update|setState(...)}`——即 `standingGoals.list` 的 item 同形。
 */
export const StandingGoalResponse = Type.Object({
  goal: StandingGoalSchema,
})

/**
 * `POST /api/standing-goals/:id/run` 与 `POST /api/goal-runs/:id/approve`：
 * `{run}`。run 未被接纳（冷却/并发）是 409，approve 只接受 `waiting_person` 的 run
 * （否则 409），故 200 一定是真实 run 行。
 */
export const StandingGoalRunResponse = Type.Object({
  run: GoalRunSchema,
})
