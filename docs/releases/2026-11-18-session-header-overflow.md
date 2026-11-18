# 2026-11-18 · Chat 标题栏收成「身份 + 交给 Lead + ⋯」

- **版本**：`v5.1.0`（桌面交互变更，不升版本号）
- **提交**：`1f901c158`
- **范围**：desktop renderer 标题栏；gateway / runtime 契约零改动
- **依据**：538px 实测 + dev app live 操作验证

## 问题

- 右侧开着编辑器时聊天列约 538px，5 个文字按钮占 338px、间距 70px，会话标题只剩 **5px**（只剩省略号）。
- 标题栏是 sticky 的，标题被压没之后，整段对话都看不到「这是哪个会话」。
- 并行 / 话题 / 状态 / 时间线 / 细节 权重完全相同，读起来像一条菜单栏，不是会话身份。

## 现状

- 标题栏只留：头像、会话标题（`min-width: 120px`）、token、任务条、Running / worktree 状态，
  外加 **交给 Lead** 与 **⋯**。
- `⋯` 用 `MenuV2` 按用途分组：
  - **视图**：展开细节（`Ctrl+O`）
  - **会话**：时间线 / 检查点（`/undo`）、从这里开始新段落、并行任务（worktree）
  - **Lead**：话题、Goal 状态（仅 Lead 会话）
  - **导航**：返回项目 Lead、返回父会话、关闭分屏（按实际可用性出现）
- 点击任一项后菜单自动关闭；toggle 项（细节 / 话题 / 状态）显示当前勾选状态。
- 术语修正：`标记 Episode` → **从这里开始新段落**。
- 删除的标题栏按钮：并行、话题、状态、返回项目 Lead、时间线、标记 Episode、细节、
  关闭分屏、返回父会话。能力与入口全部保留，只是换了位置。

## 实现

- `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`：标题栏收敛为 handoff + MenuV2，
  `runSessionMenuAction` 统一分发。
- `packages/desktop/src/renderer/mafw/components/session-header-menu.ts`：`buildSessionMenu` 纯模型，
  按 `detailsMode / hasTurns / worktreeEnabled / isLead / showReturnLead / hasParent / canClosePane`
  决定分组与禁用态。
- `packages/desktop/src/renderer/mafw/mafw.css`：标题 120px 下限、菜单最小宽度 208px，
  删除 `.mafw-episode-mark` / `.mafw-return-lead` 死样式。

## 验证

- 新增单测 **7** 条：`session-header-menu.test.ts`（分组、Lead 勾选、无回合禁用、worktree 能力门、
  导航裁剪、细节快捷键、动作计数）。
- desktop 全量：**4087 pass / 0 fail**（基线 4080）。
- `tsgo --noEmit -p tsconfig.json`：通过。
- live：dev app 标题宽 **120px 且完整**（`scrollWidth === width`）；标题栏只剩 2 个按钮；
  `⋯` 渲染 4 项会话动作；点击「展开细节」`localStorage['mafw-chat-details']` 0 → 1 → 0，
  菜单每次自动关闭。

## 测试调整

5 个源码扫描测试随入口移动更新（checkpoint-wiring、chat-episodes-wiring、
agent-native-chat-wiring、goal-workbench-wiring、design-contract），断言从「ChatPane 含按钮文案」
改为「菜单模型含入口 + ChatPane 接线」，并给标题补了 120px 下限断言。
