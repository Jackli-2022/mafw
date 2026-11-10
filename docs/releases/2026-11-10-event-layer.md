# 2026-11-10 · P2.4 事件层

- **分支**：`feat/p2.4-event-layer`
- **基础**：`main` `6a39dc17`（P2.4/P2.5 计划提交）
- **Spec**：`docs/superpowers/specs/2026-11-10-event-layer-design.md`
- **Plan**：`docs/superpowers/plans/2026-11-10-event-layer.md`
- **Head**：`c48c32e1`（P2.4 tasks 1–9 + review fix pass；合并 main 后为 `1fd9df9e`）

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

- gateway：**6030/6030**（772 suites，`--testTimeout=30000`）
- SDK：**205/205**
- desktop：**3202/3202**
- root：**112/112**
- gateway tsc / desktop tsgo / electron-vite build rc=0

## Review fix pass

- Source API no longer returns `config`（token/secret）；PATCH source / DELETE subscription 对未知 id 返回 404。
- Delivery 失败会记录 `attempts` / `lastError` / `next_retry_at`，到点重试；outbox 的 `failed` 行也会在
  `nextRetryAt` 后重新进入 `pending()`。
- `fanOut` 在没有订阅时保留 pending，后续订阅仍能取到事件；`unavailable` 决策保留批次供下次重评。
- GitHub comments 不再套用 PR labels 过滤。
- Webhook 使用 raw body 计算 HMAC，并在 registry 层跳过 apiToken（由 HMAC 认证）。
- Index 在 ingest 后调用 fanOut/evaluate；P2.4 的 work handoff 广播 `event.delivery.work`，P2.5 接入真实执行。
- 内部 eventBus 新增 memory 事件；事件层路由/诊断仍默认关闭。

## 暂缓

- PR reviews / Actions CI 轮询（per-PR 分页 / Actions API）；normalizer 已支持 `pr_review` / `ci_status`。
- `filtered` disposition、`event.delivery.changed` 事件、thread 关闭后的 handed_back 收口。
- P2.5 Standing Goals 的真实 Tech Lead evaluator / GoalRun 执行。
