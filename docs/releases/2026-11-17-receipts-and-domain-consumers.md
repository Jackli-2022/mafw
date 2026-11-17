# 2026-11-17 · 回执路由 + domain event 消费者

- **版本**：`v5.1.0`（行为增强，不升版本号）
- **提交**：`dff7507e`（consumer helpers）+ `f87a1b52`（kernel 消费者）+
  `7e9b09f6`（receipt 路由）+ `9c76b620`（SDK）+ `a4579416`（coverage ledger）+
  `90a5b76f`（read → answered 修复）+ `36f1eb6b`（review 修复）+ docs
- **计划**：`docs/superpowers/plans/2026-11-17-receipts-and-domain-consumers.md`
- **前置**：`docs/releases/2026-11-17-external-events-unification.md`

## 现在

### 人类回执路由

- `POST /api/event-deliveries/:id/read`：human-only，delivery `delivered → read`，
  同事务写 `event_outbox.read_at`。
- `POST /api/event-deliveries/:id/answer`：human-only，`read → answered`（或
  `acknowledged → answered`），写 `event_outbox.answered_at`。
- 错误映射：空 id 400、非 human 403 `human_principal_required`、不存在 404、
  非法状态转移 409、事件层关闭 503。
- `ack` 仍没有 HTTP 路由：只由 Lead 会话 `turn.completed` 写入。

### Domain event 消费者

- `DomainEventStore.getByEventId` + `domainEventForTrigger` / `consumerEnvelope`：
  按 `external:<trigger.idempotencyKey>` 精确查找。
- Lead 外部播报优先用 `renderDomainEvent`；查不到（decision/internal）回退 trigger 渲染。
- Standing Goal 的 `handleEventTrigger` 用 domain event 的 payload / kind；幂等键仍是
  `trigger.id`。
- Tech Lead 的 evaluate / decision 不变；`event_*` 继续做线程/投递审计。

### SDK

- `events.readDelivery(id)` / `events.answerDelivery(id)`；契约由
  `emit:openapi` + SDK `gen:api` 生成，`contract.test.ts` 校验 path → operationId。

## 测试

- gateway：`domain-event-consumer`、`domain-event-consumer-wiring`、
  `event-delivery-receipt-routes` 新增 8 tests；api-contract ledger 更新（+2 POST ops）。
- SDK：新增 2 个 client 测试；`npm test` 245/245。
- gateway 全量：**1022 / 1022 suites**，**8093 passed / 2 skipped / 0 failed**（review 修复前）。
  review 修复后多次全量各命中一个并行/环境 flake（`mcp/search-t1-layer`、
  `cli/plugin-standard-command`、`file-history-route`），均单独复跑全绿；最后一次
  1023/1024 suites、8113 passed / 2 skipped / 4 failed，失败全部来自
  `cli/plugin-standard-command`（与工作树里未提交的 plugin 改动相关）。
- Desktop `tsgo`：rc=0（补上 preload 的 `readDelivery` / `answerDelivery` 后）。
- `tsc`：gateway + SDK rc=0；gateway / SDK build 均通过。

## 真机验收（2026-11-17，gateway pid 58500 / instance d3fce32e）

- 临时 webhook source + lead context 订阅造出一条 `delivered` delivery，outbox
  `external:<triggerId>` 置为 `sent`（合成 Pod，避免真的 prompt Lead）。
- 无 token 调 `POST /api/event-deliveries/:id/read` → **403**。
- human token 调 read → 200 `{ delivery.state: 'read' }`；outbox `read_at` 同步。
- human token 调 answer → 200 `{ delivery.state: 'answered' }`；outbox `answered_at` 同步。
- 验收发现 `read → answered` 被状态机拒绝（409）；已补转移并加测试（`90a5b76f`）。
- 清理后 source / delivery / outbox 残余均为 0；重启日志无新增 ERROR。

## 边界

- **review 修复**：Standing Goal 仍用 trigger 的 `kind`（`pr_opened` 等过滤语义不变），
  内容取 `external.*` 事件的 `payload.data`；大 payload（`dataOmitted`）回退 trigger。
- Desktop preload 补齐 `events.readDelivery` / `events.answerDelivery`；SDK
  `EventDeliveryView` 增补 `triggerId` / `subscriptionId` / `readAt` / `ackAt`。
- `domainEventForTrigger` 校验 `payload.triggerId` 与 trigger 一致，防止串线程。- `answered` 不存回答正文：delivery 只有状态与时间戳；正文属于外部 thread，当前不落库。
- ack 无法由人类补写；如果 Lead 没回合，delivery 会停在 delivered/read。
- Tech Lead 未迁移；它仍依赖 `event_*` 的 trigger/subscription 视图。
- read/answered 路由不广播自定义事件，只有既有 `event.delivery.changed`。

## 回滚

- 删除两条 route catalog + `markReceipt` 注入即撤销 HTTP 面；SDK 方法同步删除。
- 消费者回退：`deliverContext` / `deliverWork` 改回直接用 trigger 字段（保留 helper 无害）。
