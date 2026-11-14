/**
 * E10h-R3：goal 域写接口（11 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/goal-plan.ts`（plan-approval）
 *   - `routes/goal-control.ts` → `core/goal/control-command.ts`（pause/resume/stop/retry、
 *     control / controlLegacy）
 *   - `routes/goals-inline.ts`（respondQuestion / validate / complete）
 *   - `routes/goal-node-retry.ts`（retryNode）
 *
 * 这一批 200 全是**常量回执**（`{status:'paused'}` / `{success:true}` / `{status:'ok'}`），
 * 没有实体；因此用 `Type.Literal` 精确到 handler 唯一会写出的值，而不是把 SDK
 * 的宽类型（`{status:string}`、`{success:boolean}`）搬进契约：
 *   - 这些宽类型是客户端 hand-written DTO，比 wire 更松（见 `R3-report.md` 的 concerns）；
 *   - 放宽会让「handler 只发一个值」这条事实在契约里消失。
 *
 * 错误体（400/404/409/500，含 `stale_plan` 三元组）不属于 200 形态，不在此建模。
 */
import { Type } from '@sinclair/typebox'

// ── plan approval ───────────────────────────────────────────────────────────

/**
 * `POST /api/goals/:id/plan-approval`（handler：`handleGoalPlan` POST 分支）。
 * 批准与驳回**两条**成功路径都逐字 `json(res, 200, { success: true })`；
 * stale 计划 / 非 pending 状态是 409，不进 200。
 */
export const GoalPlanApprovalResponse = Type.Object({
  success: Type.Literal(true),
})

// ── pause / resume / stop / retry ───────────────────────────────────────────

/**
 * `POST /api/goals/:id/pause`（handler：`handleGoalControl` 的 pause 分支）。
 * `deps.pause` 之后立即回 `{status:'paused'}`——不读回 Goal 状态。
 */
export const GoalPauseResponse = Type.Object({
  status: Type.Literal('paused'),
})

/** `POST /api/goals/:id/resume`（同上 resume 分支 → `{status:'resumed'}`）。 */
export const GoalResumeResponse = Type.Object({
  status: Type.Literal('resumed'),
})

/**
 * `POST /api/goals/:id/stop`（同上 stop 分支）：销毁会话 → 状态落 FAILED →
 * 归档 CANCELLED，然后回 `{status:'stopped'}`。
 */
export const GoalStopResponse = Type.Object({
  status: Type.Literal('stopped'),
})

/**
 * `POST /api/goals/:id/retry`（同上 retry 分支）：`selectRetryRun` 选中失败 run 后
 * 重跑并回 `{status:'retried'}`；无可重试 run 是 409。
 */
export const GoalRetryResponse = Type.Object({
  status: Type.Literal('retried'),
})

// ── node retry ──────────────────────────────────────────────────────────────

/**
 * `POST /api/goals/:id/nodes/:runId/retry`（handler：`handleNodeRetry`）：
 * `{success:true, runId}`——`runId` 是 `retryNodeRun()` 返回的新 run id（可能与
 * 路径里的 runId 不同，故按服务返回值声明 number）。
 */
export const GoalRetryNodeResponse = Type.Object({
  success: Type.Literal(true),
  runId: Type.Number(),
})

// ── respondQuestion ─────────────────────────────────────────────────────────

/**
 * `POST /api/goals/:goalId/questions/:questionId/respond`（handler：
 * `routes/goals-inline.ts`）：回答与取消都回 `{status:'accepted'}`，
 * 只有取消分支追加 `action:'cancelled'`（回答分支没有该键）。
 */
export const GoalRespondQuestionResponse = Type.Object({
  status: Type.Literal('accepted'),
  action: Type.Optional(Type.Literal('cancelled')),
})

// ── validate / complete ─────────────────────────────────────────────────────

/**
 * `POST /api/work/:goalId/validate`（handler：kernel `handleValidate`）：
 * `{success:true, goalId, nextAction:'GRAPH_INVOKED'}`——启动是 `setImmediate`
 * 异步的，200 只表示「已排队」。
 */
export const GoalValidateResponse = Type.Object({
  success: Type.Literal(true),
  goalId: Type.String(),
  nextAction: Type.Literal('GRAPH_INVOKED'),
})

/**
 * `POST /api/work/:goalId/complete`（handler：kernel `handleComplete`）：
 * `{success:true, nextAction:'SCHEDULED'}`——`score` 不被读取，也不回写。
 */
export const GoalCompleteResponse = Type.Object({
  success: Type.Literal(true),
  nextAction: Type.Literal('SCHEDULED'),
})

// ── control / controlLegacy ─────────────────────────────────────────────────

/**
 * `POST /api/goals/control` 与 `POST /control`（handler：
 * `core/goal/control-command.ts` `handleGoalControlCommand`）：**所有**动作
 * （PAUSE / ABORT / FORCE_PHASE / RESET_PARAMETRIC，含未知/缺失动作）都回
 * `{status:'ok'}`——历史 fail-open 形状，200 不代表动作命中。
 */
export const GoalControlResponse = Type.Object({
  status: Type.Literal('ok'),
})
