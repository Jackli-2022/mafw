/**
 * E10g-W6：MCP 管理写接口的请求体 schema（`RouteDef.request`）。
 *
 * 只有声明，不做运行时校验：字段面逐项来自 handler 的读取面
 * （`routes/mcp.ts` / `routes/mcp-config.ts`）与适配器契约类型
 * （`RuntimeMcpServerConfigInput` / `RuntimeMcpConfigChannel`，
 * `packages/runtime-contract/src/channels.ts`）。条件必填用 description
 * 说明，不伪造 oneOf/anyOf 把契约做得比 handler 更严。
 *
 * 分类（与 W1-W5 同口径）：
 *   - JSON body（`requestRequired` 缺省 true）：`mcp.configPreview`、
 *     `mcp.configPreviewRemove`、`mcp.configApply`、`mcp.configRestore`、
 *     `mcp.configRemove`；
 *   - 空对象 + `requestRequired:false`（`EmptyRequest`，见
 *     `schemas/session-write.ts`）：`mcp.connect` / `mcp.disconnect` ——
 *     handler 只读路径 `:name` 与 query `directory`，body 完全不读。
 */
import { Type } from '@sinclair/typebox'

/**
 * `RuntimeMcpServerConfigInput` 的字段面（preview / apply 共用）。
 * gateway 不读文件、不校验 JSONC：`type: 'remote'` 要求 `url`，
 * `type: 'local'` 要求非空 `command` argv —— 这两条由适配器判定（400），
 * 因此契约里只表达「url / command 可缺省」，不把条件必填写成 oneOf。
 */
const McpServerConfigInputFields = {
  name: Type.String({
    minLength: 1,
    description: 'Configured server key; the adapter validates the accepted charset.',
  }),
  type: Type.Union([Type.Literal('remote'), Type.Literal('local')], {
    description: "Determines which of url / command the adapter requires.",
  }),
  url: Type.Optional(Type.String({
    description: "Required when type is 'remote'; the adapter validates the URL.",
  })),
  command: Type.Optional(Type.Array(Type.String(), {
    description: "Required (non-empty argv) when type is 'local'.",
  })),
  overwrite: Type.Optional(Type.Boolean({
    description: 'Replace an existing entry with the same name (absent → conflict error).',
  })),
  replace: Type.Optional(Type.Boolean({
    description: 'Explicitly allow a type change for an existing name (absent → conflict error).',
  })),
}

// ── mcp.configPreview ─────────────────────────────────────────────────────

/**
 * `POST /api/mcp/config/preview`（handler：`routes/mcp-config.ts`
 * `handleMcpConfig` → `RuntimeMcpConfigChannel.preview`）。
 *
 * 纯 dry-run：计算目标文件、掩码 diff 与乐观锁 `token`，不写盘。
 * `preview()` 缺字段时由适配器抛 `invalid`/`not_found`（映射 400/404）。
 */
export const McpConfigPreviewRequest = Type.Object(McpServerConfigInputFields)

// ── mcp.configPreviewRemove ───────────────────────────────────────────────

/**
 * `POST /api/mcp/config/preview-remove`（handler 同上）。
 * handler 先校验 `body.name` 非空（否则 400），再交给适配器出删除预览。
 */
export const McpConfigPreviewRemoveRequest = Type.Object({
  name: Type.String({
    minLength: 1,
    description: 'Configured server key to remove (preview only; nothing is written).',
  }),
})

// ── mcp.configApply ───────────────────────────────────────────────────────

/**
 * `POST /api/mcp/config/apply`（handler 同上 → `config.apply`）。
 *
 * handler 强制 `confirm === true`（否则 400），并把整个 body 原样交给
 * `apply(input: RuntimeMcpServerConfigInput & { token, confirm: true })`；
 * `token` 来自 preview（不匹配 → `etag_mismatch` → 409）。
 */
export const McpConfigApplyRequest = Type.Object({
  ...McpServerConfigInputFields,
  token: Type.String({
    minLength: 1,
    description: 'Optimistic-lock token returned by the matching preview call.',
  }),
  confirm: Type.Literal(true, {
    description: 'Must be literally true; any other value is rejected with 400.',
  }),
})

// ── mcp.configRestore ─────────────────────────────────────────────────────

/**
 * `POST /api/mcp/config/restore`（handler 同上 → `config.restore`）。
 * 外科式恢复 `mcp.servers` 子树；`backupPath` 缺省用最近备份。
 */
export const McpConfigRestoreRequest = Type.Object({
  token: Type.String({
    minLength: 1,
    description: 'Optimistic-lock token returned by the preview call.',
  }),
  confirm: Type.Literal(true, {
    description: 'Must be literally true; any other value is rejected with 400.',
  }),
  backupPath: Type.Optional(Type.String({
    description: 'Backup file to restore from; absent → the most recent backup.',
  })),
})

// ── mcp.configRemove ──────────────────────────────────────────────────────

/**
 * `DELETE /api/mcp/config/servers/:name`（handler 同上 → `config.remove`）。
 * 服务器名在路径里；body 只携带确认与乐观锁。
 */
export const McpConfigRemoveRequest = Type.Object({
  token: Type.String({
    minLength: 1,
    description: 'Optimistic-lock token returned by the preview-remove call.',
  }),
  confirm: Type.Literal(true, {
    description: 'Must be literally true; any other value is rejected with 400.',
  }),
})
