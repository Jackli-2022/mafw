/**
 * E10g-W5：automation 写接口的请求体 schema（`RouteDef.request`）。
 *
 * 只有声明，不做运行时校验：字段面来自 `routes/automations.ts` 的 handler 读取
 * 与 `src/automation-engine.ts` 的 `validateRule` / `draftRule`（校验通道是
 * **响应**里的 `{valid:false, errors}`，不是 400 —— 见下）。
 *
 * 分类（与 W1-W4 同口径）：
 *   - JSON body（`requestRequired` 缺省 true）：`automations.toggle`、`automations.draft`；
 *   - 空对象 + `requestRequired:false`（`EmptyRequest`，见 `schemas/session-write.ts`）：
 *     `automations.remove` 的 handler 只读路径 id。
 */
import { Type } from '@sinclair/typebox'

// ── automations.toggle ────────────────────────────────────────────────────

/**
 * `PUT /api/automations/:id`（handler：`routes/automations.ts`）。
 * body 必须是合法 JSON（否则 400），`enabled` 是真值判定：`toggleRule(id, enabled)`
 * 原样落盘（true 注册调度，false 停掉 job）。
 *
 * handler 在 `enabled` 缺失时**不 400**，会把 `undefined` 写进规则文件（等于关闭），
 * 因此这里按「PUT 的目标状态」声明为必填 —— 声明意图，不改变 handler 行为。
 */
export const AutomationToggleRequest = Type.Object({
  enabled: Type.Boolean({
    description: 'Target enabled state; persisted verbatim by toggleRule (missing value is stored as unset).',
  }),
})

// ── automations.draft ─────────────────────────────────────────────────────

/**
 * cron / event 触发面。handler 先读 `body.trigger || {}`，再按 `trigger.type === 'event'`
 * 二分：命中 event 分支，否则一律走 cron 分支并补 `schedule: trigger.schedule || ''`、
 * `timezone: trigger.timezone || 'UTC'`。因此 `type` 缺省视为 cron，cron/event 字段
 * 不能做成判别联合（会把缺省 type 的合法调用判成非法）。
 */
const AutomationDraftTrigger = Type.Object({
  type: Type.Optional(Type.Union([Type.Literal('cron'), Type.Literal('event')], {
    description: "Absent → cron (handler's else branch).",
  })),
  schedule: Type.Optional(Type.String({
    description: 'Cron expression; required when type is cron/absent (validateRule error otherwise).',
  })),
  timezone: Type.Optional(Type.String({ description: "IANA name; defaults to 'UTC'." })),
  on: Type.Optional(Type.Array(Type.String(), {
    description: 'Event kinds to subscribe; required (non-empty) when type is event.',
  })),
  perGoalCooldown: Type.Optional(Type.String({
    description: 'Per-goal debounce window (e.g. 60s/5m); defaults to 5m, must match /^\\d+(s|m|h)$/.',
  })),
})

/**
 * `POST /api/automations/draft`（handler 同上 → `draftRule`）。
 *
 * **校验通道是响应**：`draftRule` → `validateRule` 在字段缺失/非法时返回
 * `200 {id, valid:false, errors:[…]}`（不落盘），只有非法 JSON 才 400。因此
 * `id` / `trigger` 之外的字段一律 optional，条件必填写在 description 里；
 * 不把 `skill`/`action` 的「至少一个」伪造成 oneOf（validateRule 的措辞才是事实源）。
 * 草稿恒为 disabled（`enabled:false` 由 handler 写死，客户端传了也不读）。
 */
export const AutomationDraftRequest = Type.Object({
  id: Type.String({
    minLength: 1,
    description: 'Rule id; draftRule always returns valid:false without it (200, not 400).',
  }),
  trigger: AutomationDraftTrigger,
  skill: Type.Optional(Type.String({ description: 'Skill to run; at least one of skill/action is required by validateRule.' })),
  args: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
    description: 'Skill / action input, owner: the action handler.',
  })),
  action: Type.Optional(Type.Object({
    type: Type.String({ minLength: 1, description: 'Builtin action type or a plugin-center registered external action.' }),
  }, {
    additionalProperties: true,
    description: 'External action payload; unresolved action types fail validateRule.',
  })),
  onResult: Type.Optional(Type.Object({
    type: Type.Union([Type.Literal('triage'), Type.Literal('goal')]),
    auto_confirm: Type.Optional(Type.Boolean()),
    template: Type.Optional(Type.String()),
  })),
  goal_defaults: Type.Optional(Type.Object({
    maxLoops: Type.Optional(Type.Number()),
    metrics: Type.Optional(Type.Record(
      Type.String(),
      Type.Object({ target: Type.Number(), unit: Type.String() }),
    )),
  })),
})

// ── automations.remove ────────────────────────────────────────────────────

// `automations.remove` 用 `EmptyRequest` + `requestRequired:false`：
// `DELETE /api/automations/:id` 的 handler 只读路径 id（`deleteRule(id)`），body 不读。
