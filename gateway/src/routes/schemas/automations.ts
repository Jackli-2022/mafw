/**
 * E10f-C：Automation 读接口（3 ops）的 code-first 响应 schema。
 *
 * 只做 OpenAPI 投影（`RouteDef.response`），不改变 handler wire：
 *   - automations.list    → routes/automations.ts `getRules()` + `getNextTriggers()` +
 *                           `ledger.getHistory(id, 3)` 的 `{rules}` 信封
 *   - automations.get     → 同文件 `getRule(id)` 的 spread + `{nextTriggers, history}`
 *   - automations.history → 同文件 `getHistory(id, limit)` 的 `{history}`
 *
 * 规则本体的事实源是 `src/automation-engine.ts` 的 `AutomationRule`（磁盘
 * `~/.mafw/automations/*.json` 原样解析），账本行是 `src/ledger.ts` 的 `LedgerEntry`。
 *
 * `automations.list` 从 `contract/overrides.json` 迁移为 code-first：旧 override 只描述
 * `{id, enabled, name?, trigger?{schedule,timezone}, action?{type}}`，与 handler 的
 * `spread rule + nextTriggers + recentHistory` 不一致（`trigger` 必填且是
 * cron/event 判别联合，`name` 无任何 writer）——这里以 handler 为准，并同步修正
 * SDK `AutomationRule` DTO（等价性由 `contract-compat.checks.ts` 的 AssertEq 钉住）。
 *
 * `automations.get` / `automations.history` 是 internal 读面（SDK 不调用），
 * 但 get 的规则段与 list 共享同一 `AutomationRuleSchema`，故一并加 AssertEq。
 */
import { Type } from '@sinclair/typebox'

/**
 * `automation-engine.ts` `Trigger`：
 *   - cron：`schedule` 是 5/6 段 cron 表达式，`timezone` 是 IANA 名
 *   - event：`on` 是订阅的事件 kind 列表，`perGoalCooldown` 是每 goal 去抖窗口
 */
const AutomationCronTriggerSchema = Type.Object({
  type: Type.Literal('cron'),
  schedule: Type.String(),
  timezone: Type.String(),
})

const AutomationEventTriggerSchema = Type.Object({
  type: Type.Literal('event'),
  on: Type.Array(Type.String()),
  perGoalCooldown: Type.String(),
})

const AutomationTriggerSchema = Type.Union([
  AutomationCronTriggerSchema,
  AutomationEventTriggerSchema,
])

/**
 * `AutomationRule`（`automation-engine.ts`）本体。
 * `args` / `action.type` 归 action handler 与插件中心所有（开放键集），
 * `goal_defaults.metrics` 的 value 形状由 Goal eval 读取。
 */
export const AutomationRuleSchema = Type.Object({
  id: Type.String(),
  enabled: Type.Boolean(),
  trigger: AutomationTriggerSchema,
  /** 执行时注入的 skill 名（draft 里可选）。 */
  skill: Type.Optional(Type.String()),
  /** skill / action 的入参（owner: 各 action handler）。 */
  args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  /** 执行结果的落地方式：triage 进人工确认队列，goal 直接起 Goal。 */
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
  /** 外部 action 标识（插件中心注册）；无 action 时由 skill 执行。 */
  action: Type.Optional(Type.Object({ type: Type.String() })),
})

/**
 * `src/ledger.ts` `LedgerEntry` —— `~/.mafw/ledger.md` 的行解析结果。
 * 只有 `timestamp` / `event` 必定存在；`ruleId` / `goalId` 来自行内方括号，
 * `source` 解析器只认 cron/llm/user（event 是类型上的历史值），`details` 是行尾 JSON。
 */
export const AutomationLedgerEntrySchema = Type.Object({
  timestamp: Type.String(),
  event: Type.String(),
  goalId: Type.Optional(Type.String()),
  ruleId: Type.Optional(Type.String()),
  source: Type.Optional(Type.Union([
    Type.Literal('cron'),
    Type.Literal('event'),
    Type.Literal('llm'),
    Type.Literal('user'),
  ])),
  reason: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

/**
 * `GET /api/automations` 的规则行：`{...rule, nextTriggers, recentHistory}`。
 * `nextTriggers` 是 cron 的下 5 个触发时刻（event 规则为空数组），
 * `recentHistory` 是该规则最近 3 条账本行（新→旧）。
 */
export const AutomationRuleListSchema = Type.Composite([
  AutomationRuleSchema,
  Type.Object({
    nextTriggers: Type.Array(Type.String()),
    recentHistory: Type.Array(AutomationLedgerEntrySchema),
  }),
])

export const AutomationsListResponse = Type.Object({
  rules: Type.Array(AutomationRuleListSchema),
})

/** `GET /api/automations/:id`（不存在时 404 `{error}`）。 */
export const AutomationGetResponse = Type.Composite([
  AutomationRuleSchema,
  Type.Object({
    nextTriggers: Type.Array(Type.String()),
    history: Type.Array(AutomationLedgerEntrySchema),
  }),
])

/** `GET /api/automations/:id/history?limit=`（默认 20，按新→旧）。 */
export const AutomationHistoryResponse = Type.Object({
  history: Type.Array(AutomationLedgerEntrySchema),
})
