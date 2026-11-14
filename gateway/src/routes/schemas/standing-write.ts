/**
 * E10g-W4：standing goal 写接口的请求体 schema（`RouteDef.request`）。
 *
 * 字段面来自 `routes/standing-goals.ts`（`handleCreateStandingGoal` /
 * `handleUpdateStandingGoal`）与 `core/standing/standing-service.ts` 的
 * `create` / `update` + `parseStandingTriggers` / `validateTemplate` /
 * `validateBudget` / `validateApproval`（service 的 400 是条件必填的事实源）。
 *
 * 只有声明，不做运行时校验。trigger / template / budget 直接复用
 * `schemas/standing.ts` 的读侧子 schema（同一个 `StandingGoal` 形状，单一来源）。
 *
 * 分类（与 W2/W3 同口径）：
 *   - `standingGoals.create`：JSON body（`triggers` 非空，否则 400；
 *     `projectDir` 缺省回退 `MAFW_PROJECT_DIR` / cwd，`title` / `objective` 由 service 兜底）；
 *   - `standingGoals.update`：JSON body（PATCH 全字段 optional；空 patch 是 no-op，
 *     与 `pods.tasks.update` 同处理，不伪造「至少一个字段」）。
 *
 * 空对象 + `requestRequired:false`（`EmptyRequest`）：
 *   `standingGoals.pause` / `resume` / `stop` / `run` 与 `goalRuns.approve`
 *   —— handler 的输入只有路径 id；`goalRuns.approve` 虽读 `actorSessionID`，
 *   但该字段携带即 403（human-only 禁止字段，故不声明），SDK 也发空 body。
 */
import { Type } from '@sinclair/typebox'
import { StandingBudgetSchema, StandingTemplateSchema, StandingTriggerSchema } from './standing'

/** `StandingGoal.approval`：`validateApproval` 闭集，缺省 `plan`。 */
const StandingApprovalSchema = Type.Union([
  Type.Literal('auto'),
  Type.Literal('plan'),
  Type.Literal('confirm'),
])

// ── standingGoals.create ──────────────────────────────────────────────────

/**
 * `POST /api/standing-goals`（handler：`routes/standing-goals.ts`）。
 * `triggers` 至少一条且 `id` 唯一、`type` 属于 cron/event/manual（service 400）；
 * cron 需 `schedule` + `timezone`，event 需 `eventKinds`。`concurrency` ≥1、
 * `cooldownMs` ≥0（service 400），`budget` 各档非负。
 */
export const StandingGoalCreateRequest = Type.Object({
  projectDir: Type.Optional(Type.String({
    description: 'Absolute path; absent falls back to MAFW_PROJECT_DIR / cwd (handler projectDirOf).',
  })),
  title: Type.Optional(Type.String({ description: 'Defaults to "Standing Goal" (service).' })),
  objective: Type.Optional(Type.String({ description: 'Defaults to title (service).' })),
  triggers: Type.Array(StandingTriggerSchema, {
    minItems: 1,
    description: 'At least one trigger; parseStandingTriggers 400s on empty arrays or unknown types.',
  }),
  template: Type.Optional(StandingTemplateSchema),
  concurrency: Type.Optional(Type.Number({ minimum: 1, description: 'Clamped/validated by the service (>= 1).' })),
  cooldownMs: Type.Optional(Type.Number({ minimum: 0 })),
  budget: Type.Optional(StandingBudgetSchema),
  approval: Type.Optional(StandingApprovalSchema),
  createdBy: Type.Optional(Type.Union([Type.String(), Type.Null()])),
})

// ── standingGoals.update ──────────────────────────────────────────────────

/**
 * `PATCH /api/standing-goals/:id`（handler：同上，patch 原样进 `service.update`）。
 * 全字段 optional（空 patch = no-op）；stopped 的 standing goal 不可更新（409）；
 * 给出 `triggers` 时同样至少一条（400）。
 */
export const StandingGoalUpdateRequest = Type.Object({
  title: Type.Optional(Type.String()),
  objective: Type.Optional(Type.String()),
  template: Type.Optional(StandingTemplateSchema),
  triggers: Type.Optional(Type.Array(StandingTriggerSchema, { minItems: 1 })),
  concurrency: Type.Optional(Type.Number({ minimum: 1 })),
  cooldownMs: Type.Optional(Type.Number({ minimum: 0 })),
  budget: Type.Optional(StandingBudgetSchema),
  approval: Type.Optional(StandingApprovalSchema),
})
