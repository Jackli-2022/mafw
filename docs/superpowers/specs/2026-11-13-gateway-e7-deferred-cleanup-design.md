# Gateway E7 部署前 Deferred 收口：设计（2026-11-13）

> 目标：把 E1–E6 中影响**部署安全/资源/契约门禁**的 deferred 收口，再部署。大范围 schema 覆盖、全量 timer inventory、mobile 工作 tab 重做等不阻塞部署的项继续保留。

## 1. 范围

| 项 | 来源 | 修法 |
|---|---|---|
| 剩余 human-only 路由 | E5a deferred | 计划批准、triage confirm/reject/dismiss、lead boundary accept/merge/undo、approvals.respond、permissions.reply 全部要求 human principal |
| SDK 死契约债务 | E4/E5a deferred | 删除 `DEAD_CONTRACT_TODO`（review-items SDK 方法已存在）；删除 `session.events()`、`event.url(sessionID?)`、`SSEConnection.connectToSession`（Mode B 已移除，无生产调用） |
| worktree-before-quota 孤儿 | E4 deferred | `createSessionWithWorktree` 在 session 创建失败（含 429）时回滚 worktree/branch |
| MCP 磁盘门 | E4 deferred | `mafw_add_memory` 在 disk critical 时返回 `disk_low`，不再绕过 HTTP 门 |
| mobile `time.updated` | E6 deferred | `MafwSession.timeUpdated` + 列表排序/事件 patch 使用它 |
| E5b `nextSince<=since` | E5b deferred | 协议违约时返回 fallback（不全量假装 recovered） |
| desktop reset 游标 | E6 M3 | replay reset/truncated 后写回 headSeq，避免下次冷启动全量 |

## 2. 非目标（继续 deferred）

- 剩余 ~300 ops 的 response schema 覆盖。
- 全进程 timer inventory（serve watchdog/heartbeat/queue sweep/loader）。
- mobile 工作 tab 增量渲染（已有 goalId 局部更新）。
- pod.updated 记录级 payload、attention decision 投影、OS keychain、MCP human 工具。
- 强制版本协商 / SDK 全量 schema 类型化。

## 3. 设计

### E7-1 Human-only 路由

统一 helper（`gateway/src/core/http/human-guard.ts`）：
```ts
export function requireHumanPrincipal(req: IncomingMessage, res: ServerResponse): boolean
```
- `isHumanPrincipal((req as any).mafwPrincipal)` → true；否则写 403 `{error:'human principal required', code:'human_principal_required'}`，返回 false。
- 现有 pods/decisions/standing-goals 可继续用各自 helper；本波新路由用统一 helper（不强制重构旧路径）。

改造：
- `goal-plan.ts` POST `/api/goals/:id/plan-approval`（GET plan 只读不拦）。
- `triage.ts` `triage.confirm` / `triage.reject`；`wave1-handlers.ts` `triage.dismiss`。
- `lead-boundaries.ts` `lead.boundaries.accept|merge|undo`（list/observe 不拦）。
- `approvals.ts` `approvals.respond`。
- `questions-permissions.ts` `permissions.reply`（`replyRuntime` 不动，runtime 内部路径）。
- 测试：service/local/无 principal → 403 code；human → 原成功；普通只读/agent 建议路径不拦。

### E7-2 SDK 死面清理

- `contract.test.ts`：删除 `DEAD_CONTRACT_TODO` 常量、过滤、陈旧守卫测试；review-items 4 op 必须由 SDK 方法覆盖。
- `client.ts`：删除 `session.events()`；`event.url()` 去掉 `sessionID?` 参数，恒为 `${base}/api/events`。
- `sse.ts`：删除 `connectToSession()`。
- `types.ts`：删除 `SessionNamespace.events`、`EventNamespace.url(sessionID?)`。
- 测试更新：contract 5/5 + SDK full；无生产调用方（已 grep）。
- Breaking 记录：`session.events` 删除、`event.url` 参数删除。

### E7-3 Worktree 配额回滚

`createSessionWithWorktree`：
```ts
const wt = await manager.create(slug);
try {
  const session = await deps.createSession(...);
  deps.kvSet(...);
  return ...
} catch (err) {
  try { await manager.remove(wt.worktreeDir, wt.branch); } catch { /* best effort */ }
  throw err;
}
```
测试：createSession reject（模拟 QuotaExceededError）→ manager.remove 调用、错误原样抛出；成功路径不变。

### E7-4 MCP 磁盘门

- `Services` 增加 `pressure?: () => { disk: string; degraded: string[] } | null`。
- kernel services 对象注入 live getter（governor）。
- `handleAddMemory` 在内容/类型校验后、写盘前检查：disk critical → `{success:false, error:'disk space critical', code:'disk_low'}`，`isError:true`。
- 测试：critical 不调用 store；ok/null 正常；无 pressure 时行为不变。

### E7-5 小残留

- mobile `MafwSession.timeUpdated`：`fromJson` 读 `time.updated`；`copyWith`；`applySessionListEvent` 更新 `timeUpdated` 并重排；`SessionsPage._compareSessions` 用 `timeUpdated ?? timeCreated`。
- `EventRecoveryService`：`hasMore && nextSince <= since` → `fellBack(reason:'protocol')`，不再 `recovered`。
- desktop `SseConnection` reset/truncated gap：`writeSeq(gap.headSeq)`；测试期望从 null 改为 headSeq。

## 4. 测试/门禁

- gateway tsc + targeted human/SDK/worktree/MCP；full 允许 env-red。
- SDK tsc + full + contract（必须 5/5，无 TODO）。
- desktop full（1 resolver env-red）+ tsgo known noise。
- mobile targeted（session list/recovery）+ analyze。
- analyzer 0；kernel-split 7/7。

## 5. 部署

合并后：`gateway` build + 重启令牌；desktop/TUI 构建按现有流程；mobile release build 另行。部署后验证 `/api/kernel/stats`、`/api/events/replay`、human-only 403、mobile 会话列表增量。

## 6. 风险

| 风险 | 缓解 |
|---|---|
| human gate 打破 agent 自动 plan/triage 流程 | 这些动作本就 UI-only；测试覆盖 service/local 拒绝；`triage.propose`/`lead.observe` 不拦 |
| SDK 删除方法有隐藏调用方 | 已 grep 全仓；contract 测试确认；breaking 记录 |
| worktree remove 失败 | best-effort + 原错误优先；不掩盖 429 |
| MCP 磁盘门误伤 | 仅 disk critical；governor 缺失 fail-open |
| mobile 排序变化 | `timeUpdated ?? timeCreated` 兼容旧数据 |
