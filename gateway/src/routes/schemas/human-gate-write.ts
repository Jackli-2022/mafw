/**
 * E10g-W5：human-gate / permission 写接口的请求体 schema（`RouteDef.request`）。
 *
 * `approvals.respond`、`questions.reply|reject`、`triage.confirm|reject|dismiss`
 * 是 **human-only**（`requireHumanPrincipal` 在 handler 里用凭据判定）：body 里出现
 * 非空 `actorSessionID` 会被 `humanOnlyDenied` 判 403，所以该字段**不声明**
 * （禁止字段，不是可选字段）。`permissions.*` 的 handler 也不读 actor 字段，
 * 因此本文件不含任何 `actorSessionID` 声明。
 *
 * 只有声明，不做运行时校验：字段面逐项来自 handler 的实际读取与 400 条件。
 * 条件必填（「二选一」）用 description 说明，不伪造 oneOf/anyOf。
 *
 * 分类（与 W1-W4 同口径）：
 *   - JSON body（`requestRequired` 缺省 true）：`approvals.respond`、`questions.reply`、
 *     `triage.propose`、`permissions.reply`、`permissions.replyRuntime`、
 *     `permissions.setMode`、`permissions.addAllowlist`、`permissions.addRule`、
 *     `permissions.removeAllowlist`、`permissions.removeRule`；
 *   - 空对象 + `requestRequired:false`（`EmptyRequest`，见 `schemas/session-write.ts`）：
 *     `questions.reject`、`triage.confirm`、`triage.reject`、`triage.dismiss`。
 */
import { Type } from '@sinclair/typebox'

// ── approvals.respond ─────────────────────────────────────────────────────

/**
 * `POST /api/approvals/:id/respond`（handler：`routes/approvals-respond.ts`，
 * human-only）。写 `<项目>/.mafw/user-questions/<id>.json` 的 `answered/answer/answeredAt`。
 *
 * 两种回答方式**二选一**（都缺 → 400）：goal 审批用 `decision`，MCP `ask_user`
 * 的 QuestionWidget 用自由文本 `answer`（含选项 label）。两者同给时 `answer` 优先
 * （写进文件的是 answer，decision 只影响响应里的 `decision:'answered'`）。
 */
export const ApprovalRespondRequest = Type.Object({
  decision: Type.Optional(Type.Union([Type.Literal('approve'), Type.Literal('reject')], {
    description: 'Required unless answer is present.',
  })),
  answer: Type.Optional(Type.String({
    description: 'Free-text answer (MCP ask_user widget). Required unless decision is present; wins when both are given.',
  })),
})

// ── questions.reply ───────────────────────────────────────────────────────

/**
 * `POST /api/questions/:id/reply`（handler：`routes/questions-permissions.ts`，
 * human-only）。`answers` 逐题一组所选 label（runtime `question.reply({requestID, answers})`）；
 * 空数组本身合法（不是所有 runtime 都要求逐题作答）。路由按 workspace 回退链
 * （默认 location → projectDir → 注册项目）重试，全部失败才 400。
 */
export const QuestionReplyRequest = Type.Object({
  answers: Type.Array(Type.Array(Type.String()), {
    description: 'One array of selected option labels per question, in question order.',
  }),
})

// ── questions.reject / triage.confirm / triage.reject / triage.dismiss ────

// 这四个动作都用 `EmptyRequest` + `requestRequired:false`：
//   - `questions.reject`  → handler 不读 body（只 requestID + workspace 回退链）；
//   - `triage.confirm`    → 分支由磁盘上的 `summary.skillDraft` / `axiomDraft` 决定，
//                           handler 完全不解析 body（只做 human gate）；
//   - `triage.reject`     → `rejectTriage(params.id)`，body 不读；
//   - `triage.dismiss`    → `rejectTriage(triageId)` + 账本 reason，body 不读。
// 使用方见 `route-catalog.ts`。

// ── triage.propose ────────────────────────────────────────────────────────

/**
 * `POST /api/triage/:id/propose`（handler：`routes/triage.ts`）。
 * `suggestion` 必须是 confirm|reject（否则 400）；`reason` 缺省空串；
 * `priority` 缺省 medium，未知值由 `proposeTriageDecision` 收敛成 medium。
 * 这是 agent 的建议通道（不是人审），只追加 `llmSuggestions`。
 */
export const TriageProposeRequest = Type.Object({
  suggestion: Type.Union([Type.Literal('confirm'), Type.Literal('reject')]),
  reason: Type.Optional(Type.String({ description: "Defaults to ''." })),
  priority: Type.Optional(Type.Union([
    Type.Literal('high'),
    Type.Literal('medium'),
    Type.Literal('low'),
  ], { description: 'Defaults to medium; unknown values are coerced to medium.' })),
})

// ── permissions.reply / permissions.replyRuntime ──────────────────────────

const PermissionReplyValue = Type.Union([
  Type.Literal('once'),
  Type.Literal('always'),
  Type.Literal('reject'),
])

/**
 * `POST /api/permissions/:id/reply`（列表入口，handler：
 * `routes/permission.ts` `handlePermissionReplyById`，human-only）：
 * 按 requestId 反查 sessionID 后转发 `session.permissionReply`。
 *
 * `persist` 只在 `reply:'always'` 时被读取：`'tool'` = 只沉淀裸工具名规则，
 * `'prefix'` = 前缀规则，缺省（含 `true` / 其它值）= 旧行为「有前缀则前缀，否则工具名」。
 */
export const PermissionReplyRequest = Type.Object({
  reply: PermissionReplyValue,
  message: Type.Optional(Type.String({ description: 'Optional note forwarded to the runtime reply.' })),
  persist: Type.Optional(Type.Union([Type.Boolean(), Type.Literal('tool'), Type.Literal('prefix')], {
    description: "Only read for reply:'always' — rule scope for the auto-persisted allow rule.",
  })),
})

/**
 * `POST /api/sessions/:sid/permissions/:rid`（会话直连入口，handler：
 * `routes/permission.ts` `handlePermissionReply`，runtime-internal，**不走 human gate**）。
 *
 * `reply` 与 legacy `approved` 二选一：`reply` 优先，`approved:true` → once、
 * `false` → reject；两者都取不到可判定值 → 400。`persist` 语义同上。
 */
export const PermissionReplyRuntimeRequest = Type.Object({
  reply: Type.Optional(PermissionReplyValue),
  approved: Type.Optional(Type.Boolean({
    description: 'Legacy boolean form, only read when reply is absent (true → once, false → reject).',
  })),
  message: Type.Optional(Type.String({ description: 'Optional note forwarded to the runtime reply.' })),
  persist: Type.Optional(Type.Union([Type.Boolean(), Type.Literal('tool'), Type.Literal('prefix')], {
    description: "Only read for reply:'always' — rule scope for the auto-persisted allow rule.",
  })),
})

// ── permissions.setMode ───────────────────────────────────────────────────

/**
 * `POST /api/sessions/:sid/permission-mode`（handler：`routes/permission-mode.ts`
 * `handlePermissionModeSet`）。`mode` 必须是三档之一（`'manual'` 作为 legacy alias
 * 被接受并由 `normalizeMode` 收敛为 read-only），否则 400。
 */
export const PermissionSetModeRequest = Type.Object({
  mode: Type.Union([
    Type.Literal('read-only'),
    Type.Literal('auto'),
    Type.Literal('full-access'),
    Type.Literal('manual'),
  ], { description: "'manual' is a legacy alias normalized to read-only." }),
})

// ── permissions.addAllowlist / removeAllowlist ────────────────────────────

/**
 * `POST /api/approvals/allowlist`（handler：`routes/allowlist.ts` `handleAllowlistPost`）。
 * `tool` trim 后必须非空（否则 400）；`prefix` 是可选的前缀作用域（参数前缀，如 `git `）。
 * 输入非法 JSON → 400。
 */
export const AllowlistAddRequest = Type.Object({
  tool: Type.String({ minLength: 1 }),
  prefix: Type.Optional(Type.String({ description: 'Argument prefix scope; blank = tool-wide entry.' })),
})

/**
 * `DELETE /api/approvals/allowlist`（handler 同上 `handleAllowlistDelete`）。
 * 删除同样走 **JSON body**（`parseEntryBody`），`tool` 非空否则 400；
 * 未命中条目 → 404。
 */
export const AllowlistRemoveRequest = Type.Object({
  tool: Type.String({ minLength: 1 }),
  prefix: Type.Optional(Type.String({ description: 'Must match the stored prefix; blank = tool-wide entry.' })),
})

// ── permissions.addRule / removeRule ──────────────────────────────────────

/**
 * `POST /api/approvals/rules`（handler：`routes/rules.ts` `handleRulesPost`）。
 * `tool` trim 后非空（否则 400）；`pattern` 是可选的参数模式，尾部 `*` 会被剥掉；
 * `action` 固定 allow（body 里的 action 不读）—— deny 规则尚无写通道。
 */
export const PermissionRuleAddRequest = Type.Object({
  tool: Type.String({ minLength: 1 }),
  pattern: Type.Optional(Type.String({ description: 'Argument pattern; trailing * is stripped. Blank = tool-wide rule.' })),
})

/**
 * `DELETE /api/approvals/rules`（handler 同上 `handleRulesDelete`）：与 add 同形
 * （JSON body，`tool` 必填）；未命中 → 404。
 */
export const PermissionRuleRemoveRequest = Type.Object({
  tool: Type.String({ minLength: 1 }),
  pattern: Type.Optional(Type.String({ description: 'Must match the stored pattern; blank = tool-wide rule.' })),
})
