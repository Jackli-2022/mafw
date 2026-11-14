/**
 * E10h-R5：mcp 写接口（7 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/mcp.ts`（connect / disconnect）
 *   - `routes/mcp-config.ts`（config preview / preview-remove / apply / restore / remove）
 *
 * 本文件的两份 payload 都是 **runtime 适配器** 的返回（owner =
 * `@mafw/runtime-contract` `RuntimeMcpConfigChannel`）：
 *   - `preview()` / `previewRemove()` → `RuntimeMcpConfigPreview`；
 *   - `apply()` / `remove()` / `restore()` → `RuntimeMcpConfigResult`。
 * gateway 只 `json(200, await deps.x(...))` 原样透传，不读字段、不改写，
 * 因此字段面逐项照抄契约接口（`packages/runtime-contract/src/channels.ts`），
 * 不开放附加属性——那是**已类型化**的适配器 DTO，不是自由形状。
 *
 * 错误体（400/404/409/500/503，含 `etag_mismatch` / `is not available`）不属于
 * 200 形态，不在此建模。
 */
import { Type } from '@sinclair/typebox'
import { OkResponse } from './session-write-responses'

// ── mcp.connect / mcp.disconnect ────────────────────────────────────────────

/**
 * `POST /api/mcp/:name/connect`（handler：`routes/mcp.ts` `handleMcp()`）。
 *
 * 只有适配器 `connect()` 返回 true 才 200 `{ok:true}`；false / 抛错都是 502
 * （`{error:'connect failed', name}`）——所以 200 不携带服务器名或状态。
 */
export const McpConnectResponse = OkResponse

/**
 * `POST /api/mcp/:name/disconnect`（handler 同上，`disconnect()` 分支）。
 * 与 connect 同一个成功回执（502 分支才是失败）。
 */
export const McpDisconnectResponse = OkResponse

// ── mcp.configPreview / mcp.configPreviewRemove ─────────────────────────────

/**
 * `RuntimeMcpConfigPreview`（owner = runtime MCP config channel）：
 * dry-run 结果——乐观锁 `token`、目标配置文件路径 `target`、统一 diff `diff`，
 * 以及可选的备份路径 / 保留段落 / 警告。
 *
 * preview 与 preview-remove 返回**同一类型**（适配器内部同一条流水线），
 * 所以两个 op 共用一个 schema 对象。
 */
export const McpConfigPreviewResponse = Type.Object({
  token: Type.String({
    description: 'Optimistic-lock token the apply / remove / restore call must echo back.',
  }),
  target: Type.String({
    description: 'Absolute path of the runtime config file the write would touch.',
  }),
  diff: Type.String({
    description: 'Unified diff of the would-be write (gateway never rewrites it).',
  }),
  backup: Type.Optional(Type.String({
    description: 'Backup file the adapter would create before writing.',
  })),
  preserved: Type.Optional(Type.Array(Type.String(), {
    description: 'Config subtrees the adapter keeps verbatim (adapter-owned labels).',
  })),
  warnings: Type.Optional(Type.Array(Type.String(), {
    description: 'Adapter-emitted warnings about the previewed write.',
  })),
})

/**
 * `POST /api/mcp/config/preview-remove`（handler 同上 → `previewRemove(name)`）。
 * 与 `mcp.configPreview` 同一 DTO：删除预览也回 `token` + `diff`。
 */
export const McpConfigPreviewRemoveResponse = McpConfigPreviewResponse

// ── mcp.configApply / mcp.configRestore / mcp.configRemove ──────────────────

/**
 * `RuntimeMcpConfigResult`（owner = runtime MCP config channel）：
 * `applied` = 配置文件已落盘，`runtimeApplied` = 运行时已热生效。
 * 两者可以不一致（写盘成功但热载失败：`runtimeApplied:false` + `error`），
 * 所以不能收敛成一个布尔。
 */
export const McpConfigResultResponse = Type.Object({
  applied: Type.Boolean({
    description: 'The config file was persisted.',
  }),
  runtimeApplied: Type.Boolean({
    description: 'The active runtime picked the new config up without a restart.',
  }),
  backup: Type.Optional(Type.String({
    description: 'Backup file written before the mutation.',
  })),
  error: Type.Optional(Type.String({
    description: 'Runtime-side apply error (present when runtimeApplied is false).',
  })),
})

/**
 * `POST /api/mcp/config/apply`（handler：`handleMcpConfig` → `config.apply(body)`）。
 * body 的 `confirm:true` 与 `token` 已由 handler 校验（400/409 不进 200）。
 */
export const McpConfigApplyResponse = McpConfigResultResponse

/**
 * `POST /api/mcp/config/restore`（handler 同上 → `config.restore(opts)`）：
 * 外科式回滚 `mcp.servers` 子树，回同一个 `RuntimeMcpConfigResult`。
 */
export const McpConfigRestoreResponse = McpConfigResultResponse

/**
 * `DELETE /api/mcp/config/servers/:name`（handler 同上 → `config.remove(name, body)`）：
 * 删除成功与「文件没写但运行时不必重启」都走同一结果类型。
 */
export const McpConfigRemoveResponse = McpConfigResultResponse
