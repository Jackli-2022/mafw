/**
 * E10f-A：session 运行时读面（5 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状。
 * 形状来源（handler 是事实源）：
 *   - session.structured       → routes/structured.ts + runtime/structured-output.ts `get()`
 *   - session.trajectory       → routes/sessions-read.ts → trajectory/api.ts `handleTrajectoryRequest`
 *   - session.run              → routes/session-run.ts → core/run/run-state-service.ts `toRunDto`
 *   - session.discovery        → routes/session-discovery.ts → core/discovery/types.ts `DiscoverySnapshot`
 *   - session.discoverySkill   → 同上 `DiscoverySkillContent`
 *
 * `@mafw/sdk` 有 `RunState` / `DiscoverySnapshot` / `DiscoverySkillContent` 的等价 DTO
 * （`contract-compat.checks.ts` 的 AssertEq 钉住）；trajectory 的 SDK 类型是 legacy 子集
 * （缺 `sessionID` / `provider` / `assistantText` / `workerRole`），故按 gateway 类型 schema-only。
 */
import { Type } from '@sinclair/typebox'

// ── session.structured ──────────────────────────────────────────────────────

/**
 * `StructuredOutputService.get()` 的会话现状。
 *
 * - `name` 来自 `OutputSchemaSpec.name`（可省）→ 可缺键；
 * - `schema` 是**工具作者提供的 JSON Schema**（owner = 各 structured tool spec），
 *   gateway 只做校验不重写 → 边界对象（任意键）；
 * - `submitted` 是最近一次通过校验的 data（任意 JSON；未交卷时缺键）。
 */
export const SessionStructuredResponse = Type.Object({
  sessionID: Type.String(),
  name: Type.Optional(Type.String()),
  schema: Type.Record(Type.String(), Type.Unknown()),
  submitted: Type.Optional(Type.Unknown()),
  /** 最近一次校验失败的紧凑错误（恒为数组；成功后空数组）。 */
  errors: Type.Array(Type.String()),
  updatedAt: Type.Number(),
})

// ── session.trajectory ──────────────────────────────────────────────────────

/** `trajectory/types.ts` `TokenCounts`（与 tokenSummary 同形）。 */
const TokenCountsSchema = Type.Object({
  input: Type.Number(),
  output: Type.Number(),
  reasoning: Type.Number(),
  cache: Type.Object({
    read: Type.Number(),
    write: Type.Number(),
  }),
})

/** `TRAJECTORY_EVENT_TYPES`（trajectory/types.ts）——封闭词表，客户端按它分组时间线。 */
const TrajectoryEventTypeSchema = Type.Union([
  Type.Literal('tool_start'),
  Type.Literal('tool_update'),
  Type.Literal('tool_end'),
  Type.Literal('reasoning_start'),
  Type.Literal('reasoning_end'),
  Type.Literal('agent_switch'),
  Type.Literal('model_switch'),
  Type.Literal('step_finish'),
  Type.Literal('turn_start'),
  Type.Literal('turn_end'),
  Type.Literal('text_start'),
  Type.Literal('text_end'),
])

/**
 * `TrajectoryEvent`：store 行投影 / rebuild 合成事件同形。`toolState` 只有
 * `tool_end` 带；`tokens` / `cost` 只在记账事件上出现。
 */
const TrajectoryEventSchema = Type.Object({
  id: Type.Optional(Type.Number()),
  projectID: Type.String(),
  sessionID: Type.String(),
  turnID: Type.Number(),
  seq: Type.Number(),
  eventType: TrajectoryEventTypeSchema,
  toolName: Type.Optional(Type.String()),
  callID: Type.Optional(Type.String()),
  toolState: Type.Optional(Type.Union([
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('error'),
  ])),
  agent: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  inputSummary: Type.Optional(Type.String()),
  outputSummary: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  tokens: Type.Optional(TokenCountsSchema),
  cost: Type.Optional(Type.Number()),
  finish: Type.Optional(Type.String()),
  timeMs: Type.Number(),
  durationMs: Type.Optional(Type.Number()),
})

/** `TrajectoryTurn`：turnEndMs/durationMs 在未收口回合为 null。 */
const TrajectoryTurnSchema = Type.Object({
  projectID: Type.String(),
  sessionID: Type.String(),
  turnID: Type.Number(),
  turnStartMs: Type.Number(),
  turnEndMs: Type.Union([Type.Number(), Type.Null()]),
  durationMs: Type.Union([Type.Number(), Type.Null()]),
  toolCount: Type.Number(),
  toolErrorCount: Type.Number(),
  reasoningCount: Type.Number(),
  agentSwitchCount: Type.Number(),
  tokens: TokenCountsSchema,
  cost: Type.Number(),
  finish: Type.Union([Type.String(), Type.Null()]),
  model: Type.Union([Type.String(), Type.Null()]),
  provider: Type.Union([Type.String(), Type.Null()]),
  agent: Type.Union([Type.String(), Type.Null()]),
  userText: Type.String(),
  assistantText: Type.Optional(Type.String()),
  workerRole: Type.Optional(Type.String()),
})

/** 空快照（store 缺失 / 失败）与 rebuild 失败兜底都是 `{ turns: [], events: [] }`。 */
export const SessionTrajectoryResponse = Type.Object({
  turns: Type.Array(TrajectoryTurnSchema),
  events: Type.Array(TrajectoryEventSchema),
})

// ── session.run ─────────────────────────────────────────────────────────────

/** `ResumeBrief`（core/run/run-brief.ts）：暂停点快照四键恒在。 */
const ResumeBriefSchema = Type.Object({
  lastUserText: Type.String(),
  lastAssistantTail: Type.String(),
  anchorMessageID: Type.String(),
  queuedCount: Type.Number(),
})

/** `RunState`（`toRunDto`）：resumedAt / finishedAt 只在推进后出现。 */
export const RunStateSchema = Type.Object({
  id: Type.String(),
  sessionID: Type.String(),
  projectDir: Type.String(),
  status: Type.Union([
    Type.Literal('suspended'),
    Type.Literal('resumed'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('cancelled'),
  ]),
  reason: Type.Optional(Type.String()),
  brief: ResumeBriefSchema,
  createdAt: Type.String(),
  suspendedAt: Type.String(),
  resumedAt: Type.Optional(Type.String()),
  finishedAt: Type.Optional(Type.String()),
})

/** GET /run：无活跃 run 时是 `{ run: null }`（不是 404）。 */
export const SessionRunResponse = Type.Object({
  run: Type.Union([RunStateSchema, Type.Null()]),
})

// ── session.discovery ───────────────────────────────────────────────────────

/** `DiscoveryCommand`（含 mafw 静态命令 + runtime 命令投影）。 */
const DiscoveryCommandSchema = Type.Object({
  name: Type.String(),
  aliases: Type.Optional(Type.Array(Type.String())),
  description: Type.String(),
  argumentHint: Type.Optional(Type.String()),
  category: Type.Optional(Type.Union([
    Type.Literal('goals'),
    Type.Literal('session'),
    Type.Literal('memory'),
    Type.Literal('custom'),
    Type.Literal('runtime'),
  ])),
  destructive: Type.Optional(Type.Boolean()),
  source: Type.Union([Type.Literal('mafw'), Type.Literal('custom'), Type.Literal('runtime')]),
  scope: Type.Union([
    Type.Literal('gateway'),
    Type.Literal('user'),
    Type.Literal('project'),
    Type.Literal('runtime'),
  ]),
  runtime: Type.Optional(Type.Boolean()),
  agent: Type.Optional(Type.String()),
  model: Type.Optional(Type.Object({
    id: Type.String(),
    providerID: Type.String(),
    variant: Type.Optional(Type.String()),
  })),
  subtask: Type.Optional(Type.Boolean()),
})

/** `DiscoverySkill`：contentLength 是字节数（不经 content 传输）。 */
const DiscoverySkillSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  slash: Type.Boolean(),
  scope: Type.Union([Type.Literal('user'), Type.Literal('project'), Type.Literal('path')]),
  location: Type.Optional(Type.String()),
  contentLength: Type.Number(),
})

/** `DiscoveryInstruction`：AGENTS 来源账本（kind 目前只有 agents-md）。 */
const DiscoveryInstructionSchema = Type.Object({
  id: Type.String(),
  path: Type.String(),
  scope: Type.Union([Type.Literal('global'), Type.Literal('project'), Type.Literal('nested')]),
  kind: Type.Literal('agents-md'),
  bytes: Type.Number(),
  mtime: Type.String(),
})

const DiscoveryWarningSchema = Type.Object({
  source: Type.Union([Type.Literal('commands'), Type.Literal('skills'), Type.Literal('instructions')]),
  message: Type.String(),
})

/** `DiscoverySnapshot`：degradedReason 只在降级时出现。 */
export const SessionDiscoveryResponse = Type.Object({
  sessionID: Type.String(),
  directory: Type.String(),
  revision: Type.String(),
  commandsRevision: Type.String(),
  generatedAt: Type.String(),
  commands: Type.Array(DiscoveryCommandSchema),
  skills: Type.Array(DiscoverySkillSchema),
  instructions: Type.Array(DiscoveryInstructionSchema),
  degraded: Type.Boolean(),
  degradedReason: Type.Optional(Type.Union([
    Type.Literal('capability_absent'),
    Type.Literal('runtime_error'),
    Type.Literal('partial'),
    Type.Literal('instructions_error'),
  ])),
  warnings: Type.Array(DiscoveryWarningSchema),
  /** runtime 是否支持显式 skill 调用（discovery.invokeSkill surface）。 */
  skillInvokeSupported: Type.Boolean(),
})

/** `DiscoverySkillContent` = DiscoverySkill + 全文（按需加载，不进快照）。 */
export const SessionDiscoverySkillResponse = Type.Object({
  id: Type.String(),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  slash: Type.Boolean(),
  scope: Type.Union([Type.Literal('user'), Type.Literal('project'), Type.Literal('path')]),
  location: Type.Optional(Type.String()),
  contentLength: Type.Number(),
  content: Type.String(),
})
