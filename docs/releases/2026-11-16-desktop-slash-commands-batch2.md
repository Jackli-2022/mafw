# 2026-11-16 · Desktop 标准 Slash 指令（第二批）

- **版本**：desktop `5.1.0`（未 bump）
- **Commit**：`7c36ac8e`（功能提交）
- **范围**：Desktop Chat `/` 本地命令

## 交付

- 新增 `/rename`：`RenameSessionDialog` 输入浮层，写 `sessions.rename` 并更新 workspace store。
- 新增 `/help`：`ChatHelpOverlay` 列出当前本地命令与快捷键，Esc / 点背景 / 关闭按钮可关。
- 新增 `/init`：发送固定 `INIT_AGENTS_PROMPT`，要求保留已有 `AGENTS.md` 且不提交 git。
- 新增 `/clear`：新建会话并保留当前会话，复用 `createSession`。

## 验证

- desktop 全量：**3876 / 3876**（737 suites）
- 本轮新增测试：**5**
  - `tests/slash-command-batch2-wiring.test.ts`：4
  - `src/renderer/mafw/chat/init-prompt.test.ts`：1
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 边界

- 未新增 gateway 路由、runtime contract surface 或 capability。
- `/rename` 不支持 `/rename <title>` 参数直传，统一走浮层。
- `/clear` 只新建会话，不删除或清空当前会话历史。
