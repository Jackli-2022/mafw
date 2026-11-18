# 2026-11-18 · 失败投递重试 + Lead 外部事件回执卡片

- **版本**：`v5.1.0`（行为增强，不升版本号）
- **提交**：`a2c40305c`（gateway timer）+ `418dd4419`（desktop card）+
  `f5b21c5f9`（docs）
- **前置**：`docs/releases/2026-11-17-receipts-and-domain-consumers.md`

## 现在

### Delivery 退避重试定时器

- 新增 `event:delivery-retry` timer，每 30s 调一次
  `EventLayerService.resumeIncompleteDeliveries()`（`event-delivery-retry.ts`）。
- 带 in-flight guard：上一轮 sweep 未结束时跳过本轮；失败只记日志，不把
  timer 卡死。
- 补上此前的可靠性缺口：delivery 失败后不再只能等「该线程有新事件」或
  「gateway 重启」才重试；5s→300s 退避现在按 30s 粒度兑现。
- `kernel-timers` 的长驻 interval 台账从 6 条更新为 7 条。

### Lead 外部事件回执卡片

- Lead 会话 composer 上方新增折叠卡片：只显示当前 Pod 的 Lead 外部投递，
  最多 5 条，来源限定 `github` / `webhook` / `cron`（internal 线程不进入）。
- 展开卡片时对可见的 `delivered` 投递写一次 `read`（同一 delivery 只写一次，
  新增投递在展开态下也会补 read）。
- 每条有「已回答」按钮，写 `answered`；完成后该行变灰、标题划线，全部完成后
  卡片头部变绿 `外部事件 · 已全部处理`。
- Lead 聊天回复不算 `answered`：它回的是 Lead，不是外部线程；只有卡片按钮
  写回执。
- 刷新时机：进入 Lead tab / project 或 Pod 变化 / 操作完成后。没有新增
  `event.delivery.changed` SSE handler（桌面目前没有事件层 SSE 分发）。
- 不改 gateway 路由、SDK 或 preload；复用现有
  `events.threads/subscriptions/deliveries/readDelivery/answerDelivery`。

## 测试

- gateway 全量：**1038 / 1038 suites**，**8286 passed / 2 skipped / 0 failed**。
- desktop 全量：**776 / 776 suites**，**4098 passed / 0 failed**。
- 新增测试：
  - gateway 5：`event-delivery-retry-timer` 4 + `event-delivery-retry-wiring` 1。
  - desktop 11：`lead-external-inbox` 8 + `lead-external-inbox-wiring` 3。
- 类型门禁：gateway `tsc` rc=0；desktop `tsgo` rc=0。
- gateway `npm run build` 通过（v5.1.0 / epoch 1）。
- 真机：重启后 `GET /api/kernel/stats` 的 `timers.byName` 含
  `event:delivery-retry: 1`（gateway pid 28300，instance
  `7b1f34e4-08e1-4352-b48d-21032eedffa9`）；临时 webhook source 已清理。
- 全量期间 `recall/exact-evidence` 与 `cli/plugin-standard-command` 各出现一次
  单独复跑全绿的 flake；最终全量干净。

## 边界

- 卡片只扫最近 10 个 open 线程；更老的 pending 投递仍可通过事件层 API 查看。
- `answered` 不存回答正文；`ack` 仍只由 Lead 回合写入，没有人类 HTTP 入口。
- 已读未回答的投递会保留在卡片里，不会因收起消失。
- 卡片只在 Lead 会话渲染；Tech Lead / 其他会话不显示。
- 自动 read 的触发点是「展开卡片」，不是「进入 Lead tab」。

## 回滚

- 删除 kernel 的 `eventDeliveryRetryTimer` 注册 + import + 字段即撤销定时器。
- 删除 ChatPane 的 `<LeadExternalInbox>` + 两个组件 + 样式即撤销卡片；
  gateway / SDK 无需回滚。
