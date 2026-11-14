/**
 * E10f-A：agent 契约读面（2 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状。
 * 形状来源（handler 是事实源）：
 *   - experience.actions → routes/experience-actions.ts + experience/experience-contract.ts
 *                          （`EXPERIENCE_ACTION_IDS` / `ACTION_UNAVAILABLE_REASONS`）
 *   - cognition.rules    → routes/cognition.ts `handleCognitionRules` + core/cognition/rules.ts
 *                          `validateRules()`（规则是 **config 作者的数据**，非法条目只进 errors）
 *
 * experience 的 20 个 action id 是封闭词表：`actions` 的键集由常量派生（新增动作必须同时
 * 改 `EXPERIENCE_ACTION_IDS`），每个值仍是完整的 `ActionDescriptor`。
 */
import { Type, type TSchema } from '@sinclair/typebox'
import { EXPERIENCE_ACTION_IDS } from '../../experience/experience-contract'

// ── experience.actions ──────────────────────────────────────────────────────

/** `ActionDescriptor`：supported=false ⇒ enabled=false + reason='unsupported'（schema 层不重复校验）。 */
const ActionDescriptorSchema = Type.Object({
  supported: Type.Boolean(),
  enabled: Type.Boolean(),
  reason: Type.Optional(Type.Union([
    Type.Literal('unsupported'),
    Type.Literal('busy'),
    Type.Literal('missing-data'),
    Type.Literal('non-invertible-patch'),
    Type.Literal('unsafe'),
  ])),
  warningKey: Type.Optional(Type.String()),
  /** 该动作对应的 catalog operationId（E3-4）；无真实 HTTP 路由的动作省略。 */
  operationId: Type.Optional(Type.String()),
  semantics: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

/**
 * `actions` 是 **Partial** 映射（contract 类型如此；投影当前填满 20 个 key）。
 * 键集仍封闭：新动作必须先进 `EXPERIENCE_ACTION_IDS`，否则不会出现在契约面。
 */
const ActionProperties: Record<string, TSchema> = {}
for (const id of EXPERIENCE_ACTION_IDS) ActionProperties[id] = Type.Optional(ActionDescriptorSchema)

export const ExperienceActionsResponse = Type.Object({
  experienceVersion: Type.String(),
  /** 本响应可被消费的最低客户端版本（handler 恒发）。 */
  minClientVersion: Type.String(),
  /** 只有带 sessionID 查询时才回显。 */
  sessionID: Type.Optional(Type.String()),
  actions: Type.Object(ActionProperties),
})

// ── cognition.rules ─────────────────────────────────────────────────────────

/** `CognitionRule.on`（rules.ts VALID_ON）。 */
const CognitionRuleOnSchema = Type.Union([
  Type.Literal('tool_call'),
  Type.Literal('prompt'),
  Type.Literal('tool_result'),
])

/** `CognitionRule.action`（rules.ts VALID_ACTION；transform/redact 不产出 GateDecision）。 */
const CognitionRuleActionSchema = Type.Union([
  Type.Literal('deny'),
  Type.Literal('ask'),
  Type.Literal('rewrite'),
  Type.Literal('transform'),
  Type.Literal('redact'),
])

/**
 * `CognitionRule`：`validateRules()` 把**原始 config 条目**原样放进 `valid`
 * （只校验 on/action/regex），故额外键按 config 作者的数据保留 → 开放索引。
 */
const CognitionRuleSchema = Type.Object({
  on: CognitionRuleOnSchema,
  tool: Type.Optional(Type.String()),
  match: Type.Optional(Type.String()),
  action: CognitionRuleActionSchema,
  reason: Type.Optional(Type.String()),
  input: Type.Optional(Type.Record(Type.String(), Type.String())),
  text: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
}, { additionalProperties: true })

/** 规则坏条目不抛错：跳过并写 errors（fail-open 但不静默）。 */
export const CognitionRulesResponse = Type.Object({
  rules: Type.Array(CognitionRuleSchema),
  errors: Type.Array(Type.String()),
})
