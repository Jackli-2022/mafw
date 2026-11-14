/**
 * E10g-W4：goal 写接口的请求体 schema（`RouteDef.request`）。
 *
 * 只有声明，不做运行时校验：字段面逐项来自 handler 的实际读取
 * （`routes/goal-plan.ts`、`routes/goal-control.ts`、`core/goal/control-command.ts`、
 * `routes/goals-inline.ts`、`routes/goal-node-retry.ts`）。条件必填 / 条件生效用
 * description 说明，不伪造 oneOf/anyOf 把契约做得比 handler 更严。
 *
 * 分类（与 W2/W3 同口径）：
 *   - JSON body（`requestRequired` 缺省 true）：body 是动作的输入；
 *   - 可选 body（有字段 + `requestRequired:false`）：字段只是补充信息或门禁，
 *     handler 在缺省 body 下仍能完成动作（`goals.retry` 选最近失败 run、
 *     `goals.retryNode` 的 `confirm` 只在 execute 节点需要、`goals.validate` 的
 *     `projectDir` 只是提示）；
 *   - 空对象 + `requestRequired:false`（`EmptyRequest`，见下）：
 *     `goals.pause` / `goals.resume` / `goals.stop` / `goals.complete` 的 handler
 *     完全不读 body（四个 control 动作共用一个 handler，`runId` 只被 retry 使用；
 *     complete 的 `score` 在 kernel `handleComplete` 里未被读取）。
 *
 * 人审路由（`goals.planApproval` / `goals.respondQuestion`）由 `requireHumanPrincipal`
 * 在 handler 里用凭据判定；actor 类字段不放宽也不声明为必填（本批两个 body 都不读 actor）。
 */
import { Type } from '@sinclair/typebox'

// ── goals.planApproval ────────────────────────────────────────────────────

/**
 * `POST /api/goals/:id/plan-approval`（handler：`routes/goal-plan.ts` POST 分支）。
 * 批准绑定内容哈希：`planHash` / `evalHash` 与当前计划不一致 → 409 `stale_plan`；
 * `approvalId` 必须等于 pending 批准记录的 id（缺失/过期 → 409）。
 * 驳回（`approve` 非 true）时 `feedback` 必须非空（否则 400）。
 */
export const GoalPlanApprovalRequest = Type.Object({
  approve: Type.Optional(Type.Boolean({
    description: 'true approves; false/absent rejects, and feedback is then required (handler 400).',
  })),
  feedback: Type.Optional(Type.String({ description: 'Rejection reason; required when approve is not true.' })),
  approvalId: Type.Optional(Type.String({ description: 'Must equal the pending approval id; missing/stale → 409.' })),
  planHash: Type.Optional(Type.String({ description: 'Declared plan-content hash; mismatch → 409 stale_plan.' })),
  evalHash: Type.Optional(Type.String({ description: 'Declared Goal Eval hash; mismatch → 409 stale_plan.' })),
})

// ── goals.pause / resume / stop (+ complete) ──────────────────────────────

// `goals.pause` / `goals.resume` / `goals.stop` 用 `EmptyRequest` + `requestRequired:false`：
// `attachGoalControlRoutes` 会读 body 只为取 `runId`，而 `handleGoalControl` 的
// pause/resume/stop 分支完全不使用它（只有 retry 用）。`goals.complete` 同理：
// kernel `handleComplete(goalId, data)` 忽略 `score`。使用方见 `route-catalog.ts`。

// ── goals.retry ───────────────────────────────────────────────────────────

/**
 * `POST /api/goals/:id/retry`（handler：`routes/goal-control.ts` → kernel
 * `retryGoalControl` → `selectRetryRun`）。`runId` 缺省 = 当前 revision 里最近一次
 * 失败 run；显式指定时必须属于当前 revision 且状态可重试，否则 404/409。
 */
export const GoalRetryRequest = Type.Object({
  runId: Type.Optional(Type.Integer({
    minimum: 1,
    description: 'Failed node run to replay; absent = latest failed run in the active revision.',
  })),
})

// ── goals.retryNode ───────────────────────────────────────────────────────

/**
 * `POST /api/goals/:id/nodes/:runId/retry`（handler：`routes/goal-node-retry.ts`）。
 * execute 节点会再次执行写操作 → 必须 `confirm:true`（否则 409）；
 * 其他节点重跑无需 body。
 */
export const GoalRetryNodeRequest = Type.Object({
  confirm: Type.Optional(Type.Boolean({
    description: 'Required (true) when the node is execute; other nodes can retry without a body.',
  })),
})

// ── goals.respondQuestion ─────────────────────────────────────────────────

/**
 * `POST /api/goals/:goalId/questions/:questionId/respond`（handler：
 * `routes/goals-inline.ts`）。`type:'cancel'` 取消（只写 ledger + archive_fail），
 * 其余类型按 answer 处理并读取 `answer`（是 `answer` 时必填，否则空答）。
 * 只有 pending 问题可回答（已答/已取消 → 409）。
 */
export const GoalRespondQuestionRequest = Type.Object({
  type: Type.Union([Type.Literal('answer'), Type.Literal('cancel')], {
    description: 'cancel abandons the question; answer (or any other value) forwards `answer` to the driver.',
  }),
  answer: Type.Optional(Type.String({ description: 'Required when type is answer.' })),
})

// ── goals.validate ────────────────────────────────────────────────────────

/**
 * `POST /api/work/:goalId/validate`（handler：`routes/goals-inline.ts` → kernel
 * `handleValidate`）。body 可缺省；`projectDir` 只是启动时的项目定位提示
 * （缺省走 resolveGoalProject）。
 */
export const GoalValidateRequest = Type.Object({
  projectDir: Type.Optional(Type.String({ description: 'Project hint for goal start; absent = resolve from the goal row.' })),
})

// ── goals.control / goals.controlLegacy ───────────────────────────────────

/**
 * `POST /api/goals/control` 与 `POST /control`（handler：`routes/goal-control.ts`
 * → `core/goal/control-command.ts` 的 `handleGoalControlCommand`）。
 *
 * 大写动作族与 SDK `GoalControlAction` 一致：`PAUSE` / `ABORT` / `FORCE_PHASE` /
 * `RESET_PARAMETRIC`。`goalId` 在 `RESET_PARAMETRIC` 下不被读取；`targetPhase`
 * 只对 `FORCE_PHASE` 生效。
 *
 * handler 是历史 fail-open 形状（动作/参数缺失或未知仍返回 200 `{status:'ok'}`）；
 * 契约按 SDK 的文档化命令集声明 `action`，不把 fail-open 当成「任意 body」。
 */
export const GoalControlRequest = Type.Object({
  action: Type.Union([
    Type.Literal('PAUSE'),
    Type.Literal('ABORT'),
    Type.Literal('FORCE_PHASE'),
    Type.Literal('RESET_PARAMETRIC'),
  ]),
  goalId: Type.Optional(Type.String({ description: 'Target goal; not read for RESET_PARAMETRIC.' })),
  targetPhase: Type.Optional(Type.String({ description: 'Only FORCE_PHASE: next phase name (upper-cased by the handler).' })),
})
