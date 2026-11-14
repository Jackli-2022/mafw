/**
 * E10h-R4：triage 域写接口（4 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/triage-dismiss.ts`（triage.dismiss）
 *   - `routes/triage.ts`（triage.confirm / triage.reject / triage.propose）
 *
 * 这一域的 200 **大量是「未命中也是 200」**的形状：dismiss / reject 把
 * `rejectTriage()` 的布尔结果折成 `not_found` 字符串，confirm 只在真找不到
 * （404）或状态不是 PENDING_CONFIRMATION（400）时失败。因此状态字段必须是
 * 联合而不是字面量 `'dismissed'`。
 *
 * 不返回 `TriageItem` 实体：confirm/reject/dismiss 都不回显更新后的条目
 * （客户端刷新 `GET /api/triage`），故不复用 `TriageItemSchema`。
 */
import { Type } from '@sinclair/typebox'

// ── triage.dismiss ──────────────────────────────────────────────────────────

/**
 * `POST /api/triage/:id/dismiss`（handler：`handleTriageDismiss`，语义 = reject，
 * 仅账本 reason 区分 `triage_dismissed`）：`{status: 'dismissed' | 'not_found'}`，
 * 两者都是 200。
 */
export const TriageDismissResponse = Type.Object({
  status: Type.Union([Type.Literal('dismissed'), Type.Literal('not_found')]),
})

// ── triage.confirm ──────────────────────────────────────────────────────────

/** skill 物化分支：安装 skill（`installSkillDraft` 回 `{installed: name}`，不建 goal）。 */
const TriageConfirmInstalledResponse = Type.Object({
  status: Type.Literal('confirmed'),
  installed: Type.String(),
})

/** 公理草稿分支：逐 candidate 经 L5 commit，`axioms` 是成功条数（不建 goal）。 */
const TriageConfirmAxiomsResponse = Type.Object({
  status: Type.Literal('confirmed'),
  axioms: Type.Number(),
})

/** 默认分支：写 `~/.mafw/requests/<goalId>.json`，`goalId` 是 `confirmed-<automationId>-<ts>`。 */
const TriageConfirmGoalResponse = Type.Object({
  status: Type.Literal('confirmed'),
  goalId: Type.String(),
})

/**
 * `POST /api/triage/:id/confirm`（handler：`triage.confirm`）。
 * 三条成功分支的 body 互不相同（`installed` / `axioms` / `goalId` 三选一），
 * 共同点只有 `status:'confirmed'`——按判别联合建模，而不是把三个键都设成 optional
 * （那会合法化 handler 永远不会发的组合）。
 */
export const TriageConfirmResponse = Type.Union([
  TriageConfirmInstalledResponse,
  TriageConfirmAxiomsResponse,
  TriageConfirmGoalResponse,
])

// ── triage.reject ───────────────────────────────────────────────────────────

/** `POST /api/triage/:id/reject`（handler：`triage.reject`）：`{status:'rejected'|'not_found'}`，两者都是 200。 */
export const TriageRejectResponse = Type.Object({
  status: Type.Union([Type.Literal('rejected'), Type.Literal('not_found')]),
})

// ── triage.propose ──────────────────────────────────────────────────────────

/**
 * `POST /api/triage/:id/propose`（handler：`triage.propose` →
 * `AutomationEngine.proposeTriageDecision`）：`{success, message}` 原样回显。
 * 条目不存 / 不在 PENDING 时是 `success:false` 的 200（只有引擎缺失才 404），
 * 所以 `success` 不能缩成 `true`；`message` 两分支都写，故必填。
 */
export const TriageProposeResponse = Type.Object({
  success: Type.Boolean(),
  message: Type.String(),
})
