/**
 * E10h-R4：permission 域写接口（7 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/permission.ts` `handlePermissionReplyById`（permissions.reply）
 *   - `routes/permission.ts` `handlePermissionReply`（permissions.replyRuntime）
 *   - `routes/permission-mode.ts`（permissions.setMode）
 *   - `routes/allowlist.ts`（add/removeAllowlist）、`routes/rules.ts`（add/removeRule）
 *
 * 两个 reply 入口的 200 **刻意不同形**（同一语义、两代 handler）：
 * 按 requestId 全局反查的 `permissions.reply` 回 `{status:'ok'}`，
 * 会话直连的 `permissions.replyRuntime` 回 `{success:true}`。
 * 503（surface 不可用）/ 400 / 404 不是 200 形态，不在此建模。
 */
import { Type } from '@sinclair/typebox'
import { AllowlistEntrySchema, PermissionModeResponse, PermissionRuleSchema } from './human-gate'
import { StatusOkResponse } from './session-write-responses'

// ── permissions.reply / permissions.replyRuntime ────────────────────────────

/**
 * `POST /api/permissions/:id/reply`（handler：`handlePermissionReplyById`）：
 * 按 requestId 反查 sessionID 后回复，成功是裸 `{status:'ok'}`。
 * `'always'` 沉淀持久规则是 fail-open 的副作用，不体现在 body 上。
 */
export const PermissionReplyResponse = StatusOkResponse

/**
 * `POST /api/sessions/:sid/permissions/:rid`（handler：`handlePermissionReply`）：
 * 会话直连入口，成功是 `{success:true}`（老版本形状），与上面的 `{status:'ok'}`
 * 不是同一个 schema —— 合并会掩盖两个 handler 的事实差异。
 */
export const PermissionReplyRuntimeResponse = Type.Object({
  success: Type.Literal(true),
})

// ── permissions.setMode ─────────────────────────────────────────────────────

/**
 * `POST /api/sessions/:sid/permission-mode`（handler：`handlePermissionModeSet`）：
 * `{mode, autoApprovals:0, budget}` —— 与 `permissions.getMode` 同形，故复用
 * `PermissionModeResponse`；差别只在写入路径的 `autoApprovals` 恒为 0
 * （刚切换模式，本会话还没有自动放行计数）。
 */
export const PermissionSetModeResponse = PermissionModeResponse

// ── permissions.addAllowlist / removeAllowlist ──────────────────────────────

/**
 * `POST /api/approvals/allowlist`（handler：`handleAllowlistPost` →
 * `AllowlistStore.add`）：`{success: result.ok, entries: result.entries}`。
 * 重复条目不报错（store 返回 ok:true），`entries` 是**写入后**的完整白名单。
 */
export const PermissionAddAllowlistResponse = Type.Object({
  success: Type.Boolean(),
  entries: Type.Array(AllowlistEntrySchema),
})

/**
 * `DELETE /api/approvals/allowlist`（同上 remove 臂）：未命中是 404，
 * 所以 200 的 `success` 恒为 `true`；`entries` 是**删除后**的完整白名单。
 */
export const PermissionRemoveAllowlistResponse = Type.Object({
  success: Type.Literal(true),
  entries: Type.Array(AllowlistEntrySchema),
})

// ── permissions.addRule / removeRule ────────────────────────────────────────

/**
 * `POST /api/approvals/rules`（handler：`handleRulesPost` → `PermissionRulesStore.add`）：
 * `{success: result.ok, entries: result.rules}`（`action` 恒为 `'allow'`）。
 */
export const PermissionAddRuleResponse = Type.Object({
  success: Type.Boolean(),
  entries: Type.Array(PermissionRuleSchema),
})

/** `DELETE /api/approvals/rules`（同上 remove 臂）：未命中是 404 → 200 的 `success` 恒为 `true`。 */
export const PermissionRemoveRuleResponse = Type.Object({
  success: Type.Literal(true),
  entries: Type.Array(PermissionRuleSchema),
})
