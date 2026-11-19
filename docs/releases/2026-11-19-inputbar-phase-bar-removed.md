# 2026-11-19 · 移除输入框上方的「正在生成」提示条

- **版本**：`v5.1.0`（桌面交互变更，不升版本号）
- **提交**：`d7d683d23`
- **范围**：desktop renderer composer 上方；gateway / runtime 契约零改动
- **依据**：dev app live 验证 + desktop 全量测试

## 问题

- composer 上方常驻一条 Perplexity 式 phase bar（「正在处理… / 正在生成…」），占 28px 高度。
- 流式状态在回合内已经有流式光标、发送钮和任务条三处可见，这一行属于重复信息。

## 现状

- 删除 `.mafw-phase-bar` / `.mafw-phase-dot` / `mafw-phase-pulse` 及 ChatPane 里的渲染块。
- 生成阶段管线一并删除：ChatPane `phase` signal、`workspace.phase` 注册表、
  `useSendMessage.setPhase`、SSE chat-stream `d.phase(...)`、MafwShell 桥接。
  没有留下没有消费者的死接线。
- `sending` 行为不变：发送 / 中断 / 回合收束仍由 `setSending` 与 `sendingReset` 驱动。

## 验证

- 新增 **3** 条 `dead-code` 回归：ChatPane 不再渲染提示条、CSS 无残留、phase 管线无残留。
- 更新 2 条已随 UI 删除的 phase bar 设计契约断言（`design-contract`）与
  `visual-language` 的 phase 动效断言；`chat-stream` / `dispatcher` / `use-send-message` /
  `pod-collab-ui-wiring` 的 mock 与断言同步收敛。
- desktop 全量：**4165 pass / 0 fail**（本次净 +1：新增 3、删除 2 条过时断言）。
- `tsgo --noEmit -p tsconfig.json`：通过。
- `electron-vite build`：通过（1m 19s）。
- live：dev app reload 后 `.mafw-phase-bar` 不存在、页面无「正在生成」文本；
  composer 与输入区正常渲染，窗口尺寸保持真实值。
