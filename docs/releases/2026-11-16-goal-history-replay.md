# 2026-11-16 · Phase 3：Goal History + Snapshots

- **版本**：`v5.1.0`（行为增强，不升版本号）
- **提交**：`c75b932e`（state patch → domain log）+ `1dfd655a`（快照 + 纯回放）+
  `cd06a62c`（行缺失恢复 + flag）+ `c46b9725`（前缀 parity）
- **计划**：`docs/superpowers/plans/2026-11-16-phase3-goal-history-replay.md`
- **前置**：`docs/releases/2026-11-16-goal-domain-events.md`（Phase 2）
- **范围**：gateway GoalState 持久化与恢复；desktop / SDK / runtime 零改动

## 现在

- 每次 `writeGoalState` 在同一事务里追加 `goal.state.changed`：
  `{ goalId, revision, stateVersion, round, loop, updatedAt, reset, patch | resetState }`。
  语义事件（`goal.node.*` / `goal.*`）不受影响。
- `goal_snapshots`：第一个事件、每次 revision reset、以及每 20 条 `goal.state.changed`
  写一行；语义事件不计入节奏。
- `replayGoalState({ goalId, events, snapshots, atVersion? })` 是纯函数：最新快照 +
  之后的 patch，不调 runtime/LLM、不写文件。用于诊断任意版本。
- `GoalStateStore.load`：
  1. 行存在 → 默认直接返回；
  2. 行缺失 → legacy JSON 导入（reset 事件）；
  3. 仍缺失 → history 回放并恢复 `goal_state` 行（不追加事件）；
  4. `MAFW_GOAL_REPLAY_READ=1` → 返回回放结果，与行不一致时 `[GoalHistory] divergence`
     警告并计数（`replayStats()`：`replays` / `divergences` / `failures`）。
- kernel 构造顺序：`DomainEventStore` → `GoalSnapshotStore` → `GoalStateStore(events, snapshots)`。

## 测试

- 新增套件：`goal-state-history`、`goal-history`、`goal-history-load`、`goal-history-parity`
  （共 4 suites / 13 tests：每写一条事件、快照 cadence、reset 替换、中间版本回放、
  行缺失恢复、flag divergence、任意前缀 parity、回放零写副作用）。
- gateway 全量：**1005 / 1005 suites**，**7997 passed / 2 skipped / 0 failed**。
- `tsc`：rc=0；`npm run build`：通过（`dist/release.json` v5.1.0）。

## 边界

- 事件量随 state 写入线性增长；Phase 3 不做事件裁剪，先观察 `domain_events` 体积。
  后续可按快照版本做冷归档（不在本阶段）。
- 回放只重建 **state**；节点完成判定仍走现有产物/会话探测，不重放 LLM 调用。
- 旧 Goal（历史在 Phase 1/2 之前）没有 `goal.state.changed`：只能走 legacy JSON 导入，
  replay 不可用；`load` 会先导入并产生 reset 基线，之后的新写入才可回放。
- `MAFW_GOAL_REPLAY_READ=1` 是观测/验证开关，默认关闭；divergence 不会自动改行。
- 任意时点 replay 只作为函数/诊断能力，不提供 UI。

## 回滚

- 关闭 `MAFW_GOAL_REPLAY_READ` 即回到行直读。
- 不读 `goal_snapshots` / `goal.state.changed` 也不影响 Goal 执行；两张表是 additive。
- 需要彻底回滚时 revert 四个提交即可；旧 JSON 镜像仍是最新状态。
