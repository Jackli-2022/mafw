/**
 * E10h-R4：approvals / questions 域写接口（3 个 op）的 200 响应 schema
 * （`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/approvals-respond.ts`（approvals.respond）
 *   - `routes/questions-permissions.ts`（questions.reply / questions.reject）
 *
 * 两条链都先过 `requireHumanPrincipal`（无人凭据 403），再走 workspace 重试链；
 * 403 / 400 / 503（`{status:'error', error}`）不是 200 形态，不在此建模。
 */
import { Type } from '@sinclair/typebox'
import { StatusOkResponse } from './session-write-responses'

// ── approvals.respond ───────────────────────────────────────────────────────

/**
 * `POST /api/approvals/:id/respond`（handler：`handleApprovalsRespond` 成功尾行
 * `{status:'ok', decision}`）。
 *
 * `decision` 是**回显归一化后的语义**，不是请求原文：`decision:'approve'|'reject'`
 * 原样回显，`{answer:'…'}` 文本回答回显成 `'answered'`（QuestionWidget 走这条）。
 * 请求两种形态都缺 → 400；问题文件找不到 → 404。
 */
export const ApprovalRespondResponse = Type.Object({
  status: Type.Literal('ok'),
  decision: Type.Union([
    Type.Literal('approve'),
    Type.Literal('reject'),
    Type.Literal('answered'),
  ]),
})

// ── questions.reply / questions.reject ─────────────────────────────────────

/**
 * `POST /api/questions/:id/reply`（handler：`questions.reply`）：所有 workspace
 * 都失败才 400，首个成功即 `{status:'ok'}`——不返回 question 行、也不带 sessionID。
 */
export const QuestionReplyResponse = StatusOkResponse

/** `POST /api/questions/:id/reject`（同上 reject 臂）：成功同样是裸 `{status:'ok'}`。 */
export const QuestionRejectResponse = StatusOkResponse
