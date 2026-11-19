# 用户消息气泡多余空行修复（2026-11-20）

## 问题

ChatView 用户消息气泡底部多一行空白；简单消息如「你是谁」也显示成两行高。

## 根因

- 每轮发送带 synthetic `[[turn:...]]` 文本 part；runtime 可能把 synthetic part 用空行并入用户正文。
- `packages/desktop/src/renderer/mafw/ingest/messages.ts` 的 `stripInjectedUserText` 剥掉 marker 后留下 `\n\n`。
- `UserMessageDisplay` 的 `[data-slot="user-message-text"]` 使用 `white-space: pre-wrap`，尾部换行被渲染成额外空行。

真机 DOM：`"你是谁\n\n"`，气泡高度 73px；预期 `"你是谁"`，47px。

## 修复

- `stripInjectedUserText` 末尾统一 `.replace(/\n+$/, "")`，只去尾部换行，保留正文内部换行。
- 新增 ingest 回归测试：`你是谁\n\n[[turn:turn_abc]]` → `你是谁`（`message.text` / content part / parts 索引三处）。

## 门禁

- Desktop：**803 suites / 4236 pass / 0 fail**（新增 1 条；总数含并发工作）
- `tsgo --noEmit -p tsconfig.json`：0
- `electron-vite build`：0
- 真机：用户消息 text 无尾随换行，气泡高度 73 → 47

## 提交

- `114c66cab` `fix(desktop): trim the turn-marker blank line from user messages`
- 文档：`docs/architecture/desktop.md` 更新
