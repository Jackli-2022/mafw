# Gateway E9 交互补齐 — Implementation Plan

> **For agentic workers:** superpowers:subagent-driven-development. Steps use checkbox.

**Goal:** mobile work-tab 事件保真、attention decision 投影、pod.updated 轻量 payload。

**Spec:** `docs/superpowers/specs/2026-11-13-gateway-e9-interaction-completion-design.md`

## Global Constraints

- TDD；每项一个 commit `(E9-n)`。
- 只做 additive event/DTO；不改 pod detail wire。
- 隔离 `.superpowers/e9-worktree` + 分支 `feat/gateway-e9-interaction-completion`。
- 已知环境红沿用。

### Task 1: Mobile work-tab 事件保真（E9-1）

**Files:** `mobile/lib/src/models/mafw_models.dart`、`event_effects.dart`、`work_refresh_bus.dart`/WorkTab tests。

- [ ] 把 `pod.updated`/`pod.event`/`run.updated` 加入 flat 类型与 work-refresh 表；`MafwEvent.goalId` 读取 `properties.goalId`/`data.goalId`。
- [ ] 测试：flat 解析、shouldRefreshWork、goalId、WorkTab 局部 patch。
- [ ] Commit `fix(mobile): make work tab react to pod and run events (E9-1)`。

### Task 2: Attention decision 投影（E9-2）

**Files:** `gateway/src/core/lead/attention.ts`、`routes/attention.ts`、`subsystems/api-routes.ts`、SDK `types.ts`、desktop `focus/decision-model.ts` + tests.

- [ ] `AttentionKind` 加 `decision`（priority 85）；`appendDecisionAttention` 投影 draft records；route deps decisions；kernel wiring。
- [ ] SDK AttentionKind 加值；desktop decision board 映射 `open_decision`→record action，records 去重。
- [ ] 测试 gateway/SDK/desktop。
- [ ] Commit `feat(attention): project draft decisions into person-first attention (E9-2)`。

### Task 3: Pod.updated 轻量 payload（E9-3）

**Files:** `gateway/src/core/pod/pod-*.ts`、`gateway/src/kernel.ts`、desktop `pod-store.ts` + tests.

- [ ] notify 签名可带 `goalId`；task/message 有 goalId 时携带；desktop `ingest` 有 goalId 时局部 patch，无则原 refresh。
- [ ] 测试 payload/desktop 行为。
- [ ] Commit `feat(pods): carry goal ids on pod.updated and patch desktop in place (E9-3)`。

### Task 4: 收口（E9-4）

- [ ] docs/release `docs/releases/2026-11-13-gateway-e9-interaction.md`；全量门禁；终审；merge/deploy。
- [ ] Commit `docs(gateway): E9 interaction completion closeout (E9-4)`。

## Ledger

`.superpowers/sdd/2026-11-13-gateway-e9-interaction/progress.md`
