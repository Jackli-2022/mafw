# 工作台 tab-as-view 与左栏改动面设计（2026-11-13）

状态：方向已确认（视觉伴侣选 A）；待 builder check → 计划
关系：**取代** `2026-11-12-workbench-stage-first-design.md` 中 LensBar / 镜条与「审阅是变更集的镜头」的表述；
Goal / Pod、评审项状态权威、human-only 验收、revision 隔离、PASS 不自动合并全部保持。

## 1. 意图与问题

Stage-first 把工作台拆成「框 / 镜 / 台 / 械 / 栈 / 取」，镜条（LensBar）被设计成同一对象的多种看法。
实际落地后退化了：

- 文件镜条 `阅读 / 修改 / 变更 / 审阅` 中，`阅读 / 修改` 对已打开文件没有可编辑性差异；
  `变更 / 审阅` 在项目 scope 下点击只改 `aria-pressed`，舞台、编辑器、工具栏都不变。
- 世界只有 `总览` 一个镜，且默认 active，`replaceLens` 同镜 no-op → 点击没有任何反应。
- 浏览器 / 终端 / 插件只有 `交互` 一个镜，永远 active、永远 no-op。
- Goal 的 `审阅` 同样 no-op：Goal 对象本身已经无条件渲染评审栏。
- 镜条占 36px，却是整个右 dock 里最没有动作的一层。

用户的实际心智模型是：**tab 就是镜**。tab 是文档，文档类型决定视图与动作；左侧导航负责
「有哪些东西可以打开」。因此本设计把「镜」从全局 chrome 收回 tab / 文档类型，把改动与审阅
变成左栏常驻的导航面。

## 2. 用户已确认的决定

1. **tab 就是镜**：不再有全局 LensBar；文件 tab、浏览器 tab、diff tab 各自就是视图。
2. 删除 `阅读 / 修改` 模式；文件看到即可编辑。
3. **左栏一个「改动」面**（视觉方案 A）：面内分「待审 / 本版变更 / 本会话改动」，badge 汇总待审数。
4. 默认**跟随当前讨论 / 当前 Goal** 自动切上下文；顶部可切「项目」。
5. **验收（接受 / 打回）留在 Goal 结果页**，不进入左栏改动列表。
6. 审阅与改动要和 Goal、讨论**连起来**：Goal 结果页、讨论 turn 卡片都 deep-link 到同一个面。

## 3. 目标

- 右 dock 只剩：`FrameBar / DocumentTabs / DocumentToolbar / Stage`，没有镜条。
- 文件 tab 直接可编辑；预览 tab 首次输入自动转持久；不再需要「修改」按钮。
- 左栏「改动」面常驻，任何 tab 下都能看到当前讨论 / Goal 的改动与待审。
- 改动与审阅各自有明确归属：
  - 改动 = 文件差异（会话 / Goal revision）；
  - 审阅 = 评审意见（评审项），验收仍在 Goal 页。
- 点击左栏条目在右工作台打开 **diff tab**，不覆盖当前文件 tab。
- Goal 页、讨论 turn 卡片、编辑器批注都 deep-link 到同一个面，带正确 context。
- 删除镜条后不损失任何现有能力：评审队列、变更集、批注回喂、回退、验收权限都不变。

## 4. 非目标

- 不把 Goal / 世界做成文档 tab；Goal 仍是 stage 上下文，其内部 section 取代原来的
  `orient / review / decide` 镜。若要把 Goal 也纳入文档条，属于后续独立设计。
- 不做完整 git 客户端：不提供 staging / commit / branch / merge / push。
- 不改变 gateway 路由、评审项状态机、验收权限或 revision 隔离。
- 不在左栏做「所有 Goal 的 N+1 聚合列表」；「项目」视图是 Goal / 讨论索引，不是全量 diff 合并。
- 不持久化 diff tab（patch 可能很大）；重启后只恢复文件 / 浏览器 tab 与焦点。
- 不新增 Agent / MCP 修改评审项或验收的路径。

## 5. 目标信息架构

```text
左 IconRail                 左 dock                      右工作台
──────────                  ────────                     ────────
文件                        改动                          FrameBar
改动 (badge)                 ├ 当前讨论 / 当前 Goal / 项目  DocumentTabs (file | diff | web)
讨论                        ├ 待审                        DocumentToolbar (按 tab 类型)
搜索                        ├ 本版变更                    Stage
便签                        └ 本会话改动
团队
审批
Config
```

- 左 rail 的「改动」放在「文件」之后；图标使用已注册的 `review`（或 `fork`，实现时二选一）。
- badge：**当前 context 的未解决评审项数量**。`goal` / 有 Goal 身份的 `session` 显示该 Goal
  的数量；`project` 显示项目级数量；没有 Goal context 时不显示数字。没有评审项、但当前讨论
  有改动时显示小圆点。项目级数量直接复用 `decisionStore.items()` 中 `kind === "review_item"`
  的 attention 投影，不新增聚合 store，也不做 N+1。它是评审待办，不替代「团队」的
  `needsYou` badge（后者包含审批 / 问题 / 评审等全部 attention）。
- 左 dock face 持久化为 `mafw-left-dock-face=changes`；旧的 `pod` / 未知值继续回落 `sessions`。

### 5.1 tab 的范围

本设计的 tab 指**统一文档条**：`file / web / diff`。

- `file`：文件正文，可编辑。
- `web`：浏览器。
- `diff`：只读差异（会话或 Goal revision）。
- Goal / world / terminal / plugin 仍是 stage 上下文，不进入文档条；它们不再有全局镜条。

## 6. 左栏「改动」面

### 6.1 上下文

`ChangesContext` 三选一：

```ts
type ChangesContext =
  | { kind: "session"; sessionID: string; goal: GoalRef | null }
  | { kind: "goal"; goal: GoalRef }
  | { kind: "project" }

type GoalRef = {
  podId: string
  goalId: string
  revision: number
  worktreeDir: string
  title: string
}
```

选择器是**显式模式**，不是按顺序回退：

```ts
type ChangesMode = "session" | "goal" | "project"
```

- `session`：取当前活动讨论；有 `goalSessionIdentity` 时附带 `goal`。没有活动讨论 → 选项禁用。
- `goal`：取「当前 Goal」：`podGoalId` > 当前焦点 scope 的 goal > 活动讨论的 goal。
  仍无 Goal → 选项禁用。
- `project`：进入项目索引（§6.3）。
- 深链请求（§8）**临时覆盖**选择器：写入 request 时把 mode / context 一起更新，选择器 UI
  反映该 context；用户随后可手动切回。
- `resolveChangesContext` 是纯函数，输入 `{ mode, projectDir, activeSession, sessionGoal,
  focusScope, currentGoal, goalIndex }`；`worktreeDir` 由调用方先经
  `resolveGoalWorktreeDir` 解析后传入，解析失败时该 mode 不可用。
- **revision pinning**：context 选中时捕获 `{ goalId, revision, worktreeDir }`。Goal 出了新
  active revision 时**不静默切换**，在面顶部显示「有新版本 rev N+1 · 切换」；用户点击才换。
  这样人在审 rev N 时不会被后台执行换掉。
- 切项目时 context 重新解析；不跨项目复用。

### 6.2 面结构

段集合由 mode 决定，避免两棵重叠的改动树：

- `session` mode：**待审**（有 goal 时）→ **本会话改动**。
- `goal` mode：**待审** → **本版变更**。
- `project` mode：项目索引（§6.3），不显示 diff 树。

1. **待审**（只有存在 goal 时显示）
   - 评审项：状态点（待处理 / 已回应 / 已解决）、`rel:Lx`、comment 摘要。
   - 展开行：完整 comment、Tech Lead 回应、`确认解决` / `重新打开`（human-only）。
   - 点击路径：goal mode 下若有本版 diff → 打开 diff tab 并定位到行；session mode 下
     打开文件 tab 到行（或当前会话 diff tab，若该文件在会话 diff 里）。
   - 不显示「验收」按钮。
2. **本版变更**（goal mode only）
   - 标题：`本版变更 · Goal「标题」rev N` + 文件数 / `+adds −dels`。
   - 可折叠目录树（复用 `buildChangeTree` / `change-tree`）。
   - 文件行：状态字母 A/M/D、路径、`+ / −`；点击打开 diff tab。
   - 数据：`pod.worktreeDiff(podId, goalId, revision)`；加载中 / 404 / 409 / 503 给中性空态。
   - 语义：这是 revision 分支相对 base 的差异；执行中尚未落进分支的工作由「本会话改动」
     覆盖。两者不合并成一棵树。
3. **本会话改动**（session mode only）
   - 标题：`本会话改动` + 文件数 / 总增删。
   - 目录树；点击打开会话 diff tab。
   - 数据：`contentDiffEntries()`（summary 打底 + per-turn 覆盖）+ `liveDiffs` SSE 脉冲；
     复用现有 `ChangesDock` 的树 / 脉冲逻辑，但不渲染右侧 `DiffReviewPanel`。
   - 没有活动会话：空态「打开讨论后显示本次会话改动」。

### 6.3 项目视图

「项目」不是全量 diff 合并，而是索引：

- Goal 列表：`work.overview` 的 goals（标题、revision、状态、最近更新时间）。
- 讨论列表：现有会话 store 中当前项目最近有活动的会话。
- 点击 Goal → **打开该 Goal 页**（现有 `openGoalFocus`），并把左面切到该 Goal 的 `goal` context。
- 点击讨论 → **切换活动讨论**（现有会话选择通路），左面切到该 `session` context；
  不尝试在后台加载非活动会话的 per-turn diff。
- overlay 模式下，点击 Goal/讨论后左 dock 自动收起（`shouldCloseOnSelect`）；push 模式保持。
- 不在项目视图一次性拉取所有 diff / 评审项，避免 N+1。

### 6.4 交互与无障碍

- 行是 `role=button`，Enter / Space 打开；目录行 `aria-expanded`。
- 状态点不能只靠颜色：带文本状态（待处理 / 已回应 / 已解决）。
- badge / 数量进入 `aria-label`（沿用 `railAriaLabel`）。
- 左 dock 为 overlay 模式时，点击条目后自动收起（沿用 `shouldCloseOnSelect`）。
- 窄屏：打开 diff tab 后切到 workbench 视图（沿用 `revealWorkbench` / `applyRightDock`）。

## 7. Diff tab

### 7.1 文档模型

```ts
type DiffSource =
  | { kind: "session"; sessionID: string }
  | { kind: "goal"; podId: string; goalId: string; revision: number }

type DiffDocument = {
  id: string                 // diff:<sourceKey>:<rel>
  source: DiffSource
  /** 打开文件 / 定位行所用的根与焦点 scope（session 目录或 Goal worktree）。 */
  root: string
  scope: Scope
  rel: string
  patch: string
  additions: number
  deletions: number
  status?: string
  anchorLine?: number
  reviewItemId?: string
  title: string
}
```

- `diff-documents.ts` 拥有打开集合与 active id；`document-tabs-store` 只派生 entries。
- tab id：`diff:<sourceKey>:<rel>`；`sourceKey` 为 `session:<sid>` 或 `goal:<goalId>:<rev>`。
- `root` / `scope` 由打开方解析：
  - session：活动会话目录；若目录在项目内，scope 为 world，否则仍用该目录作为 root。
  - goal：`resolveGoalWorktreeDir` 得到的 revision worktree；scope 为
    `{ kind: "goal", worldId: projectDir, goalId, revision, worktreeDir }`。
  - 解析失败 → 不打开 diff tab；左面显示「这一版的分支不可用」+ 打开 Goal 结果。
- 同一个 diff 重复打开：更新 patch / anchor / reviewItemId 并激活，不新增 tab。
- 不持久化；切 world 时清空。文档顺序快照中的 `diff:` id 在加载与保存时都过滤掉。
- 关闭 diff tab：从 store 移除；active 落到左邻居，再右邻居，再 null（复用文档条关闭语义）。

### 7.2 渲染

- 从 `DiffReviewPanel` 抽出展示层 `DiffHunks`（hunk header / 行 / 行号 / 可选评论入口），
  `DiffReviewPanel` 与 `DiffDocumentView` 共用，避免两套 diff 渲染。
- 会话 diff：保留现有能力（勾选 hunk 回退、行级评论、发送给 agent）。
  - 打开中的会话 diff tab **跟随** `store.session_diff` / `liveDiffs` 更新：
    patch 变化时原地更新并清空已勾选 hunk（避免用旧行号回退）；若正在写行级评论，
    保留草稿并提示「改动已更新」。
  - 用户手动刷新 / 重新打开同一 diff 也走同一更新路径。
- Goal diff：只读 patch；不提供回退、不提供行级评论（评审意见走批注 → Tech Lead）。
  - revision 差异在分支提交后视为稳定；打开时取一次，toolbar 提供 `刷新`。
  - `pod.reviewRevision()` 变化只刷新评审项列表，不自动重取 patch。
  - toolbar 提供 `打开文件`、`复制路径`、`上一处 / 下一处`。
- `anchorLine`：定位到包含该新行号的 hunk，并高亮该行；找不到则显示首个 hunk。
- 空 patch / 二进制 / 超长：显示「此文件没有可显示的文本差异」+ `打开文件`。
- 工具栏：`打开文件`、`复制路径`、`上一处 / 下一处`；评审项相关动作留在左栏展开行。

### 7.3 与焦点栈

- 新增 `SubjectRef`：`{ kind: "diff"; source: "session" | "goal"; id: string; rel: string; line?: number }`。
- `stageKindFor(diff) = "diff"`；`FocusStage` 的 `isDocument()` 包含 `diff`，由 `DocumentStage` 渲染。
- 点击 diff tab 走 `focusDocumentTab` → `selectFocus`，FrameBar 显示 `rel · 改动`。
- diff subject 是**瞬态**：不写焦点持久化；重启后丢弃（文档条里的 diff tab 也不恢复）。
- 返回上一焦点：如果上一焦点是文件 / web，正常回退；diff 条目在栈里但不会被持久化。

## 8. 深链：Goal / 讨论 → 左栏

统一入口：

```ts
type ChangesRequest = {
  seq: number
  context: ChangesContext
  section?: "review" | "changes"
  rel?: string
  line?: number
}
```

- `openChangesFace(request)`：`revealWorkbench()` → 打开左 dock → `face="changes"` →
  写入 request（seq 递增）→ 左面消费并滚动到 section / 行。
- Goal 结果页：
  - `查看本版变更` → `{ kind: "goal", section: "changes" }`
  - `审阅 N` → `{ kind: "goal", section: "review" }`
- 讨论 turn 卡片 / composer 改动入口：
  - `{ kind: "session", section: "changes" }`；若该会话有 Goal 身份，goal 一并带上。
- 编辑器批注 / 现有 `onOpenReview`：
  - 这些是**本地批注标记**（`annotation-marks`，按 session 内存隔离），不是 `PodReviewItem`；
    v1 不为它们新增「批注」段。
  - 点击批注标记 / 现有 `onOpenReview` → `{ kind: "session", section: "changes" }`；
    若回调带 `rel`（及可选 `line`），优先打开该文件 tab 到锚点，而不是左面。
  - 已完成「发送给 Goal Tech Lead」的批注会落成 `PodReviewItem`，随后出现在「待审」；
    左面只投影评审项，不重复投影本地 mark。
- 验收（接受 / 打回）仍走 Goal 结果页原按钮；左面不提供验收。

## 9. 去镜与文件意图

最终模型：

```ts
type Focus = { scope: Scope; subject: SubjectRef; place: Place }
```

- 删除 `Lens`、`lensesFor`、`defaultLensFor`、`isLensApplicable`、`replaceLens`、
  `Focus.lens`、picker item 的 `lens`。
- `openSubject(state, scope, subject)` 不再接收 lens；`selectFocus` 同理。
- 焦点持久化：旧快照含 `lens` 时忽略该字段；旧 `changeSet / reviewItem / evidence` subject
  在校验时丢弃（仅保留 world / goal / file / web / terminal / plugin / diff）。
- 文件意图：
  - 文件树点击：持久 tab（现有 `persist: true`）。
  - 取景器 / Chat 文件链接：单个预览 tab；首次输入自动 `promotePreview`，不再依赖 `onIntent`。
  - 删除 `ContentIntent` / `content-intent.ts` 的 reading/editing 分支；`openModeForTab` 只按
    `persist` 决定 preview/persistent。
  - `EditorDock` 去掉 `intent` / `onIntent` prop；`readOnly` 只来自文件本身（二进制 / 超大 / 非 UTF-8）。
- `InstrumentRail`：左面 parity 达成后删除；Goal 页已有评审意见区（Plan C），不再需要右侧器械栏。
- `changeSet` subject / `ChangeSetStage` / `GoalChangeSetStage`：diff tab + 左面 parity 达成后删除；
  `openProjectChangeSetFocus` 的调用点改为 `openChangesFace` 或打开 diff tab。
- `evidence` subject（当前没有 stage 分派）删除。

## 10. 数据与契约

- 无 gateway 变更；只消费现有 SDK：
  - `window.api.mafw.sessions.diff(sessionID)` / `store.session_diff` SSE
  - `window.api.mafw.pod.worktreeDiff(podId, goalId, revision)`
  - `window.api.mafw.pod.reviewItems(podId, goalId, { revision })`
  - `window.api.mafw.pod.resolveReviewItem` / `reopenReviewItem`
  - `window.api.mafw.work.overview(projectDir)`（项目索引）
- 评审项状态权威仍在 gateway；左面只是投影。
- 失效 / 不可用：404 / 409 / 503 给中性文案，不出现 runtime 名或 capability flag 名。
- 会话 diff 与 Goal diff 都来自 `patch` 字符串；diff tab 不额外读文件内容。
- 打开文件从 diff tab：走现有 `openFileInScope` / `FocusOpenRequest`，带 `line` 锚点。

## 11. 交付切片（不回归）

1. **S1 · 左栏改动面（会话）**
   - `LeftDockFace` 增加 `changes`；IconRail 入口 + badge。
   - `ChangesFace` 会话段（目录树 + 脉冲 + 空态）。
   - `diff-documents` + `DiffDocumentView` + `DiffHunks` 抽取；diff tab 进入统一文档条。
   - 讨论 turn 卡片 deep-link。
2. **S2 · Goal 版本 + 待审**
   - Goal context、`worktreeDiff`、评审项列表 / 展开 / 解决 / 重开。
   - Goal 结果页 deep-link；验收按钮不动。
3. **S3 · 去镜**
   - 删除 LensBar / 阅读修改 / 镜条 CSS；补预览自动提升。
   - 把剩余的 review 入口切到左面；删除 InstrumentRail。
   - 更新 shell / stage / editor / picker 的 lens 依赖。
4. **S4 · 模型清理**
   - 删除 `Lens` / `changeSet` / `evidence` / 旧 `ContentIntent`；焦点持久化迁移。
   - 更新架构文档与发布记录。

S3 必须在 S2 之后，保证删除镜条时评审入口已经可用。

## 12. 测试与门禁

- 纯函数单测：
  - `resolveChangesContext`（session / goal / project / 失效回退）
  - `diff-documents`（打开幂等、关闭 active 邻居、切换 world 清空）
  - 文档条 kind 同步 / 顺序 / 持久化过滤 diff id
  - `ChangesRequest` 深链 reducer（seq / section / line）
  - 焦点持久化丢弃 lens 与旧 subject
- DOM / 组件测试：
  - `WorkbenchShell` 不再渲染 `LensBar`
  - 左面按 mode 的段集合、项目索引、空态、键盘、badge aria
  - diff tab 选择 / 关闭 / toolbar
  - 点击评审项打开 diff tab 并定位
- 全量门禁：
  - `npm run test:desktop`（当前 3765 基线，新增测试单独计数）
  - `tsgo --noEmit -p tsconfig.json`
  - `electron-vite build`
- 实机冒烟（fresh build）：
  - 左 rail「改动」→ 会话段 → 点文件开 diff tab；切回文件 tab 不丢状态
  - Goal 结果页「查看本版变更」→ 左面 goal context；点文件开 diff tab
  - 评审项 → diff tab 定位到行；确认解决 / 重新打开刷新
  - 无 LensBar；`body` pointer-events auto；返回上一焦点正常
  - 重启：文件 / 浏览器 tab 恢复，diff tab 不恢复且不残留 tab
- 文档：更新 `docs/architecture/desktop.md`；交付后写 `docs/releases/2026-11-13-*.md`。

## 13. 风险与边界

- **diff tab 瞬态**：重启后 diff tab 消失是明确取舍；不持久化 patch。
- **焦点栈**：diff subject 不持久化；重启后返回栈可能少一层，但不会指向不存在的 patch。
- **评审项 N+1**：只拉当前 goal / session 的评审项；项目视图只做索引。
- **左 dock 宽度**：默认 264，路径可能截断；允许拖宽（现有 ResizeHandle），行 title 显示全路径。
- **Goal worktree 不可用**：显示「这一版没有可预览的分支」+ 打开 Goal 结果；不伪造 diff。
- **human-only**：确认解决 / 重新打开是 UI 动作，不新增 MCP / Agent 路径；验收仍只在 Goal 页。
- **不碰 E6 / gateway**：只改 desktop 渲染层与文档。

## 14. Builder check 决议（2026-11-13）

Builder 提出的 7 个问题，已在正文中落定；这里留一份索引：

1. **上下文选择**：显式 `session / goal / project` 三模式，不按顺序回退；深链临时覆盖并把
   UI 同步到该 context；Goal revision **pin**，出现新版本只显示切换横幅（§6.1）。
2. **badge**：当前 context 未解决评审项数；project mode 为项目级，数据复用
   `decisionStore.items()` 的 `review_item` attention 投影（无 N+1、无新聚合 store）；
   无 Goal 不显示数字，有改动显示小点。它不替代「团队」的 `needsYou` badge（§5）。
3. **非 Goal 审阅 / 批注**：本地 annotation marks 不是 `PodReviewItem`；v1 不加「批注」段。
   批注点击优先打开文件到锚点，否则打开会话改动段；只有发送给 Goal Tech Lead 的批注才成为
   待审项（§8）。
4. **项目索引点击**：Goal 行打开 Goal 页并切 goal context；讨论行切换活动讨论并切 session
   context；overlay 下选择后收起（§6.3）。
5. **session + goal 的段集合**：session mode 只显示「待审 + 本会话改动」；goal mode 显示
   「待审 + 本版变更」。两棵改动树不叠加；本版变更是分支差异，执行中的工作在会话改动里（§6.2）。
6. **root / scope**：`GoalRef` 带解析后的 `worktreeDir`；`DiffDocument` 带 `root` + `scope`；
   解析失败不打开 diff tab（§7.1）。
7. **会话 diff 实时性**：打开中的会话 diff tab 跟随 SSE 更新并清空已勾选 hunk，避免旧行号
   回退；Goal diff 打开时取一次，可手动刷新（§7.2）。

剩余实现自由项（计划中定）：

- 评审项用展开行还是独立 review tab；倾向展开行，避免第四种 tab。
- diff tab 工具栏是否提供评审项「上一处 / 下一处」；v1 可只做 hunk 导航。
- Goal 页「审阅 N」按钮具体位置（结果区 header vs 评审意见区 header）；按 GoalDetailPanel 现有结构选一处。
