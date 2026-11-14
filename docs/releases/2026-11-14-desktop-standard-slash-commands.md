# 2026-11-14 · Desktop 标准 Slash 指令（首批）

- **版本**：desktop `5.1.0`（未 bump）
- **Commit**：`0b8cee6d`（功能提交）
- **范围**：Desktop Chat `/` 本地命令

## 交付

- 新增 `/compact` `/export` `/fork` `/usage` `/permissions` `/diff` `/skills`
  `/undo` `/redo` `/plan` `/build` `/details` 12 条本地命令。
- 新增 `runLocalCommand()`：选中本地命令后清空 composer、清草稿、关选择器。
- preload 暴露 `sessions.summarize`，底层复用既有 `POST /api/session/:id/summarize`；
  `/compact` 先检查 `session.summarize` 能力，失败文案保持中性。
- `/plan` / `/build` 只消费 `MafwAgent.planning` / `MafwAgent.default`，并复用
  Lead / Creator Agent 锁定与忙时切换确认。

## 验证

- desktop 全量：**3862 / 3862**（735 suites）
- 本轮新增测试：**7**（`tests/slash-commands-wiring.test.ts` 6 + `session-config-menu-model.test.ts` 1）
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 边界

- 未新增 gateway 路由、runtime contract surface 或 capability。
- 未实现 `/rename` `/help` `/init` `/clear`；未动 hooks/sandbox/share/@web/inline edit。
