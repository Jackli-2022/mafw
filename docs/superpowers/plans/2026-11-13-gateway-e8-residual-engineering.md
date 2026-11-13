# Gateway E8 剩余工程 Debt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox.

**Goal:** 清 timer inventory、preload 死参数、6 个核心读 schema、E5b 恢复残留、删除死 `authorizeWsUpgrade`。

**Spec:** `docs/superpowers/specs/2026-11-13-gateway-e8-residual-engineering-design.md`

## Global Constraints

- TDD；每项一个 commit `(E8-n)`。
- 不改 wire shape；schema 只加元数据。
- 隔离 worktree `.superpowers/e8-worktree` + 分支 `feat/gateway-e8-residual-engineering`。
- 已知环境红沿用。

### Task 1: Timer inventory（E8-1）

**Files:** Modify `gateway/src/kernel.ts`、`gateway/src/boot.ts`；Tests `gateway/tests/unit/core/timer-service.test.ts` / kernel timer wiring.

- [ ] 替换 `pod:event-prune`、`pod:event-wake`、`heartbeat:sweep`、`queue:sweep`、`session:sweep`、`serve:watchdog`、`discovery:heartbeat` 为 `timers.every`；保持 unref/清理；boot discovery heartbeat 用 kernel timers。
- [ ] 测试 dispose 后无回调、stats 含新名称；tsc + targeted。
- [ ] Commit `refactor(kernel): move remaining long-lived intervals onto TimerService (E8-1)`。

### Task 2: Preload event.url（E8-2）

**Files:** `packages/desktop/src/preload/mafw-types.ts`、`mafw-api.ts`、main IPC event url handler/tests.

- [ ] `event.url()` 无参；IPC 不再传 sessionID；测试更新。
- [ ] Commit `refactor(desktop): drop dead event url session parameter (E8-2)`。

### Task 3: Core read schemas（E8-3）

**Files:** `gateway/src/routes/schemas/*`、`route-catalog.ts`；Tests `api-contract`/contract.

- [ ] 为 `session.get`、`session.messages`、`decisions.list`、`attention.list`、`memory.stats`、`pods.list` 加 TypeBox response schema；实际 op id 以 catalog 为准。
- [ ] emit:openapi + merge-contract；SDK tsc/contract；api-contract schema assertions。
- [ ] Commit `feat(contract): response schemas for six core read endpoints (E8-3)`。

### Task 4: E5b recovery residuals（E8-4）

**Files:** `mobile/lib/src/services/event_recovery.dart`、`recovery_coordinator.dart` + tests.

- [ ] reset 允许游标降到 head；busy greeting 排队一次重跑；intentional disconnect 忽略。
- [ ] Tests + analyze.
- [ ] Commit `fix(mobile): finish reset and busy-greeting recovery edges (E8-4)`。

### Task 5: Remove dead authorizeWsUpgrade（E8-5）

**Files:** `gateway/src/core/auth.ts` + tests/callers.

- [ ] grep 确认无生产调用；删除函数/类型/测试或迁移到 resolvePrincipal。
- [ ] tsc + targeted.
- [ ] Commit `refactor(auth): remove dead authorizeWsUpgrade (E8-5)`。

### Task 6: 收口（E8-6）

- [ ] docs/release `docs/releases/2026-11-13-gateway-e8-residual-engineering.md`；全量门禁；终审。
- [ ] Commit `docs(gateway): E8 residual engineering closeout (E8-6)`。

## Ledger

`.superpowers/sdd/2026-11-13-gateway-e8-residual/progress.md`
