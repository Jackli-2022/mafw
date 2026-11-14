/**
 * E10h-R1：session 域写接口（35 ops）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；每段的注释指向 handler（事实源）。
 * 复用既有读侧 schema（`SessionConfigResponse` / `SessionDiscoveryResponse` /
 * `RunStateSchema` / `SubagentRecordSchema` / `UsagePluginsListResponse`），
 * 只在 handler 确实发出不同形状时新写一个（`{ok:true}` / `{status:'ok'}` /
 * 空对象 / promptAsync 队列短路 / runtime 边界）。
 *
 * 空对象语义：`Type.Object({})` 表示 handler 真的 `json(200, {})`（revert /
 * unrevert / summarize / background），不是「任意 body」；`session.command`
 * 的开放对象另有 owner 注释。
 */
import { Type } from '@sinclair/typebox'
import { SessionCheckpointSchema, SessionConfigResponse, SubagentRecordSchema } from './session-read'
import { RunStateSchema, SessionDiscoveryResponse } from './session-runtime'
import { UsagePluginSummarySchema, UsagePluginsListResponse } from './usage'

// ── 共享信封 ────────────────────────────────────────────────────────────────

/**
 * `{ok:true}`：switch / abort / rename / delete / subagent message+cancel 的
 * 统一成功信封（`session-switch.ts` 注释：SDK request 恒解析 JSON，204 会炸）。
 */
export const OkResponse = Type.Object({
  ok: Type.Literal(true),
})

/** `{status:'ok'}`：legacy 删除面（`sessions-core.ts` → `session.deleteLegacy`）。 */
export const StatusOkResponse = Type.Object({
  status: Type.Literal('ok'),
})

/**
 * 真正没有字段的 200 体（handler 逐字 `json(res, 200, {})`）。
 * 只用于 `session.revert` / `session.unrevert` / `session.summarize` /
 * `session.background` —— 客户端只关心 2xx，不读字段。
 */
export const EmptyJsonResponse = Type.Object({})

// ── session.config.set ─────────────────────────────────────────────────────

/**
 * `POST /api/session/:id/config`（handler：routes/session-config.ts →
 * `SessionConfigService.set`）。`set()` 返回完整 `SessionConfigState`，与
 * `session.config`（GET）严格同形 —— 直接复用读侧 schema。
 */
export const SessionConfigSetResponse = SessionConfigResponse

// ── session.switchAgent / session.switchModel ──────────────────────────────

/** `POST /api/sessions/:id/agent`（handler：routes/session-switch.ts）。 */
export const SessionSwitchAgentResponse = OkResponse

/** `POST /api/sessions/:id/model`（handler 同上）。 */
export const SessionSwitchModelResponse = OkResponse

// ── structured.submit ─────────────────────────────────────────────────────

/**
 * `POST /api/structured/submit`（handler：routes/structured.ts →
 * `StructuredOutputService.submit`）：`{ok, errors}` 恒两键；校验失败也回 200
 * （只有「no active output schema」走 400）。
 */
export const StructuredSubmitResponse = Type.Object({
  ok: Type.Boolean(),
  errors: Type.Array(Type.String()),
})

// ── branch primitives ─────────────────────────────────────────────────────

/**
 * `POST /api/sessions/:id/fork`（handler：routes/session-branch.ts）。
 *
 * handler 下发 `{ session }`，值来自 runtime 的 fork 返回。gateway 契约
 * （`runtime/contract.ts`）只保证 `id`；opencode 还会带完整会话视图，故其余
 * 字段按边界开放（SDK `session.fork()` 的类型是 `{ session: Session }`，
 * 客户端只读 `id`）。
 */
export const SessionForkResponse = Type.Object({
  session: Type.Object({
    id: Type.String(),
  }, {
    additionalProperties: true,
    description: 'Runtime session record for the fork; the gateway contract guarantees `id` only.',
  }),
})

/** `POST /api/sessions/:id/revert`（handler 同上）：无字段成功体。 */
export const SessionRevertResponse = EmptyJsonResponse

/** `POST /api/sessions/:id/unrevert`（handler 同上；仅 opencode）：无字段成功体。 */
export const SessionUnrevertResponse = EmptyJsonResponse

/**
 * `POST /api/sessions/:id/diff/revert`（handler：routes/session-diff.ts）：
 * 成功时回 `{ reverted: <选中条目数> }`（git apply 失败是 502 错误信封）。
 */
export const SessionRevertDiffResponse = Type.Object({
  reverted: Type.Number(),
})

// ── checkpoints ───────────────────────────────────────────────────────────

/**
 * `POST /api/sessions/:id/checkpoint`（handler：routes/session-checkpoints.ts →
 * `CheckpointService.createManual`）：`{ checkpoint }`，条目是 `SessionCheckpoint`
 * 本体 —— 与列表条目同形但**不带 Experience actions**（列表才逐条投影）。
 */
export const SessionCheckpointCreatedSchema = Type.Omit(SessionCheckpointSchema, ['actions'])

export const SessionCheckpointResponse = Type.Object({
  checkpoint: SessionCheckpointCreatedSchema,
})

/**
 * `POST /api/sessions/:id/checkpoints/:checkpointId/restore`（handler 同上 →
 * `CheckpointService.restore`）：回 `CheckpointRestoreResult` 本体，无信封。
 * 三态 `scope` 恒在；`filesSkipped` / `leftoverUntracked` / `preRestoreCheckpointId`
 * 只在对应分支出现。
 */
export const SessionRestoreCheckpointResponse = Type.Object({
  scope: Type.Union([
    Type.Literal('session'),
    Type.Literal('files'),
    Type.Literal('both'),
  ]),
  filesSkipped: Type.Optional(Type.Boolean()),
  leftoverUntracked: Type.Optional(Type.Array(Type.String())),
  preRestoreCheckpointId: Type.Optional(Type.String()),
})

// ── run lifecycle ─────────────────────────────────────────────────────────

/** `POST /api/sessions/:id/suspend`（handler：routes/session-run.ts → `RunCoordinator.suspend`）。 */
export const SessionSuspendResponse = Type.Object({
  run: RunStateSchema,
})

/**
 * `POST /api/sessions/:id/resume`（handler 同上 → `RunCoordinator.resume`）：
 * `{run, prompted:true}` —— `prompted` 是字面量 true（恢复即重发 resume prompt）。
 */
export const SessionResumeResponse = Type.Object({
  run: RunStateSchema,
  prompted: Type.Literal(true),
})

/** `POST /api/sessions/:id/run/discard`（handler 同上 → `RunCoordinator.discard`）。 */
export const SessionDiscardRunResponse = Type.Object({
  run: RunStateSchema,
})

// ── data parts ────────────────────────────────────────────────────────────

/**
 * `POST /api/sessions/:id/data`（handler：routes/session-data.ts →
 * `DataPartService.create`）：`{ part }`，与 `@mafw/sdk` `DataPart` 同形
 * （`type` 为 `data-<name>`；`native` 是 runtime 附加的透传记录）。
 */
const DataPartSchema = Type.Object({
  id: Type.String(),
  type: Type.String({ pattern: '^data-' }),
  data: Type.Unknown(),
  transient: Type.Optional(Type.Boolean()),
  sessionID: Type.Optional(Type.String()),
  messageID: Type.Optional(Type.String()),
  native: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

export const SessionDataResponse = Type.Object({
  part: DataPartSchema,
})

// ── discovery ─────────────────────────────────────────────────────────────

/**
 * `POST /api/sessions/:id/discovery/refresh`（handler：routes/session-discovery.ts
 * → `DiscoveryService.refresh`）：回 `DiscoverySnapshot` 本体，与
 * `session.discovery`（GET）严格同形 —— 直接复用读侧 schema。
 */
export const SessionDiscoveryRefreshResponse = SessionDiscoveryResponse

/**
 * `POST /api/sessions/:id/discovery/skills/:key/invoke`（handler 同上 →
 * `DiscoveryService.invokeSkill`）：`{ ok:true, skill:<skill id> }`；未知 key 走
 * 404/409 错误信封，不在此 schema 内。
 */
export const SessionDiscoverySkillInvokeResponse = Type.Object({
  ok: Type.Literal(true),
  skill: Type.String(),
})

// ── prompts / run control ─────────────────────────────────────────────────

/** `POST /api/session/:id/abort`（handler：routes/sessions-core.ts）。 */
export const SessionAbortResponse = OkResponse

/**
 * `POST /api/session/:id/summarize`（handler：routes/session-summarize.ts）：
 * 成功只回 `{}`（压缩结果经事件下发）。
 */
export const SessionSummarizeResponse = EmptyJsonResponse

/** 同步 prompt 的 parts：runtime 归一化后的文本 part（SDK `TextPart`）。 */
const PromptTextPartSchema = Type.Object({
  id: Type.String(),
  sessionID: Type.String(),
  messageID: Type.String(),
  type: Type.Literal('text'),
  text: Type.String(),
})

/**
 * `POST /api/session/:id/prompt`（handler：routes/sessions-core.ts →
 * `SdkSessionResource.prompt`）：`{parts, structured?, structuredError?}`。
 * 无 outputSchema 时只有 `parts`；校验失败时给 `structuredError`（回退文本）。
 */
export const SessionPromptResponse = Type.Object({
  parts: Type.Array(PromptTextPartSchema),
  structured: Type.Optional(Type.Unknown()),
  structuredError: Type.Optional(Type.String()),
})

/**
 * `POST /api/session/:id/promptAsync`（handler：routes/sessions-core.ts）：
 *   - 普通 fire-and-forget → `{status:'ok'}`；
 *   - busy/暂停 + delivery:'queue' → 队列短路 `{status:'ok', queued:true, itemId,
 *     position}`（幂等键命中时是 `{status:'ok', queued:true, duplicate:true, itemId}`）。
 * 三种分支都是 200，故用联合表达；错误（400/409/500）是错误信封。
 */
export const SessionPromptAsyncResponse = Type.Union([
  Type.Object({
    status: Type.Literal('ok'),
  }),
  Type.Object({
    status: Type.Literal('ok'),
    queued: Type.Literal(true),
    itemId: Type.String(),
    position: Type.Number(),
  }),
  Type.Object({
    status: Type.Literal('ok'),
    queued: Type.Literal(true),
    duplicate: Type.Literal(true),
    itemId: Type.String(),
  }),
])

/** `POST /api/session/:id/background`（handler：routes/session-background.ts）：无字段成功体。 */
export const SessionBackgroundResponse = EmptyJsonResponse

/**
 * `POST /api/session/:id/command`（catalog 登记，gateway **无 handler**：尾部反代到
 * runtime serve）。响应形状由 runtime 拥有（opencode 回消息对象），gateway 不读不写，
 * 故按协议边界建模：任意键，客户端只关心 2xx（SDK `session.command()` 返回 void）。
 */
export const SessionCommandResponse = Type.Object({}, {
  additionalProperties: true,
  description: 'Runtime serve command result; shape owned by the runtime adapter (gateway tail-proxies it).',
})

// ── mutations ─────────────────────────────────────────────────────────────

/** `PATCH /api/sessions/:id`（handler：routes/session-mutations.ts）。 */
export const SessionRenameResponse = OkResponse

/** `DELETE /api/sessions/:id`（handler 同上）：成功 `{ok:true}`。 */
export const SessionDeleteResponse = OkResponse

/** `DELETE /api/session/:id`（legacy 面，handler：routes/sessions-core.ts）：`{status:'ok'}`。 */
export const SessionDeleteLegacyResponse = StatusOkResponse

// ── session queue ─────────────────────────────────────────────────────────

/** `DELETE /api/session/:id/queue`（handler：routes/sessions-core.ts）：`{cleared:<条数>}`。 */
export const SessionQueueClearResponse = Type.Object({
  cleared: Type.Number(),
})

/** `DELETE /api/session/:id/queue/:itemId`（handler 同上）：`{cancelled:<itemId>}`。 */
export const SessionQueueCancelResponse = Type.Object({
  cancelled: Type.String(),
})

// ── usage plugins ─────────────────────────────────────────────────────────

/**
 * `POST /api/usage/plugins/reload`（handler：routes/wave1-handlers.ts）：
 * reload 后直接复用 `handleUsagePluginsList`，响应与 `session.usagePluginsList`
 * 严格同形（不是 `{ok}` 信封）。
 */
export const SessionUsagePluginsReloadResponse = UsagePluginsListResponse

/**
 * `POST /api/usage/plugins/create`（handler：routes/usage-plugins.ts）：
 * 写入成功并 reload 后回 `{ok:true, name, plugins:<最新列表>}`。
 */
export const SessionUsagePluginCreateResponse = Type.Object({
  ok: Type.Literal(true),
  name: Type.String(),
  plugins: Type.Array(UsagePluginSummarySchema),
})

/** `PUT /api/usage/plugins/:name/source`（handler 同上）：`{ok:true, plugins}`。 */
export const SessionUsagePluginSourcePutResponse = Type.Object({
  ok: Type.Literal(true),
  plugins: Type.Array(UsagePluginSummarySchema),
})

/** `DELETE /api/usage/plugins/:name`（handler 同上）：`{ok:true, plugins}`。 */
export const SessionUsagePluginsDeleteResponse = Type.Object({
  ok: Type.Literal(true),
  plugins: Type.Array(UsagePluginSummarySchema),
})

/**
 * `POST /api/usage/plugins/:name/test`（handler 同上 → `runAdapter`）：
 * `{ok, result?, error?}` —— adapter 的返回体原样透传在 `result`。
 */
export const SessionUsagePluginTestResponse = Type.Object({
  ok: Type.Boolean(),
  result: Type.Optional(Type.Unknown()),
  error: Type.Optional(Type.String()),
})

// ── subagents ─────────────────────────────────────────────────────────────

/**
 * `POST /api/sessions/:id/subagents`（handler：routes/subagents.ts →
 * `SubagentService.spawn`）：200 时回 `SubagentRecord` 本体（派生失败是 502 + 同
 * 记录体；与 `session.subagents.list` 的条目同形 —— 直接复用）。
 */
export const SessionSubagentSpawnResponse = SubagentRecordSchema

/** `POST /api/sessions/:id/subagents/:subId/message`（handler 同上）：`{ok:true}`。 */
export const SessionSubagentMessageResponse = OkResponse

/** `POST /api/sessions/:id/subagents/:subId/cancel`（handler 同上）：`{ok:true}`。 */
export const SessionSubagentCancelResponse = OkResponse
