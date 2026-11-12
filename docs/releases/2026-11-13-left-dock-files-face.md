# 2026-11-13 · 左栏 files face

- **版本**：`v5.1.0`
- **Commit**：`13cee058`
- **范围**：桌面左栏导航；`Tool result artifact` 已从本轮范围移除

## 交付

- `LeftDockFace` 增加 `files`；`IconRail` 新增文件夹按钮，文件 / 会话 / 搜索 / 便签仍然一次只显示一个 face。
- 切换入口只在最左侧 `IconRail`；`LeftDock` 内部不渲染 face 切换按钮。
- `FilesDock` 以 `showHeader={false}` 嵌入左 dock，左 dock 顶部继续只承担项目切换与关闭。
- 文件树 root 跟随当前 content scope（项目主目录 / Goal revision worktree），树展开与选中继续使用
  `content-scope-state`。
- 点击文件走 `openFileInScope`，在右舞台打开；overlay 态选择文件后自动收起左 dock，push 态保持打开。
- 右 dock 保持 stage-only：`FrameBar / LensBar / FocusStage / InstrumentRail`，不再放文件树。

## 测试

- desktop 全量：**3571 / 3571**（696 suites）
- `left-dock.test.ts`：26 / 26
- `tsgo --noEmit -p tsconfig.json`：rc=0
- `electron-vite build`：rc=0
- 本轮新增测试：**2**（`left-dock-files-wiring.test.ts`）；同时更新 `icon-rail-wiring.test.ts` 与
  `left-dock.test.ts` 的 face 顺序 / 迁移断言。

## 边界

- 首次打开左 dock 默认 `files`；空值 / 无存储 → `files`，旧 `pod` / 未知值回落 `sessions`。
- `FilesDock` 在左 dock 中隐藏了自带 header（含手动刷新）；目录刷新依赖 watcher 与 scope 切换。
- 右 dock 的 `DocumentFrame`（共享 tab / toolbar、浏览器并入文档）不在本轮；它是下一刀。
