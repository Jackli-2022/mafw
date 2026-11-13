# 2026-11-13 · 统一文档 Phase 2C-2（文件模型拥有权）

- **版本**：`v5.1.0`
- **Commit**：`078cded4`
- **范围**：Phase 2C 的第二段；兼容 facade 清理（2C-3）未做

## 交付

- 新增 `documents/file-documents.ts`：按 root 持有 `EditorModel`（root / files / active /
  dirty / preview / readOnly / conflict / content 基准），提供稳定的模型身份与 revision signal。
- `editor-model-store.ts` 退化为兼容 facade：`editorModelFor` / `saveEditorModel` /
  `clearEditorModels` 继续可用，但底层归 document 层。
- `EditorDock`：
  - 不再创建私有 `model` signal，改为读取 `fileModelFor(props.contentRoot)`；
  - `setModel` 把 reducer 结果写回 `file-documents`；
  - 不再调用 `syncFileTabs`，只调用 `configureFileDocumentRoot(contentRoot)`；
  - root / scope 切换时用旧 root 的 canonical model 保存滚动位置与选区；
  - 预览态判断抽出 `previewingFile(file)`，保证切换时用旧文件判断预览/源码。
- `document-tabs-store` 通过模块级 `createEffect` 自动从 `fileModelFor(root)` 派生文件 entries：
  打开 / 关闭 / active / dirty / preview 变化即时反映到统一 strip。
- 文件内容、dirty / conflict reducer 仍在 `editor-state` / `editor-drafts`；webview 生命周期仍在
  browser view registry。

## 测试

- desktop 全量：**3761 / 3761**（727 suites）
- 本轮新增测试：**3**
  - `file-documents.test.ts`：2（root 身份稳定 / 同对象与 null no-op / clear）
  - `document-tabs-store.test.ts`：1（file documents 自动增删、dirty 更新、关闭清空）
- 扩展 wiring 断言：EditorDock 使用 `configureFileDocumentRoot` 且不再包含 `syncFileTabs`；
  document store 包含 `fileModelFor` / `syncFileDocuments`。
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 实机确认

fresh built app（CDP 9224）：

- 打开临时文本文件：统一 strip 自动出现文件 tab，Monaco 显示 `hello`。
- 在编辑器中输入 ` world`：tab 立即出现 dirty 点。
- 点击保存：dirty 点消失，磁盘内容更新为 `hell worldo`（证明 canonical model 与 reducer 写回）。
- 关闭 tab：strip 立即移除，`mafw-document-list` 顺序同步清空。
- reload：文件 tab 与内容恢复，toolbar 仍只有 1 个；无 error overlay。
- 临时文件已删除。

## 边界与后续

- **2C-3**：删除 `browser-tabs` / `editor-model-store` 兼容 facade；如需要，把 `savedContent`
  从 tab record 拆到独立内容层，统一 file / web document record。
- 本轮未改 webview sandbox / preload、草稿合并算法、保存冲突处理。
- E6 未触碰。
