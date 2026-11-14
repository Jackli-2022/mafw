/**
 * E10h-R3：cognition gate / rewrite 的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 * `routes/cognition.ts` 的 `handleCognitionGate` / `handleCognitionRewrite`。
 *
 * `cognition.gate` 的 200 是**规则引擎的决策对象**（`core/cognition/rules.ts`
 * `GateDecision` + prompt 侧的 transform 分支）：
 *   - `kind:'tool_call'` → allow / deny / rewrite / ask（无命中时 handler 用
 *     `{decision:'allow'}` 兜底）；
 *   - `kind:'prompt'`    → allow / deny / transform（内部会话豁免恒 allow）。
 * 五个分支共用 `decision` 判别键，用联合表达（不等于「任意对象」）。
 * `cognition.rewrite` 的 200 是 `{content}`——`applyToolResultRedact` 只改写
 * `type:'text'` 的部件，其余部件（image / runtime 私有）原样透传，故部件按
 * 「type 必填 + 其余归 runtime」的开放对象建模。
 *
 * 400（缺 sessionID / tool / output.content[]）与 403（非 loopback）、
 * 500（fail-open 之外的异常）不属于 200 形态。
 */
import { Type } from '@sinclair/typebox'

/** 无命中 / 放行 / 内部会话豁免。 */
const CognitionAllowDecision = Type.Object({
  decision: Type.Literal('allow'),
})

/** `deny`：`reason`（人类可读依据）与 `rule`（命中的规则名）都只在规则写了时出现。 */
const CognitionDenyDecision = Type.Object({
  decision: Type.Literal('deny'),
  reason: Type.Optional(Type.String()),
  rule: Type.Optional(Type.String()),
})

/**
 * `ask`：v1 只有 tool_call 类可产出（prompt+ask 在加载期被拒，规则 C6）；
 * 形状与 deny 同（依据 + 规则名）。
 */
const CognitionAskDecision = Type.Object({
  decision: Type.Literal('ask'),
  reason: Type.Optional(Type.String()),
  rule: Type.Optional(Type.String()),
})

/** `rewrite`：替换后的工具入参（规则 `input` 模板插值结果），自由对象。 */
const CognitionRewriteDecision = Type.Object({
  decision: Type.Literal('rewrite'),
  input: Type.Record(Type.String(), Type.Unknown()),
  rule: Type.Optional(Type.String()),
})

/** `transform`：改写后的 prompt 正文（prompt 侧独有分支）。 */
const CognitionTransformDecision = Type.Object({
  decision: Type.Literal('transform'),
  text: Type.String(),
  rule: Type.Optional(Type.String()),
})

/**
 * `POST /api/cognition/gate`（handler：`handleCognitionGate`）：
 * 决策对象按 `decision` 判别，五个分支见上。
 */
export const CognitionGateResponse = Type.Union([
  CognitionAllowDecision,
  CognitionDenyDecision,
  CognitionAskDecision,
  CognitionRewriteDecision,
  CognitionTransformDecision,
])

/**
 * 工具结果内容部件：`type` 必填，其余字段归 runtime（text / image / 未知部件）。
 * 与 `cognition-write.ts` 的请求侧 `ToolResultPart` 同一约定。
 */
const CognitionToolResultPart = Type.Object({
  type: Type.String(),
}, { additionalProperties: true })

/**
 * `POST /api/cognition/rewrite`（handler：`handleCognitionRewrite`）：
 * `{content}`——空数组是合法 200（无部件可脱敏）；未命中 `on:tool_result`
 * 规则时原样回传入数组。
 */
export const CognitionRewriteResponse = Type.Object({
  content: Type.Array(CognitionToolResultPart),
})
