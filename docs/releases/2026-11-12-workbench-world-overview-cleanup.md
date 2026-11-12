# Workbench 世界总览与 Legacy 清理（2026-11-12 Plan 5）

- 版本：desktop 5.1.0 / gateway 4.16.1
- Plan 5 base：`c3474871`（docs: plan workbench world overview and cleanup）
- 代码交付 HEAD：`b6735e33`（fix: route files and goal changes through focus）
- 计划：`docs/superpowers/plans/2026-11-12-workbench-world-overview-cleanup.md`
- 设计：`docs/superpowers/specs/2026-11-12-workbench-stage-first-design.md`
- 用户决定：**取消 split view**；spec §12.8 / §15.11 由本计划覆盖。

## 范围

Plan 5 收口 stage-first 工作台：焦点栈成为唯一导航，世界总览成为兜底 subject，
四 context 壳与执行抽屉退役，决定板改为 SSE 失效与分批渲染。

- 世界总览：继续 / 需要你 / 全部 Goal / standing / 团队 / New Goal；不再包含文件与
  最近内容卡片（两者仍在取景器）。
- 无焦点落地：每个世界自动打开一次取景器；关闭后保留「选择一个对象」空态。
- WorkbenchShell：只保留 `FrameBar` + `LensBar` + `FocusStage` + `InstrumentRail` +
  `SubjectPicker` + 插件 Web 缓存。
- 删除 `WorkbenchContext`、四 context 持久化、全局 L2、执行抽屉、split view。
- 执行状态：Goal 框 badge + Goal 总览；后台任务在 Chat composer 上方内联。
- 决定板：`decision.updated` SSE 定向刷新，替代 15s 轮询；记录每 25 条分批渲染。

## 提交

| commit | 内容 |
|---|---|
| `248dfd17` | remove split view |
| `62c1395d` | add world overview stage |
| `ebcb3e23` | remove execution drawer |
| `d40960c7` | route navigation through focus |
| `3862e77e` | make the shell focus-only |
| `794de9c2` | derive content scope from focus |
| `8700fd25` | land on the picker and drop legacy storage |
| `05208f93` | invalidate the board over SSE |
| `c3a86db9` | batch-render decision records |
| `10032cfa` | initialize content scope after focus helpers |
| `4c3a4c1b` | preserve live diffs and world picker label |
| `c2ccc78d` | align remaining suites with focus shell |
| `b6735e33` | route files and goal changes through focus |

## 行为变化

### 世界总览与落地

- `WorldOverviewStage` 替代 `ProjectWorkView`；`ProjectFilesCard` / `RecentContentList`
  删除，文件与最近内容只经 `⌘P` / `Ctrl+P` 取景器进入。
- 世界总览是 `SubjectRef { kind: "world" }`，不是默认页；无焦点时每个世界自动打开一次
  取景器（`shouldAutoOpenPicker`），用户关闭后不反复弹出。
- `focusBack` 在根焦点清空栈并回到取景器；项目切换重新判定落地。
- `IconRail` 的团队入口、New Goal、titlebar `项目工作`、`/goals` 都进入世界总览。

### 焦点壳

- `WorkbenchShell` 不再接收 `context` / `surface` / `execution*` / `workView` /
  `goalView` / `reviewView`；只接收焦点、框、镜、舞台渲染器、器械与取景器。
- `FocusStage` 支持 world / goal / changeSet / file / plugin / web / terminal；
  插件 Web 页面由壳级 `PluginSurfaceStage` 按访问缓存：焦点之间切换不重载，退回
  取景器空态时随壳卸载，再进入重新挂载。
- 取景器文件项与 Chat 文件链接统一走 `openFileInScope`，按 `fileOpenPlan` 分流浏览器 /
  编辑器并推入焦点栈；`editor-open` 不再是可用的 UI 路径。
- Goal 变更集由 `GoalChangeSetStage` 直接读 Pod revision `worktreeDiff`，不再依赖
  active session 目录；Pod 结果里的入口改名「查看本版变更」。Goal 作用域取景器列出
  该 worktree 文件。
- `contentScope` / `contentRoot` / `contentScopeKey` 从 active focus 派生；`contentIntent`
  从 lens 派生。`content-scope-persistence` 与 `content-history` 删除。
- 旧 `mafw-workbench-context` / `-surface` / `-execution-section` / `-view` 与旧 tab 键
  启动时清理；退役的 `mafw-content-scope:<project>` 一次性迁移成文件焦点。
- 执行抽屉删除；`PodDock` 移入世界总览的「团队与记忆」折叠区；后台任务在 Chat
  composer 上方内联；用量入口改为 Config › Usage。
- split view 删除：`Place.split`、LensBar 分屏按钮、`ContentScopeHeader` /
  `WorkbenchCodeView` 旧分屏、`SplitDocumentPane` 与相关 CSS 全部移除。
- 框面包屑按焦点栈真实下标计算；旧持久化栈没有世界根时省略世界面包屑。取景器已打开
  或关闭后不会被自动落地逻辑再次拉起；Pod 面板请求按 seq 只消费一次。

### 决定板

- gateway `DecisionRecordService` 在 draft / confirm / shelve / reopen 后发出
  `decision.updated`（action / projectDir / goalId / revision / recordId）。
- desktop dispatcher 在 sid 分发前消费该事件，`MafwShell` 200ms 合并刷新
  `decisionStore`；15s 兜底轮询删除。
- `DecisionBoard` 每组先渲染 25 条，`显示更多（剩余 N）` 追加；Episode
  「查看决定记录」会把目标记录所在组扩到可见范围。

## 验证

| 门禁 | 结果 |
|---|---|
| Plan 5 新增测试 | **30**（desktop 29 + gateway 1） |
| desktop focused suite（Plan 5 Task 10） | 72/72（13 files） |
| desktop focused suite（review fixes） | 24/24（5 files） |
| gateway focused suite | 13/13（decision-record-service） |
| desktop full `npm test` | **3555/3555**（694 suites） |
| gateway full `jest --runInBand --forceExit` | **6768/6768**（878 suites） |
| desktop `tsgo --noEmit -p tsconfig.json` | rc=0 |
| gateway `tsc --noEmit -p tsconfig.json` | rc=0 |
| `electron-vite build` | rc=0 |
| gateway `npm run build`（tsc + manifest + copy） | rc=0 |

Desktop 全量低于 Plan 4 的 3576，是因为 Plan 5 删除了约 50 个只覆盖已退役
context / header / L2 / split / execution drawer 的旧断言；当前树的 3555 全绿。
Gateway 的 6768 是当前树，包含并发落地的外部 kernel-v2 交付；Plan 5 自身只新增
1 个 gateway 测试。外部 commit 不计入 Plan 5。

### 真机 smoke

- 无焦点启动：取景器打开一次；关闭后显示「选择一个对象」，不再显示旧项目首页。
- 世界总览：标题 / 团队 / 需要你 / 全部 Goal / New Goal 可见；无文件与最近内容卡片。
- Goal：从世界总览打开 Goal，框显示 Goal / rev / 待验收；返回回到世界总览。
- 文件：从取景器打开 `AGENTS.md`，框显示文件 / HEAD；返回恢复；reload 后焦点与文件
  仍恢复。
- 无 split 按钮、无执行抽屉；世界总览有独立滚动 owner。
- 决定板 SSE 与分批渲染由单测覆盖（dispatcher / decision-model / DecisionBoard wiring）；
  真机未写入测试决定记录，避免污染项目 `.mafw/decisions/`。
- 评审修复后复验：reload 无 error overlay；世界总览 / Goal 焦点 / Goal 变更集均能打开，
  该 Goal 已无 worktree，变更集显示「这一版没有可预览的分支」空态；仍无 split 按钮与
  执行抽屉。

## 已知问题与处理

- 真机首轮出现 `ReferenceError: Cannot access 'activeFocus' before initialization`：
  `contentScope` 是 eager 的 `createMemo`，却声明在 `activeFocus` / `contentScopeFromFocus`
  之前。已移动声明顺序并新增 `mafw-shell-order.test.ts` 顺序守卫（`10032cfa`）。
- 当前 checkout 的 `node_modules/.bin` 为空、部分依赖缺失；验证时使用了直接二进制
  （`@typescript/native-preview/bin/tsgo.js`、本地 `typescript`、`jest`）并从缓存补齐
  `@babel`、`@corvu/utils`、`@codemirror`、`@ampproject/remapping` 与
  `adapters/claude/node_modules/@anthropic-ai/claude-agent-sdk`。这些是环境修复，不改
  package.json；干净安装后应恢复标准命令。
- gateway 全量测试需要 `--forceExit`（既有 zeromq 句柄）。

## 不在本计划

- 大变更集 diff 虚拟化、更细的插件配置页导航、跨历史页 Episode 边界推断。
- 外部 kernel-v2 / plugin-contract 交付；本记录不归属这些 commit。
