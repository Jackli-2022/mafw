# Desktop package notes

- Renderer process should only call `window.api` from `src/preload`.
- Main process should register IPC handlers in `src/main/ipc.ts`.
- Tests: `npm test`（node --test + `@mafw/test-shim`，纯逻辑模块与 src 同目录 `.test.ts`）；CI 入口 root `npm run test:desktop`。
- SSE 事件接线在 `src/renderer/mafw/sse/`（dispatcher + handlers，deps 注入可单测）；会话工作区状态在 `src/renderer/mafw/workspace/session-workspace.ts`（模块单例，MafwShell 别名引用）。
- **Dev CSS 更新不生效排查**（2026-10-26 实证）：整文件替换式编辑在 Windows 上可能被 Vite/chokidar 漏掉变更事件，模块 transform 缓存持续返回旧 CSS——症状是「类名已切换但样式不生效」（如工作台终端收起无效果）。诊断：`fetch('/@fs/<abs>/x.css?direct')` 是新文件、`fetch('/@fs/<abs>/x.css')`（JS wrapper）仍是旧内容。处置：`touch` 该 CSS（更新 mtime）或重启 `npm run dev`，再 reload；构建产物不受影响。
- **ButtonV2 的 classList 对多 token class 不可靠**（2026-10-27 实证）：组件把整串 `class` 当作 classList 的 key，class 含空格时 toggle 失败（`aria-selected` 已生效但 `active` 类没加上）。状态样式优先用语义属性选择器（`aria-selected="true"` / `aria-pressed="true"`），或保证 `class` 只含单 token。
