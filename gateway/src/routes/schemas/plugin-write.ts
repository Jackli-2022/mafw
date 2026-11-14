/**
 * E10g-W6：plugin 写接口的请求体 schema（`RouteDef.request`）。
 *
 * 只有声明，不做运行时校验：字段面逐项来自 handler 的实际读取
 * （`routes/plugins.ts`、`routes/plugin-packages.ts`、`routes/plugin-web.ts`）。
 * 条件必填 / 二选一用 description 说明，不伪造 oneOf/anyOf 把契约做得比
 * handler 更严（`assertBodyShape` 才是权威）。
 *
 * 分类（与 W1-W5 同口径）：
 *   - JSON body（`requestRequired` 缺省 true）：`plugins.installPackage`、
 *     `plugins.check`、`plugins.enable`、`plugins.disable`、`plugins.delete`、
 *     `plugins.webTicket`；
 *   - 可选 body + 声明字段（`requestRequired:false`）：`plugins.invoke` ——
 *     空 body 合法（`readJsonObject` 归一为 `{}`），`input` 是插件自定义负载；
 *   - 空对象 + `requestRequired:false`：`plugins.apply` / `plugins.reload`
 *     （handler `_req`，只读路径 `:name`）；
 *   - **排除**：`plugins.install` —— 原始 `.js` 字节流（`readBodyBuffer`）+
 *     query（`filename`/`type`/`overwrite`），不是 JSON body，见下。
 */
import { Type } from '@sinclair/typebox'

/**
 * `PluginType`（`plugins/hub.ts`）：四个插件目录，`parseType` 收窄。
 * 仅用于 enable/disable/delete 的 legacy `{type, filename}` 形态。
 */
const PluginType = Type.Union([
  Type.Literal('runtime'),
  Type.Literal('media'),
  Type.Literal('usage'),
  Type.Literal('ui'),
])

// ── plugins.enable / plugins.disable / plugins.delete ─────────────────────

/**
 * `POST /api/plugins/{enable,disable,delete}`（handler：`routes/plugins.ts`
 * `handlePluginsEnable` / `handlePluginsDisable` / `handlePluginsDelete`）。
 *
 * 两种二选一形态（handler `assertBodyShape` 同时给两种 → 400）：
 *   - `{ package }`：统一插件包名，走 `PackageManager.enable|disable|remove`；
 *   - `{ type, filename }`：legacy 单文件插件，走 `setPluginEnabled` / `deletePlugin`
 *     （两者都经 `parseType` + `validateFilename` 收窄）。
 * body 本身必须是 JSON 对象（空 body 解析失败 → 400），因此 `requestRequired`
 * 保持 true；字段全部可选是因为**变体**而非自由形状。
 */
const PluginToggleFields = {
  package: Type.Optional(Type.String({
    minLength: 1,
    description: 'Unified package name; mutually exclusive with type+filename.',
  })),
  type: Type.Optional(PluginType),
  filename: Type.Optional(Type.String({
    description: 'Legacy per-type plugin filename; requires type and excludes package.',
  })),
}

export const PluginToggleRequest = Type.Object(PluginToggleFields, {
  description: 'Body must be a JSON object shaped as { package } or { type, filename } (never both).',
})

// ── plugins.installPackage ────────────────────────────────────────────────

/**
 * `POST /api/plugins/packages/install`（handler：`routes/plugin-packages.ts`
 * `handlePluginPackageInstall` → `PackageManager.installFromPath`）。
 * handler 要求 `path` 存在（否则 400 `path is required`）；`overwrite` /
 * `requestId` 必须是字符串 / 布尔（类型不符 → 400）。
 */
export const PluginInstallPackageRequest = Type.Object({
  path: Type.String({
    minLength: 1,
    description: 'Absolute local directory of the package to install.',
  }),
  overwrite: Type.Optional(Type.Boolean({
    description: 'Replace an installed package of the same name (default false).',
  })),
  requestId: Type.Optional(Type.String({
    description: 'Idempotency key; a new iteration must use a fresh value.',
  })),
})

// ── plugins.check ─────────────────────────────────────────────────────────

/**
 * `POST /api/plugins/check`（handler 同上 `handlePluginPackageCheck`）。
 * 候选目录的契约检查；`{ok:false}` 是诊断结果（200），不是失败。
 */
export const PluginCheckRequest = Type.Object({
  path: Type.String({
    minLength: 1,
    description: 'Absolute local directory of the candidate package.',
  }),
})

// ── plugins.invoke ────────────────────────────────────────────────────────

/**
 * `POST /api/plugins/:name/actions/:action`（handler 同上
 * `handlePluginInvokeAction`）。
 *
 * `input` 是**插件自定义**的 action 负载（`plugin.json` 的 action schema，
 * 由统一插件包作者定义，gateway 只透传给 committed registry），因此声明为
 * 开放对象边界：`additionalProperties:true` 且不枚举字段。
 * `revision` 可走 body 或 `?revision=`（body 优先）；superseded token 由
 * registry 判 409 `stale-revision`。空 body 合法 → `requestRequired:false`。
 */
export const PluginInvokeRequest = Type.Object({
  input: Type.Optional(Type.Object({}, {
    additionalProperties: true,
    description: 'Plugin-defined action payload, passed through verbatim to the committed action registry.',
  })),
  sessionID: Type.Optional(Type.String({
    description: 'Session the invocation is attributed to (plugin action context).',
  })),
  revision: Type.Optional(Type.String({
    description: 'Client snapshot token; superseded tokens are rejected with 409 stale-revision. Falls back to ?revision=.',
  })),
})

// ── plugins.webTicket ─────────────────────────────────────────────────────

/**
 * `POST /api/plugins/:name/web-ticket`（handler：`routes/plugin-web.ts`
 * `handlePluginWebTicket`）。
 *
 * loopback-only 凭据铸造：`projectDir` 必须是已注册项目、已知 worktree 或
 * 其子目录（否则 400，`resolvePluginWebProjectDir`）；`sessionID` 缺省表示
 * 项目级 surface。响应体不可读（`Set-Cookie` + 移除 CORS 头），body 限 16KB。
 */
export const PluginWebTicketRequest = Type.Object({
  projectDir: Type.String({
    minLength: 1,
    description: 'Registered project, known worktree, or a directory below one (canonicalized before the scope check).',
  }),
  sessionID: Type.Optional(Type.String({
    minLength: 1,
    description: 'Bind the ticket to one session; absent → project-scoped surface.',
  })),
})

// ── plugins.install（排除）─────────────────────────────────────────────────
//
// `POST /api/plugins/install` 读的是**原始字节**（`readBodyBuffer(req)` +
// `installPlugin({ bytes })`），输入全部在 query（`filename`、`type`、
// `overwrite`）而不是 JSON body。建模成 `application/octet-stream` 的
// `request` 只会是一句 `Type.String()`，对客户端没有信息量，也会让
// `requests: X/188` 把「未声明形状」算成已覆盖 —— 因此按 spec §1.3 排除，
// 由收口的 `REQUEST_EXCLUDED` 台账记录原因（E10g-W6 的排除项仅此一条）。
// 单文件插件仍可通过 `plugins.installPackage`（JSON，`{ path }`）安装。
