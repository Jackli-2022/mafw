/**
 * E10e-1：元数据 / 注册面读接口（8 ops）的 code-first 响应 schema（TypeBox）。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状；
 * `emit:openapi` 直接投影成 `responses.200.content['application/json'].schema`。
 * 形状来源（handler 是事实源）：
 *   - agents.list      → routes/misc.ts + runtime/view-projections.ts `projectAgents()`
 *   - providers.list   → routes/misc.ts + `projectProviderEnvelope()` / `projectProvider()` / `projectModel()`
 *   - mcp.servers      → routes/mcp-mgmt.ts → routes/mcp.ts `handleMcp()`（runtime mcp channel `list()`）
 *   - plugins.list     → routes/wave2-handlers.ts → routes/plugins.ts `handlePluginsList()`
 *                        （`plugins/hub.ts` `listPlugins()` + `plugins/package-inventory.ts`）
 *   - skills.list      → routes/skills.ts（kernel `listInstalledSkills()` = DB 行 + 调用统计）
 *   - tools.list       → routes/tools.ts `handleToolsList()`（`runtime/mafw-tools.ts` `MAFW_TOOL_SPECS`）
 *   - config.get       → routes/config.ts（`config.raw` = GatewayConfig）
 *   - scheduler.status → routes/scheduler.ts `handleSchedulerStatus()`（`core/pod/pod-scheduler.ts`）
 *
 * 与 `@mafw/sdk` DTO 的等价性由 `contract-compat.checks.ts` 的编译期 AssertEq 钉住
 * （`MafwAgent` / `MafwProvider` / `McpServerEntry` / `PluginsListResult`）。
 * skills / tools / config / scheduler 无 SDK client（tags: internal 或 SDK 只回 `any`）→ schema-only。
 */
import { Type, type TSchema } from '@sinclair/typebox'
import type { GatewayConfig } from '../../config'

// ── agents.list ─────────────────────────────────────────────────────────────

/** `MafwModelRef`：`canonicalModelRef()` 的规范形状（variant 只在原生带 variant 时出现）。 */
const MafwModelRefSchema = Type.Object({
  providerID: Type.String(),
  modelID: Type.String(),
  variant: Type.Optional(Type.String()),
})

/**
 * `MafwAgent`：`projectAgents()` 的统一投影（source=mafw 走身份注册表，source=runtime
 * 走原生 agent 列表）。`selectable` 由投影判定（primary 才可选），客户端不自己重算。
 * 可选字段全部是 DTO 兼容面：投影按需条件展开（`description` / `default` / `planning` /
 * `mode` / `model`），`extensions` 是 DTO 预留的扩展槽（当前投影不产出）。
 */
const MafwAgentSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  description: Type.Optional(Type.String()),
  source: Type.Union([Type.Literal('mafw'), Type.Literal('runtime')]),
  selectable: Type.Boolean(),
  default: Type.Optional(Type.Boolean()),
  planning: Type.Optional(Type.Boolean()),
  mode: Type.Optional(Type.String()),
  model: Type.Optional(MafwModelRefSchema),
  extensions: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

/** `GET /api/agents` → `{items: MafwAgent[]}`。 */
export const AgentListResponse = Type.Object({
  items: Type.Array(MafwAgentSchema),
})

// ── providers.list ──────────────────────────────────────────────────────────

/**
 * `MafwModel`：`projectModel()` 把 `limit.context|output` 与 capabilities 收敛到中性字段
 * （`vision` / `thinking` 折进 `extensions`）；`providerID` 由 envelope 的 provider id 补齐。
 */
const MafwModelSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  providerID: Type.Optional(Type.String()),
  contextLimit: Type.Optional(Type.Number()),
  outputLimit: Type.Optional(Type.Number()),
  extensions: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

/** `MafwProvider`：`models` 恒为数组（对象映射与数组两种原生形状同形）。 */
const MafwProviderSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  models: Type.Array(MafwModelSchema),
  connected: Type.Optional(Type.Boolean()),
  extensions: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

/**
 * `GET /api/provider` → `{...原生信封, items: MafwProvider[]}`。
 *
 * `projectProviderEnvelope()` 先摊平原生信封（`all` 被删）再补 `items`，因此 200 body
 * 除 `items` 外还带 runtime 的 `connected: string[]` 与 `default: Record<providerID, modelID>`
 * （composer 默认模型的唯一来源，见 `view-projections.ts` 注释）。这两个键是
 * **runtime-owned 边界**（owner = runtime provider channel）：gateway 只透传、不改写，
 * 其余未列出的原生残余键同样随响应下发，不在契约面承诺。
 */
export const ProviderListResponse = Type.Object({
  items: Type.Array(MafwProviderSchema),
  connected: Type.Optional(Type.Array(Type.String())),
  default: Type.Optional(Type.Record(Type.String(), Type.String())),
})

// ── mcp.servers ─────────────────────────────────────────────────────────────

/**
 * `McpServerEntry`（= `@mafw/runtime-contract` `RuntimeMcpStatusInfo`）：
 * runtime mcp channel `list()` 的条目，gateway 归并定义面与运行时状态后原样下发。
 */
const McpServerEntrySchema = Type.Object({
  name: Type.String(),
  status: Type.Union([
    Type.Literal('connected'),
    Type.Literal('disabled'),
    Type.Literal('failed'),
    Type.Literal('needs_auth'),
    Type.Literal('unknown'),
  ]),
  detail: Type.Optional(Type.String()),
  type: Type.Optional(Type.Union([Type.Literal('local'), Type.Literal('remote')])),
  url: Type.Optional(Type.String()),
  command: Type.Optional(Type.Array(Type.String())),
  source: Type.Optional(Type.String()),
  disabled: Type.Optional(Type.Boolean()),
})

/** `GET /api/mcp/servers` → `{servers: McpServerEntry[]}`。 */
export const McpServersResponse = Type.Object({
  servers: Type.Array(McpServerEntrySchema),
})

// ── plugins.list ────────────────────────────────────────────────────────────

/**
 * 单个 legacy 插件文件（`plugins/hub.ts` `PluginEntry`；builtin 由 hub 补
 * `builtin`/`overridden`）。
 *
 * E10h-R5 起同时是 `plugins.install` / `plugins.enable|disable`（legacy 分支）的
 * 200 响应——`installPlugin()` / `setPluginEnabled()` 都返回 `statEntry()` 同一投影，
 * 故写侧直接复用本 schema，不写第二份转写。
 */
export const PluginsEntrySchema = Type.Object({
  type: Type.Union([
    Type.Literal('runtime'),
    Type.Literal('media'),
    Type.Literal('usage'),
    Type.Literal('ui'),
  ]),
  name: Type.String(),
  file: Type.String(),
  status: Type.Union([
    Type.Literal('enabled'),
    Type.Literal('disabled'),
    Type.Literal('error'),
    Type.Literal('config-disabled'),
  ]),
  error: Type.Optional(Type.String()),
  size: Type.Number(),
  mtime: Type.String(),
  builtin: Type.Optional(Type.Boolean()),
  overridden: Type.Optional(Type.Boolean()),
  pluginType: Type.Optional(Type.String()),
})

/**
 * 统一插件包 inventory 行（`PackageInventoryEntry` = `PackageState` + `enabled`）。
 * disabled 包在 host 扫描里缺席，由 manager 持久化的禁用名合成一行（`source: ''`）。
 */
const PluginsPackageEntrySchema = Type.Object({
  name: Type.String(),
  source: Type.String(),
  status: Type.Union([Type.Literal('ok'), Type.Literal('error'), Type.Literal('disabled')]),
  enabled: Type.Boolean(),
  error: Type.Optional(Type.String()),
  contributions: Type.Array(Type.String()),
  version: Type.Optional(Type.String()),
  revision: Type.Optional(Type.String()),
  pendingRevision: Type.Optional(Type.String()),
  fingerprint: Type.Optional(Type.String()),
  apiVersion: Type.Optional(Type.Number()),
  kind: Type.Optional(Type.Union([Type.Literal('trusted'), Type.Literal('untrusted')])),
  transport: Type.Optional(Type.Union([Type.Literal('in-process'), Type.Literal('worker')])),
  permissions: Type.Optional(Type.Array(Type.String())),
  state: Type.Optional(Type.Union([
    Type.Literal('active'), Type.Literal('pending'), Type.Literal('error'),
    Type.Literal('disabled'), Type.Literal('quarantined'),
    Type.Literal('safe-mode'), Type.Literal('degraded'),
  ])),
  quarantinedReason: Type.Optional(Type.String()),
  degradedReason: Type.Optional(Type.String()),
})

/**
 * `GET /api/plugins` → `PluginsListResult`。
 * `revision` 只在 envelope provider 存在时下发（缺失即省略，不是 null）。
 */
export const PluginsListResponse = Type.Object({
  plugins: Type.Array(PluginsEntrySchema),
  packages: Type.Optional(Type.Array(PluginsPackageEntrySchema)),
  revision: Type.Optional(Type.String()),
  safeMode: Type.Optional(Type.Boolean()),
})

// ── skills.list ─────────────────────────────────────────────────────────────

/**
 * 技能调用统计（`SkillInvocationStats`；无调用记录时 kernel 补零行 `lastAt: null`）。
 */
const SkillInvocationStatsSchema = Type.Object({
  total: Type.Number(),
  success: Type.Number(),
  failure: Type.Number(),
  unknown: Type.Number(),
  lastAt: Type.Union([Type.Number(), Type.Null()]),
})

/**
 * `skills.list` item = `SkillRegistryRecord` + `stats`（kernel `listInstalledSkills()`：
 * DB 行 `{...record}` 后补 stats）。`installedAt` / `updatedAt` 是 DB 的 epoch 毫秒列。
 */
const SkillRegistryItemSchema = Type.Object({
  name: Type.String(),
  version: Type.Number(),
  status: Type.Union([
    Type.Literal('staging'),
    Type.Literal('active'),
    Type.Literal('paused'),
    Type.Literal('deprecated'),
  ]),
  sourceMemoryIds: Type.Array(Type.String()),
  sourceTraceIds: Type.Array(Type.String()),
  installedAt: Type.Number(),
  updatedAt: Type.Number(),
  deoptReason: Type.Union([Type.String(), Type.Null()]),
  stats: SkillInvocationStatsSchema,
})

/** `GET /api/skills` → `{skills: SkillRegistryItem[]}`（redirect 前 200 形状）。 */
export const SkillsListResponse = Type.Object({
  skills: Type.Array(SkillRegistryItemSchema),
})

// ── tools.list ──────────────────────────────────────────────────────────────

/** MCP stable spec 注解（`runtime/tool-classes.ts` `MafwToolAnnotations`，全部 optional）。 */
const MafwToolAnnotationsSchema = Type.Object({
  title: Type.Optional(Type.String()),
  readOnlyHint: Type.Optional(Type.Boolean()),
  destructiveHint: Type.Optional(Type.Boolean()),
  idempotentHint: Type.Optional(Type.Boolean()),
  openWorldHint: Type.Optional(Type.Boolean()),
})

/**
 * `MafwToolSpec`：MAFW 基础工具声明（gateway 单一来源，runtime 激活期按会话物化）。
 * `parameters` / `outputSchema` 是**工具作者拥有的 JSON Schema 对象**（owner = 各工具
 * 的 spec 声明，含 properties/required 等任意合法 JSON Schema 键）→ 边界对象，不逐键建模。
 */
const MafwToolSpecSchema = Type.Object({
  name: Type.String(),
  label: Type.Optional(Type.String()),
  description: Type.String(),
  parameters: Type.Record(Type.String(), Type.Unknown()),
  annotations: Type.Optional(MafwToolAnnotationsSchema),
  outputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

/** `GET /api/tools` → `{tools: MafwToolSpec[]}`（loopback-only；非 loopback 走 403 错误体）。 */
export const ToolsListResponse = Type.Object({
  tools: Type.Array(MafwToolSpecSchema),
})

// ── config.get ──────────────────────────────────────────────────────────────

/**
 * `config.get` 的顶层 section 键集（`GatewayConfig` 的 section 名）。
 * 用编译期断言钉住与 `keyof GatewayConfig` 的双向相等：新增/改名 section 会直接红 tsc，
 * 不会静默漂移。
 */
const CONFIG_SECTION_KEYS = [
  'server',
  'paths',
  'timeouts',
  'loop',
  'goal',
  'mobile',
  'search',
  'memory',
  'decay',
  'llm',
  'logging',
  'mcpserver',
  'metrics',
  'chat',
  'manager',
  'recall',
  'usage',
  'trajectory',
  'approval',
  'media',
  'cognition',
  'events',
  'runtime',
  'alignment',
  'resources',
  'env',
] as const satisfies readonly (keyof GatewayConfig)[]

type MissingConfigSection = Exclude<keyof GatewayConfig, (typeof CONFIG_SECTION_KEYS)[number]>
type ExtraConfigSection = Exclude<(typeof CONFIG_SECTION_KEYS)[number], keyof GatewayConfig>

/**
 * 编译期双向断言：section 键集 ≡ `keyof GatewayConfig`（多一个 / 少一个都红 tsc）。
 * 导出以参与模块图（同时作为 section 台账的可引用出口）。
 */
export const CONFIG_SECTION_KEYS_MATCH_GATEWAY_CONFIG:
  [MissingConfigSection, ExtraConfigSection] extends [never, never] ? true : false = true

/**
 * 单个配置 section。
 *
 * 边界说明（owner = gateway config loader，`gateway/src/config.ts` `Config.buildData`）：
 * 200 body 是 `config.raw`，即「内置 defaults + `config.yaml` 覆盖 + env 覆盖」的深合并结果
 * （`deepMerge` 对未知键同样写入）。因此 section 内的键集是**运维可扩展的**：`GatewayConfig`
 * 给的是内置词汇表，不是封闭契约。这里只承诺「每个 section 是对象」——外层 section 名由上面的
 * 编译期断言锁定，**不整响应放宽**（未将 200 顶层退化成任意 JSON）。逐字段转写会把
 * `GatewayConfig` 手抄成第二份无编译期链接的副本 → 静默漂移，故不做。
 */
const ConfigSectionBoundary = Type.Record(Type.String(), Type.Unknown())

const ConfigGetResponseProperties: Record<string, TSchema> = {}
for (const section of CONFIG_SECTION_KEYS) ConfigGetResponseProperties[section] = ConfigSectionBoundary

/** `GET /api/config` → `GatewayConfig`（26 个 section 全部随 defaults 下发）。 */
export const ConfigGetResponse = Type.Object(ConfigGetResponseProperties)

// ── scheduler.status ────────────────────────────────────────────────────────

/**
 * `SchedulerPlan`（`core/pod/pod-scheduler.ts` `planPromotions()`）：`start` 是即将
 * 提升的 goalId，`waiting` 是排队 goalId；`humanSlot` 打开时 capacity +1（人类介入槽）。
 */
const SchedulerPlanSchema = Type.Object({
  start: Type.Array(Type.String()),
  waiting: Type.Array(Type.String()),
  humanSlot: Type.Boolean(),
  capacity: Type.Number(),
})

/** `GET /api/scheduler/status` → `SchedulerStatus`（404 是 `{error}`，不是 200 body）。 */
export const SchedulerStatusResponse = Type.Object({
  active: Type.Array(Type.String()),
  queued: Type.Array(Type.String()),
  capacity: Type.Number(),
  plan: SchedulerPlanSchema,
})
