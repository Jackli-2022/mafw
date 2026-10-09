# TUI 小窗口布局调研：codex / claude / opencode / dsh / kimi + 本仓库 input bar 诊断

> 日期：2026-10-09。起因：MAFW TUI（packages/tui）在小窗口下 input bar 表现异常。
> 竞对调研由两个并行 agent 完成（源码直读 + 官方文档/issue）；本仓库诊断由 `packages/tui/layout-probe.ts`（直接驱动 pi-tui `renderLayoutFrame` 快照真实帧）复现。

## 1. 竞对结论速查

| 维度 | Codex CLI (ratatui) | Claude Code (Ink) | opencode (OpenTUI/SolidJS) | Kimi Code (fork pi-tui) | dsh |
|---|---|---|---|---|---|
| 宽度策略 | 全宽 | 全宽（仅散文可 maxProseWidth 收） | 会话页全宽；首页 composer 居中限宽 75 | 全宽 + CHROME_GUTTER=1 对齐 | **无终端 TUI**（2026-08 已删包，Web/Desktop 为交互面） |
| 「too small」守卫 | 无 | 无（issue #82795 建议未采纳） | 无 | 无（分布式 clamp） | — |
| 输入框高度 | 随内容无限增高，视口钳屏高；超限时内部滚动 + `↑↓` 指示 | 随内容增高 + 内部滚动条（上限未公开） | 上限 `max(6, H/3)`，封顶内部滚动 | 上限 `max(5, H×0.3)`，封顶内部滚动 + `── ↑ N more ──` 指示 | — |
| 输入框保底 | composer `Min(3)`，status 行先牺牲 | 未查到 | flexShrink 契约 | **dock 契约：editor `minSize:3`**（顶边/输入/底边），footer 保 1 行，面板先压到 0 | — |
| footer 窄列省略 | 文档化折叠链：shortcuts hint → cycle hint → 右侧 context → 左侧全丢（footer.rs:24-46） | /rc 隐藏、indicators 不折行；权限模式行不截断 vs statusline 截断 | 纯 flex（右侧 flexShrink:0 优先保留） | tips 先让位 → 左部整体省略号；cwd 预先 shorten；context 用量优先保留 | — |
| 补全弹层 | composer 上方，`MAX_POPUP_ROWS=8`；描述列 <30% 宽即整列隐藏；高度 ≤2 行不画 | 输入框上方，超高列表可滚动 | absolute overlay 锚 composer，宽=composer 宽，高 `min(10, count, anchor.y)` | 内嵌 editor 渲染流，默认 5 条 clamp [3,20] | — |
| resize | reflow 重建 transcript，视口钳制/贴底保持 | 丢事件下一帧自愈；fullscreen 有全量重绘兜底 env | SIGWINCH → useTerminalDimensions 响应式 | SIGWINCH → 全量重布局（16ms 节流） | — |

### 关键源码引用
- Codex：`bottom_pane/chat_composer/composer_layout.rs:39-138`（自下而上 footer→status→composer `Min(3)`→popup `Max`）；`bottom_pane/footer.rs:24-46`（折叠链文档注释）；`selection_popup_common.rs:144-185`（描述列 30% 隐藏）；`popup_consts.rs:11`（MAX_POPUP_ROWS=8）；`tui.rs:1206-1241`（resize reflow）
- Claude Code：fullscreen 文档（输入框固定底部）；terminal-config 文档（maxProseWidth、800 字符/3 行粘贴折叠）；issue #91221（68 列下 statusline 截断但权限模式行完整）；issue #82795（无 too-small 守卫）
- opencode（注意：已非 Go/Bubble Tea，现为 SolidJS+OpenTUI）：`component/prompt/index.tsx`（maxHeight `max(6, H/3)`、文件标签 `truncateMiddle(max(12, min(48, W/3)))`）；`component/prompt/autocomplete.tsx`（高 `min(10, count, anchor.y)`）；`routes/session/index.tsx`（sidebar 仅 >120 列内联，否则 absolute 遮罩）
- Kimi Code：`tui-state.ts`（dock 收缩契约：editor `shrink:1, minSize:3`、footer `minSize:1`、面板 `minSize:0`）；`custom-editor.ts`（padding clamp `min(4, floor((W-1)/2))`、行宽 <4 放弃画 `>`）；`footer.ts`（tips 先让位、context 用量优先）；pi-tui fork `editor.ts`（maxVisibleLines `max(5, H×0.3)` + `↑/↓ N more` 边框指示）
- dsh：`.agents/notes/archived/simplification/2026-08-04-remove-tui-package.md`（TUI 包已删，旧实现也是 patched pi-tui）

## 2. 本仓库诊断（layout-probe.ts 实测帧）

我们栈：TuiAltScreen + 根 VStack（TabStrip `auto/minSize1` / contentHost `grow1/minSize1` / StatusBar `auto/minSize1`）；ChatTab = VStack（ScrollView `grow1/minSize1` / Editor `auto/shrink1/minSize1`）。pi-tui 0.84.1 Editor 自身宽度行为已健壮（padding clamp、contentWidth `max(1,…)`、内容行数封顶 `max(5, H×0.3)` + 内部滚动），`autocompleteMaxVisible` 默认 5（clamp [3,20]）。

实测小窗口问题四个，按严重度：

### P1（高）矮行 + 补全/多行输入时 Editor 被 VStack 硬裁切
补全激活时 Editor intrinsic = 内容 + 2 边框 + 6 行补全 ≈ 9 行。VStack shrink 权重 ∝ 当前尺寸，Editor 最大 → 缩得最多；`minSize:1` 保底几乎无效；`v-stack.js` 用 `childLines.slice(0, size)` 硬切：
- 50x6 + `/` 补全：**补全列表完全不可见**（用户不知道补全存在），只剩边框+`/`
- 50x6 + 5 行输入：只显示 line1/line2，**底边框消失**（开口箱子），无 `↑/↓` 指示

对照：kimi dock 契约 editor `minSize:3`（保边框+一行输入+边框）、上方面板先压到 0；codex composer `Min(3)`、status 行先牺牲；**三家都不允许输入框被切成开口箱**。

### P2（高）StatusBar 截断方向错误
`status-bar.ts:59-78` 从左到右拼接 project/session/conn/busy/…/usage(model/tokens/cost/⏱/duration)/hint，`truncateToWidth` 尾部截断 → 窄列保住的是 `-  ·  -  ·  disconnected`（占位符 + 连接态），**model/tokens/cost/hint 全被切掉**。28 列时状态栏完全无信息价值。

对照：codex footer 折叠链先丢 hints 再丢 context；kimi tips 先让位、context 用量优先保留；claude statusline 可截但权限模式行不截。**共性：低价值先丢，截断按元素优先级而非从左到右**。

### P3（中）补全弹层高度与屏幕无相对约束
40x12 + `/`：补全占 6/12 行（半个屏幕），transcript 被压到 1 行。opencode 把弹层高度钳到 `min(10, composer 上方空间)`；codex 固定 8 行且 composer 保底优先；kimi 默认 5 但 dock 契约保证 editor。我们的 `autocompleteMaxVisible=5` 是**绝对值**，不随终端高度收。

### P4（低）TabStrip 窄列截断可接受
`1:Chat │ 2:Goals │ 3:Mem…` — 尾部截断，当前 tab 在左不受影响。无需改。

## 3. 修复（已实施）

| # | 修复 | 位置 | 依据 |
|---|---|---|---|
| F1 ✅ | 新增 `EditorFrame` 包裹 pi-tui Editor：矮窗口下手动把渲染总行数钳到 `max(3, rows-3)`，保留顶/底边框（不开口），优先保留输入行、其次补全项；ChatTab 以 `minSize:3` 挂载 | `src/ui/editor-frame.ts`（新）+ `chat-tab.ts:127` | kimi dock 契约 / codex `Min(3)` |
| F2 ✅ | ChatTab.render 前按 `tui.terminal.rows` 调 `editor.setAutocompleteMaxVisible()`（rows<12→3、<16→4、否则 5） | `chat-tab.ts` render 覆写 | opencode `min(10, anchor.y)` / codex 8 行上限 |
| F3 ✅ | StatusBar 段带优先级，逐段删最低优先级直到放得下：hint(20)/project-session 占位(5) 先丢，usage(100)/conn(90) 最后保留；显示顺序不变 | `status-bar.ts` | codex footer.rs 折叠链 / kimi footer tips-first |
| F4 | 不做「terminal too small」守卫画面 | — | 五家均无，跟随行业 |

**F2 已知限制**：`setAutocompleteMaxVisible` 仅在该补全列表下次**创建**时生效（已打开的列表不追溯），即 resize 后重新触发补全才更新；F1 的 EditorFrame 已对当前列表做兜底裁剪，故无回归。

**验证**：TDD 新增 `tests/small-window.test.ts` 7 例（EditorFrame 4 + StatusBar 1 + ChatTab 集成 2）；修改后 80x8 多行输入输入框闭合（此前开口），80x10/70x14 补全不再静默裁掉。TUI 全量 219（218 过 / 1 冒烟跳过），tsc --noEmit 与 esbuild 构建绿。

## 4. 复现器

`packages/tui/layout-probe.ts`：`node layout-probe.ts`（在 packages/tui 下）直接快照 80x24 / 40x15 / 28x10 / 20x6 / 40x12+长输入 / 40x12+补全 / 60x8+补全 / 50x6+补全 / 50x6+多行 的真实渲染帧（`renderLayoutFrame` 直通，非 mock）。修复后可重跑对比。
