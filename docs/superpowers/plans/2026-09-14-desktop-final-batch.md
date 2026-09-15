# Desktop 交互收尾总计划（P1 遗留 + P2 质量债 + 旧待办全量）

> **For agentic workers:** 本计划为 inline 执行的精简总纲（执行者=计划作者，同会话上下文共享）。三批 16 任务，每任务独立验证+提交，纯逻辑模块 TDD（bun:test / gateway jest）。

**Goal:** 清空 desktop 交互调研的全部遗留：A 批交互功能（审批模式/方案确认/Triage 提议/Automations 编辑/布局恢复/会话导出/新建窗口）+ B 批质量债（确认统一/死代码/deep link+quick entry/杂项/命令面板）+ C 批旧待办（更新 Gateway 入口/插件系统 v2 四件）+ D（TUI --hybrid）。

**依据:** `docs/research/2026-09-14-desktop-interaction-survey.md` §3 + 记忆 #mem-xnzjcc（更新 Gateway 交办）+ #mem-9d6f63b（插件 v2 四件，YAGNI 缓存现已解锁）。

**关键事实（已核实）:**
- gateway triage HTTP 仅 GET/confirm/reject（index.ts:4082-4141）；automations 仅 GET/PUT toggle/DELETE/history（4143-4210）——propose/draft 需新增路由（复用 MCP handler 逻辑）
- Config.tsx:146-155 有 restartGateway 模式可参照
- preload `onDeepLink`（preload/index.ts:84-135）renderer 零订阅；main 已注册 `mafw://` 协议
- `mafw-menu.ts` 死代码（Ctrl+Shift+M 未挂载）——quick entry 接管该键位
- SDK `memory.search` 无 retriever 参数（TUI --hybrid 待接）
- UI 插件 v1：`UserPluginCards.tsx` 只在 completed/error 渲染；`UiPluginManager.list()` 有状态

## 批次 1：小项清障（T1-T7）

| # | 任务 | Files | 验证 |
|---|---|---|---|
| T1 | 更新 Gateway 入口：main `pending-update.ts`（令牌构建+原子写，TDD）+ ipc `mafw-gateway-update` + preload + Config Gateway 卡按钮（confirm 后调用） | main/pending-update.ts(+test), main/mafw-ipc.ts, preload 两文件, Config.tsx | bun:test + tsgo + build |
| T2 | deep link + quick entry：renderer `deep-link.ts`（parseDeepLink 纯函数 TDD：mafw://session/<id>、mafw://tab/<name>）+ MafwShell 订阅 onDeepLink → openSessionTab/setActiveTab；main globalShortcut Ctrl+Shift+M → 显示窗口 + send('mafw-quick-entry')，renderer 聚焦 composer；删 mafw-menu.ts | renderer/deep-link.ts(+test), MafwShell, main/index.ts, main/windows.ts | bun:test + tsgo + build |
| T3 | 死代码清理：删 Graph.tsx / HandoffCard.tsx / mafw-menu.ts + 引用；清 backToParent 调试 toast | git rm + 引用清理 | tsgo + build |
| T4 | 确认统一：新 `ConfirmOverlay.tsx`（mafw-confirm 样式通用弹窗）替换 4 处 window.confirm（Rail 删会话/MafwShell 新话题/Config runtime 切换/Config 插件删除） | ConfirmOverlay.tsx, Rail.tsx, MafwShell.tsx, Config.tsx | tsgo + build |
| T5 | 杂项：TabStrip approvals 徽标口径补 activeQuestion；RightDock 类型补 "notes" 去 @ts-nocheck；裸 button ×3 → ButtonV2；全局命令面板 `CommandPalette.tsx`（Ctrl+P，命令源=CommandPicker items + 导航项） | TabStrip/MafwShell/RightDock/Rail/WelcomeHome/CommandPalette | tsgo + build |
| T6 | 新建窗口：ipc `mafw-new-window` → createMainWindow()；命令面板加"新建窗口"项 | main/mafw-ipc.ts, preload, CommandPalette | tsgo + build |
| T7 | TUI --hybrid：SDK `memory.search` 加 `retriever?: 'bm25'|'token'|'hybrid'` query 参数；TUI `--hybrid` flag 接线 | gateway-sdk types+client, tui cli/store | SDK jest + tui node --test |

## 批次 2：交互功能（T8-T12）

| # | 任务 | Files | 验证 |
|---|---|---|---|
| T8 | 审批模式（desktop 本地 per-session）：`permission-mode.ts` 纯函数 TDD（shouldAutoApprove(mode, danger)）+ MafwShell `permissionModes` signal + permission.asked 分支自动 permissionReply('once')（危险命令仍手动）+ composer 盾牌切换 Popover（Manual/Auto） | permission-mode.ts(+test), MafwShell, ChatPane | bun:test + tsgo + build |
| T9 | Goal 方案确认：WelcomeHome 创建表单加 checkbox"规划完成后暂停等我确认"（默认开）→ handleNewGoal 的 prompt 注入"PLANNING_COMPLETE 后用 mafw_ask_user 向我确认方案再执行"；确认链路走既有 QuestionWidget | WelcomeHome.tsx, MafwShell handleNewGoal | tsgo + build |
| T10 | Triage 提议 + Automations 编辑：gateway 新路由 `POST /api/triage/:id/propose`、`POST /api/automations/draft`、`POST /api/automations/:id`（更新 skill/trigger）+ SDK 三方法 + TriagePage 建议 UI（confirm/reject/suggest 三键）+ AutomationsPage 创建表单（skill/schedule/时区） | gateway index.ts 路由, gateway-sdk, 两页面 | gateway jest + tsgo + build |
| T11 | 布局恢复：`layout-persist.ts` 纯模块 TDD（serialize/deserialize/merge 会话 tab + split tree）+ MafwShell 持久化（变更时防抖写 localStorage）+ 启动恢复（gateway ready + 会话列表到齐后匹配，缺失会话过滤） | layout-persist.ts(+test), MafwShell | bun:test + tsgo + build |
| T12 | 会话导出 Markdown（分享替代，无 hosted 服务）：`export-markdown.ts` 纯函数 TDD（buildSessionMarkdown(messages)）+ main ipc `mafw-export-session`（showSaveDialog + 写文件）+ SessionStrip 右键"导出 Markdown" + 命令面板项 | export-markdown.ts(+test), main ipc, preload, ChatPane/MafwShell | bun:test + tsgo + build |

## 批次 3：UI 插件系统 v2（T13-T16）

| # | 任务 | Files | 验证 |
|---|---|---|---|
| T13 | Config 插件管理卡：main `mafw-ui-plugins-status`（list 含 status/错误）+ Config 新卡片（列表/状态徽标/重载按钮） | main/mafw-ipc.ts, preload, Config.tsx | tsgo + build |
| T14 | 插件依赖：`shared/ui-plugins.ts` 校验加 `requires?: string[]`；UiPluginManager 加载时按序解析依赖，缺失→该插件 error 状态（fail-open 不影响他人）+ test | shared/ui-plugins.ts, main/ui-plugins.ts(+test) | bun:test |
| T15 | 流式渲染：UserPluginCards 在 running 期间也执行插件 render（500ms 节流，completed/error 仍最终渲染） | UserPluginCards.tsx | tsgo + build |
| T16 | Widget 词汇表扩充：8 种 + `markdown`（MD 渲染）+ `progress`（0-100 条）两种高价值类型；解释器+校验+测试 | shared/ui-plugins.ts, UserPluginCards.tsx(+test) | bun:test |

## Global Constraints

- 提交直接进 main，未跟踪新文件立即 commit（#mem-kgs82y 教训）。
- 纯逻辑模块 TDD；desktop 门禁 `tsgo -b` + `electron-vite build`；gateway 改动跑 jest；SDK 改动跑 client.test；TUI 跑 node --test。
- 审批模式 Auto 仅自动放行非危险命令（复用 PermissionCard 高风险判定），会话级不跨会话。
- T16 不做自定义类型注册机制（sandboxed renderer 不执行插件代码），词汇表扩充为固定新类型。
- 每批完成存记忆 + 简报；全部完成后总汇报（版本、commit 范围、新增测试数、全量通过数）。
