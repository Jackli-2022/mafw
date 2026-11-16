# Chat 决定板移除（2026-11-16）

- Commit: `f185559b`（`refactor(desktop): remove chat decision board`）
- 背景：用户反馈 chat 顶部的「决定」大卡片应当由 Lead 在对话里主动说明，而不是把
  attention / 决定记录拉成一张卡片放在 transcript 上方。

## 变更

- 删除 `packages/desktop/src/renderer/mafw/components/DecisionBoard.tsx`、
  `decision-board.css` 与对应 wiring tests；`ChatPane` 不再挂载决定板。
- 移除 `ChatPane` / `MafwShell` 的决定板 props 与 `handleDecisionAction`；
  `MafwShell` 不再向 ChatPane 传 `decisionBoard` / `decisionRecords`。
- `EpisodeHeader` 移除「查看决定记录」按钮；episode 关闭并记录决定仍保留，
  toast 改为「已起草决定记录」，不再指向决定板。
- 保留 `decisionStore` 与 `DecisionRecordCard`：rail Pod badge 与 Goal 详情
  继续使用同一份 attention / 记录数据；Goal 级记录仍可在 Goal 详情确认 /
  搁置 / 重开。

## 验证

- Desktop 全量：**3868 passed / 0 fail**（736 suites）。
- `desktop tsgo --noEmit -p tsconfig.json`：0。
- `electron-vite build`：通过；dev 与 packaged 窗口 reload 后
  `document.querySelectorAll('.mafw-decision-board').length === 0`。
- 净删除 6 个只覆盖决定板的测试；新增「chat 不再渲染决定板」守卫，
  并保留 Goal 计划入口 / 框 revision badge 的接线断言。

## 未做

- Lead 主动在 chat 里播报决定（draft / 待确认）尚未实现；本次只移除卡片，
  决定记录仍由 Goal 详情与 Lead 工具承接。
