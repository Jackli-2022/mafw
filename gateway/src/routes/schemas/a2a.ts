/**
 * E10f-D：A2A agent card 文档 schema（2 op）。
 *
 *   - `a2a.agentCard`  → `GET /.well-known/agent-card.json`（`media/media-agent.ts`
 *     `agentCard`，A2A 媒体 agent）
 *   - `pods.a2aCard`   → `GET /a2a/pods/:podId/.well-known/agent-card.json`
 *     （`core/pod/pod-a2a-agent.ts` `agentCard`，Pod handoff agent）
 *
 * 两张卡都是 **A2A 协议文档**（`@a2a-js/sdk` `AgentCard`，A2A v1.0），不是 MAFW
 * View DTO：字段取值域、v0.3/v1.0 兼容字段（card-level `protocolVersion` /
 * `supportedInterfaces[]`）以及未来新增能力位都由协议拥有。owner = A2A protocol
 * spec（`@a2a-js/sdk`），因此这里是边界对象：
 *   - 顶层承诺两个 handler 恒发的信封字段（name/description/url/version/provider/
 *     capabilities/defaultInputModes/defaultOutputModes/skills/securitySchemes/
 *     securityRequirements/signatures）以及 Pod 卡多出的 optional 协议字段；
 *   - 嵌套 protocol-owned 结构（skill / capabilities / interface 条目）保留已知的
 *     稳定键 + `additionalProperties: true`，协议扩展不会把 schema 打红；
 *   - `securitySchemes` / `securityRequirements` / `signatures` 是协议自有 JSON，
 *     用 open record / unknown[] 承接。
 *
 * 不做整响应放宽：顶层仍有明确 properties 与 required（见 api-contract E10f-D）。
 */
import { Type } from '@sinclair/typebox'

/**
 * A2A skill 条目（`AgentSkill`）。`id/name/description` 是协议必填；其余是
 * MAFW 两张卡恒发的展示字段，但协议把它们标为可选/可演进 → schema 保持 optional。
 */
const A2AAgentSkillSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.String(),
  tags: Type.Optional(Type.Array(Type.String())),
  examples: Type.Optional(Type.Array(Type.String())),
  inputModes: Type.Optional(Type.Array(Type.String())),
  outputModes: Type.Optional(Type.Array(Type.String())),
  securityRequirements: Type.Optional(Type.Array(Type.Unknown())),
}, { additionalProperties: true })

/** A2A capability set（`AgentCapabilities`）；协议可继续加能力位。 */
const A2AAgentCapabilitiesSchema = Type.Object({
  streaming: Type.Boolean(),
  pushNotifications: Type.Boolean(),
  extensions: Type.Array(Type.Unknown()),
}, { additionalProperties: true })

/** v1.0 `supportedInterfaces[]` 条目（`AgentInterface`）。 */
const A2AAgentInterfaceSchema = Type.Object({
  url: Type.String(),
  protocolBinding: Type.String(),
  protocolVersion: Type.String(),
}, { additionalProperties: true })

export const A2AAgentCardResponse = Type.Object({
  name: Type.String(),
  description: Type.String(),
  /**
   * 两张卡都带 JSON-RPC 入口 URL（A2A v1.0 proto 用 `supportedInterfaces[].url`
   * 表达，`url` 是 v0.3 兼容字段；媒体卡只用 `url`，Pod 卡两者都给）。
   */
  url: Type.String(),
  version: Type.String(),
  /** v0.3 card-level 协议版本（只有 Pod 卡发）。 */
  protocolVersion: Type.Optional(Type.String()),
  provider: Type.Object({
    url: Type.String(),
    organization: Type.String(),
  }, { additionalProperties: true }),
  capabilities: A2AAgentCapabilitiesSchema,
  defaultInputModes: Type.Array(Type.String()),
  defaultOutputModes: Type.Array(Type.String()),
  skills: Type.Array(A2AAgentSkillSchema),
  /** v1.0 协议入口列表（媒体卡为空数组，Pod 卡一条 JSONRPC 入口）。 */
  supportedInterfaces: Type.Optional(Type.Array(A2AAgentInterfaceSchema)),
  documentationUrl: Type.Optional(Type.String()),
  iconUrl: Type.Optional(Type.String()),
  securitySchemes: Type.Record(Type.String(), Type.Unknown()),
  securityRequirements: Type.Array(Type.Unknown()),
  signatures: Type.Array(Type.Unknown()),
}, { additionalProperties: true })
