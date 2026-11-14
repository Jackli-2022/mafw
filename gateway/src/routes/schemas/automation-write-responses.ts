/**
 * E10h-R4：automation 域写接口（3 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 * `routes/automations.ts`（draft / toggle / remove 三个写臂）。
 *
 * 规则本体不在这里复用 `AutomationRuleSchema`（见 `schemas/automations.ts`）：
 * 三个写臂都不回显规则行——toggle/remove 只回状态字符串，draft 只回校验结果。
 * `automations.draft` 的 200 也覆盖 `valid:false`（校验失败仍是 200，规则未落盘）。
 */
import { Type } from '@sinclair/typebox'

// ── automations.toggle ──────────────────────────────────────────────────────

/**
 * `PUT /api/automations/:id`（handler：`automations.toggle`）：`toggleRule()` 的
 * 布尔结果映射成 `toggled` / `not_found`——**找不到规则也回 200**（不会 404），
 * `enabled` 是请求里回显的目标状态，不是读回的真实状态。
 */
export const AutomationToggleResponse = Type.Object({
  status: Type.Union([Type.Literal('toggled'), Type.Literal('not_found')]),
  enabled: Type.Boolean(),
})

// ── automations.remove ──────────────────────────────────────────────────────

/** `DELETE /api/automations/:id`（同上 remove 臂）：`deleteRule()` → `deleted` / `not_found`，两者都是 200。 */
export const AutomationRemoveResponse = Type.Object({
  status: Type.Union([Type.Literal('deleted'), Type.Literal('not_found')]),
})

// ── automations.draft ───────────────────────────────────────────────────────

/**
 * `POST /api/automations/draft`（同上 draft 臂 → `AutomationEngine.draftRule`）：
 * `{id, valid, errors}`——`errors` 恒存在（空数组表示通过），`id` 是请求里的 id
 * （校验失败时规则不落盘，但 id 仍回显）。
 */
export const AutomationDraftResponse = Type.Object({
  id: Type.String(),
  valid: Type.Boolean(),
  errors: Type.Array(Type.String()),
})
