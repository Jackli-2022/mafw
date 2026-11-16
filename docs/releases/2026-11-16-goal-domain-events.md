# 2026-11-16 · Phase 2：Goal lifecycle domain events + SQLite GoalState

- **版本**：`v5.1.0`（行为增强，不升版本号）
- **提交**：`7b8adba9`（domain event store）+ `097ccfe8`（GoalState → SQLite）+
  `7db12806`（生命周期事件）+ `e469b1ca`（归档同事务）+ `98e615d6`（投影 parity）+
  `d77da1f9`（read / ack）
- **计划**：`docs/superpowers/plans/2026-11-16-phase2-goal-domain-events.md`
- **前置**：`docs/releases/2026-11-16-lead-inbox-unification.md`（Phase 1）
- **范围**：gateway 事件层与 Goal 状态；desktop / SDK / runtime 零改动

## 现在

### Domain event log

- 新表 `domain_events`（独立，append-only）：`UNIQUE(aggregate_type, aggregate_id,
  aggregate_version)`；`eventId` 幂等；`expectedVersion` 乐观并发冲突抛
  `DomainEventConflictError`。
- `DomainEventStore.append` / `listAggregate` / `lastVersion` 在
  `gateway/src/core/events/domain-event-store.ts`。
- `pod_events` 保持不变：它是「事件 → 人」的 inbox 投影，不并入 domain log。

### GoalState → SQLite

- 新表 `goal_state`（active，一 goal 一行）与 `goal_state_revisions`（append-only）。
- `loadGoalState` / `writeGoalState` / `ensureGoalState` / `archiveGoalStateForRevision`
  的 API 不变，经可插拔 `GoalStateBackend` 委托给 `GoalStateStore`；未注册 backend 时
  仍走文件（测试 / CLI）。
- 旧 `.mafw/state/<goalId>.json` **惰性导入**：DB 未命中时读文件、写库、继续返回；
  JSON 仍是尽力镜像（写失败只 warn）。`listGoalStates` / `recoverState` / `discoverNewGoals`
  / `archiveGoal` 的项目定位都改走 DB（无 backend 时回退文件扫描）。

### 生命周期事件

- kernel 生产：`goal.created`、`goal.phase.changed`、`goal.node.started`、
  `goal.node.completed`、`goal.node.failed`，以及归档时的 `goal.result` / `goal.failed`。
- 事件 append 是观测面：失败只 warn，不阻断节点推进（归档事务除外——那里必须回滚）。
- NodeDriver 未改：它仍是执行权威，kernel 只是把既有的 `goal_node` / `phase_transition`
  通知翻译成 domain fact。

### 归档同事务

- `PodGoalService.onGoalArchived(goalId, outcome, { inTransaction })` 在**一个**
  SQLite 事务里写：goal 状态（done/aborted）+ Pod 指针 + `domain_events` +
  `pod_events` 行 + lead outbox 行；`inTransaction` 抛错则整体回滚，Goal 仍是 active。
- `PodEventService` 拆出 `recordRow`（仅 DB）与 `writeAudit`（仅文件），审计文件在事务提交后写。
- kernel `finishPodGoal` 不再单独 `podEventService.record`；广播与审计在提交后执行。

### 投影 parity

- `goal-view-projector.ts`：`projectGoalLifecycle(events)` 从 domain log 重建
  `status / verdict / phase / round / failed / resultReady / accepted / lastError`。
- parity 测试覆盖 PASS、FAIL、MAX_RETRIES、ERROR：与 `buildPodGoalView` +
  `deriveAttention` 逐字段一致。Phase 2 **不切换读路径**。

### Lead inbox read / ack

- `event_outbox` 新增 `read_at`、`ack_at`、`sent_session_id`（additive）。
- **read**：客户端把某个 Goal 的 Pod event 标记 seen 后，该 goal 的 lead outbox 行写
  `read_at`（`markOutboxReadByGoal`）；`wake_session_id='outbox:<id>'` 的行也可按 id 精确回写。
- **ack**：Lead 会话 `turn.completed` 且成员角色是 `lead` 时，只 ack
  `sent_session_id` 匹配的行——同一 Lead 会话服务多个 Pod 也不会跨 Pod 误 ack。
- read / ack 都幂等；`a2a:<messageId>` 行不参与 read。

## 测试

- 新增套件：`domain-event-store`、`goal-state-store`、`state-v3-backend`、
  `goal-lifecycle-events`、`goal-lifecycle-wiring`、`goal-archive-tx`、
  `goal-archive-events`、`goal-view-projector`、`goal-view-projection-parity`、
  `lead-outbox-read-ack`。
- 定向：`tests/unit/events` + `tests/unit/lead` + `tests/unit/pod` =
  **116 suites / 865 tests**（Task 6 收口时）。
- gateway 全量：**1001 / 1001 suites**，**7965 passed / 2 skipped / 0 failed**（二次全量）。
  首跑有 5 个既有 flake（`restore-git` / `routes-session-worktree` 超时、`t1-sample-turn-texts`、
  `v2-live`），4 suites / 32 tests 单独复跑全绿，二次全量全绿。
- gateway `tsc`：rc=0。
- gateway `npm run build`：通过（`dist/release.json` v5.1.0）。

## 边界与偏差

- **Desktop 统一投影推迟到 Phase 3**：Phase 2 的 projector 只做 parity，读路径仍是
  `buildPodGoalView`；现在改 Desktop 会多出第三套分类。Phase 3 让 projector 接管读路径时
  再删除 `work-overview-model` / `goal-user-view` / `lead-goal-status` 的重复分类。
- JSON 镜像仍在（Phase 3 移除）；镜像写失败不影响状态迁移，但旧工具读文件可能滞后。
- `PodGoalRevisionService` 直接调 `ensureGoalState` 开新 revision，**不**发 `goal.created`
  （Phase 2 只有 `kernel.startGoal` 生产该事件）。
- read 的定义是「人看到该 Goal 的 inbox」而不是「人看到 Lead 的聊天消息」；后者没有
  可观测的客户端信号，留到 Phase 3/4 的会话已读。
- 外部事件（GitHub / cron / webhook）仍走旧 `event_*` 表，Phase 4 才并入 domain log。

## 回滚

- `setGoalStateBackend(null)` → 立即回退到 JSON 文件（镜像是最新状态）。
- domain event / 投影是 additive：不读 `domain_events` 也不影响 Goal 执行。
- read / ack 列是 additive：旧 outbox 行读出 null，不影响 dispatcher。
