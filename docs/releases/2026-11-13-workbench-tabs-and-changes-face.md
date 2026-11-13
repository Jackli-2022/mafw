# 2026-11-13 · 工作台 tab-as-view + 左栏改动面

- **版本**：`v5.1.0`
- **范围**：desktop 右工作台 chrome、统一文档条、左栏改动面、焦点模型；gateway / SDK 契约零改动
- **Spec**：`docs/superpowers/specs/2026-11-13-workbench-tab-as-view-and-changes-dock-design.md`
- **Plan**：`docs/superpowers/plans/2026-11-13-workbench-tab-as-view-and-changes-dock.md`

## 交付

| Task | 内容 | Commit |
|---|---|---|
| 1 | 左栏 `changes` face、上下文 resolver、会话改动树 | `880e04a5` |
| 2 | 瞬态 diff documents、统一 tab 同步、持久化过滤 | `4fda2f7e` |
| 3 | diff tab 渲染、焦点路由、diff subject | `c96a848b` |
| 4 | 讨论 → 左栏改动面深链 | `570e022b` |
| 5 | Goal revision 变更、revision pinning | `b42068af` |
| 6 | 评审项投影、Goal 深链、rail badge、项目索引 | `fa3c0c66` |
| 7 | 删除 LensBar、阅读/修改 intent、预览自动提升 | `33f4cbd1` |
| 8 | 删除 Lens 模型、焦点持久化迁移 | `a188b641` |
| 9 | 删除 changeSet / evidence / InstrumentRail / ChangesDock 死代码 + 文档 | `75252cf2` |
| 终审修复 | diff tab 选中同步、实时刷新、深链上下文、root/锚点/回退守卫 | `f259038b` |
| Minors 修复 | 行尾归一、diff badge、a11y、review 刷新、Goal diff 刷新/空态、项目状态文案、badge scope、改动面板入口等 | `3f3a91d1`、`1d4edce3` |
| 启动修复 | `changesMode` 提前初始化，避免 eager memo TDZ | `75170f92` |

## 结果

- 右工作台只剩 `FrameBar / DocumentTabs / DocumentToolbar / Stage`；LensBar 已删除。
- 文件 / 浏览器 / diff 同为文档 tab kind；文件 tab 直接可编辑，普通打开先预览、首次输入转持久。
- 左栏「改动」面按 `当前讨论 / 当前 Goal / 项目` 展示：
  - 待审：`pod.reviewItems`，展开可确认解决 / 重新打开（accepted 后隐藏动作）；
  - 本版变更：`pod.worktreeDiff`，revision 固定，出现新版本只显示切换横幅；
  - 本会话改动：`contentDiffEntries` 实时投影。
- 点击改动条目在右工作台打开 diff tab；会话 diff 保留回退 / 行级评论，Goal diff 只读。
- Goal 结果页的「改动面板 / 在改动面板查看」与讨论 turn 的「审阅改动」deep-link 到同一左面。
- 验收（接受 / 打回）仍只在 Goal 结果页，human-only 边界不变。

## 测试与门禁

- desktop 全量：**3798 / 3798** pass（728 suites）
- 本轮新增 11 个测试文件、约 32 个用例；关键覆盖：
  - `changes-context` / `changes-request` 上下文与深链
  - `diff-documents` / `document-tabs-store` diff tab 生命周期与持久化过滤
  - `goal-changes`（revision pinning / 中性错误文案）
  - `review-queue`（badge 计数 / accepted 隐藏动作）
  - `preview-promotion`（预览自动转持久、无 LensBar）
  - `diff-tab-wiring`（无 InstrumentRail / 无 Lens / 无 changeSet）
- `npx tsgo --noEmit -p packages/desktop/tsconfig.json`：rc=0
- `npx electron-vite build`：rc=0

## 边界与取舍

- diff tab 是瞬态的：不持久化 patch；重启后文件 / 浏览器 tab 恢复，diff tab 丢弃。
- 旧焦点快照中的 `lens` 被忽略；旧 `changeSet` / `reviewItem` / `evidence` subject 在加载时丢弃。
- 左栏改动面不做全量 N+1：项目视图只做 Goal / 讨论索引；评审项只拉当前上下文。
- worktree 不可用时显示中性文案，不伪造 diff，也不打开错误 root 的文件。
- 未改 gateway、评审项状态机、验收权限或 revision 隔离；E6 未触碰。

## 追加 · 全视图 tab 化 + Goal-first 改动面（同日）

- **一条 tab 条覆盖全部视图**：`WorkbenchTabs` 从 `DocumentStage` 上移到 `WorkbenchShell`，
  紧贴 30px `FrameBar`；世界 / Goal / 终端 / 插件成为 scene tab，文件 / 浏览器 / 改动集仍是文档 tab。
- **世界页固定首页**：`scene:world` 永远排在 tab 条第一位、不可拖动、不显示关闭按钮；任何同步 /
  拖拽后都会重新钉回首位，批量关闭也会跳过它。切换到项目时自动创建，无需先从取景器打开。
- **场景 tab 持久化**：世界 / Goal 写入 `mafw-scene-tabs:v1:<worldId>`，跨重启恢复；终端 / 插件
  与改动集是瞬态的，不落盘。tab 顺序仍由 `mafw-document-list:v1:<worldId>` 统一持久化。
- **改动集 tab（`changeset`）**：一个讨论 turn 或一个 Goal revision 一个 tab。单文件
  `diff-documents` / `DiffDocumentView` 退役，`ChangeSetView` 复用 `DiffReviewPanel` 渲染当前文件。
- **文件导航只在 toolbar**：toolbar 下拉无外框、无 `◀ ▶`，只显示状态字母 + 当前相对路径 + `▾`；
  下拉 `width:max-content`，上限 `calc(100% - 16px)`（右 dock 宽度），显示完整相对路径、`+/−`
  与当前行勾选；左侧常驻文件列表在 tab chrome 下隐藏。
- **左栏改动面**：删除 `当前讨论 / 当前 Goal / 项目` 三按钮；Goal 组在前（Goal → revision），
  讨论组在后（讨论 → turn）；组头与每个 Goal / 讨论都可收起，当前项默认展开并带「当前」标签；
  顶部只留搜索 + `全部 / 待审 / 有改动`。点标题打开对象 tab，点 revision / turn 打开改动集 tab。
- **深链**：讨论「审阅改动」打开当前会话的合并改动集；Goal 结果 / 决策评审项打开对应 revision
  的改动集（可带文件 + 行锚点），仍只读预览、人工验收边界不变。
- **门禁**：desktop 全量 **3833 / 3833** pass（729 suites）；`tsgo --noEmit -p tsconfig.json`
  rc=0；`electron-vite build` rc=0。本批新增 4 个测试文件、20 个用例：
  `change-set-documents`、`scene-tabs`、`changes-tree`、`session-turns`；另补 scene tab
  入条 / 不可持久化与 toolbar 下拉宽度上限两条接线用例。
- **边界**：改动集不持久化 patch（重启只保留世界 / Goal scene tab）；diff 文件导航不跨 tab
  混文件；未改 gateway / SDK / 验收权限。
