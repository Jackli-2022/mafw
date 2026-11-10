# Standing Goals（长效 Goal）设计

> 2026-11-10 · Phase P2.5（依赖 P0 / P1 / P2 / P2.4）
> 父设计：`docs/superpowers/specs/2026-11-10-lead-techlead-thread-handoff-design.md`
> 关联：`2026-11-10-event-layer-design.md`（Source / Trigger / Thread / Subscription / Delivery）
> 目标：Goal 不只是一次性工作，也可以是「长期意图 + 触发策略 + 运行历史」；触发后由 Tech Lead 判断怎么跑。

## 1. 背景

现有 Goal 是一次性工作单元：有明确终点、revision、NodeDriver。用户提出的是另一类：

- GitHub 有 PR 就审查，有 issue 就修改；
- 每天看 GitHub 最新热门项目；
- 每周检查依赖 / 安全公告 / 竞品动态。

这些不是「一个 Goal 做一次」，而是「一个长期意图，按事件或 cron 反复触发」。如果每个触发都建一个顶层 Goal，
Goal 列表会变成事件流；如果只做成 automation rule，又失去 Goal 的 plan / execute / review 语义。

SuperAgent 的 `Trigger → Eval → Ticket / ignore` 正好对应：Standing Goal 是长期意图，触发产生 GoalRun，
Tech Lead 做 triage（Eval），决定是 goal、report、action 还是 skip。

## 2. 目标 / 非目标

### 目标

- **Standing Goal** 是一等对象：长期意图、触发策略、运行历史、预算、状态（active / paused / stopped）。
- 每次触发产生一个 **GoalRun**；Tech Lead 判断 run 形态：
  - `goal`：创建普通 Goal（plan / execute / review；`goal_mode` 由 triage 定 quick / standard）；
  - `report`：也创建普通 Goal（`taskType:'research'`，不产生代码 diff），走同一 Goal 路径；
  - `action`：有界副作用（评论 / 标签 / 通知），**不创建 Goal**；
  - `skip`：重复、无关、已处理。
- 用户看到**一条 Standing Goal**，展开是运行历史；不是每个触发一个顶层 Goal。
- **Tech Lead 判断是否 Standing Goal**：Lead 只移交意图；Tech Lead 认为需要长期触发时，创建 Standing Goal 并注册 trigger。
- Lead 只读展示 Standing Goal 的 last / next run 与状态；暂停 / 恢复 / 停止由用户命令转给 Tech Lead / StandingGoalService。
- 事件 + cron 都支持；GitHub 是第一个事件源，后续可接内部事件 / webhook。
- 所有 run 都有审计、预算、并发限制、去重。

### 非目标

- 不做主动找活（proactive auto）；只对明确配置的 trigger 反应。
- 不替换现有 automation rules；Standing Goal 是 Goal 语义层，automation rule 仍是管线/维护动作。
- 不做跨项目 Standing Goal。
- 不让 Standing Goal 绕过 Goal 的权限 / 审批 / Reviewer。

### 反目标

- 每个事件都建顶层 Goal，Goal 列表变成事件流。
- 重复触发产生重复 run（同一 PR / issue 跑多次）。
- Tech Lead 的 triage 变成黑盒；用户不知道为什么 skip / 为什么 goal。
- 高风险动作（merge / close / 删除）没有人工门。
- 预算失控：一个高频事件把日预算烧光。

## 3. 模型

```
StandingGoal（长期意图 + 触发策略 + 预算 + 状态）
  │
  ├─ Trigger: cron / event / manual
  │
  └─ GoalRun（一次触发）
        │
        ├─ Tech Lead triage
        │     ├─ goal   → 普通 Goal（pod_goals + revision + NodeDriver）
        │     ├─ report → 普通 Goal（taskType research，无代码 diff）
        │     ├─ action → 有界副作用（评论/标签/通知），不建 Goal
        │     └─ skip   → 记录原因，不执行
        │
        └─ Run history / artifacts / cost
```

OS 映射：

| OS | MAFW |
|---|---|
| systemd unit / cron job | Standing Goal |
| timer / inotify / webhook | Trigger |
| 进程实例 | GoalRun |
| 调度器 / admission control | Tech Lead triage + gateway policy |
| rlimit / cgroup | 预算 / 并发 / 冷却 |
| systemctl start/stop | 用户的 pause / resume / stop（Lead 转达） |
| idempotency key | triggerKey |

**术语分层（避免混淆）**：

| 层 | 值 | 说明 |
|---|---|---|
| Goal mode | `quick` / `standard` / `standing` | 一个 Goal 走多重的 plan / review |
| Standing run | `goal` / `report` / `action` / `skip` | 一次触发产生什么 |

- `quick` 是 **Goal mode**，不是 Standing run mode；它仍然创建 Goal、走 NodeDriver。
- `action` 不是 Goal；它是白名单副作用，不跑 NodeDriver、不改代码。
- `report` 是 Goal（`taskType:'research'`），走同一路径，只是不产生代码 diff。

## 4. 数据模型

### `standing_goals`

| 字段 | 说明 |
|---|---|
| `id` | standing goal id |
| `project_dir` | 项目 |
| `title` | 用户可见标题 |
| `objective` | 长期意图 |
| `template` | Goal 模板：taskType / acceptance / boundaries / planReview / model |
| `triggers` | JSON：cron / event / manual 列表 |
| `state` | active / paused / stopped |
| `concurrency` | 最大并发 run，默认 1 |
| `cooldown` | 同 key 冷却时间 |
| `budget` | perRun / perDay（turns / cost） |
| `approval` | auto / plan / confirm（策略上限，Tech Lead 可更严） |
| `created_by` | Lead session id |
| `created_at` / `updated_at` | 时间 |
| `last_run_at` / `next_run_at` | 时间 |

### `goal_runs`

| 字段 | 说明 |
|---|---|
| `id` | run id |
| `standing_goal_id` | 所属 Standing Goal |
| `trigger_type` | cron / event / manual |
| `trigger_key` | 幂等键（event id / cron tick / manual uuid） |
| `payload` | 触发上下文（PR / issue / repo / query） |
| `status` | queued / triaging / running / waiting_person / done / failed / skipped |
| `mode` | goal / report / action / skip（Tech Lead 决定） |
| `rationale` | Tech Lead triage 理由（短） |
| `goal_id` | goal / report 模式关联的 Goal（可空） |
| `session_id` | 本次 run 的 Tech Lead session |
| `worktree` | goal / report 模式的工作区 |
| `result` | 报告 / PR / 评论 / 错误 |
| `cost` / `tokens` | 本次 run 成本 |
| `started_at` / `ended_at` | 时间 |

索引：`(standing_goal_id, created_at desc)`、`(trigger_key)` 唯一。

### `goal_run_events`（审计，可选）

`run_id` / `type` / `payload` / `created_at`：trigger、triaged、started、action、finished、skipped。

## 5. 触发与去重

触发层由 P2.4 事件层提供：Standing Goal 在匹配的 Thread 上建 `work` Subscription；事件层负责
Source / Trigger / Thread / 幂等 / 投递。本节只定义 Standing Goal 如何使用订阅。

### Cron（谁注册）

**注册者 = StandingGoalService（gateway 服务），不是 Lead / Tech Lead / Engine 自己。**

| 角色 | 职责 |
|---|---|
| Lead | 调 `mafw_create_standing_goal` / update / pause / stop；不直接碰 Engine |
| StandingGoalService | 持久化定义 + 向 Engine `registerCron` / `unregister`；启动时 reconcile |
| AutomationEngine | 解析 cron / 调度 / watchdog；到点 emit `cron_tick`；不持有 Standing Goal 语义 |
| Event Layer | 归 thread + subscription fan-out |
| Tech Lead | 收到 GoalRun 后 triage / 执行 |

规则：

- **key 稳定**：`standing-goal:<standingGoalId>:<triggerId>`；重复注册幂等。
- **表是 truth**：Engine job 是运行时派生；启动/重载时按 `state` reconcile——
  `active` → ensure，`paused/stopped` → remove。
- **生命周期**：create → register；update schedule → 重新 register；pause/stop/delete → unregister；
  resume → register。
- 一个 Standing Goal 多个 cron trigger → 多个 key。
- Engine job 丢失 / Engine 重启 → 从表 reconcile 重建，不重复。
- 用户 session / Lead **不能**直接注册任意 cron；必须走 StandingGoalService（避免孤儿 job / 越权）。
- 现有 memory pipeline / automation rule 仍按自己的命名空间注册，不经过 StandingGoalService。
- Engine 到点 emit `cron_tick` → Event Layer 归到 synthetic thread `cron:<standingGoalId>` →
  `work` subscription → GoalRun。
- 复用 Engine 的 cron 解析 / 时区 / next trigger 预览 / watchdog。
- 每次 tick 生成 `triggerKey = standingGoalId:cron:<ISO tick>`。
- 错过 tick 不补跑（默认）；可选 `catchUp: false`。

### Event（经事件层）

- 第一个 source：GitHub（轮询作为 Engine task，webhook 后补）。
- 事件：`pull_request.opened` / `pull_request.synchronize` / `issues.opened` / `issues.labeled` / `release.published`。
- 过滤：repo / labels / branch / author allowlist。
- `triggerKey = standingGoalId:github:<event>:<deliveryId>` 或 `repo:pr:number:headSha`。
- 同一 PR / issue 的重复事件按 `cooldown` + 当前 open run 去重。

### 并发与预算

- `concurrency` 默认 1；超出排队，不丢弃。
- 同 key 已有 `queued/triaging/running` run → 合并或 skip。
- 预算：per run / per day；超预算 → `paused` + person attention，不静默丢弃。
- 人类介入优先：Standing Goal 的 run 不占用人类会话槽。

## 6. Tech Lead triage

每次 run 创建一个 Tech Lead session（per run），seed：

- Standing Goal 的 objective / template；
- trigger payload（PR diff 摘要 / issue 标题正文 / 查询）；
- 最近 N 次 run 的 mode / result / skip 原因（去重与延续）；
- 预算与 approval policy。

Tech Lead 输出结构化 JSON：

```ts
interface RunTriage {
  mode: 'goal' | 'report' | 'action' | 'skip'
  rationale: string          // ≤200 字
  scope?: string             // goal 模式的边界
  requiresApproval?: boolean // 请求人工门
  dedupeWithRunId?: string   // 已有 open run
  action?: { type: 'comment' | 'label' | 'notify'; payload: unknown }
}
```

Gateway 校验：

- `mode` 必须在允许集合；`action` 必须是白名单动作；`requiresApproval` 只能加严，不能绕过 policy。
- 高风险（merge / close / delete / 改保护分支）→ 永远 `confirm`，Tech Lead 不能自动批准。
- `skip` 必须记录理由；同一 triggerKey 不会重复 triage。

模式：

| mode | 行为 |
|---|---|
| `goal` | 创建普通 Goal（`pod_goals` + revision）；Tech Lead triage 决定 `goal_mode: quick \| standard`；走同一 NodeDriver 路径。 |
| `report` | 也创建普通 Goal，`taskType:'research'`，不产生代码 diff；走同一 Goal 路径（quick/standard 由 triage 定），不另起执行器。 |
| `action` | 有界白名单动作（评论 / 标签 / 通知），不创建代码执行路径；写 run 审计。 |
| `skip` | 写 `skipped` + 理由；不建 session。 |

**关键**：`goal` 和 `report` 都是普通 Goal，不允许第二条执行路径；`action` 只做非代码副作用，不跑 Builder。

## 7. Lead 与 UI

### Lead

- **不判断类型**：Lead 只把用户意图和当前话题交给 Tech Lead；是否做成 Standing Goal 由 Tech Lead 决定。
- **创建**：用户说「每天看一下 GitHub 热门」→ Lead 移交 Work Request → Tech Lead triage 决定 `standing` →
  StandingGoalService 创建 Standing Goal（title / objective / trigger / budget）并注册 cron。
- **管理**：用户说「暂停 / 恢复 / 停止 / 手动跑一次」→ Lead 转给 Tech Lead / StandingGoalService；
  Lead 不直接操作 trigger。
- **状态卡**：活跃 Standing Goal 的 last run / next run / 成功率 / 待你处理；问才出。
- **不读 run 的原始 transcript**；只看结构化结果。

### UI

- **Goal 列表**：Standing Goal 一条，带 schedule 图标、state、last/next run、成功率。
- **展开**：run 历史；每条 run 显示 mode / status / result / 成本 / Tech Lead 入口。
- **Run 详情**：Tech Lead 对话、报告、PR / issue 链接、triage 理由。
- **Attention**：只有 `waiting_person` / 预算耗尽 / 连续失败进 person；健康 run 不打扰。
- 不显示 session id。

## 8. API / MCP

| 接口 | 说明 |
|---|---|
| `mafw_create_standing_goal` | title / objective / triggers / template / budget |
| `mafw_update_standing_goal` | 改 trigger / budget / state |
| `mafw_list_standing_goals` | 列表 + last/next run |
| `mafw_run_standing_goal` | 手动触发一次（force） |
| `GET /api/standing-goals?projectDir=` | 列表 |
| `GET /api/standing-goals/:id/runs` | run 历史 |
| `POST /api/standing-goals/:id/pause` | 暂停 |
| `POST /api/standing-goals/:id/resume` | 恢复 |
| `POST /api/standing-goals/:id/stop` | 停止 |
| `POST /api/goal-runs/:id/approve` | 人工批准 goal / action |

事件：

- `standing_goal.created/updated/paused/resumed/stopped`
- `goal_run.created/triaged/started/finished/skipped/failed`
- `goal_run.budget_exhausted`
- `goal_run.needs_person`

## 9. 安全、预算与审计

- **权限**：Standing Goal 的 run 继承项目权限；不新增绕过路径。
- **创建 trigger 的审批**：report / 低风险 → Tech Lead 直接创建 Standing Goal 并 register cron/event；
  会自动改代码 / 高风险 → 先给用户确认 trigger + 预算，再 register。
- **审批**：report auto；代码修改 plan；merge / close / delete / 保护分支 confirm。
- **预算**：per run + per day；超限 pause + attention；不静默。
- **并发**：默认 1；人类介入优先；新 run 排队。
- **审计**：trigger、triage、action、result 全记录；可回放到 run。
- **事件源**：GitHub token 最小权限；只读 + 白名单动作。
- **失败**：连续失败 3 次 → person；不无限重试。

## 10. 失败模式

| 失败 | 处理 |
|---|---|
| 重复触发 | `trigger_key` 唯一 + cooldown + open run 去重 |
| Tech Lead 误判 goal | 记录 rationale；用户可改 standing goal 的 approval / template；run 可打回 |
| Tech Lead 误判 skip | run history 可见；用户可手动 force run |
| 预算耗尽 | pause + person attention；不静默丢 run |
| 事件源不可用 | 退避重试 + 系统问题；不阻塞其他 run |
| 高风险动作 | 永远 confirm；Tech Lead 不能自动批准 |
| 并发冲突 | 默认 1；同 worktree 串行；人类优先 |
| 通知风暴 | 合并同 standing goal / 同原因；健康 run 不通知 |

## 11. 测试与验收

### 单元

- `parseTriggers`：cron / event / manual；时区；next run。
- `dedupeTrigger`：trigger_key / cooldown / open run。
- `validateTriage`：mode 集合；action 白名单；approval 只能加严。
- `planRun`：goal / report / action / skip 分支。
- `budget`：per run / per day；超限 pause。

### 集成

- cron 触发 → run → Tech Lead triage → report → run history。
- GitHub PR 事件 → 普通 Goal → plan approval → 执行 → 结果。
- 同一 PR 重复事件 → 只跑一次。
- 预算耗尽 → pause + attention。
- 暂停 Standing Goal → 不再触发；恢复后继续。

### GUI

- Goal 列表一条 Standing Goal；展开 run 历史；Tech Lead 入口。
- 状态卡问才出；不显示 session id。

### 指标

- trigger → run 创建 <1s；triage 完成 <30s（report）/ <2min（goal）。
- 重复 run 率 <1%。
- 误判 goal / skip 率 <10%（抽样）。
- 单 run 成本在预算内 ≥99%。

## 12. 迁移与开关

- 新表 `standing_goals` / `goal_runs` 随 migration。
- 开关 `MAFW_STANDING_GOALS`（默认关，灰度）；GitHub source 单独开关。
- 现有 automation rules 不变；Standing Goal 是新的 Goal 语义层。
- 先支持 cron + GitHub；webhook / 内部事件 P3。

## 13. 开放问题

1. Tech Lead session 是 per run 还是 per standing goal？建议 per run + 最近 run 摘要，隔离更好。
2. GitHub 先轮询还是 webhook？建议轮询（无需公网入口），webhook 后补。
3. issue 修改默认 approval 是 `plan` 还是 `confirm`？建议 `plan`（plan approval 已有人工门）。
4. `action` 白名单第一版包含什么？建议 comment / label / notify，不含 merge / close。
5. run 的 report 是否进记忆？建议写 semantic summary + run 指针，不写全文。
