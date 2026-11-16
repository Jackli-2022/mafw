# 2026-11-16 · Lead inbox 统一：PodEventWake 只入 LeadOutbox

- **版本**：`v5.1.0`（行为修复，不升版本号）
- **提交**：`0a72c7a8`（outbox payload）+ `8fe22f46`（PodEventWake producer / kernel）+
  `ea9d2490`（scan-time A2A dedupe）+ `9da7dbbc`（dispatch-time A2A dedupe + p1 lane）
- **范围**：gateway Lead 唤醒路径；desktop / SDK / runtime 零改动
- **前置**：`docs/releases/2026-11-16-goal-failure-routing.md`

## 问题

Lead 有两条唤醒路径：

- decision draft → event layer `deliverContext` → `LeadOutbox`；
- Pod event → `PodEventWake` → 直接 `promptAsync`。

两条路径各自做预算/去重/重试，互相不知道对方是否已经叫过 Lead；同一事件可能重复触达，
也无法统一 pause/resume、batching、审计。

## 现在

- `PodEventWake` 只做 **outbox producer**：
  - 每个 pending `pod_events` 行写成 `event_outbox` 的 `pod-event:<eventId>`；
  - channel 仍是 `lead:<podId>`；
  - `wake_state='delivered'` 只表示 **已入 outbox**（`wake_session_id='outbox:<id>'`），
    不代表 Lead 已收到。
- `LeadOutbox` 是唯一 Lead dispatcher：
  - decision 与 pod-event 共用 batch / retry；
  - **p1 保留通道**：有 p1 时，即使小时预算或最小间隔已到，也优先发 p1；
    没有 p1 时才按常规预算/间隔；
  - 多条消息合并：mixed/decision → `[LEAD EVENT] N 条待确认`；全 pod-event →
    `[POD EVENT] N 条待处理`；单条保持原文。
  - pod-event payload 带 `messageId`；dispatch 前再次检查 A2A 是否已送达，
    已送达则直接 `sent`、不再 prompt；成功 prompt 后 `commitDelivered` 回写镜像消息状态。
- kernel 的 `PodEventWake` 不再持有 `promptAsync` / Lead session / busy / suspended /
  delivery 去重逻辑；只保留 `pendingWakes`、`isPodPaused`、`markWakeQueued`、`enqueue`。
- 失败 enqueue 保持 pending，下一次 scan 重试；durable outbox 按 `eventId` 去重。
- 保留 A2A 已投递短路：如果镜像 `pod_message` 已经由 A2A 送达 Lead，则只把
  `wake_state` 标成 `delivered`（`wake_session_id='a2a:<messageId>'`），不再入 outbox，
  避免同一成员消息二次触达。

## 测试

- 定向：`tests/unit/lead` + `pod-event-wake` + `pod-event-service` = **28 suites / 147 tests**。
- gateway `tsc`：rc=0。
- gateway 全量：**988 / 988 suites**，**7895 passed / 2 skipped / 0 failed**。
- Phase 1 定向套件 `tests/unit/lead` + `pod-event-wake` + `pod-event-service`：
  **28 suites / 147 tests** 全绿。

## 边界

- `wake_state='delivered'` 语义变了：现在是“已入 outbox”，不是“已发 Lead”；真实发送看
  `event_outbox.state`。
- `PodEventWake` 不再因 Lead busy/suspended 跳过事件；事件会排队到 outbox，由 dispatcher
  在 Lead 可用时发送。这样不丢事件，但可能延后。
- dispatch-time A2A 去重仍有极小竞态窗口（检查后 A2A 才提交）；旧路径同样存在，
  彻底消除需要 claim/lease，不在 Phase 1。
- `markWakeDelivered` / `markWakeSuppressed` / `markWakeAttempt` 仍有少量死接口；
  read / ack、agent-set timers、dispatcher watchdog 仍未做。
- 回滚：revert `0a72c7a8` / `8fe22f46`；`pod_events` 表未变，outbox 行 additive。
