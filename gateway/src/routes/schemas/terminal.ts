/**
 * E10f-A：terminal REST 读面（1 op）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状。
 * 形状来源（handler 是事实源）：routes/terminal.ts `GET /api/terminal/sessions`
 * → terminal/terminal-service.ts `TerminalListResult`。
 *
 * 响应只含 MAFW DTO 与 `mafw-terminal/1` 协议标识；原生 PTY URL/票据/帧仍在 runtime adapter。
 * 与 `@mafw/sdk` `TerminalSessionList` 逐字段等价（AssertEq 钉住）。
 */
import { Type } from '@sinclair/typebox'

/** `TerminalSessionView`：directory 只在归属已知时下发（绝不伪造）。 */
const TerminalSessionSchema = Type.Object({
  id: Type.String(),
  directory: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  status: Type.Union([
    Type.Literal('running'),
    Type.Literal('exited'),
    Type.Literal('unknown'),
  ]),
  cwd: Type.Optional(Type.String()),
})

/** runtime 不支持 PTY 时仍是 200：`supported: false` + 空 sessions（不伪造 PTY）。 */
export const TerminalListResponse = Type.Object({
  protocol: Type.String(),
  supported: Type.Boolean(),
  sessions: Type.Array(TerminalSessionSchema),
})

// ── E10h-R2：terminal 写接口（3 ops）────────────────────────────────────
//
// 事实源：routes/terminal.ts `handleTerminal`。PTY 不支持时是 503（带
// `supported:false`），因此下面的 200 形状只在 `supported=true` 时出现。

/** `POST /api/terminal/sessions`（→ `TerminalService.create`）：只回协议标识 + 新 id。 */
export const TerminalCreateResponse = Type.Object({
  protocol: Type.String(),
  id: Type.String(),
})

/**
 * `POST /api/terminal/sessions/:id/connect-ticket`（→ `TerminalService.issueTicket`）：
 * `TerminalTicketView`——一次性票据 + 相对 WS 路径（客户端与 gateway base 拼成 ws(s)）。
 */
export const TerminalConnectTicketResponse = Type.Object({
  protocol: Type.String(),
  ticket: Type.String(),
  url: Type.String(),
  expiresAt: Type.Number(),
})

/** `DELETE /api/terminal/sessions/:id`（→ `TerminalService.remove`）：无字段成功体。 */
export const TerminalRemoveResponse = Type.Object({
  ok: Type.Literal(true),
})
