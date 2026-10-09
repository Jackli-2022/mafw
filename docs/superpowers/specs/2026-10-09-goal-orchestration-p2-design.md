# Goal 编排 P2：前端节点泳道图（设计）

> 2026-10-09 · 状态：待评审
> 四期路线第二期。P1（启用 + NodeDriver + 节点级 trace/API）已交付 v4.22.0；P2 = 桌面端把 goal 执行状态做成可呈现的泳道图 + 内联明细；P3 = 编排智能化（模板库+动态注册）；P4 = 用户设计器 + 重跑 UI。
> 输入：P1 timeline API（`GET /api/goals/:id/timeline`，goal_node_runs ⋈ state）与 `goal_node` SSE 事件已就绪；业界调研（Airflow Grid View / Temporal History Timeline / OpenAI·LangSmith span 树）见本轮 brainstorm。

## 1. 目标

把 goal 详情从「charter + 会话列表」升级为**节点级执行可视化**：
1. **泳道图**：行 = 阶段（plan/execute/review），列 = loop 迭代；格子 = 该 (loop, 阶段) 的节点运行（状态色 + 耗时 + 产物摘要）。
2. **点格子内联展开明细**：起止/耗时/token/成本/verdict/错误/feedback + 产物 chips + 「打开会话」「重跑此节点」。
3. **实时**：消费 `goal_node` SSE 事件即时刷新；保留慢轮询兜底。

**非目标**：TUI（后续）；拓扑图/DAG（固定三段结构下增益低）；OS 打开产物文件；编排 agent（P3）；可视化设计器（P4）；gateway 改动（P1 API 已足够）。

## 2. 关键决策（brainstorm 已确认）

| # | 决策 | 依据 |
|---|---|---|
| D1 | **呈现形态 = 泳道（节点 × loop）+ 内联节点明细**，不做拓扑图 | Airflow Grid View（task×run 矩阵）为本系统「loop 管线」同构；agent 可观测界的时间线/瀑布作明细层（OpenAI/LangSmith) |
| D2 | **落点 = GoalDetailOverlay 升级**（Goals 页不改） | 改动集中单组件，不动物流/路由 |
| D3 | **节点交互 = 点格子在该行下方内联展开明细** | 单视图无跳转 |
| D4 | **范围 = 仅 Desktop** | TUI 无图形，保持现状 |
| D5 | **实时 = 消费 `goal_node` SSE bump 信号 + 保留 15s 慢轮询兜底** | 事件驱动为业界惯例（P1 已 emit） |
| D6 | 产物展示 = 文件名 chips，**点击复制路径**（不做 OS 打开） | 避免引入 shell IPC 依赖，P2 最小 |

## 3. 架构与文件

```
packages/desktop/src/
  renderer/mafw/
    goal-timeline.ts              # 新：纯逻辑（buildGoalLanes / 状态映射 / 时长格式）——bun 可测
    goal-timeline.test.ts         # 新：单测
    components/
      GoalTimelineLane.tsx        # 新：泳道 + 内联明细组件（读 props，无数据获取）
      GoalDetailOverlay.tsx       # 改：接入 lattice，替换现有会话列表区
    sse/
      dispatcher.ts               # 改：CoreDeps 加 onGoalEvent；顶层分支接 goal_node/goal_created/phase_transition
      handlers/                   # （可选）handlers/goal.ts 承载 goal_node
  preload/
    mafw-api.ts                   # 改：goals 段加 timeline / retryNode
    mafw-types.ts                 # 改：goals 段加 timeline / retryNode 类型
```

**数据流**：
```
GoalDetailOverlay(goalId)
  → window.api.mafw.goals.timeline(goalId)   # P1 API → {goal, nodes[], artifacts, outcome?}
  → buildGoalLanes(nodes, goal.maxRounds)    # 纯函数 → 行×列矩阵 + 每格 attempts[]
  → <GoalTimelineLane lanes ... onOpenSession onRetry />
     （goalsRev() 变化时 refetch —— SSE goal_node 驱动）
```

## 4. 纯逻辑模块 `goal-timeline.ts`

```ts
export interface NodeRun {           // = timeline API node（P1 形状，camelCase）
  runId: number; loop: number; node: string; attempt: number;
  status: string;                    // running|succeeded|failed|timeout|aborted
  sessionId: string | null;
  startedAt: string; finishedAt: string | null; durationMs: number | null;
  outcome: string | null; error: string | null;
  tokensInput: number | null; tokensOutput: number | null; costUsd: number | null;
}
export type CellTone = 'ok' | 'running' | 'fail' | 'idle';
export interface LaneCell {
  node: string; loop: number;
  latest: NodeRun | null;            // 该 (loop,node) 最新 attempt
  attempts: NodeRun[];               // 全部 attempt（升序），供展开显示重试历史
  tone: CellTone;
}
export interface Lane { node: string; cells: LaneCell[]; }

export const PHASES = ['plan', 'execute', 'review'] as const;

/** 行=phase，列=loop(1..max(seenLoops, maxRounds))；缺失格 latest=null/tone=idle。 */
export function buildGoalLanes(nodes: NodeRun[], maxRounds: number): { loops: number[]; lanes: Lane[] };

/** status+outcome → 色调（review outcome PASS→ok，FAIL→fail；节点 status 优先）。 */
export function cellTone(run: NodeRun | null): CellTone;

/** 人类时长：45s / 3m12s / 1h04m；null → '—'。 */
export function formatDuration(ms: number | null): string;

/** 格子副标题：review→verdict/feedback 首句；execute→`receipts=N · $cost`；plan→`waves=N`；运行中→`已用 Xs`。 */
export function cellSummary(run: NodeRun | null): string;
```

**测试点**（bun:test）：
- buildGoalLanes：最多 loop 列、缺格 idle、(loop,node) 多 attempt 归到同一格且 latest=最大 attempt、attempts 升序。
- cellTone：succeeded→ok；failed/timeout/aborted→fail；running→running；null→idle；review succeeded 但 outcome=FAIL → fail（verdict 覆盖）。
- formatDuration：null/45s/3m12s/1h04m。
- cellSummary：各节点类型摘要 + 运行中「已用」。

## 5. 组件 `GoalTimelineLane.tsx`

- Props：`{ lanes, loops, artifacts, goal, onOpenSession(sid), onRetry(runId, node, confirm), retrying }`（纯展示；数据在 overlay 获取）。
- 泳道网格：CSS grid `grid-template-columns: 82px repeat(loops.length, minmax(140px,1fr))`；首列 sticky；loop 多时容器横向滚动（`overflow-x:auto`）。
- 每格：色调边框 + `✓/✗/●/—` 图标 + `cellSummary` + （attempts>1）`×N` 徽标。
- 点格 → 该行下方整行内联展开（`grid-column: 1 / -1`）明细：起止/耗时/token/成本/verdict/error/feedback + 产物 chips（点击复制路径）+ 按钮「打开会话」（有 sessionId 时）/「重跑此节点」（failed/timeout/aborted 可点；execute 标记需确认）。
- 复用现有 CSS 类（`mafw-goal-*`）与 `ButtonV2`；不新增裸 button/input（§5.10）。
- 状态：loading（`LoaderV2`）、空（无 nodes → 提示"尚未开始"）、终态 goal（全部格 + 顶部 verdict 徽标）。

## 6. `GoalDetailOverlay.tsx` 改造

- 保留头部（goalId/title/phase/round/verdict）与 Esc 关闭；头部补「已用/开始时间」（由 nodes 首末推导）。
- 中部：原会话列表位置 → `<GoalTimelineLane>`；会话下钻改由节点格子的「打开会话」触发（`onOpenSession(sessionId)`，沿用 MafwShell.openSessionTab）。
- goal 级动作：保留「取消 Goal」（`goals.control ABORT`）；产物汇总行（waves/receipts/reviews 路径 chips）。
- 实时：`createEffect` 依赖 `props.goalId` + `goalsRev()`；`goalsRev` 变化时重新 `goals.timeline(goalId)`。保留 15s `setInterval` 兜底。

## 7. SSE 接线（`goal_node` → 刷新）

- **dispatcher `CoreDeps`** 加 `onGoalEvent(event): void`；顶层分支（在 sid 分发之前，与 `project_registered` 同级）新增：
  ```ts
  if (event.type === 'goal_node' || event.type === 'goal_created' || event.type === 'phase_transition') {
    deps.core.trace(event, 'goals:rev')
    deps.core.onGoalEvent(event)
    return
  }
  ```
  （`goal_node` 无 sessionID，必须在 sid 分支前消费，否则 missTrace 刷屏。）
- **MafwShell** 提供 `core.onGoalEvent`：bump 模块级 `goalsRev` signal（`createSignal(0)`，`setGoalsRev(v=>v+1)`）。GoalDetailOverlay 与 DashboardPage 可共享该 signal（DashboardPage 可选：也改为事件驱动刷新，P2 顺带）。
- `session-events.ts` 的 `isTailAccountedAtShell`（missTrace 白名单）：把 `goal_node` 加入已消费集合，防 trace 噪音。

## 8. Preload / SDK 接线

- `preload/mafw-api.ts` goals 段追加：
  ```ts
  timeline: (id) => invoke('goals', 'timeline', id),
  retryNode: (goalId, runId, opts) => invoke('goals', 'retryNode', goalId, runId, opts),
  ```
- `preload/mafw-types.ts` goals 段对应的类型签名（`GoalTimeline`/`GoalNodeRunInfo` 复用 `@mafw/sdk` 导出——P1 已加）。
- SDK（`packages/gateway-sdk`）P1 已提供 `goals.timeline/retryNode`，无改动。

## 9. 错误处理

- timeline 拉取失败：overlay 显示错误占位 + 重试按钮（不崩）；SSE 信号只是刷新触发器，失败无副作用。
- retryNode 失败：toast（`toastStore`）显示 `error`；execute 未确认 → 前端先 `confirm()`（避免 409）。
- 节点 sessionId 为空（askUser 行等）：隐藏「打开会话」按钮。

## 10. 测试策略

- **纯逻辑 bun 测试**（`goal-timeline.test.ts`）：§4 全部测试点（buildGoalLanes / cellTone / formatDuration / cellSummary）。
- **dispatcher 测试**：`goal_node`/`goal_created`/`phase_transition` → 调用 `core.onGoalEvent` 且不落 missTrace；新增 dispatcher.test 用例。
- 组件不做全栈渲染测试（仓库惯例：纯逻辑单测 + 手工冒烟）；冒烟：真实 gateway 跑一个小 goal，观察格子实时变化与明细展开。
- 交付报告：新增测试数与 `npm run test:desktop` 全量通过数。

## 11. 交付清单

1. `goal-timeline.ts`（纯逻辑）+ 单测
2. `GoalTimelineLane.tsx`（泳道 + 内联明细）
3. `GoalDetailOverlay.tsx` 改造（接入 lane + 实时 + 产物/取消）
4. SSE dispatcher：`onGoalEvent` + goal_node/goal_created/phase_transition 顶层分支 + missTrace 白名单
5. MafwShell：`goalsRev` signal 注入 `onGoalEvent`
6. preload `mafw-api.ts` + `mafw-types.ts`：timeline / retryNode
7. （顺带）DashboardPage 改事件驱动刷新（可选，若低风险）
8. 手工冒烟（真实 goal）+ 报告测试计数

## 12. 风险与开放问题

- **loop 列很多**（maxRounds 大）：横向滚动 + 首列 sticky；如未来需要可折叠到「最近 N 轮」（P2 先不做，留阈值常量）。
- **attempt 重试历史**：格内 `×N` 徽标 + 展开列出各 attempt（起止/状态）；execute 重跑语义已在 P1（confirm）。
- **产物路径在桌面不可直接打开**：P2 用复制路径；OS 打开（`shell.openPath`）留后续。
- 开放问题：`goalsRev` 放模块单例 vs MafwShell 内 signal——倾向模块单例（GoalDetailOverlay/Dashboard 都能订阅，避免 prop 透传）。
