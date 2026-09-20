# Desktop package notes

- Renderer process should only call `window.api` from `src/preload`.
- Main process should register IPC handlers in `src/main/ipc.ts`.
- Tests: `bun test`（bun:test 风格，纯逻辑模块与 src 同目录 `.test.ts`）；CI 入口 root `npm run test:desktop`。
- SSE 事件接线在 `src/renderer/mafw/sse/`（dispatcher + handlers，deps 注入可单测）；会话工作区状态在 `src/renderer/mafw/workspace/session-workspace.ts`（模块单例，MafwShell 别名引用）。
