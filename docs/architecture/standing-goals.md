# 长效目标（Standing Goals）

> P2.5。把一个长期意图（例如“每天汇报项目状态”“每个 PR 打开时做一次调研”）保存为
> `StandingGoal`；每次触发生成一条 `GoalRun`，由 Tech Lead 分流为普通 Goal、报告、
> 白名单动作或跳过。**`goal` / `report` 始终复用普通 Goal 执行路径，不存在第二套执行器。**

## 开关

| 环境变量 | 作用 | 默认 |
|---|---|---|
| `MAFW_STANDING_GOALS=1` | 启用 Standing Goal 服务、HTTP 路由与 MCP 工具；关闭时路由返回 503 | 关闭 |
| `MAFW_EVENT_LAYER=1` | 启用事件层；只有开启后 `event` 触发才会订阅 P2.4 事件 | 关闭 |

关闭事件层时，`cron` 与 `manual` 触发仍可工作；`event` 触发不会创建订阅，也不会产生运行。

## 数据模型

统一落在 `~/.mafw/memory/gateway.db`（`ensureStandingSchema` 幂等建表）：

- `standing_goals`：目标定义、状态、触发器、预算、审批策略、`last_run_at` / `next_run_at`。
- `goal_runs`：每次触发一行；`trigger_key UNIQUE` 保证同一触发只运行一次。
- `goal_run_events`：运行审计流（created / triaged / started / needs_person / finished / failed / skipped）。

`GoalRun` 的 `sessionId` 只用于内部审计，不作为桌面端展示字段。

## 生命周期

```text
create ──► active ──pause──► paused ──resume──► active
              │                  │
              └──────stop───────►┴──► stopped（不可恢复）
```

- `create` 至少要求一个触发器，并注册 cron 规则（automation engine 的
  `standing_goal:tick`）。
- `update` 会先注销旧 cron/event 订阅，再按新定义注册；`pause` / `stop` 同样注销。
- 启动时 `reconcile()` 修复缺失的 cron 规则并清理非 active 目标的订阅。
- `reconcile()` 会把超过 24h 仍处于 queued/triaging/running/waiting_person 的 run 标记失败，
  释放并发槽。
- cron 规则键：`standing-goal:<standingGoalId>:<triggerId>`。

## 触发器与去重

| 类型 | `triggerKey` | 说明 |
|---|---|---|
| `cron` | `<goalId>:cron:<scheduledAt>` | automation engine 按计划调用 `handleCronTick` |
| `event` | `<goalId>:event:<eventId>` | P2.4 work 投递调用 `handleEventTrigger`，再按 `eventKinds` 过滤 |
| `manual` | `<goalId>:manual:<id>` | 桌面/API/MCP 手动触发 |

准入顺序：

1. `trigger_key` 已存在 → 不再创建运行。
2. 并发：`queued / triaging / running / waiting_person` 达到 `concurrency` → 拒绝。
3. 日预算：当天**该 Standing Goal** 的运行成本之和 ≥ `budget.perDayCostUsd` → 拒绝，暂停目标并广播
   `goal_run.budget_exhausted`（`stateReason` 记录原因）。
4. 冷却：距离最近一次 `startedAt` 不足 `cooldownMs` → 拒绝。

事件触发使用 wildcard 事件订阅（`threadId='*'`，`subscriberType='standing_goal'`，
`mode='work'`）；`EventLayerService` 在 fan-out 时合并线程订阅与 wildcard 订阅。
评估与投递都会校验 **事件线程所属项目 = Standing Goal 项目**，跨项目事件不会创建运行；
`filter`（repo / labels / branch / author）在触发器上保留并匹配。`context` 订阅永远不会创建运行。

## 运行状态机

```text
queued → triaging → running ──────────────► done / failed（普通 Goal 完成）
                 ├─ waiting_person ─approve─► running / done / failed
                 ├─ skipped
                 └─ failed（triage / 执行失败）
```

### 分流（Triage）

内部临时会话执行 `buildStandingTriagePrompt`，输出严格 JSON，`validateRunTriage` 校验：

- `goal`：创建一个普通 Goal（代码/实施任务）。
- `report`：同样创建普通 Goal，但 `taskType` 固定为 `research`，用于汇报。
- `action`：只允许 `comment` / `label` / `notify` 三类白名单动作。
- `skip`：记录原因，不创建 Goal。

`createGoal` 适配器复用：

1. `PodTechLeadService.createGoal(...)`（`handoff: 'none'`，预算映射
   `perRunTurns → maxTurns`、`perRunCostUsd → maxCostUsd`）。
2. `PodStore.setGoalRevisionStatus(... status: 'planning')`。
3. `PodGoalService.admitReadyGoal(goalId, projectDir)`。

因此 Standing Goal 的 `goal` / `report` 与人工创建的 Goal 走同一 NodeDriver / Plan /
Review / 人工验收路径；P2.5 不新增执行器，也不会自动合并。

普通 Goal 完成时 `PodGoalService.onGoalCompleted` 回调
`StandingGoalService.onGoalFinished`，将运行标记为 `done`/`failed` 并写审计事件。

### 动作与审批

- 动作执行器 `StandingActionExecutor` 只认识 comment / label / notify；merge、close、
  delete、protected branch 等高风险动作不在允许集合内。
- `requiresApproval: true` 或目标 `approval: 'confirm'` 的运行（**含 goal / report**）进入
  `waiting_person`，暂停在执行前。
- `approval: 'plan'` 时，代码类 Goal 的 `planReview` 强制为 `manual`，计划必须经人工放行。
- `POST /api/goal-runs/:id/approve` 由人类触发：动作运行执行动作，`goal`/`report`
  运行继续创建普通 Goal。**没有 MCP 验收工具**；携带 `actorSessionID` 的请求返回 403。
- v1 只实现 `notify`；`comment` / `label` 动作会显式失败（不静默降级），等待动作传输接入。
- 同一目标连续 3 次失败会暂停并记录 `stateReason`，同时广播 `goal_run.needs_person`。

## 事件

| 类型 | 时机 |
|---|---|
| `standing_goal.created` / `updated` / `paused` / `resumed` / `stopped` | 生命周期 |
| `goal_run.created` / `triaged` / `started` / `skipped` / `finished` / `failed` | 运行 |
| `goal_run.needs_person` | 动作待批准或连续失败 |
| `goal_run.budget_exhausted` | 日预算耗尽并暂停 |
| `standing_goal.notification` | notify 动作 |

## HTTP / MCP / 桌面

HTTP（`MAFW_STANDING_GOALS=1`）：

```text
GET    /api/standing-goals?projectDir=
POST   /api/standing-goals
PATCH  /api/standing-goals/:id
GET    /api/standing-goals/:id/runs        # 未知 id → 404
POST   /api/standing-goals/:id/pause
POST   /api/standing-goals/:id/resume
POST   /api/standing-goals/:id/stop
POST   /api/standing-goals/:id/run
POST   /api/goal-runs/:id/approve
```

MCP：`mafw_create_standing_goal` / `mafw_update_standing_goal` /
`mafw_list_standing_goals` / `mafw_run_standing_goal`（无 approve）。

桌面：右工作台「工作」面顶部的 `StandingGoalsPanel` 展示状态、上次/下次运行、成功率、
运行记录；支持暂停/恢复/停止/立即运行，以及 `waiting_person` 运行的人工批准。单条目标
运行记录加载失败会显示该目标的错误，不再静默折叠成空历史。
