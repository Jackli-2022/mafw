/**
 * E10g-W8：cognition gate / rewrite 写接口的请求体 schema（`RouteDef.request`）。
 *
 * 只有声明，不做运行时校验：字段面逐项来自 handler 的实际读取
 * （`routes/cognition.ts` `handleCognitionGate` / `handleCognitionRewrite`）
 * 与认知面契约（`runtime/contract-cognition.ts` 的 gate/rewrite 动词）。
 *
 * 分类（与 W1-W7 同口径）：
 *   - JSON body（`requestRequired` 缺省 true）：`cognition.gate`、`cognition.rewrite`。
 *     两个 op 都没有可省缺的 envelope：handler 在 `body` 缺失时直接 400。
 *
 * 条件必填（不伪造 oneOf）：`gate.tool` 只在 `kind:'tool_call'` 分支必填
 * （`kind:'prompt'` 时 handler 忽略它），因此声明为 optional + description。
 */
import { Type } from '@sinclair/typebox'

/**
 * `POST /api/cognition/gate`（handler：`routes/cognition.ts` `handleCognitionGate`）。
 *
 * 执行前拦截：`sessionID` 与 `kind` 缺失/非法 → 400；`kind:'tool_call'` 还要求
 * `tool` 是字符串；`kind:'prompt'` 的 `text` 非字符串时按空串求值。
 * `input` 缺省为 `{}`（`gateToolCall` 只把它喂给 `commandTextOf` 候选链与规则引擎）。
 */
export const CognitionGateRequest = Type.Object({
  sessionID: Type.String({
    minLength: 1,
    description: 'Session the gate decision is scoped to (required; loopback-only route).',
  }),
  kind: Type.Union([
    Type.Literal('tool_call'),
    Type.Literal('prompt'),
  ], {
    description: "Interception point: 'tool_call' before a tool runs, 'prompt' before a prompt is submitted (closed enum; anything else → 400).",
  }),
  tool: Type.Optional(Type.String({
    description: "Tool name. Required when kind is 'tool_call' (missing → 400); ignored for kind:'prompt'.",
  })),
  input: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
    description: "Tool arguments for kind:'tool_call' (absent → {}). Free-form: the rule engine interpolates {{field}} from it.",
  })),
  text: Type.Optional(Type.String({
    description: "Prompt text for kind:'prompt' (non-string values are evaluated as ''). Ignored for kind:'tool_call'.",
  })),
}, {
  description: "kind is a closed enum, and tool is conditionally required when kind is 'tool_call' (missing → 400).",
})

/**
 * 工具结果内容部件：`type` 必填，其余字段归 runtime（text / image / 未知部件）。
 * `applyToolResultRedact` 只改写 `type:'text'` 部件的 `text`，其余原样透传。
 */
const ToolResultPart = Type.Object({
  type: Type.String({
    description: "Content part type ('text' / 'image' / runtime-specific). Only text parts are redacted; everything else passes through unchanged.",
  }),
}, { additionalProperties: true })

/**
 * `POST /api/cognition/rewrite`（handler：同上 `handleCognitionRewrite`）。
 *
 * 工具输出回模型前的脱敏：`sessionID` / `tool` 缺失或 `output.content` 不是数组
 * → 400（错误文案为 `sessionID, tool and output.content[] required`）。
 * 空数组是合法输入（200 `{content: []}`）；未命中 `on:tool_result` 规则时原样返回。
 */
export const CognitionRewriteRequest = Type.Object({
  sessionID: Type.String({
    minLength: 1,
    description: 'Session used for internal-exemption / observability scoping (required).',
  }),
  tool: Type.String({
    description: 'Tool whose output is being rewritten; matched against on:tool_result rules (required).',
  }),
  input: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
    description: 'Host envelope field from the cognition contract; the current gateway handler does not read it (redaction keys on tool + output.content).',
  })),
  output: Type.Object({
    content: Type.Array(ToolResultPart, {
      description: 'Tool result content parts. Required and must be an array (otherwise → 400); an empty array is valid.',
    }),
    isError: Type.Optional(Type.Boolean({
      description: 'Host-side error flag; echoed by the host, not read by the gateway handler.',
    })),
  }, {
    description: 'Tool result envelope. `content` is the only field the gateway reads.',
  }),
}, {
  description: "sessionID, tool and output.content[] are required (missing → 400).",
})
