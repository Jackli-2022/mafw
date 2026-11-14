/**
 * E10g-W1：session 域写接口的请求体 schema（`RouteDef.request`）。
 *
 * 只有声明，不做运行时校验：每个 schema 的字段都来自对应 handler 的读取面
 * （`typeof body.x === 'string'` 之类的守卫），条件必填用 description 说明，
 * 不伪造 oneOf/anyOf 把契约做得比 handler 更严。
 *
 * 空对象 + `requestRequired: false` 的语义是「这个动作没有字段」，不是
 * 「接受任意 body」——见 `EmptyRequest`。
 */
import { Type } from '@sinclair/typebox'

const ThinkingLevel = Type.Union([
  Type.Literal('off'),
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
  Type.Literal('max'),
])

/** prompt part 的边界形状：`type` 必填，其余字段由 runtime 归一化。 */
const PromptPart = Type.Object({
  type: Type.String(),
  text: Type.Optional(Type.String()),
}, { additionalProperties: true })

/** `OutputSchemaSpec`（runtime/structured-output.ts）：schema 必填。 */
const OutputSchemaSpec = Type.Object({
  name: Type.Optional(Type.String()),
  schema: Type.Record(Type.String(), Type.Unknown()),
  retryCount: Type.Optional(Type.Number()),
})

const ModelRef = Type.Object({
  providerID: Type.String(),
  modelID: Type.String(),
})

/**
 * 无 body 动作 / body 被忽略的动作。`requestRequired: false` 时语义是
 * 「不含字段」；handler 不读 body（abort、queue.clear、delete、reload…），
 * 或路径/query 已携带全部输入（discoveryRefresh、usagePluginTest）。
 */
export const EmptyRequest = Type.Object({})

// ── session.config.set ─────────────────────────────────────────────────────

/**
 * `POST /api/session/:id/config`（handler：routes/session-config.ts →
 * `SessionConfigService.set`）。`category` 决定 `value` 的形状：
 *   - mode → 'read-only'|'auto'|'full-access'（'manual' 为 legacy alias）
 *   - agent → 非空字符串
 *   - model → `{ providerID, modelID, variant? }`
 *   - model_config → `{ variant }`
 *   - thought_level → ThinkingLevel，或 null 表示清除
 * 因此 `value` 声明为 unknown（必填但允许 null）。
 */
export const SessionConfigSetRequest = Type.Object({
  category: Type.Union([
    Type.Literal('mode'),
    Type.Literal('agent'),
    Type.Literal('model'),
    Type.Literal('model_config'),
    Type.Literal('thought_level'),
  ]),
  value: Type.Unknown({
    description: 'Shape depends on category; null clears thought_level.',
  }),
})

// ── session.switchAgent / session.switchModel ──────────────────────────────

/** `POST /api/sessions/:id/agent`（handler：routes/session-switch.ts）。 */
export const SessionSwitchAgentRequest = Type.Object({
  agent: Type.String({ minLength: 1 }),
})

/** `POST /api/sessions/:id/model`（handler：routes/session-switch.ts）。 */
export const SessionSwitchModelRequest = Type.Object({
  model: ModelRef,
  variant: Type.Optional(Type.String()),
})

// ── structured.submit ─────────────────────────────────────────────────────

/**
 * `POST /api/structured/submit`（handler：routes/structured.ts）。
 * 两者都按 `hasOwnProperty` 校验：`sessionID` 非空、`data` 必须出现。
 */
export const StructuredSubmitRequest = Type.Object({
  sessionID: Type.String({ minLength: 1 }),
  data: Type.Unknown({ description: 'Validated against the session output schema at submit time.' }),
})

// ── branch primitives ─────────────────────────────────────────────────────

/**
 * `POST /api/sessions/:id/fork`（handler：routes/session-branch.ts）。
 * body 可选：缺省 fork 整个会话。
 */
export const SessionForkRequest = Type.Object({
  messageID: Type.Optional(Type.String()),
})

/** `POST /api/sessions/:id/revert`（handler：routes/session-branch.ts）：messageID 必填。 */
export const SessionRevertRequest = Type.Object({
  messageID: Type.String({ minLength: 1 }),
  partID: Type.Optional(Type.String()),
})

/**
 * `POST /api/sessions/:id/diff/revert`（handler：routes/session-diff.ts）。
 * `patches` 非空；每条必须带非空 `patch` 与至少一个非负 `hunkIndices`
 * （索引范围 / patch hunk 数由 handler 校验）。
 */
export const SessionRevertDiffRequest = Type.Object({
  patches: Type.Array(
    Type.Object({
      patch: Type.String({ minLength: 1 }),
      hunkIndices: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1 }),
    }),
    { minItems: 1 },
  ),
})

/**
 * `POST /api/sessions/:id/checkpoint`（handler：routes/session-checkpoints.ts）。
 * body 可选：缺省挂到最新 assistant 消息。
 */
export const SessionCheckpointRequest = Type.Object({
  messageID: Type.Optional(Type.String()),
})

/** `POST /api/sessions/:id/checkpoints/:checkpointId/restore`（handler 同上）。 */
export const SessionRestoreCheckpointRequest = Type.Object({
  scope: Type.Union([Type.Literal('session'), Type.Literal('files'), Type.Literal('both')]),
  confirm: Type.Literal(true),
})

// ── data parts ────────────────────────────────────────────────────────────

/**
 * `POST /api/sessions/:id/data`（handler：routes/session-data.ts →
 * `DataPartService.create`）。`name` 必须匹配 `[a-z0-9][a-z0-9_-]{0,31}`；
 * `id` 必须匹配 `[A-Za-z0-9._:-]{1,64}`；`data` 可缺省（落库为 null）。
 */
export const SessionDataRequest = Type.Object({
  name: Type.String({ pattern: '^[a-z0-9][a-z0-9_-]{0,31}$' }),
  id: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9._:-]{1,64}$' })),
  data: Type.Optional(Type.Unknown({ description: 'JSON-serializable payload (<= 64KB after encoding).' })),
  transient: Type.Optional(Type.Boolean({ description: 'Not persisted; overrides an existing row for the same id.' })),
  messageID: Type.Optional(Type.String()),
})

// ── discovery ─────────────────────────────────────────────────────────────

/**
 * `POST /api/sessions/:id/discovery/skills/:key/invoke`（handler：
 * routes/session-discovery.ts）。body 可选；`directory` 走 query。
 */
export const SessionDiscoverySkillInvokeRequest = Type.Object({
  args: Type.Optional(Type.String()),
})

// ── run lifecycle ─────────────────────────────────────────────────────────

/**
 * `POST /api/session/:id/summarize`（handler：routes/session-summarize.ts）。
 * body 可选：缺省用 runtime 当前模型；显式覆盖时两者一起给。
 */
export const SessionSummarizeRequest = Type.Object({
  providerID: Type.Optional(Type.String()),
  modelID: Type.Optional(Type.String()),
})

// ── prompts ───────────────────────────────────────────────────────────────

/**
 * `POST /api/session/:id/prompt`（handler：routes/sessions-core.ts）。
 * 同步 prompt：`parts` 为 runtime prompt parts；`system` 为临时系统提示。
 */
export const SessionPromptRequest = Type.Object({
  parts: Type.Optional(Type.Array(PromptPart)),
  system: Type.Optional(Type.String()),
  outputSchema: Type.Optional(OutputSchemaSpec),
  thinkingLevel: Type.Optional(ThinkingLevel),
  variant: Type.Optional(Type.String()),
})

/**
 * `POST /api/session/:id/promptAsync`（handler：routes/sessions-core.ts）。
 * handler 要求 `message` 或 `parts` 至少一个；暂停/忙碌 + `delivery:'queue'`
 * 时进入队列，且此时不得携带 `maxTurns`/`maxCostUsd`（handler 400）。
 */
export const SessionPromptAsyncRequest = Type.Object({
  message: Type.Optional(Type.String({ description: 'Required when parts is absent.' })),
  parts: Type.Optional(Type.Array(PromptPart, { description: 'Required when message is absent.' })),
  agent: Type.Optional(Type.String()),
  model: Type.Optional(ModelRef),
  maxTurns: Type.Optional(Type.Number({ description: 'Rejected when the prompt is queued or the run is suspended.' })),
  maxCostUsd: Type.Optional(Type.Number({ description: 'Rejected when the prompt is queued or the run is suspended.' })),
  delivery: Type.Optional(Type.Union([
    Type.Literal('steer'),
    Type.Literal('followup'),
    Type.Literal('queue'),
  ])),
  idempotencyKey: Type.Optional(Type.String()),
  expectReply: Type.Optional(Type.Boolean()),
  thinkingLevel: Type.Optional(ThinkingLevel),
  variant: Type.Optional(Type.String()),
  outputSchema: Type.Optional(OutputSchemaSpec),
})

/**
 * `POST /api/session/:id/command`（catalog 登记，gateway 无 handler：尾部反代到
 * runtime serve）。请求形状对照 `@opencode-ai/sdk` `SessionCommandData.body`：
 * `command` + `arguments` 必填，body 本身可缺省。
 */
export const SessionCommandRequest = Type.Object({
  command: Type.String({ minLength: 1 }),
  arguments: Type.String(),
  agent: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  messageID: Type.Optional(Type.String()),
})

// ── mutations ─────────────────────────────────────────────────────────────

/** `PATCH /api/sessions/:id`（handler：routes/session-mutations.ts）：trim 后必须非空。 */
export const SessionRenameRequest = Type.Object({
  title: Type.String({ minLength: 1 }),
})

// ── usage plugins ─────────────────────────────────────────────────────────

/**
 * `POST /api/usage/plugins/create`（handler：routes/usage-plugins.ts）。
 * 两种模式二选一：`template` + `values`（template 名见 USAGE_TEMPLATES），
 * 或 `name` + `source`。`values.name` / `values.sourceName` 可提供名称
 * （clone-builtin 从 sourceName 取名）。
 */
export const UsagePluginCreateRequest = Type.Object({
  template: Type.Optional(Type.String({ description: 'Mutually exclusive with name+source.' })),
  values: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  name: Type.Optional(Type.String({ description: 'Required for name+source; optional for templates.' })),
  source: Type.Optional(Type.String({ description: 'Required with name when template is absent.' })),
})

/** `PUT /api/usage/plugins/:name/source`（handler：routes/usage-plugins.ts）。 */
export const UsagePluginSourcePutRequest = Type.Object({
  source: Type.String({ minLength: 1 }),
})

// ── subagents ─────────────────────────────────────────────────────────────

/**
 * `POST /api/sessions/:id/subagents`（handler：routes/subagents.ts →
 * `SubagentService.spawn`）：`prompt` trim 后必须非空；`directory` 缺省继承父会话。
 */
export const SubagentSpawnRequest = Type.Object({
  prompt: Type.String({ minLength: 1 }),
  directory: Type.Optional(Type.String()),
  agent: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  background: Type.Optional(Type.Boolean()),
  model: Type.Optional(ModelRef),
  outputSchema: Type.Optional(OutputSchemaSpec),
})

/**
 * `POST /api/sessions/:id/subagents/:subId/message`（handler 同上）：
 * service 要求 trim 后非空。
 */
export const SubagentMessageRequest = Type.Object({
  message: Type.String({ minLength: 1 }),
})
