/**
 * E10f-B：runtime / plugin 读面（4 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状；
 * `emit:openapi` 直接投影成 `responses.200.content['application/json'].schema`。
 * 形状来源（handler 是事实源）：
 *   - runtime.get        → routes/runtime-switch.ts `handleRuntimeGet()`（identity + loader state + 遥测）
 *   - runtime.contract   → 同文件 `handleRuntimeContract()`（manifest + active coverage）
 *   - runtime.config.get → routes/runtime-config.ts（runtime Config 原样透传）
 *   - plugins.client     → routes/plugin-packages.ts `handlePluginClient()` + plugins/client-descriptor.ts
 *
 * 本文件里四份 payload 都跨 runtime / plugin 进程边界，gateway 只做投影不做 owner：
 * 深层值域归 `RuntimeContractManifest` / `RuntimeCoverage` / `PluginClientDescriptor`
 * 各自的契约包所有 → 这里用**边界对象**（顶层身份键 + 开放索引/开放条目）承诺，
 * 不把 emitter 侧的演进锁进 HTTP 契约。
 */
import { Type } from '@sinclair/typebox'

// ── 共享：runtime 能力位（owner = runtime 契约） ─────────────────────────────

/**
 * `RuntimeCapabilities` 是 runtime 自声明的布尔位（键集随 runtime 版本演进）。
 * gateway 原样下发，不在这里枚举键名。
 */
const RuntimeCapabilitiesSchema = Type.Record(Type.String(), Type.Boolean())

// ── runtime.get ─────────────────────────────────────────────────────────────

/** `RuntimeCoverage`（owner = runtime coverage 引擎）：覆盖矩阵细节不进 HTTP 契约。 */
const RuntimeCoverageSchema = Type.Object({
  runtime: Type.String(),
  contractVersion: Type.String(),
  static: Type.Record(Type.String(), Type.Unknown()),
  behavioral: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

/** `RuntimePluginState`（runtime/loader.ts）：扫描结果行（builtin/package 前缀在 `file`）。 */
const RuntimePluginStateSchema = Type.Object({
  file: Type.String(),
  name: Type.Optional(Type.String()),
  status: Type.Union([Type.Literal('ok'), Type.Literal('error')]),
  error: Type.Optional(Type.String()),
  capabilities: Type.Optional(RuntimeCapabilitiesSchema),
  /** 文件名 stem 别名（仅当 stem ≠ 声明名时存在；hub 用它定位插件）。 */
  alias: Type.Optional(Type.String()),
})

/** 翻译守卫失败计数（B2）：per-runtime `{transformEvent, normalizeMessages, lastError?, lastAt?, lastWarnAt?}`。 */
const TranslationErrorEntrySchema = Type.Object({
  transformEvent: Type.Number(),
  normalizeMessages: Type.Number(),
  lastError: Type.Optional(Type.String()),
  lastAt: Type.Optional(Type.String()),
  lastWarnAt: Type.Optional(Type.Number()),
})

/** 入口拦截计数（B3）：per-runtime per-type 的 unmatched / suppressed 计数。 */
const TranslationDropEntrySchema = Type.Object({
  unmatched: Type.Record(Type.String(), Type.Number()),
  suppressed: Type.Record(Type.String(), Type.Number()),
})

/**
 * `GET /api/runtime`：
 *   - `active` 是当前 runtime 身份（capabilities / dialect / coverage 归 runtime）；
 *   - `plugins` 是 loader 扫描状态；
 *   - `unknownEvents` / `validation` / `translation*` 是 gateway 诊断遥测。
 */
export const RuntimeGetResponse = Type.Object({
  active: Type.Object({
    name: Type.String(),
    capabilities: RuntimeCapabilitiesSchema,
    envOverride: Type.Boolean(),
    /** 当前方言标签（钉死名取 `@` 后缀，自适应取探测结果）；无则 null。 */
    dialect: Type.Union([Type.String(), Type.Null()]),
    coverage: Type.Union([RuntimeCoverageSchema, Type.Null()]),
  }),
  plugins: Type.Array(RuntimePluginStateSchema),
  unknownEvents: Type.Record(Type.String(), Type.Record(Type.String(), Type.Number())),
  validation: Type.Array(Type.String()),
  translationErrors: Type.Record(Type.String(), TranslationErrorEntrySchema),
  translationDrops: Type.Record(Type.String(), TranslationDropEntrySchema),
})

// ── runtime.contract ────────────────────────────────────────────────────────

/**
 * `RuntimeContractManifest`（owner = runtime 契约 manifest emitter）：
 * 顶层身份/版本与五组条目数组固定，条目内部字段由契约包拥有 → 开放对象。
 * 与 `@mafw/sdk` 的 `RuntimeContractManifest` 边界 DTO 逐字段等价（AssertEq 锁定）。
 */
const ContractManifestSchema = Type.Object({
  schemaVersion: Type.Number(),
  contractVersion: Type.String(),
  generatedFrom: Type.String(),
  domains: Type.Array(Type.Object({
    id: Type.String(),
    title: Type.String(),
    description: Type.String(),
  })),
  surfaces: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  capabilities: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  events: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  cognition: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  presets: Type.Array(Type.Record(Type.String(), Type.Unknown())),
})

/**
 * `GET /api/runtime/contract` → `{manifest, coverage}`。
 * coverage 未计算时是 null（sidecar 尚未就绪 / 契约不可用 → 503 错误信封）。
 */
export const RuntimeContractResponse = Type.Object({
  manifest: ContractManifestSchema,
  coverage: Type.Union([RuntimeCoverageSchema, Type.Null()]),
})

// ── runtime.config.get ──────────────────────────────────────────────────────

/**
 * `GET /api/runtime-config` → `{config}`。
 *
 * `config` 是 runtime Config 的原样投影（`runtimeHost.config.get()`，裸 runtime 时为 `{}`）：
 * config 的键集与值域**归 runtime 所有**（不同 runtime 的 provider/model 段不同），
 * 因此契约只承诺「对象 + 开放索引」，不复制 runtime 配置模型。
 */
export const RuntimeConfigGetResponse = Type.Object({
  config: Type.Record(Type.String(), Type.Unknown()),
})

// ── plugins.client ──────────────────────────────────────────────────────────

/**
 * `PluginClientDescriptor`（owner = `@mafw/plugin-contract`）。
 *
 * 顶层身份键（name/version/revision + 四类贡献）固定；`ui` / `actions` / `events`
 * 的内部形状归 plugin-contract 所有（slot、widget、action 描述符随契约版本演进），
 * 所以按边界对象承诺：贡献内部是开放对象，顶层允许契约新增键。
 */
const PluginClientDescriptorSchema = Type.Object({
  name: Type.String(),
  version: Type.String(),
  revision: Type.String(),
  title: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  ui: Type.Record(Type.String(), Type.Unknown()),
  actions: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  events: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  diagnostics: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Unknown()))),
}, { additionalProperties: true })

/**
 * `GET /api/plugins/client` → committed snapshot 只有 `{revision, plugins}`；
 * pending 候选永不投影。包按 name 排序（确定性 diff）。
 */
export const PluginsClientResponse = Type.Object({
  revision: Type.String(),
  plugins: Type.Array(PluginClientDescriptorSchema),
})
