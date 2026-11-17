# 2026-11-17 · Phase 4：外部事件层统一

- **版本**：`v5.1.0`（行为增强，不升版本号）
- **提交**：`646f4eb2`（external domain events）+ `a0ce91e1`（Lead inbox）+
  `528676d4`（delivery receipts）+ `06d3676b`（死信）+ `0b451132`（lead-context 评估）+
  `badc5170`（outbox payload triggerId）+ `d56f5a60`（review 修复）
- **计划**：`docs/superpowers/plans/2026-11-17-phase4-external-events-unification.md`
- **前置**：`docs/releases/2026-11-16-goal-history-replay.md`（Phase 3）
- **范围**：gateway 事件层；desktop / SDK / runtime 零改动

## 现在

### External → domain log

- `EventLayerService.ingest` 对 `github` / `cron` / `webhook` 追加 `external.*`：
  `external.github.issue`、`external.cron.tick`、`external.webhook.<kind>`。
- `eventId = external:<idempotencyKey>`，`aggregateId = externalKey`；重复投递在
  `event_triggers` 与 `domain_events` 都只留一条，`aggregate_version` 不变。
- append 是 fail-open：日志失败只 `log`，ingest 仍成功；`internal` source 不重复写。

### 一条 Lead 唤醒路径

- evaluator：当线程有 `lead` + `context` 订阅时返回 `accept/report`（否则 context-only
  的外部线程会被 ignore，Lead 永远收不到）。
- `deliverContext` 对外部事件写 `LeadOutbox`：`dedupeKey = external:<triggerId>`，
  payload 带 `triggerId`（receipt 反查用），`[EVENT]` 单条文本 / `[EVENT] N 条待处理` 批量头。
- decision / Pod event / external 共用同一 dispatcher 的 batch、`maxPerHour`、
  `minIntervalMs`、retry 与 p1 保留通道。

### Delivery receipts

- `EventLayerService.markDeliveryReceipt(deliveryId, read|acknowledged|answered)`：
  先校验 `applyDeliveryTransition`，再在**一个事务**里更新 `event_deliveries` 与
  `event_outbox`（`read_at` / `ack_at` / `answered_at`）。
- Lead 会话 `turn.completed` → `markOutboxAckedBySession` 后，
  `ackDeliveriesForSession` 把对应同步到 `acknowledged`（只动 `delivered` / `read`）。
- 无效状态转移抛 `invalid delivery transition`，不写任何一行。
- 找不到对应 outbox 行的 external receipt 会记录
  `[EventLayer] no outbox row matched ...` 警告；decision 通知本来就用 `recordId`，不告警。

### 死信与恢复

- `maxDeliveryAttempts`（默认 5，可用 `MAFW_EVENT_MAX_DELIVERY_ATTEMPTS` 覆盖）：
  第 N 次失败进入 `dropped`，`lastError` 前缀 `dead-letter:`，`nextRetryAt = null`。
- 未达阈值保持 `failed` + 2s→60s 退避；重启后到期的 failed delivery 由
  `retryDueDeliveries` 继续重试。
- boot 时 `resumeIncompleteDeliveries` 也会续跑 pending 的 context / work delivery；
  work 消费者按 trigger id 幂等。

## 测试

- 新增套件：`external-domain-event`、`lead-outbox-external`、`event-delivery-receipts`、
  `event-delivery-deadletter`、`external-lead-wiring`（5 suites / 17 tests）。
- review 修复：
  - `evaluate` 在决策已接受但 delivery 仍 pending 时可恢复（context 模式），并在 boot 时
    用 `resumeIncompleteDeliveries` 扫一遍 pending / 到期 failed 的线程；
  - `delivered → acknowledged` 成为合法转移，ack 同时补 `read_at`；
  - receipt 只命中订阅者自己的 `lead:<podId>` 且 `state='sent'` 的行；
  - 补 fail-open append、receipt 事务回滚、跨 Pod 隔离、pending 重启恢复测试。
- gateway 全量：**1016 / 1016 suites**，**8072 passed / 2 skipped / 0 failed**。
  期间多次全量各有一个既有/并行 flake（`restore-git` 超时、`instance-ownership`、
  `package-host`、`plugin-doctor`、`pod-review-*`），均单独复跑全绿；另有一个并行提交
  引入的 `api-contract` fixture 缺字段，已补 `source` / `clientRef`。
- `tsc`：rc=0；`npm run build`：通过（`dist/release.json` v5.1.0）。

## 真机验收（2026-11-17，gateway pid 59848 / instance 341c5318）

用临时 webhook source + 签名请求验证（结束后清理，残余 0）：

- `POST /api/event-sources` 建 source，`POST /api/event-sources/:id/webhook` 同一
  `x-github-delivery` 两次 → 第二次 `duplicate: true`；DB 里 1 个 thread、1 个 trigger、
  1 条 `external.webhook.issue`（`event_id=external:webhook:<delivery>`）。
- 加一条 `lead` + `context` 订阅（subscriberId 用不存在的 Pod，避免真的 prompt Lead）后
  重复投递触发 evaluate → trigger `accepted`、delivery `delivered`、
  `event_outbox` 出现 `external:<triggerId>`（payload 带 `triggerId`）。
- service 级 receipt（dist 对运行库）：
  - `read` → delivery `read`、outbox `read_at` 落库；
  - 模拟 Lead 回合（`sentSessionId` + `ackAt`）→ `ackDeliveriesForSession` = 1，
    delivery `acknowledged`、outbox `ack_at` 同步；
  - `answered` → delivery `answered`、outbox `answered_at` 同步。
- 清理后 outbox/source 残余均为 0；日志无新增 ERROR。

## 边界

- read/ack/answered 的 **HTTP 路由与 SDK 契约未做**：本阶段只有 service 级 API，
  客户端接入需要单独的 API 计划（route catalog / schemas / SDK / 桌面按钮）。
- 外部事件 payload 超过 16 KB 时 domain event 只记 `dataOmitted: true` + `dataBytes`，
  不存原文。
- 订阅机制未改：外部事件的线程/订阅/决策仍由 `event_*` 承担，Tech Lead evaluate 语义不变；
  domain log 是统一事实面与 Lead inbox 入口，不是订阅消费者的唯一来源。
- `event_deliveries` 的 read 目前没有真实触发源（人看到外部事件没有客户端信号）；
  ack 由 Lead 回合驱动，answered 留给后续 UI。
- 死信阈值默认 5，`MAFW_EVENT_MAX_DELIVERY_ATTEMPTS` 可覆盖（没有 API 入口）。

## 回滚

- 不注入 `domainEvents`、不调用 `enqueueExternal` 即回到旧行为；新表/列是 additive。
- delivery receipt 是 service 级调用，旧路径不受影响。
- 死信只影响连续失败的 delivery；回滚代码后 failed 行会继续按旧逻辑重试。
- 回滚注意：Phase 4 的部分 `kernel.ts` 接线曾被并行提交 `6c156d96` 卷入；回退时应按
  内容删除 `deliverContext` 的 external 分支与 `renderExternalEvent` 引用，不要直接
  revert 该提交（它同时包含无关的 memory 改动）。
