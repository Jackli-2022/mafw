# 2026-11-14 · 左栏窄窗推挤按当前视图计算

- **版本**：`v5.1.0`（布局行为修订，不升版本号）
- **范围**：desktop 左 dock 的 push / overlay 判定；gateway / SDK / 运行时契约零改动
- **前置**：2026-11-13 的统一 tab 条与 Goal-first 改动面；本次不触碰 tab / 文档数据

## 问题

- split 模式下 `PUSH_PAIR_BUDGET=1490`（760 chat + 730 工作台），默认 dock 264 时窗口要
  **≥1800** 才推挤；默认窗口 1720 永远落在 overlay。
- 窄窗（`available < 1240`）进入 **Chat / Workbench 二选一** 后，仍沿用了 split 的整窗预算：
  1280px 窗口（1920 屏 150% 缩放）永远 overlay，左栏无法推挤。

## 现状规则

- `workbenchZoneFor(viewportWidth − 46)` 决定 split / narrow；窄窗不再用“推挤后的 available”
  反推 zone，避免 `leftDockMode ↔ availableWidth` 循环。
- **split**：`requiredMainWidth = PUSH_PAIR_BUDGET (1490)`，维持原行为（默认 dock 264 → 1800 才推）。
- **narrow Chat**：`requiredMainWidth = CHAT_COMFORT_MIN (520)`，默认 dock → **830** 可推。
- **narrow Workbench**：`requiredMainWidth = WORKBENCH_MIN_WIDTH (720)`，默认 dock → **1030** 可推。
- `resolveMode / restoreLeftDockOpen / shouldAutoRestoreLeftDock / effectiveLeftDockWidth /
  leftDockPushDragMax` 全部接收同一个 `requiredMainWidth`；窄窗切到 Workbench 时若放不下，
  左栏会从 push 变成 overlay（切回 Chat 再变回 push）。

## 结果示例（dock 264）

| 窗口宽 | 窄窗 Chat | 窄窗 Workbench |
|---|---|---|
| 1280 | push（剩 970） | push（剩 970） |
| 1100 | push（剩 790） | push（剩 790） |
| 1000 | push（剩 690） | overlay |
| 900 | push（剩 590） | overlay |

split 模式 1720 仍是 overlay（需要 1800），与 2026-11-04 的 chat 760 默认档一致。

## 测试与门禁

- desktop 全量：**3855 / 3855** pass（735 suites）
- `left-dock.test` 新增窄窗按视图预算的 push / dragMax / restore / effectiveWidth 用例
- `tests/left-dock-width-wiring.test.ts` 校验 shell 传入 `leftDockRequiredMainWidth()`
- `npx tsgo --noEmit -p tsconfig.json`：rc=0
- `npx electron-vite build`：rc=0

## 边界

- 窄窗下左栏仍可能 push / overlay 切换：这是“按当前可见栏算”的预期结果。
- 未改 split 的 1490 预算，也未改默认窗口 1720；如需默认窗口即推挤，需要另议 split 预算或窗口默认宽。
- 未 push、未合并远端。
