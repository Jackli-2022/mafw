# Gateway E5b 事件恢复源 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 event_log 一个按 seq 升序、可分页、可检测 reset/truncated 的 REST 恢复入口；mobile 持久化游标、重连先 replay 再按 seq 幂等消费，无法补齐时才全量重拉。

**Architecture:** `EventStore.replayAfter` 纯查询 + `GET /api/events/replay`（internal）→ mobile `GatewayClient.replayEvents` → `EventRecoveryService`（cursor + dedupe + fallback）→ `WsClientV2` async reconnect + `emitRecovered` → `main.dart` 接线。

**Tech Stack:** TypeScript (CJS), Jest（gateway）、Flutter/Dart（mobile）。无新依赖。

**Spec:** `docs/superpowers/specs/2026-11-12-gateway-e5b-event-recovery-design.md`

## Global Constraints

- TDD 铁律；每项一个 commit `(E5b-n)`。
- SSE 现有 newest-window 语义不变；replay 是新面，不改 SSE。
- replay 端点 internal（非 SDK-facing）；普通 API 鉴权；不要求 human。
- 消费者契约：按 seq 去重；`reset`/`truncated`/请求失败 → 全量重拉；`part.delta` 不推进游标。
- 隔离工作区 `.superpowers/e5b-worktree` + 分支 `feat/gateway-e5b-event-recovery`（基 main）。
- 已知环境红沿用（gateway env-red、TUI pi-tui、mobile runner flake）。

## Review Focus

1. **replay 语义**：升序、分页、`hasMore`/`nextSince` 单调、reset/truncated 精确、空表/异常 fail-open。
2. **游标安全**：游标只在成功应用后推进；reset/truncated 不静默跳过缺口；请求失败保留旧游标。
3. **幂等**：live 帧与 replay 帧重复只应用一次；`seq` 缺失帧不推进游标。
4. **重连顺序**：replay 完成后再触发页面刷新；emit 与 live 同一 stream。
5. **兼容**：旧 gateway 无 replay → fallback 全量重拉，不破坏现有行为。

---

### Task 1: Gateway replay endpoint（E5b-1）

**Files:** Modify `gateway/src/events/event-store.ts`；Create `gateway/src/routes/events-replay.ts`、`gateway/src/routes/schemas/events.ts`；Modify `gateway/src/routes/route-catalog.ts`、`gateway/src/subsystems/api-routes.ts`；Test `gateway/tests/unit/events/event-store-replay-after.test.ts`、`gateway/tests/unit/routes/events-replay.test.ts`、`gateway/tests/unit/api-contract.test.ts`

**Interfaces:** `EventStore.replayAfter(since, limit): { rows, headSeq, oldestSeq }`；`EventReplayResponse` TypeBox；`attachEventsReplayRoute(registry, deps)`。

- [ ] Step 1: RED — replayAfter 升序/分页/空表/head/oldest/异常；路由 400 参数、reset/truncated/hasMore/nextSince、空 events、schema、可达性。
- [ ] Step 2: GREEN — EventStore 方法；路由解析/钳制/响应；catalog `event.replay`（internal，response schema）；attach；emit:openapi + merge-contract 如需要。
- [ ] Step 3: tsc + 目标测试 + api-contract/architecture/analyzer。
- [ ] Step 4: Commit `feat(events): paginated replay endpoint over event_log (E5b-1)`。

### Task 2: Mobile model + replay client + recovery service（E5b-2）

**Files:** Modify `mobile/lib/src/models/mafw_models.dart`；Modify `mobile/lib/src/network/gateway_client.dart`；Create `mobile/lib/src/services/event_recovery.dart`；Test `mobile/test/event_replay_test.dart`、`event_recovery_test.dart`

**Interfaces:** `MafwEvent.seq`；`EventReplayPage`；`GatewayClient.replayEvents({since, limit})`；`EventCursorStore`；`EventRecoveryService.init/observe/observeHeadSeq/recover`。

- [ ] Step 1: RED — seq 顶层/内层/缺失；replay 响应解析；cursor 分页/去重/reset/truncated/异常 fallback/首次无游标/节流持久化。
- [ ] Step 2: GREEN — 实现模型/客户端/service；`replayEvents` 404/HTML → null（旧 gateway）。
- [ ] Step 3: `flutter test` 目标文件 + `dart analyze`。
- [ ] Step 4: Commit `feat(mobile): event replay client and cursor recovery (E5b-2)`。

### Task 3: Mobile reconnect wiring（E5b-3）

**Files:** Modify `mobile/lib/src/network/ws_client_v2.dart`、`mobile/lib/src/network/ws_client_interface.dart`、`mobile/lib/main.dart`；Test `mobile/test/ws_recovery_test.dart`、`main` 可行范围内

**Interfaces:** `WsClientV2.onReconnected` async；`emitRecovered(MafwEvent)`；`main` 创建 recovery、observe events、await recover 后刷新。

- [ ] Step 1: RED — async onReconnected 被 await；emitRecovered 进入 events stream；recovery 先于刷新；fallback 仍刷新。
- [ ] Step 2: GREEN — 改类型/实现/wiring；首次连接用 greeting headSeq 建立 baseline，不 replay。
- [ ] Step 3: `flutter test` 目标 + 全量（记录 flake）；`dart analyze`。
- [ ] Step 4: Commit `feat(mobile): recover missed events before reconnect refresh (E5b-3)`。

### Task 4: 收口（E5b-4）

- [ ] Step 1: `docs/architecture/gateway.md` E5b 段（replay 语义/消费者契约）；`docs/architecture/mobile.md` 游标/恢复；release `docs/releases/2026-11-12-gateway-e5b-event-recovery.md`（基 commit/commits/行为/测试/Deferred）。
- [ ] Step 2: 全量门禁（gateway tsc+full 允许 env-red；SDK；desktop；TUI 环境；mobile 定向+全量 flake；analyzer；kernel-split）。
- [ ] Step 3: 终审 + fix + ledger；commit `docs(gateway): E5b event recovery closeout (E5b-4)`。

## Ledger

`.superpowers/sdd/2026-11-12-gateway-e5b-event-recovery/progress.md`
