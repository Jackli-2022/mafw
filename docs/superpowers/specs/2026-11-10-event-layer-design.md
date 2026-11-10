# Event Layer（事件层）设计

> 2026-11-10 · Phase P2.4（事件层；Standing Goal 的前置）
> 父设计：`docs/superpowers/specs/2026-11-10-lead-techlead-thread-handoff-design.md`
> 关联：`2026-11-10-standing-goals-design.md`、`2026-11-10-lead-techlead-p2-scheduler-design.md`
> 目标：把外部 / 内部事件统一成 Source → Trigger → Thread → Subscription → Decision → Delivery，供 Standing Goal、Goal、Lead 消费。

## 1. 背景

Standing Goal 需要「GitHub 有 PR 就审查」「有 issue 就修改」「每天看热门」这类触发。直接把这些逻辑写进
Standing Goal 会导致：

- 每个来源都重复实现轮询、去重、线程、重试；
- 同一 PR 的多个事件（opened / synchronize / review / CI）无法归到一个上下文；
- 订阅关系、投递状态、审计分散；
- 以后接 Feishu / webhook / 内部事件时再重写一遍。

SuperAgent 的事件层给了现成模型：Source / Trigger / Thread / Subscription / Eval / Channel / Delivery。
MAFW 已经有 cron/event automation、SSE、presence、Goal store；P2.4 补的是**领域事件层**，不是替代它们。

## 2. 目标 / 非目标

### 目标

- **Source**：GitHub（轮询优先，webhook 后补）、cron、内部 eventBus、通用 webhook。
- **Trigger**：不可变事件 + 幂等键 + actor + payload；重复投递不重复处理。
- **Thread**：同一 PR / issue / chat / goal 的事件归一线程；Eval 串行。
- **Subscription**：Standing Goal / Goal / Lead 订阅 Thread；`work` 有执行权，`context` 只给上下文。
- **Decision**：Tech Lead triage（accept / ignore / unavailable），accept 产生 GoalRun。
- **Delivery**：per-subscriber 状态（delivered / read / acknowledged / answered / handed back / failed / dropped）+ 重试 + 审计。
- **Channel**：写回 PR 评论 / 通知 / chat；outbox 先存后发。
- 所有事件可回放、可审计；失败不静默。

### 非目标

- 不替代 automation engine 的 memory pipeline / cron 维护动作。
- 不替代 SSE / presence；事件层可以发自己的 SSE 事件。
- 不把用户聊天消息变成外部 Source（聊天仍走 session）。
- 不做跨项目事件路由。
- 不实现 SuperAgent 的完整 Mandate / Policy / Source identity 映射；最小版只做 work/context + 订阅。

### 反目标

- 同一事件被两个订阅者重复执行。
- 同一 PR 的事件散落在多个 thread，Tech Lead 看不到完整上下文。
- 事件丢失 / 重复 / 顺序错乱，没有审计。
- 订阅 `context` 越权执行。
- Channel 发送失败静默丢失。

## 3. 领域模型

```
AutomationEngine（cron / 调度 / watchdog / 预算 / action 注册）
  │  emit event
  ▼
Source（GitHub / cron / internal / webhook）
  │  poll / receive
  ▼
Trigger（immutable event + idempotency key）
  │  normalize + thread assignment
  ▼
Thread（PR / issue / chat / goal 的事件序列）
  │  subscription fan-out
  ├──────────────► Subscription(work)  → Standing Goal → GoalRun → Tech Lead Eval
  └──────────────► Subscription(context) → Goal / Lead 只读上下文
                                                   │
                                                   ▼
                                              Decision（accept / ignore / unavailable）
                                                   │
                                                   ▼
                                              Channel（PR 评论 / 通知 / chat）
                                                   │
                                                   ▼
                                              Delivery（per subscriber 状态 + 重试）
```

**分层职责**：

- **AutomationEngine = 机制层**：cron 解析 / 时区 / next trigger、调度、watchdog、预算、action 注册。
  它不持有 Thread / Subscription 语义。
- **Event Layer = 领域层**：Source / Trigger / Thread / Subscription / Decision / Delivery / Channel。
  它不自己实现 cron 调度；cron 由 Engine 触发后 emit 事件进来。
- **Goal = 注册者 / 消费者**：StandingGoalService 代 Standing Goal 向 Engine 注册 cron；
  Engine 到点 emit `cron_tick`；Event Layer 归 Thread、fan-out；Standing Goal 收事件后创建 GoalRun。
  Lead 只调用 Standing Goal API，不直接注册 cron。
- **其他 Engine 事件**（memory pipeline、内部维护）也 emit 到 Event Layer；Event Layer 按
  threadKey / subscription 过滤，只有匹配的才 fan-out，其余记 `filtered` 审计。

硬件 / OS 映射：

| 硬件 / OS | MAFW | 设计约束 |
|---|---|---|
| 设备 / 传感器 | Source | 边缘 normalize；无关事件在域外丢弃 |
| IRQ 线 | Trigger | 不可变；带 source metadata |
| 中断控制器（APIC / IOAPIC） | AutomationEngine | cron / 调度 / watchdog；不持有领域语义 |
| 中断向量表 | Event Layer router | `source+kind → thread/handler`；未知向量过滤 + 审计 |
| 上半部（hard IRQ） | Ingress fast path：校验 / 去重 / 归线程 / 入队 | 非阻塞、有界、无 LLM、<10ms |
| 下半部（softirq / workqueue） | Tech Lead triage / GoalRun | 异步、可重试、有预算 |
| 环形缓冲区 | event queue（内存 + DB） | 有界；背压；丢弃 / 合并策略 |
| DMA | payload 直接引用 | 热路径不复制 / 解析大 diff；懒加载 |
| 中断合并 | dedupe / cooldown / batch | 同一 PR 事件合并；防风暴 |
| IRQ affinity | thread affinity | 同一 thread → 同一 Eval lane；串行 |
| IRQ masking | pause / quiet hours | 停 dispatch，继续记录 |
| NMI | 高风险动作（merge / delete） | 不可被普通流程屏蔽；人工 confirm |
| softirq | report / action 后台 run | 低优先级、可延迟 |
| workqueue | GoalRun pool / 并发 | 有界 worker；排队 |
| watchdog timer | task timeout | 卡住检测；kill / 重试 |
| page cache | thread snapshot cache | 热 thread 上下文；新 trigger 失效 |
| WAL / journal | `event_triggers` + `event_outbox` | append-only；崩溃恢复 |
| TCP ACK | Delivery state | at-least-once；ack / read / answered |
| 重传 | retry / backoff | 2s → 1min；上限 |
| 死信队列 | failed deliveries | 可见；不静默 |
| 背压 | bounded queue + coalesce | 保人；丢 / 合并批量事件 |
| 优先级反转 | person attention priority | 批量事件不能堵人 |
| RCU | context subscription | 只读；不授权；不阻塞 |
| seqlock | thread `seq` / version | 顺序与一致性 |
| 内存屏障 | 事务边界 | 先 commit 再副作用 |

## 4. 数据模型

### `event_sources`

| 字段 | 说明 |
|---|---|
| `id` | source id |
| `kind` | github / cron / internal / webhook |
| `name` | 用户可见名 |
| `config` | JSON：repo / schedule / event filters / identity |
| `enabled` | 0/1 |
| `cursor` | JSON：轮询位置 / last event id |
| `created_at` / `updated_at` | 时间 |

### `event_threads`

| 字段 | 说明 |
|---|---|
| `id` | thread id |
| `source_id` | 来源 |
| `external_key` | `repo#123` / `goal:<id>` / `cron:<standingGoalId>` |
| `title` | PR / issue 标题 / goal 标题 |
| `state` | open / closed / archived |
| `last_trigger_at` | 最后事件时间 |
| `created_at` | 时间 |

唯一索引：`(source_id, external_key)`。

### `event_triggers`

| 字段 | 说明 |
|---|---|
| `id` | trigger id |
| `source_id` / `thread_id` | 来源 / 线程 |
| `external_id` | GitHub delivery id / cron tick / event id |
| `kind` | pr_opened / pr_sync / issue_opened / comment / review / ci / cron_tick / internal |
| `actor` | 触发者（GitHub login / system / user） |
| `payload` | JSON：标题、正文、diff 摘要、URL、labels |
| `occurred_at` / `received_at` | 时间 |
| `idempotency_key` | UNIQUE；重复投递直接丢弃 |
| `disposition` | pending / evaluating / accepted / ignored / fanned_out / filtered |

### `event_subscriptions`

| 字段 | 说明 |
|---|---|
| `id` | subscription id |
| `thread_id` | 订阅的线程 |
| `subscriber_type` | standing_goal / goal / lead |
| `subscriber_id` | standing goal / goal / session |
| `mode` | work / context |
| `created_at` / `expires_at` / `dropped_at` | 时间 |

唯一索引：`(thread_id, subscriber_type, subscriber_id)`。

### `event_decisions`

| 字段 | 说明 |
|---|---|
| `id` | decision id |
| `thread_id` | 线程 |
| `trigger_ids` | JSON 数组（本批） |
| `decision` | accept / ignore / unavailable |
| `mode` | full / report / action / skip |
| `goal_run_id` | accept 产生的 run（可空） |
| `rationale` | Tech Lead 短理由 |
| `decided_by` | tech lead session id |
| `created_at` | 时间 |

### `event_deliveries`

| 字段 | 说明 |
|---|---|
| `id` | delivery id |
| `trigger_id` / `subscription_id` | 事件 / 订阅 |
| `state` | pending / delivered / read / acknowledged / answered / handed_back / failed / dropped |
| `attempts` | 重试次数 |
| `last_error` | 错误 |
| `delivered_at` / `read_at` / `ack_at` / `answered_at` | 时间 |

### `event_channels` / `event_outbox`

- `event_channels`：thread + kind（github_comment / notification / chat）+ address。
- `event_outbox`：channel + payload + state + attempts + next_retry_at；先存后发，失败重试，审计。

## 5. 事件流

1. **Source** 轮询或接收 → normalize 成 Trigger。
2. **Idempotency**：`idempotency_key` 唯一；重复直接丢弃（记录 `filtered`）。
3. **Thread assignment**：按 `external_key` 找/建 Thread；PR / issue 的所有事件归同一 Thread。
4. **Fan-out**：找 Thread 的 Subscriptions；
   - `work` → Standing Goal / Goal，创建 GoalRun 或投递；
   - `context` → Goal / Lead 只读上下文，不授予执行权。
5. **Tech Lead Eval**：Tech Lead 读 Thread snapshot + 新 triggers + 最近 decisions；
   输出 accept / ignore / unavailable；accept 产生 GoalRun（full / report / action）。
6. **Channel**：需要写回时，outbox 先存后发；成功/失败更新 Delivery。
7. **Delivery**：per subscriber 状态；未读/未处理在 thread 关闭时显式收口。

### 5.1 中断模型：top half / bottom half

**Top half（硬中断，<10ms，非阻塞）**

1. Source normalize → 事件信封。
2. 校验 schema / source enabled / 幂等键。
3. Thread assignment：按 `external_key` 找/建 Thread。
4. 持久化 Trigger（WAL）+ 入队。
5. 更新 Thread `last_trigger_at` / `seq`。
6. 给 Source ACK（cursor 只在 commit 后前进）。

禁止：LLM 调用、网络写、长事务、解析大 payload。大 diff / issue 正文只存引用，懒加载。

**Bottom half（softirq / workqueue，异步）**

1. 按 Thread 串行取 batch。
2. 找 Subscriptions；`work` / `context` fan-out。
3. Tech Lead Eval → Decision。
4. `accept` → GoalRun（进调度队列 / 预算）。
5. Channel outbox → Delivery 状态。

为什么分两半：Source 轮询不能等 LLM；Tech Lead Eval 可能几十秒；Ingress 必须快速 ACK，
否则 GitHub / cron 会被拖慢。

### 5.2 背压与优先级

- **每 Thread 队列上限**：默认 100 条；溢出按策略处理，不无限增长。
- **每 Source 令牌桶**：限制事件速率；超过阈值 → pause source + system problem。
- **全局高水位**：超过水位时暂停非 person 来源，person 事件始终准入。
- **溢出策略**（按顺序）：
  1. 同 kind 合并（latest wins，例如同一 PR 的多次 synchronize）；
  2. 丢弃最旧 + 审计（不静默）；
  3. 暂停 source + 通知。
- **优先级**：person > work GoalRun > report > context。
- **NMI**：merge / close / delete / 保护分支 / 密钥 → 永远人工 confirm，不能被普通流程屏蔽。
- **优先级反转防护**：批量事件不能占满队列，导致人的消息排队。
- **中断风暴防护**：dedupe + cooldown + 令牌桶；同一 PR 的连续事件合并成一批。

### 5.3 持久化、幂等与恢复

- **WAL**：Trigger 先落库，再 ACK Source；cursor 只在 commit 后前进。
- **Exactly-once 效果**：
  - `idempotency_key` 唯一；
  - Decision 以 `(thread_id, trigger_ids)` 幂等；
  - GoalRun 以 `trigger_key` 唯一；
  - Outbox 以 `(channel_id, dedupe_key)` 幂等。
- **崩溃恢复**：重启后 replay `pending` Trigger、恢复 Thread Eval、重发 Outbox；不重复副作用。
- **顺序**：Thread 内按 `seq` 单调；一个 Thread 同时只有一个 Eval；Eval 期间到达的 Trigger 合并到下一批。
- **内存屏障**：先 commit 事务，再执行 Channel / 通知等外部副作用。
- **重试退避**：事件投递 2s → 翻倍到 1min；Channel 发送 5s → 300s；超过上限进死信。

## 6. Source adapters

**上游是 AutomationEngine**：cron 解析 / 调度 / watchdog / 预算 / 任务提交都在 Engine；Source adapter 只负责
把外部变更 normalize 成事件信封，emit 到 Event Layer。Event Layer 不自己起 cron 或轮询线程。

### GitHub（第一版）

- 作为 Engine task 轮询：issues、PRs、PR reviews、comments、CI status；cursor 持久化。
- 过滤：repo / labels / branch / author allowlist；bot 自己的消息丢弃。
- `external_key`：`<repo>#<number>`；PR 与 issue 同号不同 namespace 时加前缀。
- 事件 kind：`pr_opened` / `pr_sync` / `pr_review` / `pr_comment` / `issue_opened` / `issue_comment` / `ci_status`。
- webhook 后补：同一 normalize 路径，delivery id 作为 `external_id`。

### Cron（由 Engine 触发）

- **注册者是 StandingGoalService**，不是 Lead / Tech Lead / Engine 自己。
- StandingGoalService 向 AutomationEngine `registerCron`（schedule / timezone），不自建调度器。
- Engine 到点 emit `cron_tick` 事件：`{ kind:'cron_tick', standingGoalId, scheduledAt, actualAt }`。
- Event Layer 归到 synthetic thread：`cron:<standingGoalId>`；subscription fan-out 后创建 GoalRun。
- 复用 Engine 的 cron 解析 / 时区 / next trigger 预览 / watchdog。
- 错过 tick 不补跑（默认）；可选 `catchUp: false`。

### Internal

- Engine / eventBus 的事件：`goal.created` / `goal.phase` / `goal.result` / `memory.*` / `presence.*`。
- Thread：`goal:<goalId>` / `project:<dir>`。
- 没有 subscription 的事件记 `filtered`，仍保留审计。

### Webhook（后补）

- 通用 HTTP source：`POST /api/event-sources/:id/webhook`；HMAC 校验；payload → Trigger。
- 用于 Feishu / Slack / CI / 第三方。

## 7. Subscription 语义

- **work**：订阅者有执行权；Trigger fan-out 后创建 GoalRun / 投递给 Standing Goal。
- **context**：只给上下文；不创建 run、不恢复已结束 Goal、不授予动作权限。
- **Lead**：可以 `context` 订阅项目线程，用于状态汇报；不抢 Tech Lead 的 work 订阅。
- **drop**：用户可删除 Thread 上任意订阅；Executor 只能删自己 Goal 的订阅（保留来源 thread）。
- **closed thread**：未读/未处理 Trigger 在关闭时回到 Eval 或显式记录 `handed_back`，不静默消失。

## 8. Tech Lead Eval 集成

Tech Lead 的 triage prompt 由事件层组装：

```
[EVENT THREAD] repo#123 · PR title · state
[NEW TRIGGERS] pr_opened, pr_sync (2)
[RECENT DECISIONS] accept(full) 2h ago; ignore(duplicate) 1h ago
[STANDING GOAL] objective / template / budget / approval
[POLICY] work/context; high-risk actions need confirm
```

输出 `Decision`：

```ts
interface EventDecision {
  decision: 'accept' | 'ignore' | 'unavailable'
  mode?: 'full' | 'report' | 'action' | 'skip'
  rationale: string
  goalRunId?: string
  requiresApproval?: boolean
  dedupeWithRunId?: string
}
```

## 9. API / 事件

| 接口 | 说明 |
|---|---|
| `GET /api/event-sources?projectDir=` | 来源列表 / 状态 |
| `POST /api/event-sources` | 创建（GitHub / cron / internal / webhook） |
| `PATCH /api/event-sources/:id` | 启停 / 改配置 |
| `GET /api/event-threads?sourceId=` | 线程列表 |
| `GET /api/event-threads/:id/triggers` | 事件序列 |
| `GET /api/event-threads/:id/subscriptions` | 订阅 |
| `POST /api/event-threads/:id/subscriptions` | 订阅 |
| `DELETE /api/event-subscriptions/:id` | 取消订阅 |
| `GET /api/event-deliveries?threadId=` | 投递状态 |
| `POST /api/event-sources/:id/webhook` | 通用 webhook |

事件（SSE）：

- `event.trigger.received`
- `event.thread.updated`
- `event.decision.made`
- `event.delivery.changed`
- `event.source.error`

## 10. UI / Lead

- **Lead 状态卡**：可按需显示「事件层：N 个活跃 source、M 个线程、K 个待处理」。
- **Standing Goal**：绑定 source/thread；显示 last/next run。
- **开发者模式**：event source / thread / delivery 诊断；不暴露给普通用户。
- 普通用户只看到 Goal / Standing Goal / Tech Lead；不看到 Source / Trigger / Thread 术语（除非在事件详情）。

## 11. 失败模式

| 失败 | 处理 |
|---|---|
| 重复投递 | `idempotency_key` 唯一；丢弃并记录 |
| 事件顺序错乱 | 按 `occurred_at` 排序；Thread 内串行 Eval |
| Source 轮询失败 | 退避 + 系统问题；cursor 不前进 |
| Thread 爆炸 | 按 external_key 归并；过期归档 |
| 订阅越权 | `context` 不创建 run；work 才执行 |
| Channel 发送失败 | outbox 重试 + 失败可见；不静默 |
| Eval 卡住 | 超时 → unavailable；下一批重新评估 |
| 事件丢失 | 轮询 cursor + 幂等；webhook 失败重试 |

## 12. 测试与验收

### 单元

- `normalizeGitHubEvent`：PR / issue / comment / review / CI → Trigger。
- `assignThread`：external_key 归并；PR/issue 同号。
- `dedupeTrigger`：idempotency key；重复丢弃。
- `fanOut`：work / context；不越权。
- `deliveryState`：pending → delivered → read → ack → answered / handback。
- `retryBackoff`：2s → 1min；上限。

### 集成

- GitHub PR opened → thread 创建 → subscription → Standing Goal → GoalRun → Tech Lead Eval。
- 同一 PR synchronize → 同一 thread，不重复 run。
- context 订阅 → 只给上下文，不创建 run。
- Channel 发送失败 → outbox 重试 → 成功 / 失败可见。
- Source 重启 → cursor 恢复，不重复事件。

### GUI

- Standing Goal 绑定 source；run history 可见；Lead 状态卡按需。
- 开发者模式可查 thread / deliveries。

### 指标

- 事件投递成功率 ≥99%。
- 重复处理率 <0.1%。
- trigger → run 创建 <1s。
- thread 归并正确率 ≥99%。

## 13. 迁移与开关

- 新表随 migration；不迁移 automation rules。
- 开关 `MAFW_EVENT_LAYER`（默认关，灰度）；GitHub source 单独开关。
- Standing Goal 依赖事件层；事件层未开时 Standing Goal 只支持 cron（回退现有 automation engine）。
- 现有 automation engine 继续负责 memory pipeline / 维护动作；事件层是新的领域入口。

## 14. 开放问题

1. GitHub 先轮询还是 webhook？建议轮询（无需公网入口），webhook 后补。
2. 用户聊天消息是否作为 Source？建议第一版不做，聊天仍走 session。
3. 是否把 automation engine 的 event trigger 迁到事件层？建议不迁，事件层只服务 Goal / Standing Goal；automation 保持独立。
4. Mandate / Policy 第一版做到什么程度？建议只做 work/context + 高风险 confirm，完整 Policy 后置。
5. Thread 关闭后未处理事件怎么办？建议显式 `handed_back` + Lead 状态卡；不静默丢。
