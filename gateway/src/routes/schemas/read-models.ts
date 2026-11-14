/**
 * E3-6：四个核心读接口的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（RouteDef.response），不改变任何 handler 的 wire 形状。
 * `emit:openapi` 直接投影成 `responses.200.content['application/json'].schema`。
 * 形状来源：
 *   - goals.get            → routes/goal-get.ts `GoalView`（E1-4/A5）
 *   - project.list         → routes/projects.ts（id/worktree）
 *   - presence.get         → core/pod/pod-presence.ts `PodPresence`
 *   - session.usageSummary → routes/usage.ts + trajectory-store token summaries
 */
import { Type } from '@sinclair/typebox'

/**
 * `goals.get` → routes/goal-get.ts `projectGoalView()`。
 * E10b-1：波次计数在 `goals.list` 的 dashboard 投影里不存在，而同一个 `Goal` DTO
 * 服务两个 op，因此契约面按 optional 承诺（get 恒补齐，list 不携带）。
 */
export const GoalViewSchema = Type.Object({
  goalId: Type.String(),
  phase: Type.Union([Type.String(), Type.Null()]),
  loop: Type.Number(),
  currentWave: Type.Optional(Type.Number()),
  totalWaves: Type.Optional(Type.Number()),
  nextAction: Type.Optional(Type.String()),
  error: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.Union([Type.String(), Type.Null()]),
})

export const ProjectListResponse = Type.Object({
  projects: Type.Array(Type.Object({
    id: Type.String(),
    worktree: Type.String(),
  })),
})

const PresenceItemSchema = Type.Object({
  podId: Type.String(),
  projectId: Type.String(),
  projectName: Type.String(),
  goalId: Type.String(),
  title: Type.String(),
  phase: Type.Union([Type.String(), Type.Null()]),
  node: Type.Union([Type.String(), Type.Null()]),
  revision: Type.Number(),
  progress: Type.Union([
    Type.Object({ current: Type.Number(), total: Type.Number() }),
    Type.Null(),
  ]),
  startedAt: Type.String(),
  updatedAt: Type.String(),
})

export const PresenceResponse = Type.Object({
  running: Type.Array(PresenceItemSchema),
  attention: Type.Object({
    count: Type.Number(),
    items: Type.Array(Type.Object({
      id: Type.String(),
      goalId: Type.String(),
      revision: Type.Number(),
      kind: Type.String(),
      title: Type.String(),
      podId: Type.Optional(Type.String()),
      projectId: Type.Optional(Type.String()),
    }, { additionalProperties: true })),
  }),
  unreadResults: Type.Object({
    count: Type.Number(),
    latest: Type.Union([PresenceItemSchema, Type.Null()]),
  }),
})

export const TokenCountsSchema = Type.Object({
  input: Type.Number(),
  output: Type.Number(),
  reasoning: Type.Number(),
  cache: Type.Object({
    read: Type.Number(),
    write: Type.Number(),
  }),
})

export const TokenSummarySchema = Type.Object({
  totalTokens: TokenCountsSchema,
  totalCost: Type.Number(),
  turnCount: Type.Number(),
  sessionCount: Type.Number(),
})

/** session 汇总来自 getSessionTokenSummary（无 sessionCount，带 avgTokensPerTurn）。 */
const SessionTokenSummarySchema = Type.Object({
  totalTokens: TokenCountsSchema,
  totalCost: Type.Number(),
  turnCount: Type.Number(),
  sessionCount: Type.Optional(Type.Number()),
  avgTokensPerTurn: TokenCountsSchema,
})

const MemoryTokenSummarySchema = Type.Object({
  totalTokens: TokenCountsSchema,
  totalCost: Type.Number(),
  turnCount: Type.Number(),
  sessionCount: Type.Number(),
  byRole: Type.Record(Type.String(), TokenSummarySchema),
})

export const UsageSummaryResponse = Type.Object({
  session: Type.Union([SessionTokenSummarySchema, Type.Null()]),
  project: Type.Union([TokenSummarySchema, Type.Null()]),
  global: Type.Union([TokenSummarySchema, Type.Null()]),
  // fail-open catch 分支省略 memory；成功分支 memory 可为 null。
  memory: Type.Optional(Type.Union([MemoryTokenSummarySchema, Type.Null()])),
})

// ── E8-3: decisions.list / attention.list（SDK-facing 读面） ──

/**
 * 形状来源：
 *   - decisions.list → `core/decision/decision-record.ts` `DecisionRecord`
 *   - attention.list → `core/lead/attention.ts` `AttentionItem`
 * 两者与 `@mafw/sdk` 的 `DecisionList` / `AttentionList` 逐字段等价
 * （`contract-compat.checks.ts` 的 AssertEq 钉住）。
 */
const DecisionKindSchema = Type.Union([
  Type.Literal('direction'),
  Type.Literal('plan'),
  Type.Literal('scope'),
  Type.Literal('authorization'),
  Type.Literal('acceptance'),
  Type.Literal('priority'),
  Type.Literal('disposition'),
  Type.Literal('other'),
])

/**
 * E10h-R3：`export`（本波唯一改动）——三个 decision 写接口（draft / confirm /
 * shelve / reopen）的 200 是 `{record}`，record 与列表 item 是同一个 DTO，
 * 由 `schemas/decision-write-responses.ts` 直接复用，避免第二份转写。
 */
export const DecisionRecordSchema = Type.Object({
  id: Type.String(),
  projectDir: Type.String(),
  goalId: Type.Union([Type.String(), Type.Null()]),
  revision: Type.Union([Type.Number(), Type.Null()]),
  kind: DecisionKindSchema,
  status: Type.Union([
    Type.Literal('draft'),
    Type.Literal('decided'),
    Type.Literal('shelved'),
  ]),
  question: Type.String(),
  options: Type.Array(Type.Object({
    id: Type.String(),
    title: Type.String(),
    summary: Type.Optional(Type.String()),
    risks: Type.Optional(Type.Array(Type.String())),
  })),
  evidence: Type.Array(Type.Object({
    kind: Type.Union([
      Type.Literal('message'),
      Type.Literal('file'),
      Type.Literal('change'),
      Type.Literal('review_item'),
      Type.Literal('goal'),
    ]),
    ref: Type.String(),
    label: Type.Optional(Type.String()),
  })),
  rationale: Type.Union([Type.String(), Type.Null()]),
  consequences: Type.Union([Type.String(), Type.Null()]),
  reviewAt: Type.Union([Type.String(), Type.Null()]),
  decidedBy: Type.Union([Type.String(), Type.Null()]),
  decidedAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
  history: Type.Array(Type.Object({
    action: Type.Union([
      Type.Literal('drafted'),
      Type.Literal('confirmed'),
      Type.Literal('shelved'),
      Type.Literal('reopened'),
    ]),
    by: Type.Union([Type.Literal('agent'), Type.Literal('user')]),
    at: Type.String(),
    note: Type.Optional(Type.String()),
  })),
})

export const DecisionListResponse = Type.Object({
  items: Type.Array(DecisionRecordSchema),
})

const AttentionKindSchema = Type.Union([
  Type.Literal('answer'),
  Type.Literal('plan_approval'),
  Type.Literal('review'),
  Type.Literal('review_item'),
  Type.Literal('blocked'),
  Type.Literal('failed'),
  Type.Literal('direction_review'),
  Type.Literal('decision'),
])

export const AttentionListResponse = Type.Object({
  items: Type.Array(Type.Object({
    id: Type.String(),
    goalId: Type.String(),
    revision: Type.Number(),
    kind: AttentionKindSchema,
    priority: Type.Number(),
    coalesceKey: Type.String(),
    title: Type.String(),
    detail: Type.Optional(Type.String()),
    action: Type.Object({
      type: Type.String(),
      goalId: Type.String(),
      questionId: Type.Optional(Type.String()),
      itemId: Type.Optional(Type.String()),
      rel: Type.Optional(Type.String()),
      line: Type.Optional(Type.Number()),
    }),
  })),
})

// ── E10f-C：orchestration.outcomes ──────────────────────────────────────────

/**
 * `GET /api/orchestration/outcomes?policy=&verdict=&project=&limit=` →
 * `{outcomes}`，行来自 `memory/gateway-db.ts` `GoalOutcome`（`SELECT *` 原样下发，
 * 列名是 snake_case 存储形态）。internal / 运维诊断面：SDK 与 desktop 都不调用
 * （只有 MCP `listOutcomes` 在 gateway 内消费），故 schema-only。
 *
 * `task_type` 是 D4b 迁移列（legacy 行为 NULL），`created_at` 可空；
 * `rounds` / `thumbs_up` / `thumbs_down` 有 DEFAULT 0，非空。
 */
const GoalOutcomeRowSchema = Type.Object({
  goal_id: Type.String(),
  project_id: Type.Union([Type.String(), Type.Null()]),
  verdict: Type.String(),
  rounds: Type.Number(),
  duration_ms: Type.Union([Type.Number(), Type.Null()]),
  tokens_input: Type.Union([Type.Number(), Type.Null()]),
  tokens_output: Type.Union([Type.Number(), Type.Null()]),
  total_cost: Type.Union([Type.Number(), Type.Null()]),
  tool_error_count: Type.Union([Type.Number(), Type.Null()]),
  thumbs_up: Type.Number(),
  thumbs_down: Type.Number(),
  policy_version: Type.String(),
  evolution_proposal_id: Type.Union([Type.String(), Type.Null()]),
  failure_kind: Type.Union([Type.String(), Type.Null()]),
  failure_signature: Type.Union([Type.String(), Type.Null()]),
  task_type: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  created_at: Type.Union([Type.String(), Type.Null()]),
  archived_at: Type.String(),
})

export const OrchestrationOutcomesResponse = Type.Object({
  outcomes: Type.Array(GoalOutcomeRowSchema),
})
