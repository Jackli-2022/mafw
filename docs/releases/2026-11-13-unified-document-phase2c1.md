# 2026-11-13 · 统一文档 Phase 2C-1（web tab 拥有权）

- **版本**：`v5.1.0`
- **Commit**：`51d5ee70`
- **范围**：Phase 2C 的第一段；文件 tab 元数据迁移（2C-2）未做

## 交付

- 新增 `documents/browser-documents.ts`：web tab 集合、active id、open / close / close-other /
  close-right / update、`browser-tab-N` seq 全部归 document 层。
- `browser-tabs.ts` 退化为兼容 facade：
  - 旧命名 `BrowserTab` / `browserTabs` / `activeBrowserTabId` / `openBrowserTab` 等继续可用；
  - `BrowserDock`、`browser-tabs-persistence`、`document-frame-model`、`MafwShell` 无需改调用面。
- `document-tabs-store` 通过模块级 `createRoot` + `createEffect` 自动把
  `browserDocuments()` 同步成 web entries；
  - `BrowserDock` 不再调用 `syncWebTabs`；
  - 打开 / 关闭 web tab 会立即增删统一 strip 条目；
  - active web 被关闭时，document store 自动清掉 stale active id。
- 文档顺序持久化、浏览器 tab 持久化、恢复逻辑保持不变。

## 测试

- desktop 全量：**3757 / 3757**（727 suites）
- 本轮新增测试：**1**（`document-tabs-store.test.ts`：browser documents 自动增删 web entries、
  关闭 active web 清空 active id）
- 扩展 wiring 断言：`BrowserDock` 不再包含 `syncWebTabs`；document store 包含
  `browserDocuments()` / `createEffect(syncBrowserDocuments)`。
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 实机确认

fresh built app（CDP 9224）：

- 打开文件 + `https://example.com`：统一 strip 出现 web tab，toolbar 仍只有 1 个。
- 关闭 web tab：strip 立即只剩文件 tab，`mafw-browser-tabs:v1` 变空，
  `mafw-document-list` 顺序同步移除 web id；无 error overlay。
- 文件 tab / web tab 的拖拽、持久化、恢复路径未受影响。

## 边界与后续

- **2C-2**：`EditorModel` 的 tab 元数据（root / rel / 顺序 / active / dirty / preview /
  readOnly）迁入 document 层；`editor-state` 只保留内容 / conflict reducer。
- **2C-3**：删除 `browser-tabs` / `editor-model-store` 兼容 facade，统一 file / web document
  record 类型。
- 2C-2 / 2C-3 需要单独迁移 spec + 回滚设计；本轮未触碰文件内容、草稿、webview 生命周期。
- E6 未触碰。
