/**
 * E10g-W2：task / terminal / background / fileHistory 写接口的请求体 schema
 * （`RouteDef.request`）。
 *
 * 只有声明，不做运行时校验：字段面来自下面每个 handler 的实际读取
 * （`typeof body.x === 'string'` 之类的守卫与 service 的 400），条件必填用
 * description 说明，不伪造 oneOf/anyOf 把契约做得比 handler 更严。
 *
 * 空对象 + `requestRequired: false` 的语义是「这个动作没有字段」，不是
 * 「接受任意 body」（与 W1 `session-write.ts` 的 `EmptyRequest` 同义）。
 */
import { Type } from '@sinclair/typebox'

/**
 * 无 body 动作 / body 被忽略的动作。使用方必须同时给 `requestRequired: false`：
 *
 *   - `tasks.cancel`          → handler 不读 body（只有路径 id + service.cancel）
 *   - `terminal.remove`       → DELETE 只读路径 id 与 `?directory=`（query）
 *   - `background.jobs.cancel` → POST 只读路径 id 与 `?sessionID=`（query）
 *
 * W3 的 pod 空动作复用同一个 schema。
 */
export const EmptyRequest = Type.Object({})

// ── tasks ─────────────────────────────────────────────────────────────────

/**
 * `POST /api/tasks/:id/message`（handler：routes/tasks.ts `handleTaskMessage`）。
 * `TaskService.message` 要求 trim 后非空，且仅 subagent task 可用。
 */
export const TaskMessageRequest = Type.Object({
  message: Type.String({ minLength: 1 }),
})

// ── terminal ──────────────────────────────────────────────────────────────

/**
 * `POST /api/terminal/sessions`（handler：routes/terminal.ts）。
 * `directory` 是唯一必填（trim 后非空，否则 400）；其余为 PTY 初始尺寸/标题，
 * 空字符串视为未提供（handler 逐字段判 truthy）。
 */
export const TerminalCreateRequest = Type.Object({
  directory: Type.String({ minLength: 1 }),
  cwd: Type.Optional(Type.String()),
  cols: Type.Optional(Type.Number()),
  rows: Type.Optional(Type.Number()),
  title: Type.Optional(Type.String()),
})

/**
 * `POST /api/terminal/sessions/:id/connect-ticket`（handler 同上）。
 * body 可缺省：`directory` 缺省时回退 `?directory=` query，仍为空则由 service
 * 决定（票据按会话 id 签发）。
 */
export const TerminalConnectTicketRequest = Type.Object({
  directory: Type.Optional(Type.String()),
})

// ── background jobs ───────────────────────────────────────────────────────

// `background.jobs.cancel` 使用 `EmptyRequest`：sessionID 走 query，body 被忽略。
// （输出见文件头注释。）

// ── file history ──────────────────────────────────────────────────────────

/**
 * `POST /api/file-history/snapshot`（handler：routes/file-history.ts）。
 * `sessionID` 必填；`directory` 缺省时按 sessionID 解析（office 技能只传
 * sessionID），解析失败 → 400。`paths` 为 1..200 条字符串（绝对路径会被
 * 收敛到 session 目录内转 rel）；`reason` 由 handler 截断到 200 字符（是截断
 * 不是拒绝，所以不声明 `maxLength`：声明了就是承诺一个 handler 不会返回的 400）。
 */
export const FileHistorySnapshotRequest = Type.Object({
  sessionID: Type.String({ minLength: 1 }),
  directory: Type.Optional(Type.String({ description: 'Required unless resolvable from sessionID.' })),
  paths: Type.Array(Type.String(), { minItems: 1, maxItems: 200 }),
  reason: Type.Optional(Type.String({
    description: 'Free-form label; the handler truncates it to 200 chars instead of rejecting longer values.',
  })),
})

/** `POST /api/file-history/restore`（handler 同上）：两者都必填，缺一 400。 */
export const FileHistoryRestoreRequest = Type.Object({
  sessionID: Type.String({ minLength: 1 }),
  entryId: Type.String({ minLength: 1 }),
})
