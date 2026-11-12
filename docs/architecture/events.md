# 领域事件层（P2.4）

> 状态：2026-11-10。设计：`docs/superpowers/specs/2026-11-10-event-layer-design.md`；
> 计划：`docs/superpowers/plans/2026-11-10-event-layer.md`。
> 开关：`MAFW_EVENT_LAYER=1` 才启用；默认关闭。

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
- `event_channels` / `event_outbox`：频道与先存后发的 outbox，失败重试 5s→300s。

## 流程

1. **Ingress（top half）**：校验开关/来源启用/准入 → `ensureThread` → 插入 Trigger → 更新
   `last_trigger_at` → 广播 `event.trigger.received`。不调用 LLM、不发网络写。
2. **Fan-out**：每个 pending Trigger × 每个 Subscription 建一条 Delivery；Trigger 进入
   `fanned_out`。没有 Subscription 时 Trigger 记为 `filtered`；后续订阅会把它复活为
   `pending`，再 fan-out 一次，避免丢事件。
3. **Decision**：同一批 Trigger 只评估一次；并发 `evaluate(threadId)` 共享同一个在飞
   Promise；`work` 订阅才调用 `deliverWork`，`context` 永不创建 run。决定写
   `event_decisions` 并广播 `event.decision.made`。
4. **Delivery / Channel**：Delivery 状态机流转，每次状态变化广播
   `event.delivery.changed`；需要写回时经 `event_outbox`，失败保留 `last_error` 并按退避重试。
5. **Thread close**：`POST /api/event-threads/:id/close` 把线程置为 `closed`；已投递/已读/
   已确认/失败的 Delivery 收口为 `handed_back`，未投递的 `pending` 记为 `dropped`。

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
- `gateway/tests/unit/events/github-source.test.ts`
- `gateway/tests/unit/routes/events.test.ts`
- `gateway/tests/integration/event-layer.test.ts`
