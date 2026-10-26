# 六方前端差距复检：opencode v2 / Claude / Codex / dsh / Kimi / pi 生态（2026-10-26）

> 目的：复检 `2026-10-21-six-way-frontend-interaction-gap-survey.md` 的 16 项清单 + 采集 10 月下旬六家增量，回答「我们 desktop 前端还缺哪些交互、哪些功能」。
> 方法：MAFW 侧当日全量代码实读（18 项逐项核对，explore 子代理 file:line 级验证）；业界侧当日网络读取（官方 changelog/文档/发布文）。标注：[实证-本地]（2026-10-26 代码读取）/ [实证-网络]（2026-10-26 读取）/ [实证-既有]（引前次调研未重验）。
> 关联：工作台合并设计 spec `docs/superpowers/specs/2026-10-26-workbench-merge-design.md`（同日确认）。

## 0. 一句话结论

10-21 定位的 P0 四大块（后台任务、子代理生命周期、行级批注、checkpoint 时间线）**已全部闭合**。缺口重心转移到三块：**「圈选即上下文」**（截屏批注 / 网页元素点选，Kimi·Claude·Codex·pi 四家收敛）、**「steer 进行中注入」**（回应中追加消息直接转向，Codex·Kimi·pi-gui）、**「交付闭环 Git/PR」**（分支状态/staging/PR 关联，Kimi·Claude·pi 全有）；外加会话管理长尾（置顶/归档/未读/跨会话搜索）与跨设备（远程控制/移动端）两大蓄水池。

## 1. 10-21 清单复检（当日代码实读，18 项）

| # | 项 | 判定 | 证据（`packages/desktop/`） |
|---|---|---|---|
| 1 | 后台任务体系 | **已闭合**（缺续聊 UI） | `BackgroundWorkBar.tsx`（composer 上方聚合+全部转后台）、`background-capability.ts` 三态 60s 重探、`BackgroundDock.tsx`（shell 尾部预览/终止 + durable 任务区）、`background-notify.ts` + `createNotifyGate(10s)` 节流（Claude #11716 前车之鉴已防）；401 残留注释仍在但 gateway 兜底反代已注入 serve Basic（`gateway/src/index.ts:7038`）[实证-本地]。**缺**：`tasks.message` 续聊 API 已备（preload/SDK）但 renderer 零消费 |
| 2 | 子代理生命周期 | **已闭合** | `SubagentDock.tsx` + tab badge；`sse/handlers/subagents.ts` **事件驱动**（part.updated 建行 / created/updated/deleted / turn 终态）+ 15s 对账兜底；task 卡 `taskChildSessionID` 跳转 [实证-本地] |
| 3 | diff/编辑器行级批注 | **已闭合** | `shared/annotations.ts`（行级 startLine/endLine + 代码快照 + electron-store 持久）；EditorDock「加入批注/立即发送」+ DiffReviewPanel per-hunk 评论 + `PendingAnnotations` [实证-本地] |
| 4 | checkpoint/rewind 时间线 | **已闭合** | `CheckpointOverlay.tsx`（时间戳+prompt 摘要+文件 chips+对话/代码分开回滚+双重确认+runtime-aware 警告）[实证-本地] |
| 5 | composer readline + 历史 | **已闭合** | `composer-readline.ts`（Ctrl+A/E/B/F/K/U/W/T + Alt+B/F + transpose）；`input-history-persist.ts`（per-session 50 条/单条 4KB/总 20KB）[实证-本地] |
| 6 | 指向性上下文 | **部分** | quote-reply 已闭合（`quote-format.ts`/`QuoteToolbar.tsx`）[实证-本地]；**截屏+批注未动**（无用户侧截屏入口，仅 agent 自动化用 `/screenshot`）[实证-本地] |
| 7 | 跨会话全文搜索 | **未动** | 仍只有会话内 `TranscriptSearchOverlay` + 会话名 Ctrl+K [实证-本地] |
| 8 | 变更文件树实时化 | **已闭合** | `ChangesDock.tsx` buildChangeTree + liveDiffs 脉冲（1200ms）[实证-本地] |
| 9 | 内置浏览器 | **部分** | 浏览器+加固已闭合（webview/权限全拒/window.open 拦截/系统浏览器出口）[实证-本地]；**元素圈选/截图注释未动** [实证-本地] |
| 10 | trajectory per-event inspector | **部分** | 回合 KPI + 嵌套 call tree 有（`trajectory-tree.ts`）；无 per-event payload/schema 下钻、无回放/分叉 [实证-本地] |
| 11 | !cmd / composer 外部编辑器 | **未动** | 无 `!` 前缀处理、无 composer 外部编辑器（EditorDock 的文件级外部编辑按钮不算）[实证-本地] |
| 12 | 键位可配置 / 通知音 | **未动** | 键位硬编码、无声音 [实证-本地] |
| 13 | 任务预览多方案 | **未动** | 仅有 `mafw_ask_user` 流卡的 options（agent 主动问），无方案对比 UI [实证-本地] |
| 14 | todo ↔ goal 波次关联 | **部分** | todo 视图（TaskBar/TaskList + plan.updated）与 goal 泳道（GoalDetailOverlay）各有，**未关联** [实证-本地] |
| 15 | SessionStrip 三件 | **部分** | slinky 已闭合（`session-strip-slinky.ts`）；拖拽重排/中键关闭未动 [实证-本地] |
| 16 | 多 pane | 维持既定取舍 | 单 pane（v6 刻意移除分屏）；本轮工作台合并设计已开「浏览器并排」口子 [实证-本地] |
| 17 | 队列 inbox 条 | **已闭合** | `ChatPane.tsx` 网关队列条（逐条取消/清空，与本地 turn queue 分开）[实证-本地] |
| 18 | 上下文 pill | **已闭合** | percent+费用+阈值变色+tooltip（≤520px 容器查询隐藏）[实证-本地] |

**计：6 闭合 / 5 部分 / 4 未动 / 1 既定取舍；两个 bonus 均闭合。**

## 2. 六家 10 月增量速览（当日网络）

### 2.1 opencode v2（changelog v2.0.25 → v2.1.4）
- **v2.1.4（10-23）**：MCP elicitation/input 表单（desktop/web/TUI，text/number/choice/multiselect/boolean/URL）；实验性 background compaction；**TUI 实验开关：`tui_open_terminal`/`tui_write_terminal`**（见 §4 T1 情报）
- **v2.1.3（10-22）**：Pierre Highlights（大文件/大 diff 高亮提速）；SDK voice 模型发现 + Console 托管 GPT-Live 语音会话
- **v2.1.0（10-20）**：Windows persistent PTY 终端；TUI todo 列表（todowrite 实验开关）
- **v2.0.30（10-15）**：**Changed Files by Turn**（时间线逐回合改动文件+行数+可展开 diff——与我们 B3.1 对齐）；Option+↑/↓ tab 导航（Shift 跳未读）
- **v2.0.25（10-08）**：**Office 文件预览**（Word/Excel/PPT）；**最近关闭的 tab 菜单**；命令面板空态列最近会话；终端连接瞬断存活；Markdown 可选中 + KaTeX 数学
- 布局事实（源码/PR）：对话列默认 600px；统一侧栏 256px（Codex 式，#20242）；文件树 200 + review 解耦开关（mod+\，#12481）；面板左右换边 PR 开着（#34419）

### 2.2 Claude Code Desktop（10-14 大更新 + docs）
- **Nested sessions**：并行任务各起嵌套会话、结果回灌主线程；**suggested follow-ups**（agent 主动建议下一步，一键开新会话）
- **Saved environments**（文件夹/SSH/云组合 + 每文件夹 worktree）+ 新会话页最近文件夹一键回
- 侧栏状态分组（working / needs-you）；回合内 live to-do；recap 卡；side rail（运行位置/上下文/改动）
- Pane 系统扩充：chat/diff/browser/terminal/file/plan/tasks/subagent + **iOS Simulator pane**；pane 可 pop out 独立窗口再 dock 回
- 文件编辑器（source view 直编，.claude 目录禁编）；**浏览器 pane 可涂画标注**；side chat（/btw、Cmd+;）
- 云会话（关机续跑）/ 手机 Dispatch / SSH / WSL；PR 监控（gh）；connectors（GitHub/Slack/Linear）；computer use

### 2.3 Codex App（CLI 0.162–0.164 + app 26.10xx + what's new）
- **Composer predictions**（10-09）：回应后在输入框自动补全建议的下一句，Tab 接受为可编辑草稿
- **Steer**：回应中发 follow-up 立即转向；打断同时停掉 Code Mode cells（0.163.0）
- **Auto-review**（"Approve for me"，10-06 免费化，settings>permissions）
- Worktree 工具（创建/列出受管 worktree）；Command Center 任务 **pin**（`p`，Pinned 组）；**Activity view**（侧栏铃铛 + Cmd/Ctrl+Opt+U，注意力视图）
- CLI：`/presets` 十槽可复用提示词；`/model` `/permissions` 内联参数；Kitty/Sixel 终端图片预览；凭据遮蔽
- **多仓 review**（multi-folder 项目逐仓行数 + 跨仓 diff）；**图片编辑**（放大查看/评论/挑选/定向修改）
- **Browser Developer mode**（CDP：profiling/console/网络/DOM）；**Site tools（WebMCP，网页自带工具）**；云环境复用/跨设备继续；Team Tasks；MCP 事件 webhook

### 2.4 dsh（0.1.7 系 → 0.2.1-alpha.3，dsh-tauri v0.25.0）
- **右栏「在新窗口全屏打开」**（dsh-tauri v0.25.0，10-22）；非主窗口「子窗口」chip
- **键位自定义**（查看/搜索/自定义/重置，侧栏显示当前绑定，0.1.7-rc.2）；**Cmd/Ctrl± 全局字号**（字/代码/终端一起）
- **归档会话管理**（pin/过滤/恢复；停止归档确认列出受影响的 rounds/subagents/tasks）
- 定时任务（提醒+运行历史+最细 1 分钟重复+重启存活）；Web 侧栏终端（多 tab/shell 选择/刷新恢复）；MCP resource 发现 + URI 模板
- **消息内密钥/token 自动打码**（可显）；/compact 手动压缩；子代理 **Agent Presets**（角色+工具捆绑）
- 「让 Agent 创建插件」（Creator mode）；genui 30+ 交互组件（表格/图表/表单/文件树/mermaid/3D）；Office Kit
- 社区：dsh-desktop-ui 插件（会话=可移动窗口+任务栏+贴边分屏+pop-out）

### 2.5 Kimi Code Desktop（1.0.0 → 1.1.1）
- **远程控制**（链接/QR 从手机/平板/他机接管本机 agent，任务本地执行；1.1.0 正式化）
- 右栏**文件树面板**（可左可右，Cmd/Ctrl+Shift+E）；**kimi app [path]** 终端唤起；Linux 版
- **进展更新 NotifyUser**（回合内短进展，Lab 开关）；**WaitFor 可被消息打断**（Enter/Ctrl-S 注入当前轮提前结束等待）
- 浏览器全家桶：**下载管理**（进度/暂停/继续/取消/重试+速度）、**Agent 浏览活动流**（会话记录实时展示、按活动分组+信息来源、Agent 控制时页面高亮描边、**可暂停 Agent 控制**、弹窗处理、Agent 主动展示指定页面）
- **可视化标注四件套**：截图标注（框选+评论）、划词评论、@文件、**网页元素点选**（自动捕获元素信息+截图+评论）
- /compact 可排队（运行期间排队轮到自动执行）；**/reload**（外部 AGENTS.md/skills/config 变更立即生效）；工作区信任确认；切换模型三选确认（新会话/压缩继续/直接继续）；多客户端占用提示
- Git 状态区（分支/领先落后/文件变化/**PR 关联**）；全屏模式（用户消息一行摘要可跳回）；目标/计划/Swarm/Tower（实验多 Agent）模式

### 2.6 pi 生态（pi-web-ui / pi-gui / Pi Desktop / openpi / Eco Coding / Pi 1.0）
- **pi-web-ui**：快照流式（<60ms）；`ask_user_question` 结构化问卷（**刷新可恢复**）；**Page Picker**（Chrome 扩展点选 DOM→视觉捕获+CSS 选择器进对话）；多会话并发 + **edit-and-fork / 消息撤回 ↩ / live migration**；多根工作区（1 主 + 8 辅，live watching）；**Remote SSH 项目**（ssh:// 直开远端仓库、SFTP 编辑、远端 PTY、环境探测装依赖）；`present_files` 交互产物卡；**server PTY + persistent ai-bash**（agent 在可见交互终端跑命令）；**visual Git 操控台**（inline diff/staging/commit/切分支/pull）；多引擎热切换（pi/DSH/Claude runtime）；沙箱项目模式（隔离克隆、临时/持久）；Goal Mode 2.0（Reviewer+Executor+证据注入+停滞熔断）
- **pi-gui**：**Queue and steer**；定时任务；Review tab（uncommitted vs branch vs 单回合基准切换、逐文件 stage）；会话树导航（fork/rewind 任意移动）；⌘K/⌘P/Ctrl-Tab/⌘1-9；每任务独立布局
- **Pi Desktop**：Mission Control 跨项目；**linked multi-repo task**（一次任务多仓、每仓一个 PR）；本地语音听写（Moonshine/Whisper/Parakeet）；权限规则库
- **openpi**：子代理 live 状态托盘+活动流+完成横幅；@mention 自动补全（子代理+文件 chips）
- **Eco Coding**：vision split（专职视觉模型）；built-in browser + computer use；手机端（自托管 relay）

## 3. 更新后的差距矩阵

### P0（多家收敛 + 高频 + 我们全缺）

| # | 缺口 | 谁有 | 我们现状 / 成本 |
|---|---|---|---|
| G1 | **截屏+批注**（框选屏幕区域+评论→发 agent） | Kimi[网络]、Claude（browser 涂画）[网络]、Codex（website annotations API）[网络] | 无用户侧截屏入口 [本地]。媒体管道现成（粘贴/上传→指针），纯 desktop 增量，成本低 |
| G2 | **网页元素点选**（点 DOM→截图+选择器+评论进对话） | Kimi element picking[网络]、pi-web-ui Page Picker[网络]、Codex site tools（WebMCP 变体）[网络] | BrowserDock 无 [本地]。webview `send`/executeJavaScript 可取节点信息；与 G1 同批=「圈选即上下文」 |
| G3 | **steer 进行中注入**（回应中追加消息立即转向，不打断） | Codex steer[网络 0.163]、Kimi WaitFor 打断（Enter/Ctrl-S 注入当前轮）[网络 v2.2.0]、pi-gui "Queue and steer"[网络] | 本地 turn queue + 网关 queue 都是「回合后发送」[本地]。需 gateway+runtime+事件三面（词汇表先行，同 10-08 §5.3 杠杆） |

### P1（明确缺口，快赢到中工程）

| # | 缺口 | 谁有 | 我们现状 / 成本 |
|---|---|---|---|
| G4 | **compact 入口+排队**（/compact 运行期排队自动执行） | Kimi[网络 v1.1.1] | desktop 无 compact 入口（TUI 有；gateway summarize 路由现成）[本地]。快赢：slash 组 + 复用 queue |
| G5 | **Git 状态/PR 交付闭环**（分支/领先落后/PR 关联/staging/commit） | Kimi Git 状态区[网络]、Claude PR 监控（gh）[网络]、pi visual git[网络] | changes 树+diff 审阅有；无 git 状态区/staging/PR [本地]。中工程，gateway git API 面 |
| G7 | **会话置顶/归档管理** | dsh（pin/过滤/恢复+停止归档确认）[网络]、Kimi（置顶+批量）[网络] | rail 无 [本地 grep]。纯 desktop + 少量 gateway |
| G8 | **未读/注意力视图** | Codex Activity view[网络]、opencode Shift+↑↓ 跳未读[网络]、Kimi 未读区[网络] | 无未读概念 [本地]。与 tray/通知联动 |
| G9 | **跨会话全文搜索** | Claude[既有]、pi-gui ⌘K 搜 chats[网络]、Kimi 全局搜索[网络] | 仅会话内搜索 [本地]。需 gateway 消息扫描 API（sessionStorageApi 可拼） |
| G10 | **suggested follow-ups + 最近文件夹/environments** | Claude[网络 10-14] | WelcomeHome 无最近文件夹快捷 [本地] |
| G11 | **!cmd shell 模式（desktop）** | opencode[既有] | 无 [本地]。TUI 有 `shell-mode.ts` 可移植，输出进 transcript 不进上下文 |
| G12 | **composer 外部编辑器** | opencode[既有]（TUI Ctrl+G） | 无 [本地]。TUI `external-editor.ts` 可移植 |
| G17 | **Agent 浏览活动流**（agent 驱动浏览器：活动流/高亮/暂停控制/弹窗） | Kimi[网络 1.0.2/1.1.0] | BrowserDock 纯用户侧，agent 无浏览器工具 [本地]。与 G2 同批评估（都在「agent×浏览器」块） |
| G32 | **后台任务续聊 UI** | （自家 API 已备） | `tasks.message` preload/SDK 就绪，renderer 零消费 [本地]。**最快赢** |

### P2（蓄水池，按需立项）

- **G6** 审阅基准切换（uncommitted/branch/单回合，逐文件 stage）— pi-gui
- **G13** composer predictions（下一句自动补全）— Codex
- **G14** 键位自定义 + 通知音 — opencode/dsh/Codex/openpi 四家
- **G15** 全局字号调节 — dsh
- **G16** 浏览器下载管理 — Kimi
- **G18** Browser Developer mode（CDP）— Codex
- **G19–G21** 远程/跨设备：远程控制（Kimi）/云会话+手机（Claude/Codex）/Remote SSH 项目（pi-web-ui）
- **G22** Office/媒体预览扩展（Word/Excel/PPT、HEIC/BMP）— opencode/Kimi
- **G23** 最近关闭 tab 菜单 — opencode
- **G24** 多仓 review — Codex（我们 worktree 多仓各一会话，语义不同）
- **G25** 图片编辑（评论/挑选/定向修改）— Codex
- **G26** auto-review 档（Approve for me）— Codex
- **G27** genui 式交互组件扩展 — dsh（我们 UserPluginCards 8-widget 通道在，可扩）
- **G28** 会话树导航（fork/rewind 树上移动）— pi-gui
- **G29–G31** 10-21 残留：tab 拖拽/中键、trajectory per-event inspector、todo↔goal 波次关联

### 记录（微交互，顺手项）

- **G33** 工作区信任确认（Kimi）；**G34** 消息内密钥遮蔽（dsh；我们 gateway 写路径有 redactSecrets，UI 层无）；**G35** /reload 外部配置生效（Kimi）；**G36** 切换模型三选确认（Kimi）

### 已对齐确认（10 月业界动向 × 我们）

Changed-files-by-turn（opencode v2.0.30 ↔ B3.1 per-turn diff）；persistent terminal（opencode v2.1.0 Win ↔ terminal dock）；文件树+点击预览（Kimi 1.1.0 ↔ FilesDock/EditorDock，我们早于其桌面版）；划词引用（Kimi Web ↔ B2 quote-reply）；排队条（Kimi 排队消息 ↔ queue inbox + turn queue）；侧栏状态可见（Claude ↔ rail badge + work bar）；本地语音听写（Pi Desktop ↔ 我们 voice 全链路更全）；审批三档（Kimi 正式化同构）；结构化问答（pi `ask_user_question` ↔ `mafw_ask_user` 流卡；pi 的「刷新可恢复」值得抄）。

## 4. T1（共享终端）特别情报

- **opencode v2.1.4 已发布**（10-23），changelog 明确：实验开关（experiments dialog）提供 `tui_open_terminal` / `tui_write_terminal`，让 agent 在**不抢键盘焦点**的情况下打开并输入**会话终端**（#57506）[网络]。T1 的解冻条件「opencode ≥2.1.4 重跑 wire 实证」**现在可执行**——注意两点：①目前挂在 experiments 开关下；②语义面向 TUI 会话终端，serve 模式 + 非 TUI 客户端（我们 desktop）的行为待证。
- **pi-web-ui 的 ai-bash 是共享终端的已上线先例**：server PTY（node-pty + xterm.js）+ persistent ai-bash 会话，「AI 在可见的交互终端里跑命令」[网络]。T1 设计可直接参照其「同屏可见 + 持久会话 + 命令归属显示」三要素。
- Kimi 的「Agent 控制浏览器可暂停」是同一信任模型在浏览器面的实现（agent 代理可见 + 用户可收回）——T1 的 UX 语言可对齐（用户终端被 agent 使用时描边/可暂停）。

## 5. 建议排期（供立项讨论，非决策）

1. **P0 三件**：G1+G2 同批（「圈选即上下文」——截屏批注 + 元素点选，媒体管道与 BrowserDock 都在，纯增量）；G3 steer 单独立项（事件词汇表先行，gateway/runtime/desktop/TUI 四面）。
2. **P1 快赢串**：G32 续聊 UI（API 已备）→ G4 compact → G11/G12（TUI 移植）→ G7 置顶/归档 → G9 跨会话搜索。
3. **P1 中工程**：G5 Git/PR 闭环、G8 未读/注意力、G17 agent×浏览器（与 G2 合并评估）。
4. **T1 解冻动作**（独立小任务）：serve 模式重跑 `tui_open_terminal`/`tui_write_terminal` wire 实证（参考 `docs/research/2026-10-22-phase2-wire-probe.md` 契约）。
5. 工作台合并（已定 spec）与本矩阵并行不冲突——G2/G17 的 UI 落点就在合并后的工作台里。

## 来源

- 本地：explore 子代理 2026-10-26 全量核对（`packages/desktop` 18 项，file:line 级）；`docs/research/2026-10-21-six-way-frontend-interaction-gap-survey.md`（基线）
- 网络（2026-10-26 读取）：opencode.ai/changelog（v2.0.25–v2.1.4）；code.claude.com/docs/en/desktop + whats-new + changelog（2.1.310）；learn.chatgpt.com/docs/changelog（Codex CLI 0.162–0.164 / app 26.10xx / what's new）；whatsnew.fyi/product/deepseek-harness（0.2.1-alpha.3）+ dshseek.com（0.1.7→0.2.1-alpha.1）+ github.com/dsh-tauri/deepseek-harness-desktop（v0.25.0）+ dsh-plugin-genui release notes；kimi.com/code/docs（changelog 1.0.0–1.1.1 + whats-new）；pi.dev/packages/pi-web-ui + pi-desktop.com + pi-gui.com + github（openpi / Eco Coding #9327 / pi PR #8840）+ earendil.com/posts/pi-1-0
