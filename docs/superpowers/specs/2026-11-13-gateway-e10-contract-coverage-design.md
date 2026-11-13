# Gateway E10 契约覆盖（第一批）：设计（2026-11-13）

> 目标：把 desktop/mobile 实际消费的「读接口」从无 schema 变成可校验契约，并建立覆盖率台账，为后续批次提供可重复的入口。

## 0. 基线（实测）

- `gateway/src/routes/route-catalog.ts`：**316** 个 operationId，其中仅 **13** 个带 `response`。
  （E8 release 中「20/316」为旧口径，含非 catalog 统计；本波以脚本实测 13 为准。）
- 已有 schema：`presence.get`、`session.list`、`session.get`、`session.messages`、`session.usageSummary`、`project.list`、`goals.get`、`attention.list`、`decisions.list`、`pods.get`、`memory.stats`、`kernel.stats`、`event.replay`。
- 生成链：catalog `response` → `npm run emit:openapi`（gateway）→ SDK `npm run gen:api`（`merge-contract.mjs` + `openapi-typescript`）。
- SDK 已有 DTO：`Todo`、`QueueItem`、`SessionCheckpoint`、`PodGoal`、`PodTask`、`PodMessage`、`PodGoalResult`、`PodReviewItemList`、`PodEventItem` 等，可在 `contract-compat.checks.ts` 做 `AssertEq`。

## 1. 范围

### E10-1 会话读接口（8 ops）

| op | path | 形状来源 |
|---|---|---|
| `session.queue.list` | `/api/session/:id/queue` | `sessions-core.ts` → `{ items: QueueItem[] }` |
| `session.config` | `/api/session/:id/config` | `core/session-config.ts` `get()` |
| `session.todo` | `/api/sessions/:id/todo` | `sessions-read.ts` → `{ data: Todo[] }` |
| `session.children` | `/api/sessions/:id/children` | `{ items: (Session & { depth: number })[] }`（runtime item 字段开放） |
| `session.tokenSummary` | `/api/sessions/:id/token-summary` | `totalTokens` / `totalCost` / `turnCount` / `avgTokensPerTurn` |
| `session.checkpoints` | `/api/sessions/:id/checkpoints` | `session-checkpoints.ts` → `{ checkpoints: SessionCheckpoint[] }` |
| `session.subagents.list` | `/api/sessions/:id/subagents` | `sessions-permissions.ts` |
| `session.diff` | `/api/sessions/:id/diff` | `session-diff.ts`（SDK `MafwDiff` 家族） |

Reserve（若某项 wire 被证明不稳定，记录理由后替换）：`session.structured`（runtime-owned opaque，默认不选）、`session.trajectory`。

### E10-2 Pod / Work 读接口（8 ops）

| op | path | 形状来源 |
|---|---|---|
| `work.overview` | `/api/projects/:projectId/work` | `pod-handlers.ts`（mobile work tab 消费） |
| `pod.events.list` | `/api/pods/:podId/events` | `pods-events-dispatch.ts` → `{ items: PodEventItem[] }` |
| `pods.tasks.list` | `/api/pods/:podId/tasks` | `routes/pods.ts` |
| `pods.messages.list` | `/api/pods/:podId/messages` | `routes/pods.ts` |
| `pods.goals` | `/api/pods/:podId/goals` | `routes/pods.ts` |
| `pods.goals.result` | `/api/pods/:podId/goals/:goalId/result` | `PodGoalResult` |
| `pods.goals.reviewItems` | `/api/pods/:podId/goals/:goalId/review-items` | `PodReviewItemList` |
| `pods.cost` | `/api/pods/:podId/cost` | `routes/pods.ts` |

Reserve：`pods.goals.revisions`、`pods.memory.get`、`pods.goals.worktree.diff`。

### E10-3 台账 + `session.get` 404 + 收口

1. **覆盖率台账**：`gateway/scripts/schema-coverage.cjs` 解析 catalog，输出总数/已覆盖/按 tag 分布/未覆盖清单；`npm run schema:coverage`。配套测试 `tests/unit/architecture/schema-coverage.test.ts`：
   - 断言 `E10_COVERED_OPS` 清单中每个 op 都有 `response`；
   - 断言覆盖数 ≥ 29（13 + 16）；
   - 防止 schema 被静默移除。
2. **`session.get` 缺失返回 404**：现状 `200 {error:'not found'}` 与 `SessionSchema` 矛盾。改为 `404 {error:'not found'}`；同 commit 审计并修正调用方（desktop `ChatPane`/`MafwShell`/`session-status`，SDK 文档），保证缺失会话按「不可用」处理而不是崩溃。
3. 文档 + release。

## 2. 规则（硬约束）

- schema 必须匹配 handler 实际 wire，**不得**为了好写把整个响应放宽成 `Unknown` / `additionalProperties: true`。
  - 边界对象只允许用于 runtime-owned payload（如 part 联合、runtime item 字段），必须在注释里写明 owner（先例：`MafwPartBoundary`）。
- 有 SDK DTO 的 op 必须在 `contract-compat.checks.ts` 加 `AssertEq`；schema 与 DTO 冲突时以 handler 为准修 DTO，并在报告里列出受影响的消费者（0 消费者优先）。
- 不改 handler 输出（E10-3 的 404 除外）；不新增/删除路由。
- 每个 op 只建模 200 成功体；错误体不建模。
- 生成物必须重生成并入库：gateway `emit:openapi`，SDK `gen:api`（含 `api-schema.gen.ts`）。`api-contract` 新鲜度测试必须绿。
- 测试：每个新 schema 至少一个断言（shape/必填字段/可空性），SDK 侧编译期检查计入。

## 3. 非目标

- 剩余 ~300 ops 全量 schema（本波只做 16 个 + 台账）。
- POST/PUT/PATCH/DELETE 的请求/响应 schema。
- 强制版本协商、OS keychain / 进程签名、MCP human 工具、插件配额副作用。
- `session.structured` / `session.trajectory` 的深度建模（runtime-owned，留待后续）。

## 4. 门禁

gateway：`tsc` 0 + `emit:openapi` 无意外 diff + 全量 jest（允许 9 env-red）+ `schema:coverage`。
SDK：`tsc` 0 + full + contract 4/4 + `gen:api` 一致。
desktop：full（允许 resolver env-red）+ `tsgo`（已知 `node:tls` 噪声）。
mobile：targeted + `dart analyze`（本波预计仅 work.overview 消费面受影响）。
架构：`node scripts/analyze-routes.cjs` TOTAL 0；kernel-split 7/7。
