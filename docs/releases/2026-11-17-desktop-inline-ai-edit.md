# 2026-11-17 · Desktop AI 内联编辑

- **版本**：desktop `5.1.0`（未 bump）
- **Commit**：`c19b9f0c`
- **范围**：Desktop 编辑器选区工具栏 / AI 编辑 sheet

## 背景

编辑器已有选区、引用、批注和行内 diff，但选中代码后没有“直接让 agent 改这段”的入口。
本轮补成 Cursor/Copilot 式 inline edit 的第一版。

## 交付

- 源码选区浮动 toolbar 增加 `AI 编辑`（预览面不显示）。
- 新增 `InlineEditSheet`：选中代码 + 文件/行号 + 指令输入，快捷动作：
  重构、修 bug、补注释/类型、优化命名；Ctrl/⌘↵ 发送，Esc 取消。
- 编辑器有选区且焦点在编辑器内时，`Ctrl/Cmd+K` 直接打开 AI 编辑；没有选区时仍走全局搜索。
- 提交通过 `buildInlineEditPrompt()` 生成带文件、行范围、选中代码、修改要求和边界的 prompt，
  走既有 `sessions.promptAsync`；agent 修改文件后由编辑器 watcher 回显 diff。
- Desktop 不直接应用模型返回的代码文本，避免绕过 agent 工具/权限与文件写盘链。

## 验证

- desktop 全量：**3998 / 3998**（759 suites）
- 本轮新增测试：**4**
  - `editor/inline-edit.test.ts`：1（prompt 内容与边界）
  - `tests/inline-edit-wiring.test.ts`：3（toolbar / sheet / shell 发送路径）
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 边界

- 第一版是“发一个带选区上下文的 agent 回合”，不是悬浮式逐字补全/直接替换。
- 若 runtime 不支持编辑工具或权限被拒，agent 会回复说明，文件不会被修改。
- 未新增 gateway/runtime contract。
