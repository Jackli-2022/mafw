# 2026-11-17 · Phase 4：外部事件层统一

- **版本**：`v5.1.0`（行为增强，不升版本号）
- **提交**：`646f4eb2`（external domain events）+ `a0ce91e1`（Lead inbox）+
  `528676d4`（delivery receipts）+ `06d3676b`（死信）
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

- `deliverContext` 对外部事件写 `LeadOutbox`：`dedupeKey = external:<triggerId>`，
  `[EVENT]` 单条文本 / `[EVENT] N 条待处理` 批量头。
- decision / Pod event / external 共用同一 dispatcher 的 batch、`maxPerHour`、
  `minIntervalMs`、retry 与 p1 保留通道。

### Delivery receipts

- `EventLayerService.markDeliveryReceipt(deliveryId, read|acknowledged|answered)`：
  先校验 `applyDeliveryTransition`，再在**一个事务**里更新 `event_deliveries` 与
  `event_outbox`（`read_at` / `ack_at` / `answered_at`）。
- Lead 会话 `turn.completed` → `markOutboxAckedBySession` 后，
  `ackDeliveriesForSession` 把对应同步到 `acknowledged`（只动 `delivered` / `read`）。
- 无效状态转移抛 `invalid delivery transition`，不写任何一行。

### 死信与恢复

- `maxDeliveryAttempts`（默认 5）：第 N 次失败进入 `dropped`，`lastError` 前缀
  `dead-letter:`，`nextRetryAt = null`。
- 未达阈值保持 `failed` + 2s→60s 退避；重启后到期的 failed delivery 由
  `retryDueDeliveries` 继续重试。

## 测试

- 新增套件：`external-domain-event`、`lead-outbox-external`、`event-delivery-receipts`、
  `event-delivery-deadletter`（4 suites / 10 tests）。
- gateway 全量：**1009 / 1009 suites**，**8022 passed / 2 skipped / 0 failed**。
  前两次全量各有一个既有 flake（`checkpoint/restore-git` 超时、`runtime/instance-ownership`），
  两个套件单独复跑均全绿。
- `tsc`：rc=0；`npm run build`：通过（`dist/release.json` v5.1.0）。

## 边界

- read/ack/answered 的 **HTTP 路由与 SDK 契约未做**：本阶段只有 service 级 API，
  客户端接入需要单独的 API 计划（route catalog / schemas / SDK / 桌面按钮）。
- 订阅机制未改：外部事件的线程/订阅/决策仍由 `event_*` 承担，Tech Lead evaluate 语义不变；
  domain log 是统一事实面与 Lead inbox 入口，不是订阅消费者的唯一来源。
- `event_deliveries` 的 read 目前没有真实触发源（人看到外部事件没有客户端信号）；
  ack 由 Lead 回合驱动，answered 留给后续 UI。
- 死信阈值固定 5，暂不可配置（deps 可注入，但没有 env/API 入口）。
- 外部事件 payload 原样进 domain event（审计），大 payload 会放大 `domain_events`；后续可按需裁剪。

## 回滚

- 不注入 `domainEvents`、不调用 `enqueueExternal` 即回到旧行为；新表/列是 additive。
- delivery receipt 是 service 级调用，旧路径不受影响。
- 死信只影响连续失败的 delivery；回滚代码后 failed 行会继续按旧逻辑重试。
