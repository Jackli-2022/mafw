/**
 * E10h-R5：plugin 写接口（17 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/plugins.ts`（install / enable / disable / delete：legacy hub 面）
 *   - `routes/plugin-packages.ts`（installPackage / check / apply / reload / invoke /
 *     kill / resume / quarantine / unquarantine / doctor / doctorAll / rollback）
 *   - `routes/plugin-web.ts`（webTicket）
 *
 * 复用的读侧 DTO（不写第二份转写）：
 *   - `PluginsEntrySchema` —— `plugins.list` 的 item（`plugins/hub.ts` `PluginEntry`）；
 *     也是 `plugins.install` 与 enable/disable/delete 的 legacy 分支返回值。
 *
 * 两类**判别式双分支**（handler 的 `assertBodyShape` 收窄到 `{package}` 或
 * `{type,filename}`，两条路径返回不同 DTO）：
 *   - enable / disable：`{package}` → `UpdateResult`，legacy → `PluginEntry`；
 *   - delete：`{package}` → `UpdateResult`，legacy → `{ok:true}`。
 *
 * `plugins.invoke` 的 `output` 是**插件定义**的 action 结果（owner = 统一插件包
 * 的 `outputSchema`，gateway 只透传 committed registry 的返回值），因此按 JSON
 * 边界建模：开放对象 + 其余 JSON 形态，不枚举字段。
 *
 * `plugins.install` 的**请求**是原始 `.js` 字节流 + query（E10g 排除，见
 * `schemas/plugin-write.ts` 尾注），但**响应仍是 JSON**：安装成功回 `PluginEntry`
 * （`installPlugin()` 的 `statEntry()` 结果）。
 */
import { Type } from '@sinclair/typebox'
import { PluginsEntrySchema } from './meta'
import { OkResponse } from './session-write-responses'

// ── 共享：manager 结果类型（`plugins/package-manager.ts`）───────────────────

/** `PluginKind`（`plugins/package-manifest.ts`）：包信任级别。 */
const PluginKind = Type.Union([Type.Literal('trusted'), Type.Literal('untrusted')])

/** `InstallResult['application']`：文件落盘后的应用结果。 */
const PluginApplication = Type.Union([
  Type.Literal('applied'),
  Type.Literal('pending'),
  Type.Literal('failed'),
])

/**
 * `InstallResult`（`PackageManager.installFromPath`）：
 * `saved` = 文件已进插件根，`application` = 是否已生效（`pending` 需 apply）。
 * `kind` / `apiVersion` 只在包清单解析成功时出现（v1 包可缺 `apiVersion`）。
 */
export const PluginInstallResultSchema = Type.Object({
  name: Type.String({ description: 'Package name from the manifest.' }),
  version: Type.Optional(Type.String({ description: 'Manifest version; absent for legacy packages.' })),
  activeRevision: Type.Optional(Type.String({ description: 'Committed revision now serving clients.' })),
  pendingRevision: Type.Optional(Type.String({ description: 'Staged revision awaiting apply.' })),
  saved: Type.Boolean({ description: 'Package files exist in the plugin root.' }),
  application: PluginApplication,
  error: Type.Optional(Type.String({ description: 'Activation error when application is failed.' })),
  kind: Type.Optional(PluginKind),
  apiVersion: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2)], {
    description: 'Unified contract version declared by the manifest.',
  })),
})

/**
 * `UpdateResult`（enable / disable / remove / reload / rollback / applyPending）：
 * `enabled` 是**写入后**的启用状态；`runtimeSwitchRequired` / `runtimeName` 只在
 * `applyPending` 命中运行时贡献时出现（路由层据此触发一次真实切换）。
 */
export const PluginUpdateResultSchema = Type.Object({
  name: Type.String(),
  version: Type.Optional(Type.String()),
  activeRevision: Type.Optional(Type.String()),
  pendingRevision: Type.Optional(Type.String()),
  saved: Type.Boolean(),
  enabled: Type.Boolean(),
  application: PluginApplication,
  error: Type.Optional(Type.String()),
  runtimeSwitchRequired: Type.Optional(Type.Boolean({
    description: 'The committed package owns the active runtime; the caller must switch it.',
  })),
  runtimeName: Type.Optional(Type.String({
    description: 'Runtime contribution name (loader key) when runtimeSwitchRequired is true.',
  })),
})

/**
 * `PluginCheckFailureCode`（`plugins/package-host.ts`）：`ok:false` 的稳定原因。
 *
 * 固定枚举——消费方（CLI / CI / agent）switch 这个值而不是匹配 `error` 文案；
 * 原始错误文本永远不会出现在这里。
 */
const PluginCheckFailureCode = Type.Union([
  Type.Literal('candidate_missing'),
  Type.Literal('manifest_invalid'),
  Type.Literal('entry_missing'),
  Type.Literal('identity_mismatch'),
  Type.Literal('contribution_bound'),
  Type.Literal('activation_failed'),
  Type.Literal('worker_unavailable'),
], {
  description: 'Stable failure reason; only present when ok is false.',
})

/**
 * legacy 单例 plane 的朝向：`media` 除名字外还钉住可服务的 modalities。
 *
 * `name` 缺省时按包名解析（与 host 一致），`modalities` 恒是数组——空数组是
 * 零上界，不是"未声明"。
 */
const PluginCheckMediaPlane = Type.Object({
  name: Type.Optional(Type.String({
    description: 'Legacy media contribution name; defaults to the package name.',
  })),
  modalities: Type.Array(Type.String(), {
    description: 'Modalities the instance may serve; [] = nothing allowed.',
  }),
}, {
  description: 'Legacy media plane: one instance per package, pinned to its modalities.',
})

/**
 * `PluginCheckDeclared`（`PluginHost`）：`plugin.json` 的 `contributes.gateway` 静态上界。
 *
 * 逐 plane 的**存在性有意义**：缺键 = 该 plane 未声明（不设上界），`[]` = 零上界
 * （一个都不允许）。渲染方不得把两者合并。
 */
const PluginCheckDeclared = Type.Object({
  actions: Type.Optional(Type.Array(Type.String(), {
    description: 'Declared action names; absent = unbounded, [] = nothing allowed.',
  })),
  events: Type.Optional(Type.Array(Type.String(), {
    description: 'Declared event types; absent = unbounded, [] = nothing allowed.',
  })),
  tools: Type.Optional(Type.Array(Type.String(), {
    description: 'Declared tool names; absent = unbounded, [] = nothing allowed.',
  })),
  observers: Type.Optional(Type.Array(Type.String(), {
    description: 'Declared observer ids; absent = unbounded, [] = nothing allowed.',
  })),
  http: Type.Optional(Type.Boolean({
    description: 'contributes.gateway.http when the manifest opts in or out explicitly.',
  })),
  // legacy 单例 plane：每个包至多一个实例，所以是**一名上界**而不是名字数组。
  // 清单省略 name 时按包名解析（host 的默认），故 `{}` 与 `{name:'<pkg>'}` 同义。
  runtime: Type.Optional(Type.String({
    description: 'Legacy runtime contribution name; a one-name bound, absent = unconstrained.',
  })),
  tts: Type.Optional(Type.String({
    description: 'Legacy TTS contribution name; a one-name bound, absent = unconstrained.',
  })),
  usage: Type.Optional(Type.String({
    description: 'Legacy usage contribution name; a one-name bound, absent = unconstrained.',
  })),
  media: Type.Optional(PluginCheckMediaPlane),
}, {
  description:
    'Static plane declarations; absent for legacy packages without a contributes.gateway block.',
})

/**
 * `PluginCheckRegistered`：候选包在检查期间**实际尝试注册**的 plane。
 * `registered ⊆ declared` 被强制执行；反向从不要求（包可以条件注册）。
 */
const PluginCheckRegistered = Type.Object({
  actions: Type.Array(Type.String()),
  events: Type.Array(Type.String()),
  tools: Type.Array(Type.String()),
  observers: Type.Array(Type.String()),
  http: Type.Number({ description: 'HTTP + WebSocket routes recorded through ctx.http.' }),
  // legacy 单例 plane：只有在可信激活真的观察到该实例时才出现。缺失是合法的
  // （该 plane 没注册任何东西，或者检查在到达它之前就失败了）。
  runtime: Type.Optional(Type.String({
    description: 'Legacy runtime instance observed during a trusted activation.',
  })),
  tts: Type.Optional(Type.String({
    description: 'Legacy TTS instance observed during a trusted activation.',
  })),
  usage: Type.Optional(Type.String({
    description: 'Legacy usage instance observed during a trusted activation.',
  })),
  media: Type.Optional(PluginCheckMediaPlane),
}, {
  description: 'Planes the candidate actually tried to register while it was checked.',
})

/**
 * `PluginCheckResult`（`PluginHost.checkPackage` / `PackageManager.checkPath`）：
 * `ok:false` 是**诊断结果**（200），不是 HTTP 失败——`error` 携带原因，`code`
 * 是同一原因的稳定机器可读分类。
 */
export const PluginCheckResultSchema = Type.Object({
  ok: Type.Boolean({ description: 'false is a diagnostic answer, still HTTP 200.' }),
  name: Type.Optional(Type.String()),
  version: Type.Optional(Type.String()),
  contributions: Type.Optional(Type.Array(Type.String(), {
    description: 'Contribution kinds of the candidate (ui / actions / runtime / …).',
  })),
  declared: Type.Optional(PluginCheckDeclared),
  registered: Type.Optional(PluginCheckRegistered),
  warnings: Type.Optional(Type.Array(Type.String(), {
    description:
      'Non-fatal manifest diagnostics (legacy-permissions, …); `mafw plugin check --strict` fails on a non-empty list.',
  })),
  webSurfaces: Type.Optional(Type.Object({
    count: Type.Number(),
    rail: Type.Boolean(),
  }, {
    description: 'Validated Web surface summary; absent when the candidate declares none.',
  })),
  apiVersion: Type.Optional(Type.Number({ description: 'Phase 6 manifest apiVersion.' })),
  kind: Type.Optional(Type.Union([Type.Literal('trusted'), Type.Literal('untrusted')])),
  permissions: Type.Optional(Type.Array(Type.String(), {
    description: 'Declared permissions shown by the install consent step.',
  })),
  error: Type.Optional(Type.String()),
  code: Type.Optional(PluginCheckFailureCode),
  evaluated: Type.Optional(Type.Boolean({
    description:
      'true when activate() returned and its contributions were observed; false when the candidate never produced a contribution set.',
  })),
})

/**
 * `PluginDoctorCheck`（`plugins/plugin-doctor.ts`）：单条诊断。
 * `status` 三态——`warn` 不算失败（`report.ok` 只看 `fail`）。
 */
const PluginDoctorCheckSchema = Type.Object({
  id: Type.String({ description: 'Check id (manifest / api-version / integrity / …).' }),
  status: Type.Union([Type.Literal('pass'), Type.Literal('warn'), Type.Literal('fail')]),
  message: Type.String(),
  fix: Type.Optional(Type.String({ description: 'Suggested remediation for warn/fail checks.' })),
})

/**
 * `PluginDoctorReport`（`PluginDoctor.check` / `checkAll`）：
 * `ok` = 没有任何 `fail` 检查；报告只读，永不改包状态。
 */
export const PluginDoctorReportSchema = Type.Object({
  name: Type.String(),
  version: Type.Optional(Type.String()),
  apiVersion: Type.Number({ description: '0 when the manifest could not be resolved.' }),
  kind: Type.Union([
    Type.Literal('trusted'),
    Type.Literal('untrusted'),
    Type.Literal('unknown'),
  ]),
  fingerprint: Type.Optional(Type.String()),
  ok: Type.Boolean(),
  checks: Type.Array(PluginDoctorCheckSchema),
  generatedAt: Type.String({ description: 'ISO timestamp of the diagnosis.' }),
})

// ── plugins.install ─────────────────────────────────────────────────────────

/**
 * `POST /api/plugins/install`（handler：`routes/plugins.ts` `handlePluginsInstall`）。
 *
 * 请求是原始 `.js` 字节流（`readBodyBuffer`）+ query `filename`/`type`/`overwrite`，
 * 但 200 是 `installPlugin()` 的 `statEntry()` 投影——与 `plugins.list` 的 item 同形。
 */
export const PluginInstallResponse = PluginsEntrySchema

// ── plugins.installPackage ──────────────────────────────────────────────────

/**
 * `POST /api/plugins/packages/install`（handler：
 * `handlePluginPackageInstall` → `PackageManager.installFromPath`）。
 * `requestId` 幂等：重放同一 key 返回第一次的结果（同一 DTO）。
 */
export const PluginInstallPackageResponse = PluginInstallResultSchema

// ── plugins.check ───────────────────────────────────────────────────────────

/**
 * `POST /api/plugins/check`（handler：`handlePluginPackageCheck` → `checkPath`）。
 * 发布前的契约检查；`{ok:false}` 也是 200。
 */
export const PluginCheckResponse = PluginCheckResultSchema

// ── plugins.enable / plugins.disable ────────────────────────────────────────

/**
 * `POST /api/plugins/{enable,disable}`（handler：`handlePluginsEnable|Disable`）。
 *
 * 判别式双分支（body 形状决定）：`{package}` → `UpdateResult`；
 * `{type,filename}` → `PluginEntry`（legacy 单文件，`status` 随开关变化）。
 * 两个分支的公共键只有 `name`，所以必须用联合——收敛成一份会合法化
 * handler 永不发出的字段组合。
 */
export const PluginToggleResponse = Type.Union(
  [PluginUpdateResultSchema, PluginsEntrySchema],
  { description: '{package} → UpdateResult; {type, filename} → PluginEntry.' },
)

/**
 * `POST /api/plugins/enable`（handler 同上，`enabled:true` 分支）。
 */
export const PluginEnableResponse = PluginToggleResponse

/**
 * `POST /api/plugins/disable`（handler 同上，`enabled:false` 分支）。
 */
export const PluginDisableResponse = PluginToggleResponse

// ── plugins.delete ──────────────────────────────────────────────────────────

/**
 * `POST /api/plugins/delete`（handler：`handlePluginsDelete`）。
 * `{package}` → `UpdateResult`；`{type,filename}` → `deletePlugin()` 的 `{ok:true}`。
 */
export const PluginDeleteResponse = Type.Union(
  [PluginUpdateResultSchema, OkResponse],
  { description: '{package} → UpdateResult; {type, filename} → {ok:true}.' },
)

// ── plugins.apply ───────────────────────────────────────────────────────────

/**
 * `POST /api/plugins/:name/apply`（handler：`handlePluginApply` → `applyPending`）。
 *
 * 基础是 `UpdateResult`，路由层再按运行时切换结果补三个键：
 *   - 无 `switchRuntime` 接线 → `runtimeSwitch:'required'`（显式人工信号）；
 *   - 切换成功 → `runtimeSwitch:'applied'` + `active:{name,capabilities}`；
 *   - 切换抛错/失败 → `runtimeSwitch:'failed'` + `runtimeError`。
 * 三键严格互斥（required 不带 error/active），故按 optional 分组即可。
 */
export const PluginApplyResponse = Type.Object({
  name: Type.String(),
  version: Type.Optional(Type.String()),
  activeRevision: Type.Optional(Type.String()),
  pendingRevision: Type.Optional(Type.String()),
  saved: Type.Boolean(),
  enabled: Type.Boolean(),
  application: PluginApplication,
  error: Type.Optional(Type.String()),
  runtimeSwitchRequired: Type.Optional(Type.Boolean()),
  runtimeName: Type.Optional(Type.String()),
  runtimeSwitch: Type.Optional(Type.Union([
    Type.Literal('applied'),
    Type.Literal('failed'),
    Type.Literal('required'),
  ], {
    description: 'Only present when the committed package owns the active runtime.',
  })),
  runtimeError: Type.Optional(Type.String({
    description: 'Present when runtimeSwitch is failed.',
  })),
  active: Type.Optional(Type.Object({
    name: Type.String({ description: 'Runtime facade identity the gateway switched to.' }),
    capabilities: Type.Record(Type.String(), Type.Unknown(), {
      description: 'Runtime-declared capability bits (owner = runtime contract).',
    }),
  }, {
    description: 'Present when runtimeSwitch is applied.',
  })),
})

// ── plugins.reload ──────────────────────────────────────────────────────────

/**
 * `POST /api/plugins/:name/reload`（handler：`handlePluginReload` → `manager.reload`）。
 * 走正常 staging/commit 流程，回 `UpdateResult`。
 */
export const PluginReloadResponse = PluginUpdateResultSchema

// ── plugins.invoke ──────────────────────────────────────────────────────────

/**
 * 插件 action 的输出（**owner = 统一插件包的 `outputSchema`**）。
 *
 * gateway 只要求「可 JSON 序列化 + 不超过 256KB」（`plugin-actions.ts`
 * `assertOutputBudget`），实际形状由包作者定义，因此按 JSON 边界建模：
 * 开放对象（`additionalProperties:true`）+ 其余 JSON 标量/数组形态。
 * 不枚举任何业务字段——那会立刻把契约绑死到某一个插件上。
 */
const PluginActionOutput = Type.Union([
  Type.Object({}, {
    additionalProperties: true,
    description: 'Plugin-defined action output object (owner = the package outputSchema).',
  }),
  Type.Array(Type.Unknown(), { description: 'Plugin-defined array output.' }),
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
])

/**
 * `POST /api/plugins/:name/actions/:action`（handler：`handlePluginInvokeAction`）。
 *
 * 信封是网关自己的：`package` / `action` 是路径回显，`revision` 是本次调用
 * 绑定并校验过的 committed snapshot token（superseded → 409）。`output` 是
 * 插件定义边界（见上）；handler 返回 `undefined` 时该键被 JSON 省略。
 */
export const PluginInvokeResponse = Type.Object({
  package: Type.String(),
  action: Type.String(),
  revision: Type.String({ description: 'Committed client snapshot the result belongs to.' }),
  output: Type.Optional(PluginActionOutput),
})

// ── plugins.doctorAll / plugins.doctor ──────────────────────────────────────

/**
 * `POST /api/plugins/doctor`（handler：`handlePluginDoctorAll` → `doctor.checkAll()`）。
 * 目录扫描结果按包名排序；空目录回 `[]`（200）。
 */
export const PluginDoctorAllResponse = Type.Array(PluginDoctorReportSchema)

/**
 * `POST /api/plugins/:name/doctor`（handler：`handlePluginDoctor` → `doctor.check(name)`）。
 * 包名非法 / 不存在也回 200 报告（`manifest` 检查 fail），不是 404。
 */
export const PluginDoctorResponse = PluginDoctorReportSchema

// ── plugins.kill / plugins.resume ───────────────────────────────────────────

/**
 * `POST /api/plugins/kill`（handler：`handlePluginKill` → `PluginSafety.kill`）。
 * 进入安全模式并停掉全部包；`safeMode` 是字面量（kill 的语义就是 on）。
 */
export const PluginKillResponse = Type.Object({
  safeMode: Type.Literal(true),
  stopped: Type.Array(Type.String(), { description: 'Packages deactivated by the kill switch.' }),
})

/**
 * `POST /api/plugins/resume`（handler：`handlePluginResume` → `safety.resume()`）：
 * 离开安全模式；`activated` 由调用方 reload 决定，服务本体恒回空数组。
 * 隔离 / 禁用的包不会因为 resume 而复活（阻塞原因独立）。
 */
export const PluginResumeResponse = Type.Object({
  safeMode: Type.Literal(false),
  activated: Type.Array(Type.String()),
})

// ── plugins.quarantine / plugins.unquarantine ───────────────────────────────

/**
 * `POST /api/plugins/:name/quarantine`（handler：`handlePluginQuarantine`）。
 * handler 自己组装回执（不返回 safety 对象）：`reason` 是请求回显。
 */
export const PluginQuarantineResponse = Type.Object({
  name: Type.String(),
  quarantined: Type.Literal(true),
  reason: Type.String(),
})

/**
 * `POST /api/plugins/:name/unquarantine`（handler：`handlePluginUnquarantine`）。
 * 解除隔离只清状态 + 审计，回执不含 reason。
 */
export const PluginUnquarantineResponse = Type.Object({
  name: Type.String(),
  quarantined: Type.Literal(false),
})

// ── plugins.rollback ────────────────────────────────────────────────────────

/**
 * `POST /api/plugins/:name/rollback`（handler：`handlePluginRollback` → `manager.rollback`）。
 * 恢复 last-known-good 快照，回 `UpdateResult`（`application` 反映恢复结果）。
 */
export const PluginRollbackResponse = PluginUpdateResultSchema

// ── plugins.webTicket ───────────────────────────────────────────────────────

/**
 * `POST /api/plugins/:name/web-ticket`（handler：`handlePluginWebTicket`）。
 *
 * `PluginWebTicketIssue`（`plugins/plugin-web-ticket.ts`）：`ticket` 同时写进
 * `Set-Cookie`（`mafw_plugin_ticket`，Path 限定到该包），`expiresAt` 是 epoch
 * 毫秒（默认 8h TTL）。响应刻意移除 CORS 头，浏览器页面读不到 body。
 */
export const PluginWebTicketResponse = Type.Object({
  ticket: Type.String({ description: 'Path-scoped ticket secret (also set as an HttpOnly cookie).' }),
  expiresAt: Type.Number({ description: 'Epoch milliseconds; the client renews before expiry.' }),
})
