# Gateway E7 部署前 Deferred 收口 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** 收口部署前高优先 deferred：human gates、SDK 死面、worktree 配额回滚、MCP 磁盘门、mobile/E5b/E6 小残留；随后部署。

**Spec:** `docs/superpowers/specs/2026-11-13-gateway-e7-deferred-cleanup-design.md`

## Global Constraints

- TDD；每项一个 commit `(E7-n)`。
- 普通 API 行为不变；human-only 收紧有测试。
- SDK 删除仅限无生产调用方的死面；contract 5/5。
- 隔离 worktree `.superpowers/e7-worktree` + 分支 `feat/gateway-e7-deferred-cleanup`。
- 已知环境红沿用。

---

### Task 1: 剩余 human gates（E7-1）

**Files:** Create `gateway/src/core/http/human-guard.ts`；Modify `routes/goal-plan.ts`、`triage.ts`、`wave1-handlers.ts`（dismiss）、`lead-boundaries.ts`、`approvals.ts`、`questions-permissions.ts`；Tests `gateway/tests/unit/routes/human-only-guards.test.ts` + 各路由测试。

- [ ] Step 1: RED — 上述 POST 路由 service/local/无 principal → 403 `human_principal_required`；human → 原 200；GET/list/observe/propose 不拦。
- [ ] Step 2: GREEN — helper + 接入；更新现有测试注入 human principal。
- [ ] Step 3: tsc + `tests/unit/routes/ tests/unit/core/ tests/unit/http/`。
- [ ] Step 4: Commit `fix(auth): close remaining human-only routes (E7-1)`。

### Task 2: SDK 死面清理（E7-2）

**Files:** Modify `packages/gateway-sdk/src/contract.test.ts`、`client.ts`、`types.ts`、`sse.ts` + tests。

- [ ] Step 1: RED — 删除 `DEAD_CONTRACT_TODO` 后 contract 仍应 5/5（若红说明 SDK 覆盖不足）；删除 `session.events`/`event.url(sessionID?)`/`connectToSession` 后 tsc/测试红。
- [ ] Step 2: GREEN — 删除死面、更新测试；contract 无豁免。
- [ ] Step 3: SDK tsc + full + contract 5/5。
- [ ] Step 4: Commit `refactor(sdk): drop dead mode-b surface and contract TODO (E7-2)`。

### Task 3: Worktree 配额回滚（E7-3）

**Files:** Modify `gateway/src/routes/session-worktree.ts`；Test `gateway/tests/unit/routes/session-worktree.test.ts`（或现有）。

- [ ] Step 1: RED — createSession reject → manager.remove(dir,branch) 调用 + 原错误抛出；成功路径不变。
- [ ] Step 2: GREEN — try/catch rollback。
- [ ] Step 3: tsc + targeted。
- [ ] Step 4: Commit `fix(sessions): roll back worktree when session creation is rejected (E7-3)`。

### Task 4: MCP 磁盘门（E7-4）

**Files:** Modify `gateway/src/types.ts`（Services.pressure）、`gateway/src/kernel.ts`（services 注入）、`gateway/src/mcp/handlers/add-memory.ts`；Test `gateway/tests/unit/mcp/add-memory-pressure.test.ts`。

- [ ] Step 1: RED — critical 返回 `{success:false,code:'disk_low'}` 且 store 未调用；ok/null/无 pressure 正常。
- [ ] Step 2: GREEN — live pressure getter + handler 检查。
- [ ] Step 3: tsc + MCP tests。
- [ ] Step 4: Commit `fix(mcp): honor disk pressure on memory writes (E7-4)`。

### Task 5: 小残留（E7-5）

**Files:** Modify `mobile/lib/src/models/mafw_models.dart`、`mobile/lib/src/models/session_list_events.dart`、`mobile/lib/src/pages/sessions_page.dart` + tests；`mobile/lib/src/services/event_recovery.dart` + test；`packages/desktop/.../sse-connection.ts` + test。

- [ ] Step 1: RED — mobile timeUpdated 排序/更新；recovery protocol fallback；desktop reset cursor headSeq。
- [ ] Step 2: GREEN — 实现。
- [ ] Step 3: mobile targeted + analyze；desktop sse tests。
- [ ] Step 4: Commit `fix(clients): close time.updated, protocol fallback, reset cursor residuals (E7-5)`。

### Task 6: 收口 + 部署（E7-6）

- [ ] Step 1: docs/release `docs/releases/2026-11-13-gateway-e7-deferred.md`；architecture 更新（human gates/SDK 死面/MCP 门/残余）。
- [ ] Step 2: 全量门禁（gateway sdk desktop mobile analyzer kernel-split）。
- [ ] Step 3: 终审 + fix + merge；构建 gateway、写 restart token、验证部署；desktop/TUI/mobile 构建说明。
- [ ] Step 4: commit `docs(gateway): E7 deferred cleanup and deploy (E7-6)`。

## Ledger

`.superpowers/sdd/2026-11-13-gateway-e7-deferred/progress.md`
