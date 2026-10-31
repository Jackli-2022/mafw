# Pod 任务板可编辑（写回计划）设计

- 日期：2026-10-31
- 状态：已批准（用户确认 v1 只做「标题 + 验收」）
- 前置：`docs/research/2026-10-30-task-handoff-memory-boundary.md`（任务/记忆四层边界）、
  `docs/superpowers/specs/2026-10-31-goal-acceptance-review-fix-design.md`（acceptance 与同轮复核）

## 1. 问题

Pod 任务板现在是 `waves.json` 的**只读投影 + 状态覆盖层**：

- 标题来自 plan 产物，用户看到错误的任务只能重跑 plan；
- 验收标准（`acceptance`）已进 `waves.json` 并被 review 使用，但桌面上看不到、改不了；
- 用户说「任务要可以改」，期望的是**改了就生效**，不是改 UI 副本。

## 2. 决定（v1）

| # | 决定 | 理由 |
|---|---|---|
| D1 | 可改字段：`title`、`acceptance` | 改这两项就能修正「任务描述错/验收口径错」，覆盖 80% 场景 |
| D2 | **不做**新增/删除任务 | 任务 id 是位置生成（`w1-t2`），删一个会让后续 id 前移、状态错位；需要先做稳定 id 迁移，独立一批 |
| D3 | 复用 `PATCH /api/pods/:podId/tasks/:taskId` | 已有 status/owner 通道，桌面已接线；新增字段而不是新端点 |
| D4 | 写回 `waves.json`，再重新投影 | 计划文件是权威；任务板是投影，不能反向成为第二真相源 |
| D5 | 有节点在跑 → 409 | execute 会话已读过旧计划，中途改会造成「执行的和验收的不一致」 |
| D6 | 计划批准门（`AWAIT_PLAN_APPROVAL`）允许编辑 | 这正是人审计划的时刻；改完再批准，execute 用新计划 |
| D7 | 编辑只对当前轮有效 | 下一轮 plan 会重写 `waves.json`；UI 需提示 |
| D8 | 接受者：人类（无 actor）或 Lead 身份 | 计划变更属 Lead 职责；Builder/Reviewer 会话不得改 |
| D9 | `pod_tasks.acceptance_json` 镜像验收 | 任务板要能显示/编辑验收；镜像随投影刷新，status 仍保留 |

## 3. 接口

```
PATCH /api/pods/:podId/tasks/:taskId
body: { title?: string, acceptance?: string[], actorSessionID?: string }
resp: { task: PodTask }
```

- `title` 去空白后不得为空（400）。
- `acceptance` 必须为 `string[]`；元素 trim、去空、去重，上限 20 条 × 500 字符（超出截断）。
- 与 `status`/`ownerMemberId` 混传 → 400（两条通道语义不同）。
- 只有 `goalId + externalTaskId` 都存在的任务可编辑（手工任务 400）。

## 4. 状态门

| goal 状态 | 判定 | 结果 |
|---|---|---|
| 找不到 state / plan 文件 | `resolveGoalPlan == null` | 404 |
| 已归档/终止 | `nextAction ∈ {COMPLETED,FAILED,CANCELLED,ARCHIVED}` | 409 `goal is closed` |
| 节点运行中 | `state.nodeSession != null` | 409 `goal is running` |
| 节点之间 / 计划待批 / 等待回答 | `nodeSession == null` | 允许 |

## 5. 效果链

1. `editWaveTask(plan, externalTaskId, patch)` 纯函数找到任务（遍历 waves 用 `${wave.id}-t${i+1}` 匹配），返回新 plan；
2. 原子写 `<mafwDir>/waves.json`（`.tmp` + rename）；
3. `projectWaves` 重新投影：标题、`acceptance_json` 刷新；status/owner/artifactRefs 保留；
4. 广播 `pod.updated`；
5. 下一节点 prompt 读到的就是新标题/新验收（review 以新 acceptance 为判定口径）。

## 6. 非目标

- 新增/删除/重排任务（需稳定 task id）；
- 编辑历史/审计流水（v1 只有 `updatedAt`）；
- 编辑已归档 goal 的计划；
- Agent 侧（MCP/工具）改计划——v1 仅桌面人类 + Lead。

## 7. 验收

- 纯函数：改标题、改验收、字符串任务升级为对象任务、找不到返回 null、其余任务不动。
- 服务：写盘 + 重投影保状态、运行中 409、终态 409、手工任务 400。
- 路由：成功 200、混传 400、Builder actor 403。
- 桌面：任务卡出现「编辑」（仅计划投影任务）；保存后刷新；409 显示原因。
- 回归：gateway 全量 + desktop 全量 + `tsc`/`tsgo -p`/`electron-vite build`。
