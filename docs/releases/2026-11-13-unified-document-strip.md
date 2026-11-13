# 2026-11-13 · 统一文档 tab 条（Phase 1）

- **版本**：`v5.1.0`
- **Commit**：`c1e3f30f`（模型 / 菜单）、`4dae0456`（store）、`ddceab1d`（UI / 接线）
- **范围**：右 dock 文件与浏览器 tab 合成一条文档条；不迁移编辑器 / 浏览器内部状态

## 交付

- 新增 `documents/document-tabs-model.ts`：文件 id 带 root、浏览器 id 带 tab id；稳定的
  open-order merge、root 内同步、下一个 active、关闭其他 / 关闭右侧、active 视图映射。
- 新增 `documents/document-tabs-store.ts`：模块级 entries / activeId / 一次性 close-request 队列；
  同内容重复同步不重写 store（避免反应式环路）。
- 新增 `DocumentStage`：一条 `DocumentTabs` + 常挂载的 `EditorDock` / `BrowserDock`；
  active kind 用 wrapper `display: contents / none` 切换，活跃文档变化不重载 webview、
  不丢编辑器状态。
- `EditorDock` / `BrowserDock` 增加 `embedded`：不渲染各自的 tab 条；各自同步本类 tab、
  消费 close request，并从统一 active document 单向同步内部 active。
- `FocusStage` 永久挂载 `DocumentStage`（非文档 kind 时隐藏），不再在 `Switch` / `Match` 的
  计算属性里创建文档 body；这同时修掉了 tab 同步触发 stage 重建、最终栈溢出的问题。
- `MafwShell` 接管 tab select / close / close-others / close-right：file 走 file subject，
  web 走 web subject 且不重新导航；关闭 active 后聚焦相邻 tab，最后一条回到 landing。
- 新增 `buildDocumentTabMenu`：关闭 / 关闭其他 / 关闭右侧 + 文件复制路径 / 网页复制链接、
  系统浏览器打开；菜单按被点击 tab 计算可用性。
- `DocumentTabs` 的 item id 使用统一 document id，select / close / context-menu 不再混用
  raw rel 与 browser tab id。

## 测试

- desktop 全量：**3633 / 3633**（702 suites）
- 本轮新增测试：**25**
  - `document-tabs-model.test.ts`：8（id / 顺序 / root 隔离 / next active / 关闭目标 / 视图）
  - `document-tab.test.ts`：3（文件菜单 / 网页菜单 / 禁用项）
  - `document-tabs-store.test.ts`：8（合并 / 移除 / root 替换 / activate / 幂等同步 / active 查询 /
    close 队列 / 关闭其他与右侧）
  - `document-stage-wiring.test.ts`：4（单条 tab 条 + 双 body / FocusStage 路由 / WorkbenchShell
    透传 / embedded body 同步与 close 消费）
  - `unified-document-wiring.test.ts`：2（shell 路由 / 焦点 stage 挂载）
- 同步更新 `content-intent-wiring`、`focus-stage-wiring`、`workbench-browser-wiring`、
  `design-contract` 的旧 stage 断言；`document-frame-wiring` 保持通过。
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0

## 实机确认

fresh built app（`MAFW_ALLOW_MULTI_INSTANCE=1`，CDP 9224）：

- 左 dock 打开 `AGENTS.md` + 地址栏打开 `https://example.com` → 同一条 tab 条，顺序
  `[web, file]`（按打开顺序）。
- 点击文件 / 网页 tab 双向切换：active class、pane `display`、frame crumb 同步；webview
  元素标记在切换后仍存在（不重载），`DocumentStage` 实例数保持 1。
- 地址栏导航后焦点为 web 时，web tab 自动成为 active；URL 尾斜杠差异由 active browser tab
  兜底匹配。
- 关闭 active 网页 → 相邻文件 tab 接管；`关闭其他` 保留被点击 tab；`关闭右侧` 跨类型关闭；
  关闭最后一条 → 返回 landing（stage 卸载、frame 清空）。
- 文件 tab 菜单：关闭 / 关闭其他 / 关闭右侧 / 复制路径；网页 tab 菜单：关闭 / 关闭其他 /
  关闭右侧（右侧无文档时禁用）/ 复制链接 / 在系统浏览器打开。菜单关闭后 `body` 的
  `pointer-events` 正确恢复。
- 无 Vite error overlay，无 render stack overflow。

## 边界与后续

- `EditorModel` 的 draft / dirty / conflict 与 `BrowserTab` 的 webview 生命周期仍由各自模块持有；
  本阶段只统一 tab 集合、active、关闭与右键菜单。
- 不做拖拽排序、不做跨重启文档列表持久化、不合并 editor / browser toolbar。
- Phase 2：详细状态迁入统一 document store、拖拽排序、跨重启文档列表、统一 toolbar 动作注册。
- E6 worktree / `feat/gateway-e6-interaction-model` 未触碰。
