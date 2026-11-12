# 2026-11-13 · 右 dock DocumentFrame

- **版本**：`v5.1.0`
- **Commit**：`3663f8af`
- **范围**：编辑器 + 浏览器共享文档框架；不改变左右布局与文件树入口

## 交付

- 新增 `DocumentFrame` / `DocumentTabs` / `DocumentToolbar`，编辑器与浏览器共用同一套 tab 和
  toolbar 度量。
- 编辑器移除私有「编辑器」标题；保存 / 外部 / 预览 / 改动 / 内联改动导航移入 `DocumentToolbar`。
- 浏览器移除 `TabsV2` pill tab 与独立地址栏：tab 走 `DocumentTabs`，后退 / 前进 / 刷新 / 地址 /
  点选 / 外部打开走 `DocumentToolbar`。
- 文件与浏览器 tab 共享：图标、dirty 点、preview 斜体、只读 badge、关闭、中键关闭、键盘上下文菜单。
- 右 dock chrome 统一为：`FrameBar 40 / LensBar 36 / DocumentTabs 32 / DocumentToolbar 32`；
  内部分隔统一 `--border-subtle`。
- 编辑器空态改为「从左侧文件树或取景器（Ctrl+P）选择文件」。

## 测试

- desktop 全量：**3577 / 3577**（697 suites）
- 本轮新增测试：**6**
  - `document-frame-model.test.ts`：2（tab 映射）
  - `document-frame-wiring.test.ts`：4（共享框架、编辑器去 header、浏览器去 pill tab、CSS）
- 同步更新 `browser-tabs-wiring.test.ts`、`content-intent-wiring.test.ts`、
  `design-contract.test.ts` 的旧 chrome 断言。
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 边界

- 编辑器与浏览器仍是两个独立 stage，各自持有自己的文档状态；**跨类型混合 tab 条未做**。这需要把
  editor model 与 browser tabs 提升成统一 document model，属于下一刀。
- 浏览器 tab 的右键菜单仍按活动 tab 处理；逐 tab 菜单未做。
- 本轮只做测试/类型/构建门禁，未做实机截图冒烟。
