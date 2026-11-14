# 2026-11-14 · 左栏推挤：两边都放得下才 push

- **版本**：`v5.1.0`（布局行为修订，不升版本号）
- **范围**：desktop 左 dock 的 push / overlay 判定；gateway / SDK / 运行时契约零改动
- **前置**：2026-11-13 的统一 tab 条与 Goal-first 改动面；本次不触碰 tab / 文档数据

## 问题

- split 模式下 `PUSH_PAIR_BUDGET=1490`（760 chat + 730 工作台），默认 dock 264 时窗口要
  **≥1800** 才推挤；默认窗口 1720 永远落在 overlay。
- 窄窗（`available < 1240`）进入 **Chat / Workbench 二选一** 后，仍沿用了 split 的整窗预算：
  1280px 窗口（1920 屏 150% 缩放）永远 overlay，左栏无法推挤。
- 调研结论：push 的判据是“当前可见内容还放得下”，不是“整窗够大”；主流做法是容器宽度 − dock
  后仍满足各栏最小宽度才 push，否则 overlay。

## 现状规则

- `workbenchZoneFor(viewportWidth − 46)` 决定 split / narrow；窄窗不再用“推挤后的 available”
  反推 zone，避免 `leftDockMode ↔ availableWidth` 循环。
- **split**：`requiredMainWidth = PUSH_PAIR_BUDGET (1240 = 520 chat + 720 工作台)`；
  默认 dock 264 → **1550** 可推。默认 1720 窗口现在会 push，chat 实际 690。
- **narrow Chat**：`requiredMainWidth = CHAT_COMFORT_MIN (520)`，默认 dock → **830** 可推。
- **narrow Workbench**：`requiredMainWidth = WORKBENCH_MIN_WIDTH (720)`，默认 dock → **1030** 可推。
- `resolveMode / restoreLeftDockOpen / shouldAutoRestoreLeftDock / effectiveLeftDockWidth /
  leftDockPushDragMax` 全部接收同一个 `requiredMainWidth`；窄窗切到 Workbench 时若放不下，
  左栏会从 push 变成 overlay（切回 Chat 再变回 push）。
- 旧的 1490（760+730）不再作为 push 门槛；它只描述默认 chat 档位，不参与 overlay 判定。

## 结果示例（dock 264）

| 窗口宽 | split | 窄窗 Chat | 窄窗 Workbench |
|---|---|---|---|
| 1720 | push（chat 690 + wb 720） | – | – |
| 1550 | push（chat 520 + wb 720） | – | – |
| 1549 | overlay（chat 760 + wb 743） | – | – |
| 1280 | – | push（剩 970） | push（剩 970） |
| 1000 | – | push（剩 690） | overlay |
| 900 | – | push（剩 590） | overlay |

## 测试与门禁

- desktop 全量：**3861 / 3861** pass（735 suites）
- `left-dock.test` 更新 split 预算 1550 / dragMax / restore 用例，保留窄窗按视图预算用例
- `tests/left-dock-width-wiring.test.ts` 校验 shell 传入 `leftDockRequiredMainWidth()`
- `npx tsgo --noEmit -p tsconfig.json`：rc=0
- `npx electron-vite build`：rc=0

## 边界

- split 在 1550 跨过阈值时，dock 从 overlay 变 push，chat 会从 760 收到 520；这是“dock 参与布局”
  的代价，阈值处会有一次明显收缩。
- 窄窗下左栏仍可能 push / overlay 切换：这是“按当前可见栏算”的预期结果。
- 未改默认窗口 1720；如需在 1720 保持 chat 760，需要把默认窗口加宽到约 1840 或调低 chat 默认档。
- 未 push、未合并远端。
