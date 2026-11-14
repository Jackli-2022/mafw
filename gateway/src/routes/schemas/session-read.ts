/**
 * E10-1：session 读接口（8 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状；
 * `emit:openapi` 直接投影成 `responses.200.content['application/json'].schema`。
 * 形状来源（handler 是事实源）：
 *   - session.queue.list     → routes/sessions-core.ts + core/session-queue.ts `QueuedItem`
 *   - session.config         → routes/session-config.ts + core/session-config.ts `get()`
 *   - session.todo           → routes/sessions-read.ts `{ data }`（runtime todo 原样转发）
 *   - session.children       → routes/sessions-read.ts `{ items: runtime children + depth }`
 *   - session.tokenSummary   → routes/sessions-read.ts + trajectory-store `getSessionTokenSummary`
 *   - session.checkpoints    → routes/session-checkpoints.ts `{ checkpoints }`（+ Experience actions）
 *   - session.subagents.list → routes/subagents.ts `{ items: SubagentRecord[] }`
 *   - session.diff           → routes/session-diff.ts `{ files: MafwDiff[] }`
 *
 * 与 `@mafw/sdk` DTO 的等价性由 `contract-compat.checks.ts` 的编译期 AssertEq 钉住
 * （QueueItem / SessionConfigState / Todo / SessionCheckpointListItem / SubagentList /
 * MafwDiff 家族；tokenSummary 锁 client 现有内联返回类型）。
 */
import { Type } from '@sinclair/typebox'

const ThinkingLevel = Type.Union([
  Type.Literal('off'),
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
  Type.Literal('max'),
])

// ── session.queue.list ──────────────────────────────────────────────────────

/**
 * 边界形状：队列条目的 `parts` 是客户端 prompt payload（session.promptAsync body），
 * gateway 只做校验后原样入队（`core/session-queue.ts` 不重写 part）。
 * owner = view-dto / 请求体契约；这里只承诺 SDK 边界守卫认的最小形状（`type` 必填）。
 */
const QueuedPartBoundary = Type.Object({
  type: Type.String(),
  text: Type.Optional(Type.String()),
}, { additionalProperties: true })

/** 与 `@mafw/sdk` `QueueItem` 逐字段等价（thinkingLevel 经 isThinkingLevel 白名单校验后才入队）。 */
const QueueItemSchema = Type.Object({
  id: Type.String(),
  sessionID: Type.String(),
  text: Type.Optional(Type.String()),
  parts: Type.Optional(Type.Array(QueuedPartBoundary)),
  agent: Type.Optional(Type.String()),
  model: Type.Optional(Type.Object({
    providerID: Type.String(),
    modelID: Type.String(),
  })),
  expectReply: Type.Optional(Type.Boolean()),
  idempotencyKey: Type.Optional(Type.String()),
  thinkingLevel: Type.Optional(ThinkingLevel),
  variant: Type.Optional(Type.String()),
  enqueuedAt: Type.String(),
  source: Type.String(),
})

export const SessionQueueListResponse = Type.Object({
  items: Type.Array(QueueItemSchema),
})

// ── session.config ──────────────────────────────────────────────────────────

/** `SessionConfigService.get()` 恒发 mode + thinkingLevelSupported（其余字段仅在存在时出现）。 */
export const SessionConfigResponse = Type.Object({
  mode: Type.Union([
    Type.Literal('read-only'),
    Type.Literal('auto'),
    Type.Literal('full-access'),
  ]),
  agent: Type.Optional(Type.String()),
  model: Type.Optional(Type.Object({
    providerID: Type.String(),
    modelID: Type.String(),
  })),
  variant: Type.Optional(Type.String()),
  thinkingLevel: Type.Optional(ThinkingLevel),
  thinkingLevelSupported: Type.Boolean(),
})

// ── session.todo ────────────────────────────────────────────────────────────

/** runtime todo 条目（opencode todowrite / plan 域同形）；SDK `Todo` 钉住这四个字段。 */
const TodoSchema = Type.Object({
  id: Type.String(),
  content: Type.String(),
  status: Type.String(),
  priority: Type.String(),
})

export const SessionTodoResponse = Type.Object({
  data: Type.Array(TodoSchema),
})

// ── session.children ────────────────────────────────────────────────────────

/**
 * 边界形状：子会话条目由 runtime 拥有（adapter `session.children` 通道 —— opencode 走原生
 * `/session?parentID=` 列表、pi 走 registry `AdapterSession`），字段随 runtime 变化；
 * gateway 只保证 `id` 与自己补齐的 `depth`（`sessions-read.ts` 在缺省时写 parentDepth+1）。
 * 因此不组合 `SessionSchema`：pi 的 `AdapterSession` 只有 id 必填，title/directory/time 皆可选。
 */
const RuntimeChildSessionBoundary = Type.Object({
  id: Type.String(),
  depth: Type.Number(),
}, { additionalProperties: true })

export const SessionChildrenResponse = Type.Object({
  items: Type.Array(RuntimeChildSessionBoundary),
})

// ── session.tokenSummary ────────────────────────────────────────────────────

const TokenCountsSchema = Type.Object({
  input: Type.Number(),
  output: Type.Number(),
  reasoning: Type.Number(),
  cache: Type.Object({
    read: Type.Number(),
    write: Type.Number(),
  }),
})

/**
 * `trajectoryStore.getSessionTokenSummary` 的 4 个字段（无 sessionCount）；
 * store 缺失/抛错时 handler 回同一形状的零值汇总。
 */
export const SessionTokenSummaryResponse = Type.Object({
  totalTokens: TokenCountsSchema,
  totalCost: Type.Number(),
  turnCount: Type.Number(),
  avgTokensPerTurn: TokenCountsSchema,
})

// ── session.checkpoints ─────────────────────────────────────────────────────

/**
 * Experience ActionDescriptor（`experience/experience-contract.ts`）：supported 描述功能面，
 * enabled 描述此刻可执行性，对象级限制走 reason。
 */
const ActionDescriptorSchema = Type.Object({
  supported: Type.Boolean(),
  enabled: Type.Boolean(),
  reason: Type.Optional(Type.Union([
    Type.Literal('unsupported'),
    Type.Literal('busy'),
    Type.Literal('missing-data'),
    Type.Literal('non-invertible-patch'),
    Type.Literal('unsafe'),
  ])),
  warningKey: Type.Optional(Type.String()),
  semantics: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
})

const CheckpointActionsSchema = Type.Object({
  restoreConversation: ActionDescriptorSchema,
  restoreFiles: ActionDescriptorSchema,
  restoreBoth: ActionDescriptorSchema,
})

/**
 * 列表条目 = `core/checkpoint/checkpoint-service.ts` 的 `SessionCheckpoint` + 路由层
 * `projectCheckpointActions` 恒挂的 `actions`（POST 创建响应不带 actions，故 SDK 用
 * `SessionCheckpointListItem` 单独表达列表形状）。
 */
export const SessionCheckpointSchema = Type.Object({
  id: Type.String(),
  sessionID: Type.String(),
  projectDir: Type.String(),
  anchorMessageID: Type.String(),
  snapshotTree: Type.Union([Type.String(), Type.Null()]),
  untracked: Type.Array(Type.String()),
  kind: Type.Union([Type.Literal('auto'), Type.Literal('manual')]),
  createdAt: Type.String(),
  actions: CheckpointActionsSchema,
})

export const SessionCheckpointsResponse = Type.Object({
  checkpoints: Type.Array(SessionCheckpointSchema),
})

// ── session.subagents.list ──────────────────────────────────────────────────

/** `SubagentService.list()` → `SubagentRecord`（gateway-owned 记录面）。 */
export const SubagentRecordSchema = Type.Object({
  id: Type.String(),
  parentID: Type.String(),
  depth: Type.Number(),
  agent: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  status: Type.Union([
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('aborted'),
  ]),
  background: Type.Optional(Type.Boolean()),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
  error: Type.Optional(Type.String()),
})

export const SessionSubagentsResponse = Type.Object({
  items: Type.Array(SubagentRecordSchema),
})

// ── session.diff ────────────────────────────────────────────────────────────

/**
 * 与 `@mafw/sdk` `MafwDiff` 家族等价：`file` 恒有（turn-diff 解析与 runtime 会话级 diff 都带），
 * 其余字段可选；`status` 用 view-dto 的归一化词表。
 */
const MafwDiffSchema = Type.Object({
  file: Type.String(),
  patch: Type.Optional(Type.String()),
  additions: Type.Optional(Type.Number()),
  deletions: Type.Optional(Type.Number()),
  status: Type.Optional(Type.Union([
    Type.Literal('added'),
    Type.Literal('modified'),
    Type.Literal('deleted'),
    Type.Literal('renamed'),
    Type.Literal('unknown'),
  ])),
})

export const SessionDiffResponse = Type.Object({
  files: Type.Array(MafwDiffSchema),
})
