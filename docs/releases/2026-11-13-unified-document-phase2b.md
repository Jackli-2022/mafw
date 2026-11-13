# 2026-11-13 · 统一文档 Phase 2B（toolbar 注册）

- **版本**：`v5.1.0`
- **Commit**：`68e4754c`（registry + plan）、`2637b0df`（DocumentStage 渲染 toolbar）、
  `8b260b60`（编辑器注册）、`a6c24571`（浏览器注册）、`5acba3ff`（空白浏览器 tab 修复）
- **范围**：Phase 2 的第二段；不做 `EditorModel` / `BrowserTab` 详细状态迁移（2C）

## 交付

- 新增 `document-toolbar-registry`：按 `DocumentTabKind` 注册 provider（`ariaLabel` +
  `leading / center / trailing` render functions）；unregister 只移除自己那一份。
- `DocumentStage` 根据 active kind 取 provider，渲染 **唯一一份** `DocumentToolbar`；
  两个 body 的 toolbar 不再各自挂在 pane 里。
- `EditorDock` / `BrowserDock`：
  - toolbar JSX 抽成 `toolbarSlots`，在 `onMount` 注册并 `onCleanup` 注销；
  - embedded 分支只返回 body，不再渲染 `DocumentFrame` / 自己的 toolbar；
  - 非 embedded 分支仍保留 `DocumentFrame + DocumentToolbar`，避免堵死未来独立使用；
  - 浏览器 body 在 embedded 时自己挂 `onContextMenu`，保持空白区右键菜单。
- 修复统一 toolbar 暴露的回归：`打开浏览器` 命令先 `openBrowserTab("")` 创建空白 tab，
  再聚焦 web subject；地址栏在 active web tab 下始终可见、可输入。
- tab 选中 / 切换时 toolbar 立即换内容（编辑器 ↔ 浏览器），body 不重挂载，webview 不重载。

## 测试

- desktop 全量：**3755 / 3755**（726 suites）
- 本轮新增测试：**5**
  - `document-toolbar-registry.test.ts`：3（注册 / 注销 / 替换 / reset）
  - `document-stage-wiring.test.ts`：1（DocumentStage 渲染 registry toolbar）
  - `unified-document-wiring.test.ts`：1（浏览器命令创建空白 tab）
- 扩展既有 wiring 断言：EditorDock / BrowserDock 的 `registerDocumentToolbar`、
  `if (props.embedded) return body`、浏览器 embedded 右键菜单。
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 实机确认

fresh built app（CDP 9224）：

- 文件 + 网页混合 tab 下，DOM 中始终只有 **1** 个 `.mafw-document-toolbar`。
- 文件 active：`编辑器工具栏`，保存 / 外部编辑器 / Markdown 预览按钮可见；编辑器 body
  高度正常（550px）；点击 Markdown 预览 `aria-pressed` 在 true / false 间切换。
- 网页 active：`浏览器工具栏`，后退 / 前进 / 刷新 / 点选元素 / 系统浏览器打开可见；
  地址栏显示 `https://example.com/`，在其中输入 `https://example.org` 并 Enter 后，
  tab 与 webview 都更新到新 URL。
- 关掉 web tab 后执行 `打开浏览器`：出现 `新标签页` blank tab 并成为 active，浏览器 toolbar
  与空地址栏立即出现；输入 `https://example.net` 后正常加载。
- 切换文件 / 网页时 webview 元素保持（标记未丢），无 error overlay。

## 边界与后续

- **2C**：`EditorModel` / `BrowserTab` 详细状态迁入 document store 未做；文件内容 / dirty /
  conflict / 草稿仍由 `editor-state` / `editor-drafts` 持有，webview 生命周期仍由 browser
  view registry 持有。
- toolbar slot 是渲染函数注册，不是逐按钮 action descriptor；如果后续要插件向 toolbar 注入
  动作，再在 registry 上扩展 action 层。
- E6 worktree / `feat/gateway-e6-interaction-model` 未触碰。
