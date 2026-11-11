# Workbench Stage-first 基础（Plan 1）— 2026-11-12

## 范围

- Spec：`docs/superpowers/specs/2026-11-12-workbench-stage-first-design.md`
- Plan：`docs/superpowers/plans/2026-11-12-workbench-stage-first-foundation.md`
- 本轮只替换 `content` context 的阅读路径；`project` / `goal` / `review` 继续走 legacy panes，属于绞杀者切片。
- 本地 `main`，未 push。

## 提交

| commit | 内容 |
|---|---|
| `2662518e` | 焦点模型：`Focus = { scope, subject, lens, place }`、栈转换、lens 矩阵 |
| `b9ff2370` | per-world 焦点持久化：`mafw-focus:v1:<worldId>`、校验、去抖、fail-open |
| `19613bae` | 框：FrameBar + `frameView` |
| `20558ded` | 镜：LensBar |
| `426e859c` | 台：FocusStage 分派 + `stageActionFor` |
| `9fc0e2ee` | 取：SubjectPicker（⌘P / Ctrl+P） |
| `88524860` | content context 接入焦点壳 |
| `a007c933` | 返回 / 面包屑 / picker / 持久化接线 |
| `12dd56ca` | 旧 `ContentScopeState` 迁移 |
| `9427f596` | 框显示 `HEAD`；修复 picker 初始化顺序 |
| `7278962f` | 修复返回时舞台不同步；隔离 focus 编辑器；picker goal scope |

## 行为变化

- **焦点模型**：`subjectKey` 以对象身份去重（文件版本不进身份）；同 subject 再打开只替换 lens/place，不堆栈；`popFocus` 在根节点 no-op，由 shell 关闭焦点并回项目。
- **持久化**：每个世界一个 `mafw-focus:v1:<worldId>`；读取逐条校验，坏数据丢弃；stack 上限 50、kept 上限 20；300ms 去抖；存储失败 fail-open。
- **框 / 镜 / 台**：一条 FrameBar（world / scope / subject / version / state）；LensBar 只显示当前 subject 适用的 lens；FocusStage 分派 editor / browser / terminal / plugin / changeSet / goal / world。
- **取景器**：⌘P / Ctrl+P；文件、最近内容、浏览器、终端；goal scope 下不混入 project-root 文件列表；project recent 使用 project root。
- **返回 / 面包屑**：`syncStageToFocus` + 显式 `openRequest` 把新 top focus 同步到编辑器；实机验证 AGENTS → CONTEXT → 返回 → AGENTS，编辑正文与框一致。
- **双编辑器**：focus 态卸载 legacy `WorkbenchCodeView`，避免两个 `EditorDock` 抢 `pendingEditorOpen`。
- **legacy context 切换**：`applyWorkbenchContext` 在切到非 `content` context 时清空焦点，避免 review / Goal 详情开在 `display:none` 后面。
- **旧状态迁移**：`activeFile`、scroll、selection、openFiles 从 `content-scope-state` 迁入焦点栈；不修改源对象。

## 验证

- desktop 全量：**3434 / 3434**，691 suites
- `npx tsgo --noEmit -p tsconfig.json` rc=0
- `electron-vite build` rc=0
- 实机冒烟：
  - 项目首页 → 打开 AGENTS.md：FrameBar / LensBar / FocusStage 出现，`ContentScopeHeader` 消失
  - 变更 / 审阅 / 阅读切换：subject 不变，lens 正确
  - ⌘P 打开取景器，选 AGENTS.md，返回回到上一个 subject
  - reload 恢复 AGENTS.md 与阅读 lens
  - legacy Goal 详情仍渲染
  - 900px 窄窗：frame 为 static flex，lens `overflow-x:auto`，crumb `max-width:220px` + ellipsis
  - 返回舞台同步：AGENTS → CONTEXT → 返回 → AGENTS，编辑正文随框变化
  - 截图：`.mafw/qa/focus-foundation-smoke.png`

## 最终 review

独立 reviewer（`gateway/deepseek-v4-pro#max`）对 `37785f8f..9427f596` 做了全量 review。评审发现并已修复：

- **Critical：返回只恢复框、不恢复舞台** → 增加 `stageActionFor` / `syncStageToFocus` / 显式 `openRequest`，实机冒烟通过。
- **Critical：legacy review / Goal 入口在 focus 态被吞** → `applyWorkbenchContext` 切非 content context 前清空焦点。
- **Important：两个 `EditorDock` 同时挂载、抢打开请求** → focus 态卸载 legacy `WorkbenchCodeView`。
- **Important：goal scope picker 混入 project-root 文件** → 增加 `filesRoot`，goal scope 不列 project-root 文件；project recent 使用 project root。
- **Important：`Focus.place` 与 `content-scope-state` 两套 place** → 本轮判给 `content-scope-state`，Plan 2 决定最终归属。
- **测试缺口** → 新增 `stageActionFor` 纯测试、picker goal scope 测试、focus openRequest / legacy editor 的 wiring 测试。

Deferred minor：picker 命令可能被 50 项 cap 挤出；FrameBar 在 Windows 仍显示 `⌘P`；picker 无 focus trap / scroll-into-view；`onOpenFile` / `lensCounts` 暂无消费方；`clearFocusPersistence` 不 remove 存储键。

## 已知边界

- `project` / `goal` / `review` 仍是 legacy context；Plan 2/3 收口。
- Instrument rail、决定板、Chat 决定面、Agent/用户契约未在本轮实现。
- goal scope picker 只列最近内容，不列 worktree 文件；完整 worktree 取景器留给 Plan 2。
- 执行抽屉在 focus 态隐藏；Plan 3 作为框/Goal 总览的状态回归。
- `Focus.place` 暂不是滚动/选区的权威存储。

## 下一步

Plan 2：Goal / review scope + instrument rail + decision surface。
