# 2026-11-16 · Lead outbox dispatcher（决定播报耐久化）

- **版本**：`v5.1.0`（gateway 行为变更，不升版本号）
- **提交**：`e16a1a50`（batch model）、`39cff8f4`（dispatcher）、`eb068633`（kernel 接线）、
  `6229f2aa`（清理未使用的 id factory）、`ed1ff11c`（review 修复：channel 作用域 + shutdown drain）、
  `752ad155`（review minors：失败路径加固 + `markSent` 清理旧错误）
- **范围**：gateway 事件层 + Lead 播报；桌面 / SDK / runtime 契约零改动
- **计划**：`docs/superpowers/plans/2026-11-16-lead-outbox-dispatcher.md`
- **依据**：`docs/research/2026-11-16-always-on-agents-event-layer-research.md` §6 P0

## 现状

- `EventLayerService.deliverContext` 不再直接调用 Lead 的模型 session，只把渲染好的
  `[LEAD EVENT]` 写入 `event_outbox`：每个 Pod 一个 `chat` channel（`lead:<podId>`），
  去重键 `decision:<recordId>`。
- `LeadOutbox` dispatcher 每 5s 取 pending（含到期 failed），按 channel 批量合并：
  优先级 p1 → p2 → p3，再按 createdAt；`maxBatch=5`、`maxPerHour=6`、两批最小间隔 60s。
- 成功逐行 `sent`；失败逐行 `failed`，沿用 `EventOutbox.markFailed` 的 5s→300s 退避。
  预算 / 最小间隔只延迟，不丢弃；重启后 pending 与到期 failed 继续发送，已 `sent` 不重发。
- 单条决定保持原文；多条合并为 `[LEAD EVENT] N 条待确认` + 编号块（带 recordId）。
- P0 明确不做：`PodEventWake` 合并、read / ack、agent-set timers、watchdog、per-run memory。
- dispatcher 只处理 `lead:*` channel，其他生产者的 outbox rows 原样保留；kernel shutdown
  在关闭 DB 前等待在飞 dispatch（`isIdle`，5s 上限）。
- 失败路径加固：`markSent` 部分失败时已 `sent` 的行保持 `sent`，只重试剩余行；`failRows`
  逐行兜底，单行/单 channel 失败不会中断其他 channel；`markSent` 清空旧 `lastError` /
  `nextRetryAt`；`status()` 统计 `dropped`。

## 实现

- `gateway/src/core/lead/lead-outbox-model.ts`：payload 校验、批量选择（预算/间隔/优先级/
  时间/maxBatch）、合并渲染。
- `gateway/src/core/lead/lead-outbox.ts`：channel ensure、`enqueueDecision`、单飞 `dispatch`、
  `start` / `stop`（`TimerService.every('lead:outbox', 5000, …)`）、`status`。
- `gateway/src/kernel.ts`：构造并启动 `LeadOutbox`；`deliverContext` 改为 `enqueueDecision`；
  `stop()` 先停 dispatcher 再 dispose timers。
- `docs/architecture/events.md`：Decision → Lead 播报改为 outbox 路径，记录预算与 P0 边界。

## 测试

- 新增 21 个测试：
  - `gateway/tests/unit/lead/lead-outbox-model.test.ts`（6）
  - `gateway/tests/unit/lead/lead-outbox.test.ts`（11）
  - `gateway/tests/unit/lead/lead-outbox-wiring.test.ts`（3）
  - `gateway/tests/unit/events/event-outbox.test.ts`（新增 1：`markSent` 清理失败状态）
- 覆盖：payload 拒绝、优先级排序、maxBatch、预算/间隔 defer、合并渲染、去重、批量成功
  全标 sent、失败整批 failed + 退避、并发单飞、非 Lead channel 不被动、`isIdle` 在飞状态、
  timer 幂等、kernel 不再直连 `promptAsync`、shutdown settle 等待在飞 dispatch、
  `markSent` 部分失败不重排已发送行、坏行不阻塞其他 channel、`status` 含 `dropped`。
- 全量门禁（2026-11-16 本次运行）：gateway **984 suites / 7859 passed / 2 skipped / 7861 total**；
  `npx tsc --noEmit -p tsconfig.json` exit 0。

## 真机验证

- `gateway` build 通过，重启到 `6229f2aa`（pid 53956，`/health` ok，commit 匹配）。
- 自检决定 `dec_9eff1cd5-207a-40c7-ada9-70ee9a67728a`（`source=agent`）：
  - `event_outbox` 行 `created_at=05:13:42.254Z`，`state=sent`，`updated_at=05:13:44.445Z`
    （约 2.2s），`attempts=0`，`dedupe_key=decision:dec_9eff1cd5-…`；
  - channel `lead:pod_d7ceb3025dbd`（`kind=chat`）；
  - `event_deliveries` 为 `delivered`；
  - Lead 会话 `ses_e62c4d612ffeMEMsCQq7V3snek` 收到 `[LEAD EVENT]`（`msg_1e2c68902001…`），
    Lead 回复确认“这条 `[LEAD EVENT]` 我确实收到了”；
  - 再等一个 dispatcher tick 后：同 recordId 的 Lead 消息仍为 1 条、outbox 行仍为 1 条；
  - 已用 human token 将自检决定 `shelve`（`reviewAt=2026-11-23`）。
- 最终 build 重启到 `573eb37c`（review 修复后）再等一个 dispatcher tick + 8s：同 recordId
  仍只有 1 条 Lead 消息、outbox 行仍为 `sent`（`attempts=0`），确认 `sent` 不会因重启重发。
- minors 修复后再次 build 重启到 `0dba07ab`：同 recordId 仍为 1 条 Lead 消息、1 条 `sent`
  outbox 行，失败路径加固未改变已发送行的重启语义。

## 部署说明

- 需要重启 gateway 让新 `dist` 生效；重启后不需要迁移数据，复用既有 `event_channels` /
  `event_outbox`，无新表、无新 env。
- 预算计数在进程内（每小时 6 批），重启会重置；`sent` 去重仍生效，因此不会重复播报，
  极端情况下重启后可能比理论预算多发一批。P1 可从 outbox 的 `sent` 时间反推预算。
