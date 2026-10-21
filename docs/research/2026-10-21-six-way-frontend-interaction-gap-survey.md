# 六方前端交互差距调研：opencode v2 / Claude / Codex / dsh / pi / Kimi（2026-10-21）

> 目的：回答「我们 desktop 前端还缺哪些交互、哪些功能」。对象：MAFW Desktop（`packages/desktop`，以本轮全量代码阅读为准）× 六家前端。
> 方法：既有调研复用（`2026-10-08-agent-event-models-survey`、`2026-10-11-tool-call-rendering-survey`、`2026-09-28-desktop-aesthetics-competitor-research`、`2026-09-14-desktop-interaction-survey`、`2026-10-13-tab-strip-logic-survey`）+ 2026-10-21 网络增量（官方文档/changelog/一手评测）。
> 标注：[实证-网络] 当日网络读取；[实证-本地] 本仓库代码；[实证-既有] 引既有调研未重验；[知识] 未能核实。
> 范围说明：MAFW 侧以 desktop 为主（TUI 已有独立能力批，见 AGENTS §5.9b）；TUI 特有差距仅在相关处注记。

## 0. 一句话结论

单会话精细交互（审批卡/语音/工具卡/审阅面板/命令面板）我们**不输**；**agent 时代的并行语义**（后台任务、子代理生命周期、行级评论返工、checkpoint 时间线）是六家都在收敛而我们系统缺失的四大块——其中前两块与 10-08 事件模型调研的 canonical 词汇缺口同根，一次接线三端受益。

## 1. 六家前端交互速览（当日增量为主）

### 1.1 opencode v2（TUI + Desktop BETA）
- **Desktop 输入框内置完整 Readline/Emacs 编辑层**：Ctrl+A/E/B/F/K/U/W、undo/redo（Ctrl+- / Ctrl+Z / Super+Z）、redo（Ctrl+.）、transpose（Ctrl+T）——"built into the OpenCode Desktop prompt input"，且暂不可配置 [实证-网络 opencode.school/cheatsheet + 官方 keybinds]。
- TUI：Ctrl+X leader 键体系 + `tui.json`/`cli.json` **全键位可重映射**；`@` 模糊文件引用（**文件内容自动进对话**）；`!cmd` shell 模式（输出作为 tool result 进对话）；Ctrl+E 外部编辑器；Tab plan/build；attention 声音+系统通知；session sidebar/thinking 显隐/image preview/`/details` 工具细节开关等全部可配 [实证-网络 opencode.ai/docs/tui + v2/docs/cli/config]。
- Desktop（既有）：右侧 **Review 面板一等公民**（Unified/Split diff）；输入框内嵌 Build/Plan + 模型 + 变体三选择器 [实证-既有 09-28]。

### 1.2 Claude（Code + Desktop）
- **后台任务**：Bash `run_in_background:true` → 返回 task ID 即刻继续；**Ctrl+B 把运行中的命令后台化**（tmux 按两次）；**超时 120s 自动转后台**而非杀掉；`BashOutput(bash_id)` 检索输出、`KillShell` 终止；输出落盘按需读 [实证-网络 clockedcode/developersdigest/官方 issue]。已知坑：后台任务 system-reminder 洪泛（#11716）——**通知节流是设计必修项**。
- **Tasks（v2.1.16，2026-01）**：TodoWrite 的替代——`~/.claude/tasks/` 磁盘持久化**有向依赖图**，崩溃/重启后从下一个 ready 步骤续跑 [实证-网络 harness engineering 系列]。
- **Checkpoints/Rewind**：双 Esc 或 `/rewind` → **时间线 UI**（时间戳 + prompt 摘要 + 触及文件），回滚粒度可选（对话/代码/both）；保留 30 天；bash 文件操作与子代理编辑不在 checkpoint 内 [实证-网络 buildthisnow/medium]。
- Desktop（既有）：pane 系统是核心——chat/diff/browser/terminal/file/plan/tasks/subagent 任意拖拽可 pop out；diff 统计徽标 → diff viewer → **行级评论批量提交返工**；task chip（范围外工作一键开新 session 带 worktree）；侧栏 status/project 过滤分组 [实证-既有 方向C 调研]。

### 1.3 OpenAI Codex App（2026-02 macOS / 03 Windows / 08 Linux preview）
- 多 agent **threads by projects** 并行 command center + worktrees + skills + **automations** + plugins + memory [实证-网络 openai.com + nimbalyst]。
- **审阅**：右侧**变更文件树实时生长**（watch files being written in real-time），点文件开 side-by-side diff，**在 diff 上留评论让 agent 修订**；review menu 切 unified/split；Context Window Indicator 在 composer 旁 [实证-网络 YouTube 官方教程 + flaviocopes]。
- **Preview system**：任务先生成 2-4 个实现方案供挑选再执行 [实证-网络 zackproser]。
- 审批三档（read-only/approvals、auto/workspace、full/network）与我们同构 [实证-网络 openai.com upgrades]。

### 1.4 dsh（DeepSeek Harness，2026-08 开源）
- **Append-only 事件流 = 单一真相**：trajectory/resume/fork/search/replay 全部操作同一条流；Trajectory 视图 per-event inspector（payload/result/**schema**/timing）+ 嵌套 call tree [实证-网络 deepseek.com/harness + springbrand]。
- 插件生态：dsh-TUI（**double-Esc rewind-and-fork**）、dsh-genui（**模型在回复内渲染 30+ 交互组件**：表格/图表/表单/文件树/mermaid/3D）、dsh-at-file、dsh-market 应用内插件市场 [实证-网络 composio/awesome 列表]。
- Desktop：Tauri 2 打包 Web UI + 受管 sidecar（与我们 Mode A 捆绑同构）[实证-网络]。

### 1.5 pi（pi-coding-agent，本地依赖）
- 每工具自带 TUI 渲染器：折叠一行 + `⌘O to expand`；结果**按语言语法高亮** + 默认 10 行显式截断；bash 结果**实时计时** [实证-既有 10-11 调研]。
- 扩展系统：register **commands/keyboard shortcuts/CLI flags** + overlay UI 原语——键位与命令是扩展一等公民 [实证-本地 `dist/core/extensions/types.d.ts`]。

### 1.6 Kimi Code Desktop（v2.0.0，2026-09-17）
- **内置浏览器右侧 tab**（会话专属 tab、与 agent 共享页面上下文）：**网页上圈选元素、截图注释、文本选择评论** [实证-网络 kimi.com/code/docs whats-new]。
- 指向性上下文四件套：`@` 引用（渲染成 icon 胶囊）、**截屏+批注**、**引用选中文本追问（quote-reply）**、浏览器内标注 [实证-网络 atoms.dev 介绍]。
- 完成工具调用折叠为标题+一行摘要，Ctrl-O 展开；**/btw 支线问答**（与我们同名同义！）；子代理面板已更名 **Background Agent**；subagent model pool 常开 [实证-网络 whats-new v0.36/v2.0.0]。
- work bar 聚合后台任务于 composer 上方 [实证-既有 09-28]。

## 2. 差距矩阵（我们缺的；✅=已对齐不列）

| # | 缺口 | 谁有（证据强度） | MAFW 现状 | 分级 |
|---|---|---|---|---|
| 1 | **后台任务体系**：bash 后台化（run_in_background / Ctrl+B / 超时自动转）、输出检索与终止（BashOutput/KillShell）、composer 上方 work bar 聚合、完成通知（**需节流**，Claude #11716 前车之鉴） | Claude[实证-网络]、Kimi[实证-既有] | 全链缺失（canonical 词汇亦无，10-08 §5.3 已列） | **P0** |
| 2 | **子代理/后台代理生命周期事件与面板**：task_started/progress/notification 实时状态、Background Agent 专属面板、完成通知 | Claude[实证-网络]、Codex[实证-既有]、Kimi[实证-网络] | task 卡只有 part status；AgentPicker 有静态列表；无事件 | **P0** |
| 3 | **diff 行级评论→批量提交返工闭环** | Claude Desktop[实证-既有]、Codex App[实证-网络] | session-ui 有 `line-comment.tsx` 组件**未接线**；DiffReviewPanel 只有 per-hunk 保留/回退 | **P0**（组件已有，接线成本低） |
| 4 | **Checkpoint/rewind 时间线**：双 Esc 或按钮唤起、时间戳+prompt+文件列表、对话/代码分别回滚 | Claude[实证-网络]、Zed[实证-既有]、dsh-TUI[实证-网络] | 只有消息级 revert/unrevert（对话+文件一起回退） | P1 |
| 5 | **输入框 Readline 编辑层**（Ctrl+A/E/B/F/K/U/W/undo/transpose）+ **历史跨重启持久化** | opencode Desktop[实证-网络]（内置） | ↑/↓ 历史已修（readline 门语义）但编辑层无；历史 per-pane 内存态 | P1 |
| 6 | **指向性上下文**：截屏+注释、quote-reply（引用选中文本追问） | Kimi[实证-网络] | 媒体上传/粘贴有；无截屏注释、无 quote-reply | P1 |
| 7 | **跨会话全文搜索**（chat search） | Claude[实证-既有] | 只有会话内 Ctrl+F + 会话名 Ctrl+K | P1 |
| 8 | **变更文件树实时视图**（边写边长出来的 tree） | Codex[实证-网络] | ChangesDock 快照列表；`session.diff` SSE 实时流已有（数据面够） | P1（数据已备，纯 UI） |
| 9 | 内置浏览器 + 网页元素圈选/截图注释 | Kimi[实证-网络]、Codex Atlas[实证-网络] | 无（A2A media agent 可分析截图，但无浏览器） | P2（重资产） |
| 10 | Trajectory per-event inspector（payload/schema/timing）+ 回放/分叉 | dsh[实证-网络] | TrajectoryDock 回合聚合；无 per-event 下钻 | P2（方向 C 已有此判断） |
| 11 | `!cmd` shell 模式（desktop 版）、外部编辑器（desktop 版） | opencode[实证-网络]、Kimi[实证-网络] | TUI 有（AGENTS §5.9b.1/5.9b.3），desktop 无 | P2 |
| 12 | 键位可配置 / leader 键 / 通知音 | opencode[实证-网络]、pi[实证-本地] | 键位硬编码；无声音 | P2 |
| 13 | 任务预览多方案选择（2-4 方案挑一） | Codex[实证-网络] | plan 模式相邻但无方案对比 UI | P2（与 plan 节点整合再评估） |
| 14 | Tasks 持久任务图（磁盘依赖图，崩溃续跑） | Claude[实证-网络] | **不应照搬**——MAFW goal/node+state v3 已是更强的持久编排层；缺的是把 todo/plan 工具视图升级为「引用 goal 波次」 | P2（概念映射） |
| 15 | Tab 拖拽重排 + 中键关闭 + tab slinky | 浏览器/IDE 全体[实证-既有 10-13] | SessionStrip 已知三项差距 | P2 |
| 16 | 多 pane 系统（chat/diff/browser 任意拖拽 pop out） | Claude Desktop[实证-既有 方向C] | v6 **主动移除**了分屏（单 pane 模型）——是刻意取舍非欠账，但与 Claude 的 pane 核心论背离，记录在案 | 记录 |

已对齐项（不展开）：审批三档、权限卡串行+键盘、工具卡 v8（30+ 卡/家族卡/兜底）、thinking 折叠、元数据行、压缩分割线、fork/revert、worktree 并行、命令面板、Tray+OS 通知、quick entry、deep link、布局持久化、上下文 pill、用量/配额 dock、语音全链路、/btw（与 Kimi 撞名同义）。

## 3. 与 canonical 词汇缺口的同根关系（P0 的杠杆）

P0-1/P0-2 的上游是 `2026-10-08-agent-event-models-survey` §5.3 已列的 canonical 缺口：**subagent/task 生命周期**（claude task_started/task_progress/task_updated/task_notification/background_tasks_changed；codex CollabAgentToolCall/SubAgentActivity；kimi TaskStarted）——事件词汇表先行 → desktop work bar/Background Agent 面板/完成通知 + TUI overlay 三端一次受益；bash 后台化是 opencode/pi runtime 侧的工具能力扩展（`run_in_background` 参数 + 输出落盘 + 检索工具），与词汇表解耦可并行。pi runtime 子代理跳转断链（无 `metadata.sessionId`）顺修——gateway enrich 单点已有 `enrichToolIdentity` 先例。

## 4. 建议排期

1. **P0 三件**（后台任务 + 子代理生命周期/面板 + 行级评论返工）——行级评论是纯 desktop 接线（组件在库）；另两件事件先行。
2. **P1 批**（checkpoint 时间线、Readline 层+历史持久化、截屏注释+quote-reply、跨会话搜索、变更树实时化）。
3. **P2 按需**（浏览器集成、trajectory inspector、键位配置、任务图映射）。

（本文件为调研蒸馏，非设计决策；每项立项走 brainstorm → spec → plan。）

## 来源
- 本仓库：`docs/research/2026-10-08-agent-event-models-survey.md`、`2026-10-11-tool-call-rendering-survey.md`、`2026-10-20-agent-platform-tool-events-survey.md`、`2026-09-28-desktop-aesthetics-competitor-research.md`、`2026-09-14-desktop-interaction-survey.md`、`2026-10-13-tab-strip-logic-survey.md`；`packages/desktop` 源码（2026-10-21 全量阅读）
- 网络（2026-10-21 读取）：opencode.ai/docs/tui、opencode.ai/v2/docs/cli/config、opencode.school/cheatsheet；clockedcode.com / developersdigest.tech / buildthisnow.com（Claude background tasks/checkpoints）；openai.com/index/introducing-the-codex-app、introducing-upgrades-to-codex、flaviocopes.com/codex、zackproser.com、nimbalyst.com；kimi.com/code/docs（whats-new v0.36/v2.0.0）、atoms.dev/blog/kimi-code-desktop；deepseek.com/en/harness、springbrand.ai、composio.dev、awesome-deepseek-harness；pi 本地 `gateway/node_modules/@earendil-works/pi-coding-agent`
