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

export const GoalViewSchema = Type.Object({
  goalId: Type.String(),
  phase: Type.Union([Type.String(), Type.Null()]),
  loop: Type.Number(),
  currentWave: Type.Number(),
  totalWaves: Type.Number(),
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

const TokenCountsSchema = Type.Object({
  input: Type.Number(),
  output: Type.Number(),
  reasoning: Type.Number(),
  cache: Type.Object({
    read: Type.Number(),
    write: Type.Number(),
  }),
})

const TokenSummarySchema = Type.Object({
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
