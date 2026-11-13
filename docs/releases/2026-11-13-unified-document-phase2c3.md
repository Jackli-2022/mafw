# 2026-11-13 · 统一文档 Phase 2C-3（facade 清理）

- **版本**：`v5.1.0`
- **Commit**：`9dbf670c`
- **范围**：Phase 2C 的收尾清理；不改用户可见行为

## 交付

- 删除 `browser-tabs.ts` / `editor-model-store.ts` 兼容 facade。
- 调用面统一到：
  - `documents/browser-documents`：`browserDocuments` / `activeBrowserDocumentId` /
    `openBrowserDocument` / `closeBrowserDocument` / `updateBrowserDocument` /
    `browserDocumentTitle` / `BrowserDocument` 等；
  - `documents/file-documents`：`fileModelFor` / `saveFileModel` / `clearFileModels`。
- `browser-tabs.test.ts` 迁移为 `documents/browser-documents.test.ts`；
  `editor-model-store.test.ts` 删除（`file-documents.test.ts` 已覆盖同等行为）。
- `browser-tabs-persistence` 与存储键 `mafw-browser-tabs:v1` 保留：它们描述「持久化的浏览器
  tab」，不是 facade；改键会破坏已有用户快照。
- `MafwShell`、`BrowserDock`、`document-frame-model`、wiring 测试同步改名。

## 测试

- desktop 全量：**3759 / 3759**（727 suites）
- 测试数量变化：删除 2 个 facade 专属测试；浏览器 tab 测试迁移到 documents 目录，覆盖不丢。
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 实机确认

fresh built app（CDP 9224）：

- 打开文件 + `https://example.com`：混合 tab 条、1 个 toolbar、webview 正常；
- 文件 / 网页切换、关闭、持久化路径未受改名影响；
- 无 error overlay。

## Phase 2 收口

- 2A 拖拽 + 跨重启顺序 / 浏览器 tab 恢复 ✅
- 2B 统一 toolbar 注册 + 空白浏览器命令修复 ✅
- 2C-1 web tab 拥有权 ✅
- 2C-2 文件模型拥有权 ✅
- 2C-3 facade 清理 ✅

未推送、未合并、未发布；E6 未触碰。
