# Gateway E6 交互模型 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面 replay 补齐、session 单一实体缓存、decision 增量补丁、mobile 会话列表增量。

**Architecture:** SseConnection 开流前调用 REST replay；sessionStore 只存 id bucket，实体集中 `session-entities`；decision.updated 带完整 record，desktop 直接 upsert；mobile 用纯函数把 session 事件应用到列表。

**Tech Stack:** TypeScript/Solid（desktop）、Jest（gateway）、node --test（desktop）、Flutter/Dart（mobile）。无新依赖。

**Spec:** `docs/superpowers/specs/2026-11-13-gateway-e6-interaction-model-design.md`

## Global Constraints

- TDD 铁律；每项一个 commit `(E6-n)`。
- 不改 SSE/WS 协议；不改 event_log；`decision.updated` 只做 additive 字段。
- desktop 测试必须带 `--conditions=browser`（单文件也一样）。
- 隔离工作区 `.superpowers/e6-worktree` + 分支 `feat/gateway-e6-interaction-model`（基 main）。
- 已知环境红：gateway env-red、TUI pi-tui、mobile runner flake、desktop tsgo node:tls/SubjectPicker。

## Review Focus

1. **replay 与 live 不重复**：replay 完成后再开流（since=headSeq），SSE 零回放；失败回退旧路径。
2. **实体单一来源**：标题/角色只写 `sessionEntities`；tab 不复制写；Rail/tab/ChatPane 同步。
3. **decision 增量不丢 attention**：record upsert + attention 同 id patch；旧 gateway 仍 fallback refresh。
4. **mobile 事件保守**：缺字段不猜测，走 debounce 全量；顺序/Lead 排序保持。

---

### Task 1: Desktop replay gap recovery（E6-1）

**Files:** Modify `packages/desktop/src/renderer/mafw/sse/sse-connection.ts`；Create `packages/desktop/src/renderer/mafw/sse/event-replay-gap.ts`；Modify `packages/desktop/src/renderer/mafw/MafwShell.tsx`；Tests `sse/sse-connection.test.ts`、`sse/event-replay-gap.test.ts`

**Interfaces:** `GapRecovery {headSeq,applied,reset?,truncated?}`；`SseConnectionDeps.recoverGap?`；`recoverEventGap({baseUrl,since,limit?,fetchImpl?,dispatch})`。

- [ ] Step 1: RED — SseConnection：有游标时先 recoverGap；成功用 headSeq 开流、lastApplied=head；reset/truncated 先 onFullResync + clearSeq；null/异常回退原 since；首次无游标不调用。replay client：分页、seq 注入、hasMore、reset/truncated、404/HTML/503/异常→null。
- [ ] Step 2: GREEN — 实现；MafwShell 注入 `recoverGap`（gateway URL + dispatchShellEvent）。
- [ ] Step 3: desktop touched tests + `tsgo`（允许既有噪声）。
- [ ] Step 4: Commit `feat(desktop): replay event gaps before opening SSE (E6-1)`。

### Task 2: Session single entity cache（E6-2）

**Files:** Create `packages/desktop/src/renderer/mafw/session-entities.ts`；Modify `session-store.ts`、`workspace/session-workspace.ts`、`MafwShell.tsx`、`session-tab-identity.ts`/相关 tab 读取；Tests `session-entities.test.ts`、`session-store.test.ts`、`session-tab-identity.test.ts`、`SessionStrip`/ChatPane 相关。

**Interfaces:** `SessionEntity`；`sessionEntities.get/upsert/patch/remove/version/reset`；`sessionStore` API 不变；tab 通过 reactive 读 entity 标题/角色。

- [ ] Step 1: RED — entities upsert/patch/remove/version；sessionStore fetch 只存 ids、sessionsFor 映射 entity；patch/remove 同步；tab title/role 从 entity 派生；`session.updated` 只写 entity 后 Rail/tab/ChatPane 同步。
- [ ] Step 2: GREEN — 实现；`retitleOpenTab` 不再复制写 tab；`openSessionTab` upsert；resume 持久化 `{id,title}` upsert entity。
- [ ] Step 3: desktop touched tests + tsgo；确认无 UI 行为回归。
- [ ] Step 4: Commit `refactor(desktop): consolidate session metadata into one entity cache (E6-2)`。

### Task 3: Decision incremental patch（E6-3）

**Files:** Modify `gateway/src/core/decision/decision-record.ts`（event type）、`decision-record-service.ts`（emit record）、`gateway/src/routes/decisions.ts`/catalog if schema；Modify `packages/desktop/src/renderer/mafw/decision-store.ts`、`MafwShell.tsx`、`sse/dispatcher.ts` if needed；Tests gateway `decision-record-service`/event payload、desktop `decision-store.test.ts`。

**Interfaces:** `DecisionRecordEvent.record: DecisionRecord`；`DecisionStore.ingest(event): boolean`。

- [ ] Step 1: RED — gateway emit 带 record 且既有字段不变；desktop ingest 带 record 时 upsert records + patch attention 同 id、返回 true 且不调用 refresh；无 record → false；旧事件走 refresh。
- [ ] Step 2: GREEN — 实现；MafwShell `decisions.onEvent` 改为 ingest→fallback refresh。
- [ ] Step 3: gateway tsc/targeted + desktop touched。
- [ ] Step 4: Commit `feat(decisions): carry the record on decision.updated and patch desktop in place (E6-3)`。

### Task 4: Mobile session list incremental（E6-4）

**Files:** Create `mobile/lib/src/models/session_list_events.dart`；Modify `mobile/lib/src/models/mafw_models.dart`（copyWith）、`mobile/lib/src/pages/sessions_page.dart`、`mobile/lib/main.dart`；Tests `mobile/test/session_list_events_test.dart`、`sessions_page_test.dart`（新建/扩展）。

**Interfaces:** `applySessionListEvent(List<MafwSession>, MafwEvent)`；`SessionsPage.events?: Stream<MafwEvent>`。

- [ ] Step 1: RED — update/delete/create/缺 info/未知事件/排序；页面注入 fake stream 不触发全量；created 缺字段触发一次 debounce；events=null 行为不变。
- [ ] Step 2: GREEN — 实现纯函数 + 页面订阅 + main 传 `_ws?.events`；didUpdateWidget 重订阅。
- [ ] Step 3: `flutter test` 目标 + `dart analyze`；全量 flake 记录。
- [ ] Step 4: Commit `feat(mobile): patch session list from live events (E6-4)`。

### Task 5: 收口（E6-5）

- [ ] Step 1: `docs/architecture/desktop.md`（replay/entity cache/decision patch）、`mobile.md`（session list patch）、release `docs/releases/2026-11-13-gateway-e6-interaction.md`。
- [ ] Step 2: 全量门禁（gateway tsc+full 允许 env-red；SDK；desktop full+tsgo；TUI 环境；mobile 定向+全量 flake；analyzer；kernel-split）。
- [ ] Step 3: 终审 + fix + ledger；commit `docs(gateway): E6 interaction closeout (E6-5)`。

## Ledger

`.superpowers/sdd/2026-11-13-gateway-e6-interaction/progress.md`
