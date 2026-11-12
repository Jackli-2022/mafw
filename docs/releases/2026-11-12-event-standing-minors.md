# 2026-11-12 · 事件层 / Standing Goals deferred minors

- **版本**：`v5.1.0` 基础上
- **Commit**：`98c8c232`
- **范围**：P2.4 事件层与 P2.5 Standing Goals 的 review/deferred minors；直接在 `main` 修复

## 交付

- **事件层**
  - 无 Subscription 的 Trigger 现在记为 `filtered`；后续订阅会复活为 `pending` 并重新 fan-out，
    不再丢事件。
  - 同一 thread 的并发 `evaluate()` 共享一个在飞 Promise，避免重复 decision。
  - `ingest` 校验 source 存在且 enabled；禁用来源拒绝写入。
  - 每次 Delivery 状态变化广播 `event.delivery.changed`。
  - 新增 `POST /api/event-threads/:id/close`：线程置 `closed`，已投递/已读/已确认/失败
    Delivery 收口为 `handed_back`，未投递 `pending` 记为 `dropped`。
  - GitHub comments：空 issue number 的评论不再生成 `#0` 线程；补充 bot/畸形评论 cursor 测试。
  - webhook 文档改为 raw-body HMAC 的现状。
- **Standing Goals**
  - `update()` 广播 `standing_goal.updated`。
  - `GET /api/standing-goals/:id/runs` 对未知 id 返回 404。
  - event subscribe/unsubscribe 的异步失败改为 best-effort 日志，不再产生未处理 rejection。
  - 桌面 `StandingGoalsPanel` 单目标 run history 加载失败会显示错误，不再静默折叠为空。
- **桌面**
  - 事件层诊断区移到显式 developer gate 后：`localStorage['mafw-developer-mode']='1'`。

## 门禁

- gateway：**6615 passed / 6615 total**
- SDK：**217/217**
- desktop：**3532/3532**
- root：**112/112**
- gateway `tsc --noEmit`、desktop `tsgo --noEmit`、`electron-vite build` 全部 rc=0
- 本轮新增测试：**9**

## 仍未做（feature / 需产品决策）

- GitHub PR reviews / Actions CI 轮询（需要 per-PR 分页与 Actions API）。
- `comment` / `label` 动作仍为 notify-only（动作传输未接入）。
- 桌面端新建 Standing Goal 表单。
- 手动 `run now` 仍同步等待 triage；未改成 202 + 后台 watcher。
