/**
 * E10f-A：usage 读面（3 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状。
 * 形状来源（handler 是事实源）：
 *   - session.usage                → routes/usage.ts `GET /api/usage`（summary + memory +
 *                                    modelStats + providerData 合并；查询失败仍 200 空壳）
 *   - session.usagePluginsList     → routes/usage-plugins.ts `handleUsagePluginsList`
 *                                    （pluginSummary + USAGE_TEMPLATES + builtins）
 *   - session.usagePluginSourceGet → `handleUsagePluginSourceGet`（{source, origin}）
 *
 * provider / window 字段的值域由**外置 usage 插件**（用户 JS）拥有：poller 只做 budget 折叠，
 * 不重写字段；因此 provider 行按边界对象建模（已知键 + 开放索引）。
 */
import { Type } from '@sinclair/typebox'

// ── session.usage ───────────────────────────────────────────────────────────

const TokenCountsSchema = Type.Object({
  input: Type.Number(),
  output: Type.Number(),
  reasoning: Type.Number(),
  cache: Type.Object({
    read: Type.Number(),
    write: Type.Number(),
  }),
})

/** project / global 汇总（`getProjectTokenSummary` / `getGlobalTokenSummary`）。 */
const ScopeSummarySchema = Type.Object({
  totalTokens: TokenCountsSchema,
  totalCost: Type.Number(),
  turnCount: Type.Number(),
  sessionCount: Type.Number(),
})

/**
 * session 汇总来自 `getSessionTokenSummary`（无 sessionCount，带 avgTokensPerTurn）；
 * 无 store / 未带 sessionID 时 handler 回同一形状的零值汇总（含 sessionCount: 0）。
 */
const SessionSummarySchema = Type.Object({
  totalTokens: TokenCountsSchema,
  totalCost: Type.Number(),
  turnCount: Type.Number(),
  sessionCount: Type.Optional(Type.Number()),
  avgTokensPerTurn: TokenCountsSchema,
})

const UsageSummarySchema = Type.Object({
  session: SessionSummarySchema,
  project: ScopeSummarySchema,
  global: ScopeSummarySchema,
})

/** memory 角色账本（worker 用量；byRole 键是 worker role）。 */
const MemorySummarySchema = Type.Object({
  totalTokens: TokenCountsSchema,
  totalCost: Type.Number(),
  turnCount: Type.Number(),
  sessionCount: Type.Number(),
  byRole: Type.Record(Type.String(), ScopeSummarySchema),
})

/** `ModelUsageRow` + `estimatedCost`（无价目表时为 null）。 */
const ModelUsageRowSchema = Type.Object({
  provider: Type.Union([Type.String(), Type.Null()]),
  model: Type.String(),
  turns: Type.Number(),
  tokens: TokenCountsSchema,
  estimatedCost: Type.Union([Type.Number(), Type.Null()]),
})

const ModelStatsSchema = Type.Object({
  windows: Type.Object({
    today: Type.Array(ModelUsageRowSchema),
    '7d': Type.Array(ModelUsageRowSchema),
    '30d': Type.Array(ModelUsageRowSchema),
    all: Type.Array(ModelUsageRowSchema),
  }),
})

/**
 * 边界形状（owner = usage 插件 / poller 折叠）：内置插件用 `5h|day|7d|month|balance` 与
 * `$|tokens|requests|pct|credit`，但外置插件是用户 JS，poller 只按 budget 折叠 balance 窗口，
 * 不强制值域 → `window` / `unit` / `pacing` 保持开放字符串。数值五键恒由插件产出。
 */
const UsageWindowSchema = Type.Object({
  window: Type.String(),
  used: Type.Number(),
  limit: Type.Number(),
  unit: Type.String(),
  resetAt: Type.Optional(Type.Number()),
  pct: Type.Number(),
  pacing: Type.Optional(Type.String()),
  projected: Type.Optional(Type.Number()),
  remaining: Type.Optional(Type.Number()),
  tokens: Type.Optional(Type.Number()),
  projectedCost: Type.Optional(Type.Number()),
  /** 附加明细行（如分模型消耗），UI tooltip 逐行展示。 */
  detailLines: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: true })

/** 一个 provider 的用量账本（name 恒有；plan/type/severity 由插件决定）。 */
const UsageProviderSchema = Type.Object({
  name: Type.String(),
  plan: Type.Optional(Type.String()),
  type: Type.Optional(Type.String()),
  windows: Type.Array(UsageWindowSchema),
  severity: Type.Optional(Type.String()),
}, { additionalProperties: true })

/**
 * GET /api/usage 的两个分支：
 *  - 成功：`summary` 对象 + `memory`（可为 null）+ `modelStats` + `providers` / `updatedAt`；
 *  - 查询失败（fail-open 200）：`summary: null` + 空 `providers` + `updatedAt`（无 memory/modelStats）。
 * 因此 `memory` / `modelStats` optional，`summary` 可空，其余三键恒在。
 */
export const SessionUsageResponse = Type.Object({
  summary: Type.Union([UsageSummarySchema, Type.Null()]),
  memory: Type.Optional(Type.Union([MemorySummarySchema, Type.Null()])),
  modelStats: Type.Optional(ModelStatsSchema),
  providers: Type.Array(UsageProviderSchema),
  updatedAt: Type.Number(),
})

// ── session.usagePluginsList ────────────────────────────────────────────────

/** `ConfigSchemaField`（plugin-loader）：select 必有 options；default 三型之一。 */
const ConfigSchemaFieldSchema = Type.Object({
  key: Type.String(),
  label: Type.String(),
  type: Type.Union([
    Type.Literal('number'),
    Type.Literal('string'),
    Type.Literal('boolean'),
    Type.Literal('select'),
  ]),
  options: Type.Optional(Type.Array(Type.String())),
  default: Type.Optional(Type.Union([Type.String(), Type.Number(), Type.Boolean()])),
})

/** `pluginSummary()` 行：origin 由 loader 判定（builtin / override / user）。 */
export const UsagePluginSummarySchema = Type.Object({
  file: Type.String(),
  name: Type.Optional(Type.String()),
  status: Type.Union([Type.Literal('ok'), Type.Literal('error')]),
  error: Type.Optional(Type.String()),
  disabled: Type.Boolean(),
  origin: Type.Union([Type.Literal('builtin'), Type.Literal('override'), Type.Literal('user')]),
  /** 原生 mod.type 透传（'api' | 'token-plan' | 'local' | …）——插件作者拥有词表。 */
  pluginType: Type.Optional(Type.String()),
  configSchema: Type.Optional(Type.Array(ConfigSchemaFieldSchema)),
  /** usage.pluginConfig 的持久化值（无 name 时为 null）。 */
  config: Type.Unknown(),
})

/** `TemplateField`（usage/templates.ts）：textarea 只出现在表单模板里。 */
const TemplateFieldSchema = Type.Object({
  key: Type.String(),
  label: Type.String(),
  type: Type.Union([
    Type.Literal('string'),
    Type.Literal('number'),
    Type.Literal('boolean'),
    Type.Literal('select'),
    Type.Literal('textarea'),
  ]),
  required: Type.Optional(Type.Boolean()),
  options: Type.Optional(Type.Array(Type.String())),
  placeholder: Type.Optional(Type.String()),
  hint: Type.Optional(Type.String()),
})

/** `UsageTemplate`：render 函数不进 wire（UI 只拿字段声明）。 */
const UsageTemplateSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  description: Type.String(),
  fields: Type.Array(TemplateFieldSchema),
})

export const UsagePluginsListResponse = Type.Object({
  plugins: Type.Array(UsagePluginSummarySchema),
  templates: Type.Array(UsageTemplateSchema),
  builtins: Type.Array(Type.String()),
})

// ── session.usagePluginSourceGet ────────────────────────────────────────────

/**
 * 成功体（200）：用户插件文件源码 + origin。
 * 403（builtin 只读）/ 404（文件不存在）是错误信封 `{error, builtin?}`，不属于 200 schema。
 */
export const UsagePluginSourceResponse = Type.Object({
  source: Type.String(),
  origin: Type.Union([Type.Literal('override'), Type.Literal('user')]),
})
