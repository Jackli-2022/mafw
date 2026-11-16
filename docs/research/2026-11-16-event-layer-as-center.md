# 事件层是否应该成为中心？MAFW 现状与目标架构

- 日期：2026-11-16
- 状态：调研完成；**未改产品代码**
- 范围：gateway 事件层、Goal / Pod 状态机、desktop 读模型
- 关联：`docs/architecture/events.md`、`docs/architecture/gateway.md`、`docs/architecture/goal.md`、
  `docs/architecture/pod.md`、`docs/research/2026-11-16-always-on-agents-event-layer-research.md`

## 0. 结论

**方向是对的，但“中心”要定义清楚。**

1. 对 always-on、多角色协作的 MAFW，**事件层应该成为“集成中心”**：
   跨 Lead / Tech Lead / Builder / Reviewer / 人 / 桌面 / 记忆的所有事实，都先进入同一条
   领域事件流，再由各消费者投影。
2. 但**不等于所有状态都必须 event-sourced**。更合适的目标是
   **Temporal 式的“工作流 Event History + 快照”**：NodeDriver 仍是执行权威，
   但它的历史是 append-only 事件，当前 state 只是可重建的快照/投影。
3. 我们现在的架构**不是事件层中心**，而是：
   **NodeDriver 状态机 + PodStore/GoalState 是中心，事件层是下游的通知/传输/触发器侧车。**
   而且不是一个事件层，是**三条并行的 event plane**（见 §2）。
4. 这个错位已经产生真实成本：一次 Goal 失败状态，要在
   `classifyGoalArchive`、`deriveAttention`、`buildPodAttention`、`LeadGoalStatusCard`、
   `goal-user-view`、`work-overview-model`、`PodTechLeadService`、`kernel` 多处分别改；
   归档报告还会和事件/状态打架（`COMPLETED` 硬编码、`Merged main into main`）。
   如果事件层是中心，这些应该只是**一个 `goal.failed` 事实的不同投影**。

---

## 1. 当前架构：谁在中心？

### 1.1 三条事件路径 + 一条工作流状态机

```text
runtime / agent
  └─ canonical events → eventBus → EventHub
       ├─ event_log（SSE / WS 回放，seq）
       ├─ SSE / WS / push
       └─ 少量 eventBus 订阅（goal_created / state_change / phase_transition）

GoalDriver（NodeDriver）
  ├─ state/{goalId}.json（GoalStateV3，原子写）
  ├─ goal_node_runs（SQLite trace）
  ├─ phase_transition / goal_node → eventBus / SSE
  └─ archive → finishPodGoal

PodStore
  ├─ pod_goals / revisions / sessions / messages / tasks
  ├─ finishPodGoal → pod_events（p1/p2/p3）+ PodEventWake → Lead
  └─ PodGoalView → attention / presence / Lead card / WorkOverview

P2.4 EventLayer
  ├─ event_sources / event_threads / event_triggers
  ├─ event_subscriptions / event_decisions / event_deliveries
  └─ event_outbox → Lead dispatcher
```

### 1.2 三个“事件层”不是同一个东西

| 层 | 存储 | 作用 | 是否是领域真相 |
|---|---|---|---|
| `event_log` | `event_log`（SQLite，seq） | 客户端 SSE/WS 断点续传、回放 | ❌ 传输日志 |
| `pod_events` | `pod_events`（SQLite，p1/p2/p3） | Pod inbox / unread / Lead wake / presence | ❌ 通知/收件箱 |
| P2.4 event layer | `event_*` 八张表 | 外部 GitHub/cron/webhook → thread/subscription/decision/outbox | ❌ 触发器/投递 |
| Goal 状态机 | `.mafw/state/*.json` + `goal_node_runs` | 编排真相、恢复、重试 | ✅ 当前执行真相 |
| Pod 状态 | `pod_goals` / revisions / sessions / messages | 协作真相、展示、验收 | ✅ 当前协作真相 |

### 1.3 关键证据

- `kernel.finishPodGoal` 先改 Pod/Goal 状态，再 `podEventService.record()` 写事件：
  **state 与 event 是两次写，没有同一事务/outbox**。
- `PodEventWake` 和 P2.4 的 `LeadOutbox` 是**两条唤醒路径**、两套预算/去重；
  现有调研文档已经把它列为最大缺口。
- `goal_created` / `state_change` 既像事件又像命令：`eventBus` 监听后直接
  `startGoal` / `driver.advance`。这是 Fowler 说的“把命令伪装成事件”（passive-aggressive command）。
- `deriveAttention` / `buildPodAttention` / `work-overview-model` / `LeadGoalStatusCard`
  都各自从 `PodGoalView` 重算“谁需要处理”，没有共享的事件分类。
- `event_log` 只保存广播帧，`pod_events` 只保存 Pod 生命周期事件，
  P2.4 只保存外部 trigger；**没有一个覆盖 `goal.node.*` / `goal.phase.*` / `goal.failed` /
  `goal.accepted` / `pod.message` 的统一 domain event log**。
- `archiveWorktree.generateReport()` 写死 `Status: COMPLETED`，失败归档也写成功报告；
  这说明当前“报告”不是从事件/verdict 投影出来的，而是另一份手写真相。

---

## 2. 业界对照

### 2.1 Fowler：四种“事件驱动”要分开

Martin Fowler 把“event-driven”拆成四种不同模式：

| 模式 | 事件内容 | 真相在谁 |
|---|---|---|
| Event Notification | 只告诉你“变了”，通常只带 ID | 生产者 |
| Event-Carried State Transfer | 带足够状态，消费者不必回查 | 生产者 + 消费者副本 |
| Event Sourcing | 事件日志就是真相，状态是投影 | 事件日志 |
| CQRS | 写模型/读模型分离，事件同步 | 写库 + 读投影 |

来源：<https://martinfowler.com/articles/201701-event-driven.html>

对我们的意义：
- 我们现在主要是 **Event Notification + 少量 State Transfer**，不是 Event Sourcing。
- 事件层作为“中心”最自然的落点是 **Event-Carried State Transfer + CQRS 投影**：
  事件带足够上下文，消费者不需要到处回查 Goal/Pod 状态。
- 是否进一步 Event Sourcing，取决于我们是否真的需要“重放到任意时点/重建全部读模型”；
  这不是免费的。

### 2.2 Temporal：工作流 Event History 是真相，状态是可变摘要

Temporal 的模型非常接近我们需要的形态：

- 每个 Workflow Execution 有一条 append-only 的 **Event History**；
- Workflow 代码重放 Event History 恢复状态；
- Activity（LLM 调用、文件 I/O、外部 API）的结果被记录，重放时不重复执行；
- 另有一份 **Mutable State** 做快速查询，但它是 Event History 的摘要，不是第二真相；
- 事务性 Outbox 保证 History 与任务队列一致。

来源：
- <https://docs.temporal.io/workflow-execution/event>
- <https://docs.temporal.io/encyclopedia/architecture/temporal-architecture>
- <https://docs.temporal.io/workflows>

对我们的意义：
- NodeDriver 已经是“工作流引擎”的雏形；缺的是**把它的 node/phase 事实写进统一事件历史**，
  并让 `GoalStateV3` 成为可重建快照，而不是唯一真相。
- 不需要把 LLM 调用做成 event sourcing 的核心；LLM 是 Activity，结果进 History 即可。

### 2.3 Transactional Outbox：state 与 event 必须一起成功/失败

双写（先写 DB，再发事件）在崩溃时会丢事件或产生幽灵事件。标准解是
**同一事务写业务表 + outbox 表，再由 relay 投递**；消费者必须幂等。

来源：
- <https://microservices.io/patterns/data/transactional-outbox.html>
- <https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html>
- <https://www.eventfoundation.io/concepts/reliable-delivery>

对我们的意义：
- `finishPodGoal` 的 state → `pod_events` 应该进 outbox 或同一 SQLite 事务；
- 文件型 GoalState 与 SQLite 事件无法同事务，需要 outbox/补偿，或把 Goal 状态也放进同一个 DB。

### 2.4 多 Agent：事件总线是协作面，不是可选的日志

Confluent / StreamNative / Microsoft 的多 Agent 参考架构都把事件总线放在中心：

- Agent 只声明“我生产什么事件、消费什么事件”，不直接互相调用；
- 事件带 type / correlation / causation / trace，中央日志可回放；
- Orchestrator 负责路由与聚合，Worker 只处理命令/事件；
- 事件日志用于审计、恢复、重放和新消费者接入。

来源：
- <https://www.confluent.io/blog/event-driven-multi-agent-systems/>
- <https://streamnative.io/blog/the-event-driven-agent-era-why-streams-matter-now>
- <https://microsoft.github.io/multi-agent-reference-architecture/docs/agents-communication/Message-Driven.html>
- <https://akka.io/blog/event-sourcing-the-backbone-of-agentic-ai>

对我们的意义：
- Lead / Tech Lead / Builder / Reviewer 的协作应该通过同一条事件面，而不是
  “Lead 用 PodEventWake、Tech Lead 用 handoff 文件、human 用 attention 重算”。
- 一个 `goal.failed` 事实应该同时被 Lead、Tech Lead、human inbox、presence、memory 订阅，
  各自做自己的投影。

### 2.5 架构对比：MAFW vs Claude always-on vs DeepSeek Super-agent

> Claude 的 always-on 是产品/平台模式（Anthropic 文章 + Duet / Dispatch / Channels），
> 不是开源架构；Super-agent 是 DeepSeek 的 research prototype；MAFW 是我们当前代码。
> 下表比较的是**架构形状**，不是功能清单。

#### 2.5.1 中心与角色

| 维度 | MAFW 现在 | Claude always-on | DeepSeek Super-agent |
|---|---|---|---|
| **架构中心** | NodeDriver 状态机 + PodStore/GoalState | **event inbox + run + outbox** | **持久 Router + Worker pool** |
| **事件层角色** | 三个下游侧车：`event_log` / `pod_events` / P2.4 `event_*` | 中心 inbox：耐久入队、单 active worker、快速 ack | 中心 trigger/thread/subscription：后续事件直达 Worker |
| **执行单元** | Goal node run（plan / execute / review / probe） | agent run（可 sandbox / VM / browser） | 隔离 Worker 执行任务 |
| **协调者** | Lead：聊天对象 + 协调者 + 转达者，边界模糊 | 产品 run 调度 + outbox；不是常驻“总管家” | Router：只做交互/路由/全局记忆，不干重活 |
| **状态** | `GoalStateV3` + `pod_goals`/revisions + `goal_node_runs` | session state + 持久 memory | task state + Chain of Recall |
| **记忆** | 谐波记忆、T1、pinned/sticky、100ms recall | instructions / notes / past messages / task progress 四类文件 | 跨 run task state + recall chain |
| **人的注意力** | attention + `PodEventWake` + decision Lead outbox（两条路径、两套预算） | outbox pacing；只在需要时打扰 | 注意力预算 + 批处理/digest；Router 不刷屏 |
| **权限** | human-only 验收/计划批准/方向裁定；强 | permission primitives、deferred tool call、auto-mode | mandate / admission / human gate / watchdog |
| **交付** | Lead 直接 `promptAsync`；`event_outbox` 未真正接线 | outbox dispatcher | outbox + channel |
| **恢复/审计** | `event_log` + `pod_events` + `goal_node_runs`；无统一 domain replay | 持久 inbox/run 状态 + 产品审计 | event log + task state + watchdog |
| **扩展** | `event_sources/threads/triggers` 已有骨架 | Channels（IM/CI/webhook 注入） | Trigger sources + Thread/Subscription |

#### 2.5.2 强项 / 弱项（相对评估）

| 能力 | MAFW | Claude | Super-agent | 说明 |
|---|---|---|---|---|
| 确定性工作流 | **强** | 中 | 中 | NodeDriver + state machine + 重试/恢复 |
| 独立评审 / 验收 | **强** | 中 | 中 | 独立 Reviewer + 逐任务 rubric + human-only accept |
| 角色隔离 | **强** | 中 | **强** | Pod Lead/Tech Lead/Builder/Reviewer |
| 记忆系统 | **强** | 中 | 中 | 谐波 + T1 + pinned/sticky + recall |
| 事件层中心性 | **弱** | **强** | **强** | MAFW 是三套侧车 |
| 统一 inbox / outbox | **弱** | **强** | **强** | MAFW 两条 Lead 唤醒路径 |
| Agent-set timers | **弱** | **强** | 中 | MAFW 只有 cron/automation |
| Deferred approval | **弱** | **强** | 中 | MAFW 停下等人，但没有“回答作为事件恢复” |
| Run ledger / watchdog | 中 | 中 | **强** | MAFW 有 node trace，无 Lead-run/dispatcher watchdog |
| 注意力预算 | 中 | **强** | **强** | MAFW 的预算只在 PodEventWake |

#### 2.5.3 一句话对照

| 问题 | Claude | Super-agent | MAFW 现在 | MAFW 目标 |
|---|---|---|---|---|
| Agent 什么时候醒？ | event inbox + timers | trigger + 程序快筛 | `PodEventWake` + event layer 两条路 | 统一 inbox + timers |
| 谁跟人说话？ | outbox / 产品界面 | 持久 Router | Lead（直连 promptAsync） | Lead 走 outbox |
| 谁干活？ | agent run / sandbox | Worker | NodeDriver + Pod 角色 | 保留（强项） |
| 后续事件去哪？ | 续 session 或新 session | thread subscription 直达 Worker | event layer subscription；work/context 分流 | 统一 domain event + subscription |
| 怎么防噪音？ | 只在需要时发 | 两级过滤 + 注意力预算 | 两套预算 | 统一预算 + p1/p2/p3 + digest |
| 怎么防失控？ | permissions / approval | mandate / admission / watchdog | human-only 门（强） | + deferred approval + watchdog |
| 跨 run 记什么？ | memory 四类文件 | task state + recall chain | 谐波记忆（强） | + per-run 指针快照 |
| 事件层在中心吗？ | **是** | **是** | **否** | **是（集成中心）** |

#### 2.5.4 架构模式命名

- **MAFW 现在**：*workflow-centric + notification sidecar*。
  优点是确定性、评审、human gate、记忆都很强；缺点是事件层不中心、协调规则分散。
- **Claude always-on**：*event-inbox + durable run + outbox*。
  把“事件先入耐久 inbox”作为 source of truth，run 醒来处理，结果走 outbox；产品侧用
  Duet / Dispatch / Channels 承载不同通道。
- **DeepSeek Super-agent**：*Router/Worker + thread/subscription + event bus*。
  Router 只路由和记忆，Worker 隔离执行；事件由 trigger 快筛后进 thread，后续事件直接投给
  Worker；强调注意力预算和 watchdog。
- **MAFW 目标**：*event-centric workflow*。
  以统一 domain event 为集成中心，NodeDriver 作为确定性工作流执行器，Pod 角色作为消费者/
  生产者，outbox 作为交付，projection 作为读模型。

#### 2.5.5 该借什么、不该借什么

**借 Claude：**
- 事件先入耐久 inbox，handler 快速 ack；inbox 是 source of truth；
- 一个 active worker / 一个 dispatcher；
- outbox pacing：先安静，再逐步赢得注意力；
- per-run memory 文件（instructions / notes / progress / reported）；
- deferred tool call：run 挂起，人回答后以事件恢复。

**借 Super-agent：**
- Router / Worker 边界：Lead 不应变成通用 Worker；
- Thread / Subscription：后续事件直达对应 Worker，不反复经过 Router；
- 程序快筛 + 模型慢判：不是每条事件都跑 LLM；
- 注意力预算 + 批处理 / digest；
- Mandate / admission / watchdog；
- task state + Chain of Recall（但复用现有谐波记忆，不另造一套）。

**保留 MAFW：**
- 确定性 NodeDriver（不把工作流交给 Router 临场判断）；
- 独立 Reviewer + 逐任务 rubric + 必需 Goal 条件；
- human-only 验收 / 计划批准 / 方向裁定；
- 谐波记忆 / soft supersede / pinned-sticky / 100ms recall；
- Pod / Goal / revision 状态机（事件层是入口，不是替代品）。

**不要借：**
- 不要给 Lead 默认 Bash/文件写权限；
- 不要把所有事件都广播给 Lead；
- 不要为了 always-on 另造一套 memory；
- 不要自动接受 inferred 工作或自动 merge/purge；
- 不要把 Super-agent 的 research prototype 直接当生产架构。

---

## 3. 判断：事件层应该是中心吗？

### 3.1 应该成为“集成中心”，不必成为“所有状态的唯一真相”

建议把“中心”拆成三层：

```text
Command（意图）
  → Workflow / NodeDriver（确定性执行、重试、人工批准）
  → Domain Event（事实，append-only，带 aggregate/version/correlation）
  → Projections（Goal 列表、attention、presence、inbox、Lead 卡、Tech Lead 上下文）
  → Consumers（Lead、Tech Lead、human、memory、desktop/TUI）
```

- **事件层是中心**：所有跨角色、跨进程、跨 run 的“发生了什么”都从这里走；
- **Workflow 是执行权威**：谁该跑、重试几次、何时等人，仍由 NodeDriver 决定；
- **GoalState / PodGoalView 是投影/快照**：可以重建，不能各自成为第二真相；
- **Chat / UI 是消费者**：不再自己重算 domain 规则。

### 3.2 为什么不建议“全量 Event Sourcing”

- 事件 schema 演进、重放副作用、非确定性（时间/随机/LLM）都会放大复杂度；
- 聊天 token、part.delta 这类高频流不适合进 domain log；
- 我们真正需要的是：
  - 可审计的 Goal/协作事实；
  - 可重建的 attention/inbox/presence；
  - 可回放调试失败；
  - 新消费者接入不需要改生产者。
- 这些用 **Event History + 快照 + 投影** 就能拿到 80% 收益，成本远低于全量 ES。

---

## 4. 当前缺口（按优先级）

| # | 缺口 | 现状 | 影响 |
|---|---|---|---|
| 1 | 无统一 domain event envelope | 三个 event plane 字段/语义不同 | 消费者要认识三套模型 |
| 2 | 无 aggregate version / correlation / causation | 只有 `goalId` / `revision` 局部字段 | 无法可靠重放/追踪因果 |
| 3 | state 与 event 双写 | `finishPodGoal` 先 state 后 event | 崩溃丢事件/幽灵事件 |
| 4 | 事件与命令混用 | `goal_created` / `state_change` 直接驱动 driver | 流程隐式、难调试 |
| 5 | 两条 Lead 唤醒路径 | `PodEventWake` + decision outbox | 预算/去重/暂停不一致 |
| 6 | attention 多处重算 | `deriveAttention` / `buildPodAttention` / desktop | 分类漂移（失败被当“待验收”） |
| 7 | 读模型不可重建 | Goal 卡/报告/attention 从多源拼接 | 报告与事件/状态打架 |
| 8 | Tech Lead/人的路由硬编码 | kernel 里 `notifyFailure` + 文件 | 新角色/新渠道要改核心 |

---

## 5. 目标架构（建议）

### 5.1 统一事件信封

```ts
interface DomainEvent<T = unknown> {
  eventId: string
  type: string                 // goal.created / goal.phase.changed / goal.node.completed / goal.failed / goal.result / goal.accepted ...
  aggregateType: 'goal' | 'pod' | 'revision' | 'message'
  aggregateId: string
  aggregateVersion: number     // 每个 aggregate 内单调
  occurredAt: string
  recordedAt: string
  actor: { kind: 'human' | 'lead' | 'tech_lead' | 'builder' | 'reviewer' | 'system'; id?: string }
  correlationId?: string       // 一次用户请求/Goal run
  causationId?: string         // 直接触发它的上一个事件
  audience: Array<'human' | 'lead' | 'tech_lead' | 'memory' | 'desktop'>
  visibility: 'internal' | 'pod' | 'human'
  schemaVersion: number
  payload: T
}
```

### 5.2 写入路径

```text
NodeDriver / PodService / DecisionService
  └─ 同一 SQLite 事务：
       ├─ 更新 aggregate（pod_goals / goal_state / ...）
       └─ 追加 domain_events + outbox
  └─ relay（或直接读 domain_events）→ SSE / wake / inbox
```

### 5.3 读模型

```text
domain_events
  ├─ GoalViewProjector      → PodGoalView / Goal list / Goal detail
  ├─ AttentionProjector     → person attention / failed / review
  ├─ PresenceProjector      → running / attention / unreadResults
  ├─ InboxProjector         → pod_events / unread / Lead wake
  ├─ LeadStatusProjector    → LeadGoalStatusCard / recent outcomes
  ├─ TechLeadProjector      → goal-scoped failure handoff / context manifest
  └─ MemoryProjector        → goal outcome → semantic memory
```

### 5.4 角色订阅

| 事件 | human | Lead | Tech Lead | memory |
|---|---|---|---|---|
| `goal.phase.changed` | 不打扰 | 摘要 | 订阅（自己 goal） | 否 |
| `goal.node.failed` | 不打扰 | 摘要 | 订阅（可修复） | 否 |
| `goal.failed`（终态） | attention | 唤醒 | 订阅（handoff） | 结果 |
| `goal.result`（PASS/UNREVIEWED） | 待验收 | 通知 | 否 | 结果 |
| `goal.accepted` | 完成 | 通知 | 否 | 结果 |
| `decision.drafted` | attention | 转达 | 订阅 | 否 |

这样“Tech Lead 要不要知道”不再由 kernel 写死，而是由事件的 `audience` / 订阅决定。

---

## 6. 迁移路径（建议分阶段，不大爆炸）

### P0：统一分类与契约
- 定义 `DomainEvent` 信封 + 事件目录（`goal.*` / `pod.*` / `message.*` / `decision.*`）；
- 把 `classifyGoalArchive` / attention / UI 的失败分类收敛到一个纯函数；
- 加 contract test：每个事件类型必须有 producer、audience、projection 声明（类似 `EVENT_FLOW_MATRIX`）。

### P1：outbox + inbox 收敛
- `finishPodGoal` 的 state 与 `pod_events` 写入同一 SQLite 事务/outbox；
- `PodEventWake` 与 decision Lead outbox 合并为一个 `LeadInboxDispatcher`；
- `pod_events` 变成 domain event 的 projection，而不是独立分类入口；
- 先双写/影子运行，比较旧 attention 与新投影的差异。

### P2：Goal 节点事件进入 domain log
- `goal_node` / `phase_transition` 写 domain_events（不只 SSE）；
- `GoalStateV3` 变成 snapshot；`goal_node_runs` 保留为执行 trace；
- 加 replay 测试：从 `goal.created` 重放到当前，得到同一 `PodGoalView` / attention。

### P3：事件历史 + 快照
- NodeDriver 使用 append-only Goal History；定期快照；
- 崩溃恢复 = replay + snapshot + 未完成 side effect 的 outbox；
- 这一步才接近 Temporal 的 Durable Execution。

### P4：P2.4 外部事件层接入同一条总线
- GitHub / cron / webhook 作为 source adapter，产出 domain_events；
- `event_sources/threads/triggers` 保留为外部事件的去重/线程投影；
- 不再维护“外部事件层”和“Pod 事件层”两套唤醒语义。

---

## 7. 非目标 / 风险

- **不要把 chat token / part.delta 放进 domain log**：高频、可重建，留在 transport/event_log。
- **不要在事件 handler 里直接调用 LLM**：LLM 是 Activity/Command 的处理，事件只描述事实。
- **不要追求 exactly-once**：at-least-once + 幂等消费者 + dedupe key 是现实目标。
- **不要一次性全量 ES**：schema 演进、重放副作用、历史数据迁移都会反噬。
- **不要用事件层替代 human-only 验收/审批**：权限仍是命令处理层的不变量。

---

## 8. 需要产品/架构确认的问题

1. 我们说的“事件层中心”，是 **集成中心**（推荐）还是 **唯一真相/全量 event sourcing**？
2. **已定（2026-11-16）：GoalState 迁进 SQLite**，与 PodStore / `domain_events` 同库，
   以支持 state + event 同事务/outbox；现有 `.mafw/state/*.json` 一次性迁移 + 兼容读取。
3. **已定（2026-11-16）：`domain_events` 独立表**；`pod_events` 保留为「事件 → 人」的
   inbox 投影（含 unread/seen/attention 输入），不并入 domain log。
4. Lead / Tech Lead 的唤醒是否统一走一个 outbox dispatcher（推荐）？
5. **已定（2026-11-16）：不需要任意时点重放作为产品能力**（只做崩溃恢复 + 投影重建），
   也不引入 Temporal 式 Activity/Command 抽象——`goal.state.changed` patch + 快照的纯回放足够。

---

## 9. 参考

- Martin Fowler, *What do you mean by “Event-Driven”?* — <https://martinfowler.com/articles/201701-event-driven.html>
- Temporal, *Events and Event History* — <https://docs.temporal.io/workflow-execution/event>
- Temporal, *Workflow replay* — <https://docs.temporal.io/workflows>
- microservices.io, *Transactional outbox* — <https://microservices.io/patterns/data/transactional-outbox.html>
- AWS, *Transactional outbox pattern* — <https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html>
- Confluent, *Four Design Patterns for Event-Driven, Multi-Agent Systems* — <https://www.confluent.io/blog/event-driven-multi-agent-systems/>
- StreamNative, *The Event-Driven Agent Era* — <https://streamnative.io/blog/the-event-driven-agent-era-why-streams-matter-now>
- Microsoft, *Multi-agent Reference Architecture: Message-Driven* — <https://microsoft.github.io/multi-agent-reference-architecture/docs/agents-communication/Message-Driven.html>
- Akka, *Event Sourcing: The Backbone of Agentic AI* — <https://akka.io/blog/event-sourcing-the-backbone-of-agentic-ai>
- 既有 MAFW 调研：`docs/research/2026-11-16-always-on-agents-event-layer-research.md`
