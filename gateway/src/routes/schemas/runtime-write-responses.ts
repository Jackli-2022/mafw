/**
 * E10h-R5：runtime 写接口（6 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/runtime-switch.ts`（switch / reload）
 *   - `routes/restart-agent.ts`（restartAgent）
 *   - `routes/dry-event.ts`（dryEvent）
 *   - `routes/conformance.ts`（conformance）
 *   - `routes/runtime-config.ts`（config.update）
 *
 * 复用读侧 DTO：`RuntimeCapabilitiesSchema` / `RuntimePluginStateSchema`
 * （`schemas/runtime-surface.ts`，`runtime.get` 的同一投影）——switch 的
 * `active.capabilities` 与 reload 的 `plugins` 都是同一份 runtime loader 状态。
 *
 * 错误体（400/409/500/503）不属于 200 形态，不在此建模。
 */
import { Type } from '@sinclair/typebox'
import { RuntimeCapabilitiesSchema, RuntimePluginStateSchema } from './runtime-surface'

// ── runtime.switch ──────────────────────────────────────────────────────────

/**
 * `POST /api/runtime/switch`（handler：`handleRuntimeSwitch` → `performRuntimeSwitch`）。
 *
 * 只有切换成功才 200：`success` 恒 true（失败走 400 `not-found` / 409 `blocked`
 * / 500 `failed`），`active` 是切换后的 runtime 身份与能力位，
 * `envOverride` 表示是否有 `MAFW_RUNTIME_PLUGIN` 环境覆盖在生效。
 */
export const RuntimeSwitchResponse = Type.Object({
  success: Type.Literal(true),
  active: Type.Object({
    name: Type.String({ description: 'Active runtime facade identity (bare name, no dialect suffix).' }),
    capabilities: RuntimeCapabilitiesSchema,
  }),
  envOverride: Type.Boolean({
    description: 'True when an environment override pins the runtime for this process.',
  }),
})

// ── runtime.restartAgent ────────────────────────────────────────────────────

/**
 * `POST /api/runtime/restart-agent`（handler：`handleRestartAgent`）。
 * 503（无 `process.restart` 能力）/ 409（恢复或切换中）都不是 200；
 * 200 只在 agent 进程重启被受理后出现，`mode` 由 adapter 决定（如 `serve`）。
 */
export const RuntimeRestartAgentResponse = Type.Object({
  success: Type.Literal(true),
  mode: Type.String({ description: 'Restart mode reported by the runtime adapter.' }),
})

// ── runtime.reload ──────────────────────────────────────────────────────────

/**
 * `POST /api/runtime/reload`（handler：`handleRuntimeReload` → `loader.scan()`）。
 *
 * 只重扫插件目录，不切换 runtime：200 回扫描后的 loader 状态行
 * （与 `runtime.get` 的 `plugins` 同形）。无 loader 时是 503。
 */
export const RuntimeReloadResponse = Type.Object({
  plugins: Type.Array(RuntimePluginStateSchema),
})

// ── runtime.dryEvent ────────────────────────────────────────────────────────

/** `ApprovalFacet`（`runtime/normalize.ts`）：permission.asked 的审批候选。 */
const ApprovalFacetSchema = Type.Object({
  requestId: Type.String(),
  toolName: Type.String(),
  patterns: Type.Array(Type.String()),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

/**
 * 归一化 facet 投影（`handleDryEvent` 现场组装）：每个 facet 都显式补 `null`，
 * 因此六键恒在（`step` 折成布尔，其余保持三态/二态）。
 */
const DryEventFacetsSchema = Type.Object({
  sessionID: Type.Union([Type.String(), Type.Null()]),
  step: Type.Boolean(),
  chatSignal: Type.Union([
    Type.Literal('delta'),
    Type.Literal('complete'),
    Type.Literal('error'),
    Type.Null(),
  ]),
  compaction: Type.Union([Type.Literal('start'), Type.Literal('end'), Type.Null()]),
  toolCommand: Type.Union([Type.String(), Type.Null()]),
  approval: Type.Union([ApprovalFacetSchema, Type.Null()]),
})

/**
 * 事件流向矩阵行（`runtime/event-flow-matrix.ts` `EventFlowRow`）的 HTTP 投影：
 * handler 只挑四个键下发（`normalizeFacet` 不外泄）。
 */
const DryEventFlowSchema = Type.Object({
  modeA: Type.Union([Type.Literal('passthrough'), Type.Literal('rewrite'), Type.Literal('drop')]),
  desktop: Type.Union([Type.Literal('handled'), Type.Literal('ignore')]),
  tui: Type.Union([Type.Literal('handled'), Type.Literal('ignore')]),
  note: Type.Optional(Type.String()),
})

/**
 * `POST /api/runtime/dry-event`（handler：`handleDryEvent`）。
 *
 * 一个 schema 覆盖 handler 的三条成功分支（同一条语句族的不同键组合）：
 *   1. 映射表把事件丢掉：`{plugin, mapping:{matched:false,dropped:true}, type:null,
 *      known:false, facets:null, warnings:[]}`；
 *   2. 工具三原语：`{plugin?, mapping?, type, known:true, facets:null, warnings:[],
 *      assembled}` —— `assembled` 是 ToolPartAssembler 合成的**runtime 事件**数组
 *      （owner = `@mafw/runtime-core` `RawRuntimeEvent`），故按开放对象数组建模；
 *   3. 普通事件：`{plugin?, mapping?, type, known, facets:{…}, flow?, warnings}`。
 *
 * 因此 `type` 可空、`facets` 可空但**恒在**、`flow` / `assembled` / `plugin` /
 * `mapping` 只在对应分支出现。400（未知 plugin / 非法 body）不进本 schema。
 */
export const RuntimeDryEventResponse = Type.Object({
  plugin: Type.Optional(Type.String({
    description: 'Echo of the requested mapping plugin; absent for identity passthrough.',
  })),
  mapping: Type.Optional(Type.Object({
    matched: Type.Boolean(),
    to: Type.Optional(Type.String({ description: 'Canonical type the mapping rewrote the event to.' })),
    dropped: Type.Optional(Type.Boolean({ description: 'True when the mapping table dropped the event.' })),
  })),
  type: Type.Union([Type.String(), Type.Null()], {
    description: 'Canonical event type; null when the mapping dropped the event.',
  }),
  known: Type.Boolean({ description: 'Whether the type is a known canonical event.' }),
  facets: Type.Union([DryEventFacetsSchema, Type.Null()], {
    description: 'Normalized facets; null for dropped events and assembled tool primitives.',
  }),
  flow: Type.Optional(DryEventFlowSchema),
  warnings: Type.Array(Type.String(), {
    description: 'Field-contract warnings raised while checking the sample.',
  }),
  assembled: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Unknown()), {
    description: 'Runtime-native events emitted by the ToolPart assembler (owner = runtime-core RawRuntimeEvent).',
  })),
})

// ── runtime.conformance ─────────────────────────────────────────────────────

/**
 * `POST /api/runtime/conformance`（handler：`handleConformance`）。
 *
 * 逐场景结果 + 汇总；能力位缺失 / 场景崩溃都算 `pass:false`（200 上报告，
 * 不是 HTTP 失败）。`failures` 恒为数组（空数组表示通过）。
 */
export const RuntimeConformanceResponse = Type.Object({
  runtime: Type.String({ description: 'Active runtime facade identity that was exercised.' }),
  results: Type.Array(Type.Object({
    id: Type.String({ description: 'Scenario id (chat-roundtrip / tool-visibility / …).' }),
    title: Type.String(),
    pass: Type.Boolean(),
    failures: Type.Array(Type.String()),
    durationMs: Type.Number(),
  })),
  summary: Type.Object({
    pass: Type.Number(),
    fail: Type.Number(),
  }),
})

// ── runtime.config.update ───────────────────────────────────────────────────

/**
 * `PATCH /api/runtime-config`（handler：`routes/runtime-config.ts` 的
 * `runtime.config.update` → `runtimeHost.config.update(body)`）。
 *
 * 200 是 `{status:'ok', config}`：`config` 是 merge 之后的**整份 runtime Config**
 * （owner = runtime；裸 runtime 或空返回时是 `null`）。字段面归 runtime 所有，
 * 因此只承诺「对象 + 开放索引」，不复制 runtime 配置模型（与
 * `RuntimeConfigGetResponse` 同口径）。body 解析失败是 500，不是 200。
 */
export const RuntimeConfigUpdateResponse = Type.Object({
  status: Type.Literal('ok'),
  config: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
})
