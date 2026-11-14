/**
 * E10b-2：human-gate / 权限读接口（7 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状；
 * `emit:openapi` 直接投影成 `responses.200.content['application/json'].schema`。
 * 形状来源（handler 是事实源）：
 *   - approvals.list             → routes/approvals.ts（`~/.mafw/user-questions` 扫描）
 *   - questions.list             → routes/questions-permissions.ts + runtime `projectQuestionRequest`
 *   - triage.list                → routes/triage.ts + `automation-engine.getTriageItems()`（磁盘 JSON 原样）
 *   - permissions.list           → routes/questions-permissions.ts + runtime `projectPermissionList`
 *   - permissions.getMode        → routes/permission-mode.ts `handlePermissionModeGet`
 *   - permissions.listAllowlist  → routes/allowlist.ts `handleAllowlistGet`（`core/approval/allowlist-store`）
 *   - permissions.listRules      → routes/rules.ts `handleRulesGet`（`core/approval/rules-store`）
 *
 * 与 `@mafw/sdk` DTO 的等价性由 `contract-compat.checks.ts` 的编译期 AssertEq 钉住
 * （Approval / QuestionRequest / TriageItem / MafwPermissionRequest / PermissionsNamespace 返回类型）。
 *
 * approvals.list / questions.list / triage.list 此前由 `contract/overrides.json` 手写 schema 描述；
 * E10b-2 起改为 code-first，override 条目删除。三处均按 handler 修正了 override 的偏差
 * （见各段注释与 SDK DTO 的同步改动）。
 */
import { Type } from '@sinclair/typebox'

// ── approvals.list ──────────────────────────────────────────────────────────

/**
 * 一条待办审批 = `user-questions/*.json` 的一行投影。
 *
 * handler 只投影 `{id, goalId, question, status, createdAt}`：
 *   - `id` 是文件名（去 `.json`），必填；
 *   - `goalId` 在 flat legacy 文件（`core/tools/run-ask-user.ts` 的 `goalId?`）里可缺，
 *     `JSON.stringify` 会直接省略该键 → optional；
 *   - `createdAt` 同源：legacy 文件写的是 `timestamp`，投影取不到就是 undefined → optional；
 *   - `status` 由 `q.answered` 派生，wire 上只有 pending / answered（override 里的
 *     'expired' 从未被任何 writer 产出，E10b-2 按 handler 收窄）。
 */
const ApprovalSchema = Type.Object({
  id: Type.String(),
  goalId: Type.Optional(Type.String()),
  question: Type.String(),
  status: Type.Union([Type.Literal('pending'), Type.Literal('answered')]),
  createdAt: Type.Optional(Type.String()),
})

export const ApprovalListResponse = Type.Object({
  approvals: Type.Array(ApprovalSchema),
})

// ── questions.list ──────────────────────────────────────────────────────────

/** 单题选项（`projectQuestionRequest` 的 `canonicalQuestion`：label 恒有，description 可选）。 */
const QuestionOptionSchema = Type.Object({
  label: Type.String(),
  description: Type.Optional(Type.String()),
})

/** 单题规范字段；`multiple` / `custom` 只在为 true 时出现（投影用条件展开）。 */
const QuestionInfoSchema = Type.Object({
  question: Type.String(),
  header: Type.Optional(Type.String()),
  options: Type.Array(QuestionOptionSchema),
  multiple: Type.Optional(Type.Boolean()),
  custom: Type.Optional(Type.Boolean()),
})

/**
 * runtime 问题请求的规范投影。
 *
 * 边界说明（owner = runtime adapter / view-projections）：`projectQuestionRequest`
 * 先 `{...request}` 再覆盖规范字段，原生 residual（`form` / `mode` / `expiresAt` /
 * 每题 `type`/`required`/`placeholder`…）仍随响应下发——卡片 typed 控件读的就是这些扩展。
 * 契约只承诺跨 runtime 一致的规范字段；无法投影（缺 id）的条目 handler 原样透传，
 * 属 legacy 容错路径，不在承诺内。
 */
const QuestionRequestSchema = Type.Object({
  id: Type.String(),
  sessionID: Type.String(),
  questions: Type.Array(QuestionInfoSchema),
  tool: Type.Optional(Type.Object({
    messageID: Type.String(),
    callID: Type.String(),
  })),
  /** `createdAt` 被投影补齐时的规范时间（`projectQuestionRequest` 的 `time.created`）。 */
  time: Type.Optional(Type.Object({
    created: Type.Optional(Type.Number()),
  })),
})

export const QuestionListResponse = Type.Object({
  items: Type.Array(QuestionRequestSchema),
})

// ── triage.list ─────────────────────────────────────────────────────────────

/**
 * `automation-engine.getTriageItems()` 读 `~/.mafw/triage/*.json` 原样下发；
 * 文件由三处 writer 产出：`createTriage()`、kernel `memory:skillPromotion`、
 * kernel `memory:axiomDistill`（后者不带 `proposedGoal`，故 optional）。
 */
const TriageProposedGoalSchema = Type.Object({
  title: Type.String(),
  boundaries: Type.Array(Type.String()),
  estimatedLoops: Type.Number(),
})

const TriageUserActionSchema = Type.Object({
  type: Type.Union([Type.Literal('confirm'), Type.Literal('ignore'), Type.Literal('edit')]),
  at: Type.String(),
})

const TriageLlmSuggestionSchema = Type.Object({
  action: Type.Union([Type.Literal('confirm'), Type.Literal('reject')]),
  reason: Type.String(),
  priority: Type.Union([Type.Literal('high'), Type.Literal('medium'), Type.Literal('low')]),
  timestamp: Type.String(),
})

/**
 * 边界形状：`summary` 是草稿载荷（skillDraft / axiomDraft / 自动化产物），
 * owner = automation engine + memory pipeline 的各类 writer；gateway 只原样透传，
 * `routes/triage.ts` 的 confirm 分支按 `summary.skillDraft` / `summary.axiomDraft` 自行识别。
 */
const TriageSummaryBoundary = Type.Record(Type.String(), Type.Unknown())

const TriageItemSchema = Type.Object({
  id: Type.String(),
  automationId: Type.String(),
  discoveredAt: Type.String(),
  source: Type.String(),
  summary: TriageSummaryBoundary,
  proposedGoal: Type.Optional(TriageProposedGoalSchema),
  state: Type.Union([
    Type.Literal('PENDING_CONFIRMATION'),
    Type.Literal('CONFIRMED'),
    Type.Literal('REJECTED'),
  ]),
  userAction: Type.Union([TriageUserActionSchema, Type.Null()]),
  deadline: Type.String(),
  llmSuggestions: Type.Optional(Type.Array(TriageLlmSuggestionSchema)),
  updatedAt: Type.Optional(Type.String()),
})

export const TriageListResponse = Type.Object({
  items: Type.Array(TriageItemSchema),
})

// ── permissions.list ────────────────────────────────────────────────────────

/**
 * 权限请求规范投影（`projectPermissionRequest`；网关两侧同一出口）。
 * `kind` 恒有（缺省 `tool`），`targets` 恒为数组（patterns / args 提取后可能为空）。
 */
const SuggestedRuleSchema = Type.Object({
  scope: Type.Union([Type.Literal('tool'), Type.Literal('prefix')]),
  value: Type.String(),
})

/** 边界形状：`extensions` 携带原生 metadata/impact/risk，owner = runtime adapter；gateway 原样并入。 */
const PermissionRequestSchema = Type.Object({
  id: Type.String(),
  sessionID: Type.String(),
  kind: Type.String(),
  targets: Type.Array(Type.String()),
  suggestedRule: Type.Optional(SuggestedRuleSchema),
  tool: Type.Optional(Type.Object({
    messageID: Type.String(),
    callID: Type.String(),
  })),
  time: Type.Optional(Type.Object({
    created: Type.Optional(Type.Number()),
  })),
  extensions: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

export const PermissionListResponse = Type.Object({
  items: Type.Array(PermissionRequestSchema),
})

// ── permissions.getMode ─────────────────────────────────────────────────────

/**
 * per-session 审批模式（`handlePermissionModeGet`）：`mode` 是 policy 归一化后的三档
 * （legacy 'manual' 读取时已是 read-only），`budget` 是常量 25。
 */
export const PermissionModeResponse = Type.Object({
  mode: Type.Union([
    Type.Literal('read-only'),
    Type.Literal('auto'),
    Type.Literal('full-access'),
  ]),
  autoApprovals: Type.Number(),
  budget: Type.Number(),
})

// ── permissions.listAllowlist ───────────────────────────────────────────────

/** `AllowlistStore.list()`：`tool` 必填，`prefix` 只在 config 串带 `tool:prefix` 时出现。 */
export const AllowlistEntrySchema = Type.Object({
  tool: Type.String(),
  prefix: Type.Optional(Type.String()),
})

export const AllowlistListResponse = Type.Object({
  entries: Type.Array(AllowlistEntrySchema),
})

// ── permissions.listRules ───────────────────────────────────────────────────

/**
 * `PermissionRulesStore.list()` 的行（`~/.mafw/permission-rules.json`）。
 * `action` 当前只有 'allow'（deny 规则预留，store 读取时过滤掉非 allow 行）。
 */
export const PermissionRuleSchema = Type.Object({
  tool: Type.String(),
  pattern: Type.Optional(Type.String()),
  action: Type.Literal('allow'),
})

export const PermissionRulesListResponse = Type.Object({
  entries: Type.Array(PermissionRuleSchema),
})
