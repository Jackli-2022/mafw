# 2026-11-15 · Chat 内联评审项与话题边界卡

- **版本**：`v5.1.0`（交互行为修订，不升版本号）
- **提交**：`153e6c32`（P3 + P4）、`1519bcac`（边界卡 topic scoping）、`b5a267db`（latest topic / review 上下文守卫）
- **范围**：desktop Chat；gateway / SDK / 运行时契约零改动
- **前置**：`docs/releases/2026-11-15-agent-native-chat-intent.md`（P1 + P2）

## P3：Tech Lead chat 内联评审项

- 当前 tab 是 Goal 的 Tech Lead 讨论、且该 Goal 仍 `active` 时，composer 上方显示最多 3 条未解决
  评审项（`visibleChatReviewItems`）。已解决项不占 chat 空间，仍在左栏「改动」面重开。
- 复用 `PodReviewItems`：`pending` / `responded` 可「确认解决」，`responded` 可「重新打开」。
  两个动作都只由人点击，Agent 仍只能标记「已回应」。Goal 已验收时 `accepted` 会隐藏动作。
- 数据：`pod.reviewItems(podId, goalId, {})`；`reviewRefreshKey` 绑定
  `podStore.reviewRevision()`；确认 / 重开后本地 tick 重拉。切换 session / Goal 时先清空列表，
  避免旧 Goal 的评审项在新上下文里可点。
- 超过 3 条时显示「还有 N 条未解决」和「在改动面查看全部」；后者先把 workbench Goal 切到
  当前 Tech Lead 的 Goal，再打开 review section。

## P4：Lead chat 内联话题边界

- Lead chat 内联 `BoundaryCard`：只显示当前话题（`topicItems[0]`，与 `latestForProject` 同序）
  且 `status === "proposed"` 的边界；**先按 topic 过滤再截断 2 条**，其他话题的提议不会占位。
- 动作：**分开**（accept）/ **合并**（merge）/ **忽略**（undo），复用
  `lead.boundaries.*` 与既有 `boundaryAction`；项目切换后清空 topic 信号，动作前校验
  `boundary.projectDir === currentProject()`。
- 数据刷新：进入 Lead 会话时拉一次；Lead 消息发送成功后立即拉一次，并在 1.5s 后再补一次
  trailing read（boundary 写入是异步的），两者都经过 10s 节流 / 项目守卫。
- 默认 `MAFW_LEAD_AUTO_BOUNDARY=observe` 不广播 `topic.boundary.proposed`，所以这里用
  `lead.topics.list` + 每个 topic 的 `boundaries` 拉取，而不是依赖 SSE。

## 测试与门禁

- desktop 全量：**3876 / 3876** pass（736 suites）
- 新增 9 个用例：
  - `chat-review.test` 2（过滤 / 截断 / 计数）
  - `chat-review-inline-wiring` 2（chat 内联 + shell 接线）
  - `boundary-card.test` 3（proposed 过滤 / trigger 文案 / 先过滤后截断）
  - `boundary-card-wiring` 2（Lead 内联 + 刷新节流 / 项目守卫）
- `npx electron-vite build`：rc=0
- `npx tsgo --noEmit -p tsconfig.json`：本轮被并行进行的 plugin 改动阻断
  （`PluginDoctorReport` / `PluginAuditEvent` / `PluginSafetyResult` 等未导出）；本变更涉及
  `ChatPane` / `MafwShell` / `chat-review` / `boundary-card` / `BoundaryCard` 文件无类型错误。
- 未 push、未合并远端。

## 仍未做

- `HandoffCard`：自由讨论检测到工作意图时由 agent 提议交接；当前仍用 header 的「交给 Lead」。
- 窄分屏 header 按钮拥挤；`标记 Episode` 仍占一个标题栏位。
- overlay 的完整 focus trap。
