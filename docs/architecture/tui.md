# MAFW TUI 架构

> 迁移自根 `AGENTS.md`（2026-11-10），原文搬迁（未改写）；章节号沿用迁移前编号，
> 交叉引用以标题为准。后续变更记录写 `docs/releases/`，不再回填本文件。

### TUI（packages/tui/，2026-09-11）

- `mafw tui` 子命令启动（bin/mafw.js spawn `packages/tui/dist/cli.js`，stdio inherit + `windowsHide: false`——TUI 需要可见控制台）；CLI 先探测 gateway `/health`（`MAFW_SERVER_API_PORT → MAFW_GATEWAY_PORT → 3000`，`MAFW_TUI_PORTS` 覆盖钩子供测试隔离），不通提示 `mafw daemon` 并退出
- 纯 HTTP/SSE 客户端：pi-tui（ESM-only，engines ≥22.19，TuiAltScreen + setLayoutRoot(VStack)：TabStrip / 内容区 grow:1 / StatusBar）+ `@mafw/sdk`，gateway 零改动。四 tab：Chat（promptAsync + SSE 流式累积、/new /btw /older /help、Esc 中止）、Goals（10s 轮询 + 详情/取消/问答 overlay）、Memory（BM25 检索 + 便签板 `u` 下架）、Triage（approvals 区块 + c/r/d）；SSE `permission.asked` → once/always/reject overlay
- 分层：`src/store/`（状态机，不依赖 pi-tui）→ `src/ui/`（组件）；AppModel（tab 切换/quit）与各 store 均纯 TS 可测；ConnectionStore 监督 SSE（1/2/5/15s 退避重订阅）
- 测试：`node --test tests/*.test.ts`（Node 22+ 类型剥离）；**源码禁用 TS parameter properties**（strip-only 不支持）；相对 import 用 `.ts` 后缀 + tsconfig `rewriteRelativeImportExtensions`（tsc 编译时改写为 .js）；UI 组件直接 `render(width)`/`handleTabKey` 断言（pi-tui **不导出 VirtualTerminal**）；冒烟测 cli 退出码（`MAFW_TUI_SMOKE=1` 启用）；冒烟与轮询注意 interval cleanup（store.stop() 必须清 schedule handle，否则 node 进程挂住）
- 发布注意：`@earendil-works/pi-tui` + `chalk` 在 **root dependencies**（发布后全局解析），root `files` 含 `packages/tui/dist/`；SDK `event.connected()` 为 TUI 监督器新增
- 已知类型缺口：SDK `TriageItem` 缺 `id` 字段（wire 实际有，TUI 用 `TriageItem & { id: string }`）；`--hybrid` 检索 flag 待 SDK `memory.search` 加 retriever 参数后接（v1 固定 bm25）

#### TUI v2 能力批（2026-09-14，对标 Claude Code/Codex/opencode/Hermes 调研缺口）

**Chat 本体**：
- **Markdown 渲染**：assistant 文本走 pi-tui `Markdown` 组件（`message-blocks.ts` 的 `markdownTheme`，标题/列表/代码块/表格；无 cli-highlight 依赖，代码块不着色）；user 文本保持纯文本 `>` 前缀
- **busy 消息排队**：`ChatStore.send()` streaming 时入 `queuedTurns`（turn 标 `queued`，渲染 `⏳` dim），`turn.completed` 后 `flushQueue()` 每次续发一条（复用 turn 不重复；v2 词汇）
- **`!` shell 模式**（`src/shell-mode.ts`）：`! <cmd>` 本地 exec（30s 超时、128KB buffer、输出截 50 行），渲染进 transcript 本地块（`RawLines`，跨 rebuild 保留），**不进模型上下文**（Hermes 同款零成本语义）
- **外部编辑器**（`src/external-editor.ts`）：Ctrl+G / `/editor` → `tui.stop()` → `$VISUAL/$EDITOR`（win 默认 notepad）编辑临时文件 → `tui.start()`（pi coding agent 同款模式；Windows 禁 spawnSync 防输入缓冲争抢）
- **会话切换**：`/sessions`（别名 `/resume` `/switch`）→ SelectList picker（★manager 标记）→ `ChatStore.switchSession()` + `ConnectionStore.setSession()` 重订 SSE + `chatTab.rebuild()`（localBlocks 保留——loadHistory 与本地块的竞态曾清空 shell 结果，测试抓出）
- **/model**：providers.list 展平（connected 过滤）→ 选中存 `modelSelection` → 后续 `promptAsync` 带 `body.model`；状态栏显示
- **/compact**：`POST /api/session/:id/summarize`（gateway `routes/session-summarize.ts` 薄代理 runtime `session.summarize`）→ 重载历史
- **/undo /redo**：revert 到最后一条**已持久化** user 消息（`local-`/`queued-` 前缀跳过）+ unrevert；pi runtime 无 unrevert → 方法缺席报错
- **状态栏用量**：`session.tokenSummary` 15s 轮询 + idle 触发 → model/tokens(`formatTokens` 1.2K/1.3M)/cost($0.06)/duration(`15m 30s`)；slash 命令表收敛在 `slash-commands.ts`（`SLASH_COMMANDS` + `createSlashHandler`，app.ts 注入实现）

**Goals 编排下钻**：goal 详情 overlay 按 `s` → `GET /api/goals/:id/sessions`（gateway `routes/goal-sessions.ts`，goal_sessions 表 + runtime session.get 富化 title，**必须挂在 `/api/goals*` dashboard 兜底之前**）→ SelectList（phase/loop）→ Enter 只读 transcript overlay（`historyItemsToTurns` 复用渲染管线，最近 50 条）

**SDK 新增**：`session.summarize`、`goals.sessions(goalId)`（`GoalSessionInfo`）；测试 TUI 90（89 过/1 冒烟跳过）+ gateway 路由 17 + SDK 71

**测试坑**：pi-tui 布局引擎（layout.js `layoutComponent`）需要 viewport 高度上下文，手动 `tab.render(80)` 会把 ScrollView 裁到 1 行——ChatTab 级测试断言 `(tab as any).transcript.render(80)` 而非全栈 render；chalk 非 TTY 环境自动关色，断言 ANSI 需先 `chalk.level = 3`

#### TUI 鼠标点击（2026-09-14，对标 opencode "click accepts"）

- **分层**：滚轮滚动/滚动条拖拽/拖选复制（OSC52）/URL 点击为 pi-tui TuiAltScreen **内建**（`mouse` 选项默认开，SGR 1000/1002/1006 + tmux/screen 自动降级 button-motion）；组件级点击派发是自建层 `ui/clickable-tui.ts` 的 `enableClickDispatch(tui)`——**实例补丁** `handleSelectionMouseEvent`（TS-private，子类重写会撞私有冲突；版本锁定 ^0.84.1 + typeof 门控 fail-open）：左键按下（非拖动）→ overlay 模态命中（`resolveOverlayLayout` 运行时穿透算 rect）→ 布局树 `currentLayout.root` 由深到浅命中 → 未命中回落选区逻辑。overlay 打开时外部点击吞掉（模态语义，不落底不触发选区）
- **命中契约**：组件实现可选 `handleMouseClick(col, row)`（相对组件左上角，返回 true = 消费）：TabStrip（clickAt 列 → tab，onTabClick 回调接 app 的 applyTab 同路径）、ChatTab（未聚焦点击聚焦/已聚焦放行保拖选）、Goals/Memory/Triage（行点击 = 选中，Enter 仍负责动作——triage 破坏性操作不一点触发）、picker 全部走 `ClickableSelectList`（点击行 = 选中+onSelect，opencode click-accepts；含 HeaderSelectOverlay 带 header 变体，permission overlay 用）
- **SelectList 穿透**：`filteredItems/selectedIndex/maxVisible` TS-private 运行时公有，`as any` + 版本锁定；可见窗口计算与 `SelectList.render` 同式（scroll-info 行不可点）
- 测试 `tests/mouse.test.ts` 12 例（FakeTerminal + 真实 SGR 输入管线 + renderNow 建 currentLayout）；总计 TUI 104（103 过/1 冒烟跳过）

#### TUI 交互重构 P1+P2（2026-09-14，四家交互模型调研落地）

**P1 交互地基**（commit 825bf0d4）：
- **InteractionStateMachine**（`ui/interaction-state.ts`）：`prompt|busy|overlay|transcript(P3 预留)` 单一模式替代散落的 editing/streaming/hasOverlay 三布尔；overlay > busy > prompt 优先级；dispatchKey 时从活查询刷新（overlay 开关无事件钩子）
- **COMMAND_REGISTRY**（`ui/command-registry.ts`）：单表驱动 slash 补全（autocompleteItems）、/help 分组渲染（helpLines，破坏性 ⚠）、别名解析（resolveCommand，Hermes COMMAND_REGISTRY 模式）；带 category/destructive/immediate 元数据（immediate=busy 立即执行不排队，Claude 语义）
- **声明式 keymap**（`ui/keymap.ts`）：app 级键位收敛为 binding 表（quit/abort/memory-blur/editor-open/tab/q/help），动作名对齐 opencode 词汇；AppModel 瘦身为纯状态持有（键测试迁 keymap.test.ts）
- **Editor history**：submit → `editor.addToHistory`（pi-tui 内建 up/down 导航，此前从未接线）

**P2 输入/反馈回路**：
- **Up 收回排队**（Claude 语义）：输入为空 + queued>0 时 Up 把全部排队消息收回编辑框（一行一条）；`ChatTab.handleInput` 转发前拦截
- **Ctrl+S prompt stash**（Hermes 栈式）：有文本=入栈清空、空输入=LIFO 恢复（toggle 语义：恢复后再按=重新入栈）；`PromptStash` 只存内存不落盘；状态栏 📌N 徽标
- **/queue 管理**（别名 /q）：QueueOverlay——j/k/↑↓ 选择、Enter 收回该条进编辑框、d 丢弃、Esc 关；ChatStore 增 queuedCount/queuedTexts/takeBackAll/dropQueuedAt
- **状态栏增强**：busy 位 + queued N + 📌N + ⏱ per-prompt 计时（流式实时跳、idle 冻结，Hermes ⏱12s/15m 30s 语义）+ 会话总时长
- **完成响铃**：回合结束 `\x07`（MAFW_TUI_BELL=0 关）

测试 136（135 过/1 冒烟跳过）。坑：测试里闭包计数器经解构/直接返回都是快照值，必须用 getter 包装

#### TUI 阅读回路重构 P3（2026-09-14）

- **消息块组件树**（`ui/blocks.ts`，commit 4e61332a）：ChatTab transcript 从"一 turn 一纯文本组件"改为 per-part 块树——UserTextBlock（queued ⏳ dim）/ AssistantMarkdownBlock / ReasoningBlock / **ToolBlock（可折叠）**/ PendingBlock；`UpdatableBlock` 契约承接流式快照替换（update(part) 清缓存）
- **ToolBlock 交互**：单击切换展开/折叠（Claude click-to-expand，`userExpanded` 覆盖全局默认）；全局 `/verbose` 循环 all↔off；`/focus` 静视图（Hermes 语义：开=收起+记住、关=恢复，tool 块渲染单行 `⋯` 隐藏标记，display-only 不改历史）；`DisplaySettings` 共享对象，块渲染时读取，切换后 invalidateAll 全量失效
- **ChatTab 块协调**：refreshTranscript 增量挂新 turn/新 part（pending 之前插入）、快照替换、done 移除 pending；queued→delivered 转正走全量 rebuild（罕见路径）；`scrollToTurn(messageID)` 按块渲染高度累计滚动（scrollTo 前需 updateLayout 钳制——测试要手动喂）
- **Ctrl+O 会话内搜索**（`ui/transcript-search.ts`）：TranscriptSearchOverlay——输入即过滤（大小写不敏感，前 8 条命中带角色标记 + 片段），↑/↓ 选择，Enter 跳转 scrollToTurn，Esc 关；keymap 加 openTranscriptSearch（chat tab + 无 overlay 时）
- **/diff [staged|all]**：runShell git diff → colorDiffLine 着色 overlay（150 行截断）
- turnToLines 保留（goal transcript overlay 复用）；状态栏 `◉ focus` 徽标
- 测试 158（157 过/1 冒烟跳过）：blocks 10、transcript-search 5、chat-tab 块协调/scrollToTurn/显示设置 8、keymap Ctrl+O、registry/slash 面更新

#### TUI 会话安全 P4（2026-09-14，交互重构收尾）

- **破坏性命令确认**（`ui/confirm-overlay.ts`，Hermes 三选）：COMMAND_REGISTRY destructive 标记（new/compact/undo/redo）执行前弹 ConfirmOverlay——本次执行 / 本会话总是执行 / 取消（Enter/l/d/Esc）；inline skip `now|--yes|-y`（`handleSlashWithConfirm` 包装层，always 结果进 `sessionApproved` Set）
- **/rename <标题>**：SDK session.rename；**/fork**：SDK session.fork → switchToSession 切到新会话；**/status**：`computeRecap`（`ui/session-recap.ts`）本地计算——轮次/工具调用计数/top 工具/最近交互快照，零 LLM 零缓存影响（Hermes 语义），recapLines 渲染 overlay
- **`mafw tui --session <id>`**：cli.ts parseArgs 显式连接指定会话（fork 后跳转、调试用）；**入口守卫**——cli.ts 顶层 main() 改为 `import.meta.url === pathToFileURL(process.argv[1]).href` 才执行（测试 import 解析参数不再触发网络探测，曾导致测试套 180s 挂死）
- 测试 167（166 过/1 冒烟条件跳过，MAFW_TUI_SMOKE=1 时真跑）

#### TUI 命令扩展（2026-09-18，v4.11.0）

- 新命令：`/export`（`ui/export-chat.ts` 导出会话为 Markdown 文件，跳过 queued/local 块）、`/copy [N]`（`ui/copy-text.ts` OSC52 复制第 N 近 assistant 回复，`\x1b]52;c;<b64>\x07` fail-open）、`/exit`（别名 /quit）、`/usage`（别名 /cost，`ui/usage-overlay.ts` 渲染 gateway `/api/usage/summary` 的 session/project/global KPI）
- 远端命令消费：启动时 `mafwCommands.list()` 拉取 → `ui/gateway-commands.ts` `mergeCommands` 合并（**本地优先**：远端 name/alias 撞本地 name/alias 隐藏远端；远端 category 映射 本地分类），`chatTab.setAutocompleteExtra` 重建补全 provider；未命中本地的命令 fallback 到 `mafwCommands.run` 派发（`slash-commands.ts` default 分支），远端 destructive 同过确认门
- `CommandDef` 新增 `argumentHint`（补全描述尾拼接）/`gateway` 标记；`COMMAND_CATEGORIES` 增『自定义』
- **模糊匹配不自建**：pi-tui `CombinedAutocompleteProvider` 内建 `fuzzyFilter`（子序列+大小写不敏感+`- _ . / :` 词边界加权+打分排序，dist/fuzzy.js），slash 补全天然满足 Claude Code 语义——评估后 YAGNI 不引入自建 fuzzy 模块

#### TUI 小窗口布局修复（2026-10-09）

调研 codex/claude/opencode/kimi/dsh 小窗口策略后（`docs/research/2026-10-09-tui-small-window-layout-research.md`，含复现器 `packages/tui/layout-probe.ts`）修三个问题：①**开口箱**——矮行时 VStack 用 `slice(0,allocated)` 硬切 Editor，底边框消失；新增 `ui/editor-frame.ts` 包裹 Editor，钳总行数到 `max(3, rows-3)`、保顶/底边框、优先留输入行再留补全项，ChatTab 以 `minSize:3` 挂载。②**补全弹层无相对约束**——ChatTab.render 按 `terminal.rows` 调 `editor.setAutocompleteMaxVisible`（<12→3、<16→4、否则 5；仅下次触发生效，当前列表由 EditorFrame 兜底裁剪）。③**状态栏截断方向错**——`status-bar.ts` 段带优先级逐段删最低者（hint/占位先丢，usage/conn 最后留），不再从左到右盲截。参照：kimi dock 契约 editor `minSize:3`、codex composer `Min(3)` + footer 折叠链。测试 `tests/small-window.test.ts` 7 例；TUI 全量 219（218 过/1 冒烟跳过）。
