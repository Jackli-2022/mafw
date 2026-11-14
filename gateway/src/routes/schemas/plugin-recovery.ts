/**
 * E10g-fix（main Phase 6 集成）：plugin 自愈面的请求 / 响应 schema。
 *
 * 这些 op 由 main 的 Phase 6 落地（`routes/wave2-handlers.ts` 的
 * `plugins.doctorAll` / `doctor` / `kill` / `resume` / `quarantine` /
 * `unquarantine` / `audit` / `lastGood` / `rollback`），实现全部在
 * `routes/plugin-packages.ts`；schema 逐项对齐 handler 返回值，不是设计稿：
 *   - doctor → `PluginDoctor.check` / `checkAll`（`plugins/plugin-doctor.ts`）；
 *   - kill / resume → `PluginSafety.kill` / `resume`（`plugins/plugin-safety.ts`）；
 *   - quarantine / unquarantine → handler 自己组装的 `{name, quarantined, reason?}`；
 *   - audit → `{events: PluginAuditStore.list()}`（`plugins/plugin-audit-store.ts`）；
 *   - lastGood → `{name, lastGood: PackageLastGoodStore.read()}`（`LastGoodMeta`）。
 *
 * 只有声明，不做运行时校验（与 E10g 其他批同口径）：handler 才是事实源，
 * 条件必填 / 空对象语义用 description 与 `requestRequired` 表达。
 */
import { Type } from '@sinclair/typebox'

// ── plugins.quarantine ────────────────────────────────────────────────────

/**
 * `POST /api/plugins/:name/quarantine`（handler：`routes/plugin-packages.ts`
 * `handlePluginQuarantine`）。
 *
 * 包名来自路径 `:name`；body 必须带非空 `reason`（缺失 / 非字符串 / 空串 →
 * 400 `reason is required`）。隔离本身不改包文件，只写状态 + 审计。
 */
export const PluginQuarantineRequest = Type.Object({
  reason: Type.String({
    minLength: 1,
    description: 'Why the package is being isolated; stored in state and the trust audit (empty → 400).',
  }),
})

// ── plugins.audit（GET）───────────────────────────────────────────────────

/** `PluginAuditAction`（`plugins/plugin-audit-store.ts`）：审计动作的封闭枚举。 */
const PluginAuditAction = Type.Union([
  Type.Literal('install'),
  Type.Literal('install.rejected'),
  Type.Literal('enable'),
  Type.Literal('disable'),
  Type.Literal('remove'),
  Type.Literal('reload'),
  Type.Literal('apply'),
  Type.Literal('activate.failed'),
  Type.Literal('quarantine'),
  Type.Literal('unquarantine'),
  Type.Literal('safe-mode.on'),
  Type.Literal('safe-mode.off'),
  Type.Literal('rollback'),
  Type.Literal('doctor'),
])

/**
 * 审计事件（`PluginAuditEvent`）。`detail` 只保留 allowlist 键
 * （reason / permissions / consent / apiVersion / kind / host /
 * previousVersion / restoredVersion / doctorSummary），但值的形状随动作为准，
 * 因此声明为开放对象而不是逐键枚举。
 */
const PluginAuditEvent = Type.Object({
  id: Type.String({ description: 'Audit row id (`pa_<uuid>`).' }),
  at: Type.String({ description: 'ISO timestamp written when the action ran.' }),
  action: PluginAuditAction,
  package: Type.Optional(Type.String({ description: 'Package name; absent for gateway-wide actions (safe-mode.on/off).' })),
  version: Type.Optional(Type.String()),
  fingerprint: Type.Optional(Type.String()),
  principalKind: Type.Optional(Type.String({ description: 'human | device | service | local (principal that acted).' })),
  principalMethod: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String({ description: 'Originating session when the action came from a session-bound client.' })),
  result: Type.Union([Type.Literal('ok'), Type.Literal('failed'), Type.Literal('denied')]),
  detail: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
    description: 'Allowlisted diagnostic detail (reason / permissions / consent / versions / doctorSummary).',
  })),
})

/**
 * `GET /api/plugins/audit`（handler：`handlePluginAudit`）。
 *
 * query：`package` 过滤包名，`limit` 1..500（越界 → 400）。空审计表返回
 * `{events: []}`（200），503 只表示审计库未接线。
 */
export const PluginsAuditResponse = Type.Object({
  events: Type.Array(PluginAuditEvent),
})

// ── plugins.lastGood（GET）────────────────────────────────────────────────

/**
 * `GET /api/plugins/:name/last-good`（handler：`handlePluginLastGood`）。
 *
 * 无快照 → 404 `last_good_missing`；store 未接线 → 503。`fingerprint` 是
 * `LastGoodMeta` 的唯一硬字段（legacy 单文件包没有 version）。
 */
export const PluginLastGoodResponse = Type.Object({
  name: Type.String(),
  lastGood: Type.Object({
    version: Type.Optional(Type.String({ description: 'Snapshot version; absent for legacy single-file packages.' })),
    fingerprint: Type.String({ description: 'Content fingerprint the snapshot was promoted with.' }),
    savedAt: Type.String({ description: 'ISO timestamp of the snapshot (promotion time).' }),
  }),
})
