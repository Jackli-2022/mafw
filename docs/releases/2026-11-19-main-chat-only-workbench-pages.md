# 2026-11-19 · 主区只留 Chat，页面进右工作台

- **分支**：`main`
- **实现 commits**：`3e1cd7f60`（page subject）→ `1c93ab941`（Triage）→ `659ecbb6f`（Approvals）→
  `cf492164c`（Automations）→ `a61571319`（MCP）→ `a2d0edea6`（Config）→ `3dd23a17c`（chat-only）
- **设计**：`docs/superpowers/specs/2026-11-19-workbench-pages-design.md`
- **计划**：`docs/superpowers/plans/2026-11-19-main-chat-only-workbench-pages.md`

## 交付

**之前**：Approvals / Triage / Automations / MCP 用 `activeTab` 替换主区 chat；Config 用
`showConfig()` 独占主区，右 dock 被视觉隐藏（`workbenchShellHidden` 返回 true）。

**之后**：主区永远只渲染 chat（含 Welcome 空态）；五个页面都是右工作台的 `page` focus，
用持久化的 `scene:page:<id>` tab 承载。

| 页面 | id | 入口 | compact 关键点 |
|---|---|---|---|
| 审批 | `approvals` | 左栏 badge / 命令面板 / `/approvals` | 动作行换行，human-only 回调不变 |
| 分诊 | `triage` | 命令面板 / `/triage` | 卡片换行，动作行换行 |
| 自动化 | `automation` | 命令面板 / `/automation` | 表单字段 100%，header 换行 |
| MCP | `mcp` | 左栏 / 命令面板 / `/mcp` | 独立 action row，summary 4→2 列 |
| 设置 | `config` | 左栏 / 命令面板 / usage 圆环 / notification | 隐藏左导航，顶部 `SelectV2` section picker |

关键实现：

- `focus/workbench-pages.ts`：`WORKBENCH_PAGE_IDS` / `WorkbenchPageId` / `WORKBENCH_PAGE_META`；
  `subjectKey = page:<id>`；`isStalePageActiveTab` 处理重启后的悬空 activeId。
- `scene-tabs.ts`：`scene:page:<id>` 按项目持久化；`sceneTabIconFor` 保证 shell 不把 `page` 当图标。
- `MafwShell`：`openPageFocus`（`selectFocus`，重复打开不重复入栈）、`openConfigPage(section?)`
  （rAF 派发 `mafw:open-config`）、`navigateWorkbench(tab)` 统一导航出口。
- 页面关闭只由 FrameBar back / tab close 触发；切会话、点 chat、开 subagent、`revealWorkbench`
  都不再关闭右 dock 页面。
- `focus-persistence` 接受 `page` / `memory`；重启恢复时清掉没有焦点支撑的 page activeId。
- gateway down 时，有 page focus 的 dock 仍渲染（Config 离线可达）。
- 主区删掉全部非 chat 分支和 `showConfig`；`activeTab` 保留但被 chat-only guard 钉死。

## 门禁

- desktop 全量：**4229 / 4229 pass，0 fail（803 suites）**，较本批起点 4197 净 **+32** 用例。
- `tsgo --noEmit -p tsconfig.json`：rc=0。
- `electron-vite build`：rc=0，1m16s。
- Gateway / runtime 契约零改动；审批的人类专属语义（`permissions.reply` / `approvals.respond` /
  questions）参数与权限判断未改。
- 终审（fresh reviewer）：1 Critical（关 tab 后焦点栈仍留着页面，back / 重启会复活无 tab 的页面）
  已修——`withoutSubjects` + `pruneClosedTabsFromFocus`，并在关「其他 / 右侧」时批量剪枝；1 Important
  （`tabIdForSubject` 对 scene 恒返回 id，`ensureSceneTabFor` 永远不可达）已修——只有 tab 真存在才返回 id，
  恢复 / 被裁剪的 tab 会重建。commit `dc9c52ac9`。
- 终审 deferred minors 已收口（commit `0bc6879b6`）：页面图标 meta 改用 `DocumentTabIcon`；stale page
  activeId 改为响应式守卫（document store 晚到也能清）；page frame scope 显示「项目」；approvals 动作行
  允许收缩换行；Triage/Automations 卡片主体 `min-width: 0`；删除 `connDown` 非 chat 死分支与
  `WorkbenchContentMode` / `workbenchContent`；deep-link 注释、测试排版、`navigateWorkbench` 未知 tab
  回 chat 的契约断言一并补齐。

## 真机冒烟

dev app + CDP `127.0.0.1:9226`（renderer 5173），宽窗 1572 CSS px / 窄窗 1006 CSS px：

- **审批**：左栏 → 右 dock 显示「审批」tab + 页面；主区仍是 chat（split 时 chat 760 同屏）。
- **分诊**：命令面板 → dock「分诊」；卡片动作在同一行，无横向溢出。
- **自动化**：命令面板 → dock「自动化」→「+ 新建规则」：7 个字段全部 `798px`（dock 内宽），
  无横向滚动。
- **MCP**：左栏 → dock「MCP」：compact action row（刷新/添加服务器）+ summary 2×2 + 服务器行。
- **设置**：左栏 → dock「设置」：左导航 `display:none`，顶部 `SelectV2` = Gateway；在已挂载状态用
  命令面板「打开用量与上下文」切到 Usage（`mafw:open-config` 事件生效）；页面 `scrollWidth - clientWidth = 0`。
- **记忆**：命令面板 → dock「记忆」。
- **会话切换 / 点 chat / FrameBar back / tab close**：切到另一个 session 后页面仍在；点 chat 输入框
  页面仍在；back 回到上一个焦点（页面不崩）；关「设置」tab（中键）后焦点回落到「MCP」，再 back 到
  「审批」而不是复活「设置」，`mafw-scene-tabs` 同步移除 `page:config`。
- **窄窗**：1006 px 下打开审批自动切到 Workbench 全宽视图，Chat / Workbench 分段可一键回 chat，
  chat 视图下页面仍挂载。

冒烟中修掉一个真实布局 bug：`.mafw-card { align-items: center }` 让 compact 表单行收缩成
content-width（Select 只有 155px）；`.mafw-automations-form` 补 `align-items: stretch`，并把
`SelectV2` 包进 field div（Kobalte 的 wrapper 使 width 100% 无法直接命中）。已补源契约断言。

已知：dock 在 split 下的实际下限是 **766px**（720 工作台下限 + 46 rail），不是计划里估计的 640；
本次在 766px 完成页面矩阵验证，无横向滚动。截图在 `.mafw/qa/`（workbench-pages-*）。

