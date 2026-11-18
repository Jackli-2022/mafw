/**
 * E10f-D：观测面读接口 schema（3 op，全部 GET JSON）。
 *
 *   - `dashboard.stats`  → `routes/dashboard.ts` `dashboard.stats` handler：
 *     `{activeGoals, registeredProjects, sseClients, serveRunning, eventAppendFailures?,
 *     tokens?}`。`eventAppendFailures` 只在有持久 event store 时出现（E2-5，
 *     null = 纯直播部署省略字段）；`tokens` 只在 `trajectoryStore()` 可用且汇总
 *     成功时出现（catch 分支只回 base）。两者因此 optional，但 analyze 面从不
 *     伪造空值。
 *     `tokens` = `trajectory-store.ts` `getGlobalTokenSummary()`
 *     （`totalTokens/totalCost/turnCount/sessionCount`，复用 `read-models.ts`
 *     的 TokenSummarySchema —— 与 `usage.summary` 同一投影）。
 *
 *   - `health.root`      → `http/transport.ts` `GET /health` 分支（TRANSPORT_ALLOWLIST）。
 *     这是 **liveness envelope**：活体计数 + release 身份字段。`status/serveRunning/
 *     registeredProjects/activeGoals/media` 恒发；8 个 release 身份字段由
 *     `release-info.ts` `gatewayHealthFields()` 整体提供，release metadata 尚未加载
 *     时整组省略 → 全部 optional（不把半组字段写成 required）。
 *
 *   - `session.subagents.result` → `runtime/subagent-service.ts` `result()`：
 *     `{status}` 恒发，`structured`（子代理提交的结构化输出）与 `text`（最后一条
 *     assistant 文本）互斥出现。`status` 与 service 导出的 `SubagentStatus` 编译期
 *     AssertEq 锁定；`structured` 是 runtime-owned 任意 JSON（outputSchema 由调用方
 *     决定），schema 只承诺键存在。
 */
import { Type, type Static } from '@sinclair/typebox'
import type { SubagentStatus } from '../../runtime/subagent-service'
import { TokenSummarySchema } from './read-models'

/** 编译期精确相等（与 SDK `contract-compat.checks.ts` 同一写法）。 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type AssertEq<A, B> = Equals<A, B> extends true ? true : ['MISMATCH', A, B]

const SubagentStatusSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('waiting'),
  Type.Literal('unknown'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('aborted'),
])

/**
 * `GET /api/sessions/:id/subagents/:subId/result`。
 * `structured` 是 runtime/subagent 提交的 outputSchema 结果（任意 JSON），
 * 与 `text` 二选一；`status` 是 gateway 推导的终态。
 */
export const SessionSubagentResultResponse = Type.Object({
  status: SubagentStatusSchema,
  /** owner = subagent outputSchema（调用方定义的 JSON），gateway 只透传。 */
  structured: Type.Optional(Type.Unknown()),
  text: Type.Optional(Type.String()),
})

/** `GET /api/stats`：运行时计数 + 可选全局 token 汇总。 */
export const DashboardStatsResponse = Type.Object({
  activeGoals: Type.Number(),
  registeredProjects: Type.Number(),
  sseClients: Type.Number(),
  serveRunning: Type.Boolean(),
  /** E2-5：持久 event_store 缺席时字段省略（旧 payload 形状）。 */
  eventAppendFailures: Type.Optional(Type.Number()),
  /** `trajectoryStore` 不可用 / 汇总抛错时省略（handler fail-open）。 */
  tokens: Type.Optional(TokenSummarySchema),
})

/**
 * `GET /health`：liveness envelope。
 * release 身份字段来自 `release-info.ts` `gatewayHealthFields()`（整组发或整组省略）。
 */
export const HealthResponse = Type.Object({
  status: Type.Literal('ok'),
  serveRunning: Type.Boolean(),
  registeredProjects: Type.Array(Type.String()),
  activeGoals: Type.Array(Type.String()),
  media: Type.Object({
    configured: Type.Boolean(),
  }),
  gatewayVersion: Type.Optional(Type.String()),
  experienceVersion: Type.Optional(Type.String()),
  minimumClientExperienceVersion: Type.Optional(Type.String()),
  schemaEpoch: Type.Optional(Type.Number()),
  instanceId: Type.Optional(Type.String()),
  distribution: Type.Optional(Type.Union([
    Type.Literal('desktop-managed'),
    Type.Literal('standalone'),
  ])),
  channel: Type.Optional(Type.String()),
  pid: Type.Optional(Type.Number()),
})

/** schema ↔ service 的 `SubagentStatus` 漂移即 gateway tsc 红。 */
const _SUBAGENT_STATUS_SCHEMA_MATCHES_SERVICE: AssertEq<Static<typeof SubagentStatusSchema>, SubagentStatus> = true
export { _SUBAGENT_STATUS_SCHEMA_MATCHES_SERVICE }
