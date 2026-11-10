# 2026-11-10 · P2.4 事件层

- **分支**：`feat/p2.4-event-layer`
- **基础**：`main` `6a39dc17`（P2.4/P2.5 计划提交）
- **Spec**：`docs/superpowers/specs/2026-11-10-event-layer-design.md`
- **Plan**：`docs/superpowers/plans/2026-11-10-event-layer.md`
- **Head**：待 task-9 提交后填入

## 交付

- 8 张表：`event_sources` / `event_threads` / `event_triggers` / `event_subscriptions` /
  `event_decisions` / `event_deliveries` / `event_channels` / `event_outbox`，由
  `ensureEventLayerSchema` 统一建表。
- `EventStore`：idempotent Trigger、Thread 归并、Subscription upsert、Decision、Delivery、
  Channel、Outbox。
- `EventLayerService`：ingress → fan-out → evaluate → delivery；`admitIngress` person 优先 +
  queue/token 背压。
- `normalizeGitHubEvent` / `normalizeCronTick` / `normalizeInternalEvent`。
- GitHub poller：issues/PRs + comments、labels/branches/authors 过滤、cursor 最后前进。
- Delivery 状态机（2s→1min 重试）与 Channel outbox（5s→300s）。
- 10 个 HTTP 路由 + RouteRegistry/SDK；桌面 Config → Gateway 的只读事件层诊断。
- 集成测试：PR opened → thread → work delivery → accept → delivery audit。

## 开关

- `MAFW_EVENT_LAYER=1` 启用；默认关闭（路由 503）。
- GitHub source 独立启用；webhook 需要 source config `secret`。

## 门禁

- gateway：**6018/6018**（771 suites，`--testTimeout=30000`）
- SDK：**205/205**
- desktop：**3202/3202**
- root：**112/112**
- gateway tsc / desktop tsgo / electron-vite build rc=0

## 暂缓

- PR reviews / Actions CI 轮询（per-PR 分页 / Actions API）。
- Webhook raw-body HMAC（当前按 JSON.stringify 计算）。
- Tech Lead 真实 evaluator 由 P2.5 Standing Goals 接入；P2.4 默认只 accept work 订阅。
