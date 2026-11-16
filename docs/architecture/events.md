# 领域事件层（P2.4）

> 状态：2026-11-10。设计：`docs/superpowers/specs/2026-11-10-event-layer-design.md`；
> 计划：`docs/superpowers/plans/2026-11-10-event-layer.md`。
> 开关：默认开启；显式 `MAFW_EVENT_LAYER=0` 才关闭（关闭后事件层路由返回 503）。
>
> 业界对照：`docs/research/2026-11-16-always-on-agents-event-layer-research.md`（Claude / DeepSeek 的 always-on 架构与 MAFW 缺口）。

## 职责

事件层把外部/内部事件统一成：

```
Source → Trigger → Thread → Subscription → Decision → Delivery → Channel
```

它是领域层，不替代 AutomationEngine（cron / 调度 / watchdog）、SSE 或 presence。
`AutomationEngine` 到点执行 `event:cron_tick` / `event:github_poll` 动作，把事件交给
`EventLayerService`；事件层负责去重、归线程、fan-out、Tech Lead decision 与投递审计。

## 表

`gateway/src/memory/gateway-db.ts` 通过 `ensureEventLayerSchema(db)` 建表：

- `event_sources`：来源（github / cron / internal / webhook）、config、cursor、enabled。
- `event_threads`：`(source_id, external_key)` 唯一；GitHub 用 `repo#number`，cron 用
  `cron:<standingGoalId>`，内部 goal 事件用 `goal:<goalId>`。
- `event_triggers`：不可变事件；`idempotency_key` 唯一，重复投递只保留一条。
- `event_subscriptions`：`(thread_id, subscriber_type, subscriber_id)` 唯一；`work` 有执行权，
  `context` 只读。
- `event_decisions`：Tech Lead accept / ignore / unavailable + mode + rationale。
- `event_deliveries`：per-subscriber 状态机 pending → delivered → read → acknowledged → answered；
  失败/丢弃可见。
- `event_channels` / `event_outbox`：频道与先存后发的 outbox，失败重试 5s→300s；
  Phase 2 起 outbox 行带 `read_at` / `ack_at` / `sent_session_id`（Lead inbox 回执）。

## Domain event log（Phase 2，2026-11-16）

- `domain_events` 是独立 append-only 表（`gateway/src/core/events/domain-event-store.ts`），
  与 `pod_events` 分工：
  - `domain_events` 存事实（`goal.*` 生命周期，后续 `external.*`）；
    `UNIQUE(aggregate_type, aggregate_id, aggregate_version)` 保证同一 aggregate 版本单调；
  - `pod_events` 保持「事件 → 人」的 inbox 投影（unread / seen / attention），不并入 domain log。
- `append` 在单事务内取 `MAX(aggregate_version)+1`；`eventId` 幂等；`expectedVersion`
  不匹配抛 `DomainEventConflictError`。
- 当前生产者全部在 kernel（NodeDriver 仍是执行权威）：`goal.created`、`goal.phase.changed`、
  `goal.node.started`、`goal.node.completed`、`goal.node.failed`、`goal.result`、`goal.failed`。
- 归档：`PodGoalService.onGoalArchived(..., { inTransaction })` 在同一个 SQLite 事务里写
  goal 状态 + domain event + pod event + lead outbox；任一失败整体回滚。
- 投影：`goal-view-projector.ts` 从事件重建 `GoalLifecycleProjection`；Phase 2 只做 parity，
  读路径仍是 `buildPodGoalView`（Phase 3 接管）。

### Goal history / snapshots（Phase 3，2026-11-16）

- 每次 `writeGoalState` 在同一 SQLite 事务里追加 `goal.state.changed`
  （payload 带 `patch`、`round`/`loop`、`stateVersion`、`updatedAt`；新 revision 的 reset
  事件带完整 `resetState`）。
- `goal_snapshots(goal_id, version, state_json, created_at)`：首个事件、每次 reset、以及每
  20 条 `goal.state.changed` 写一行快照；语义事件（`goal.node.*`）不计入节奏。
- `replayGoalState` = 最新快照 + 之后 patch 的**纯回放**：不调 runtime/LLM、不写文件。
  可传 `atVersion` 做诊断。
- 默认读路径仍是 `goal_state` 行；`MAFW_GOAL_REPLAY_READ=1` 时读快照+回放，与行不一致
  记 `[GoalHistory] divergence` 并计数（`GoalStateStore.replayStats()`）。
- 行与 legacy JSON 都缺失时，`load` 从 history 回放并恢复 `goal_state` 行（不追加事件）。

### Lead read / ack（2026-11-16 定案）

- **read**：客户端把某个 Goal 的 Pod event 标记 seen 后，该 goal 的 lead outbox 行写
  `read_at`（`markOutboxReadByGoal`）；只命中 `state='sent'` 且 payload 无 `messageId` 的行。
  `wake_session_id='outbox:<id>'` 的行也可按 id 精确回写。
- **ack = Lead 回复**：Lead 会话 `turn.completed` 且成员角色是 `lead` 时，只 ack
  `sent_session_id` 等于该会话的行（`ack_at`）；同一会话服务多个 Pod 也不会跨 Pod 误 ack。
- read / ack 都是幂等的；`a2a:<messageId>` 行不参与 read。

## 流程

1. **Ingress（top half）**：校验开关/来源启用/准入 → `ensureThread` → 插入 Trigger → 更新
   `last_trigger_at` → 广播 `event.trigger.received`。不调用 LLM、不发网络写。
2. **Fan-out**：每个 pending Trigger × 每个 Subscription 建一条 Delivery；Trigger 进入
   `fanned_out`。没有 Subscription 时 Trigger 记为 `filtered`；后续订阅会把它复活为
   `pending`，再 fan-out 一次，避免丢事件。
3. **Decision**：同一批 Trigger 只评估一次；并发 `evaluate(threadId)` 共享同一个在飞
   Promise；`work` 订阅调用 `deliverWork`，`context` 订阅调用 `deliverContext`（只读，永不创建
   run）。决定写 `event_decisions` 并广播 `event.decision.made`。
4. **Delivery / Channel**：Delivery 状态机流转，每次状态变化广播
   `event.delivery.changed`；需要写回时经 `event_outbox`，失败保留 `last_error` 并按退避重试。
5. **Thread close**：`POST /api/event-threads/:id/close` 把线程置为 `closed`；已投递/已读/
   已确认/失败的 Delivery 收口为 `handed_back`，未投递的 `pending` 记为 `dropped`。

### Decision / Pod event → Lead 播报（2026-11-16）

- `DecisionRecordService.emit('drafted')`（仅 `agent` 起草的 draft）→ kernel
  `ingestDecisionEvent` → `internal` source 的 `decision.drafted` trigger：
  `externalKey=decision:<recordId>`（一 record 一线程），幂等键
  `internal:decision.drafted:<recordId>`。
- ingest 后为该线程建 `subscriberType:'lead'` + `mode:'context'` 订阅；kernel evaluator 对
  `decision.*` + Lead context 返回 `accept` / `report`。
- `deliverContext` 只做 **耐久入队**，不再直接调模型 session：每个 Pod 一个 `chat`
  channel（`lead:<podId>`），`dedupeKey = decision:<recordId>`，payload 保存渲染好的
  `[LEAD EVENT]` 文本、priority、podId / goalId / recordId。
- `PodEventWake` 2026-11-16 起也不再直接 `promptAsync`：每个 pending `pod_events` 行写成
  同 channel 的 `pod-event:<eventId>` outbox 行；`wake_state='delivered'` 只表示已入
  outbox（`wake_session_id='outbox:<id>'`），**不代表 Lead 已收到**。如果镜像
  `pod_message` 已由 A2A 送达 Lead，则只标记 `a2a:<messageId>`，不再入 outbox；
  dispatch 前还会再次检查 A2A 状态，成功后回写 `commitDelivered`。
- **p1 保留通道**：`LeadOutbox` 选择批次时，p1 行在有预算/最小间隔压力时仍优先发送；
  没有 p1 时才应用常规 `maxPerHour` / `minIntervalMs`。p1 仍受 `maxBatch` 限制。
- `LeadOutbox` dispatcher 每 5s 取 pending（含到期 failed）：按 channel 批量，
  p1 → p2 → p3 再按 createdAt；`maxBatch=5`、`maxPerHour=6`、两批最小间隔 60s。
  成功逐行 `sent`，失败逐行 `failed` 并按既有 outbox 退避重试；预算/间隔只延迟，
  不丢行，重启后 pending / 到期 failed 继续。dispatcher 只拥有 `lead:*` channel；
  `event_outbox` 其他生产者的行原样保留。kernel shutdown 先停 timer，并在关闭 DB 前
  等待在飞 dispatch 落盘（5s 上限），避免同一决定重启后重复播报。
- 多条 decision / pod-event 合并成一条消息（`[LEAD EVENT] N 条待确认` 或
  `[POD EVENT] N 条待处理` + 编号块），单条保持原文；同一 `recordId` / `eventId`
  重复 enqueue 只留一行。Lead 只负责转达，确认 / 搁置仍是 human-only。
- `event_deliveries.delivered` 与 `pod_events.wake_state='delivered'` 都只表示已成功写入
  outbox，**不代表 Lead 已收到**；实际发送状态看 `event_outbox.state`
  （`pending` / `sent` / `failed` / `dropped`）。
- 仍不做：read / ack、agent-set timers、dispatcher watchdog；这些留在后续阶段。
- `internal` / `cron` 系统 source 在事件层启动时 ensure；外部 GitHub / webhook source 仍需显式创建。

## GitHub 来源

第一版轮询：

- `GET /repos/{repo}/issues?state=all&since=...`：PR / issue opened、PR synchronize。
- `GET /repos/{repo}/issues/comments?since=...`：issue / PR comment；空 issue number 的评论
  直接跳过，不产生 `#0` 线程。
- 过滤器：repo、labels、branches、authors；`[bot]` 默认丢弃。
- cursor 只在所有 envelope 成功 ingest 后前进。

**暂缓**：PR reviews / Actions CI 的轮询需要 per-PR 分页与 Actions API，归 P2.4
follow-up；`normalizeGitHubEvent` 已支持 `pr_review` / `ci_status` 的 kind。

Webhook：`POST /api/event-sources/:id/webhook`，`x-hub-signature-256` HMAC 校验；与轮询共用
normalize / thread 路径。registry handler 读取 raw body 交给 HMAC，避免 JSON 重排导致签名不一致。

## 错误与背压

- 重复 `idempotency_key` → 直接返回已有 Trigger（`duplicate=true`），不重复广播。
- `admitIngress`：person 事件永不因队列满被拒；非 person 先看线程队列上限，再看 token bucket。
- 未知 source / thread → 404；非法 kind / 缺少字段 → 400；开关关闭 → 503。
- source 轮询失败广播 `event.source.error`，cursor 不前进。

## API

| 方法 | 路径 | operationId |
|---|---|---|
| GET | `/api/event-sources` | `events.sources.list` |
| POST | `/api/event-sources` | `events.sources.create` |
| PATCH | `/api/event-sources/:id` | `events.sources.patch` |
| GET | `/api/event-threads` | `events.threads.list` |
| GET | `/api/event-threads/:id/triggers` | `events.threads.triggers` |
| GET | `/api/event-threads/:id/subscriptions` | `events.threads.subscriptions.list` |
| POST | `/api/event-threads/:id/subscriptions` | `events.threads.subscriptions.create` |
| DELETE | `/api/event-subscriptions/:id` | `events.subscriptions.delete` |
| GET | `/api/event-deliveries?threadId=` | `events.deliveries.list` |
| POST | `/api/event-sources/:id/webhook` | `events.webhook.receive`（internal） |

SDK：`@mafw/sdk` 的 `events.sources/threads/subscriptions/deliveries`；桌面 Config → Gateway
的「事件层（开发者）」只读诊断（来源可启停）。

## 测试

- `gateway/tests/unit/events/event-store.test.ts`
- `gateway/tests/unit/events/event-normalize.test.ts`
- `gateway/tests/unit/events/event-layer-service.test.ts`
- `gateway/tests/unit/events/event-fanout.test.ts`
- `gateway/tests/unit/events/event-delivery.test.ts`
- `gateway/tests/unit/events/event-outbox.test.ts`
- `gateway/tests/unit/lead/lead-outbox-model.test.ts`
- `gateway/tests/unit/lead/lead-outbox.test.ts`
- `gateway/tests/unit/lead/lead-outbox-wiring.test.ts`
- `gateway/tests/unit/events/github-source.test.ts`
- `gateway/tests/unit/routes/events.test.ts`
- `gateway/tests/integration/event-layer.test.ts`
