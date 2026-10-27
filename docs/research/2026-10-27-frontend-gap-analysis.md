# 前端交互/功能差距调研（MAFW Desktop vs opencode v2 / Claude / Codex / DSH / Pi / Kimi）

> 调研日期：2026-10-27。方法：以官方文档/changelog/仓库为准逐项提取（三组并行），我方现状从本仓库组件与交付记录盘点。
> 基线：opencode v2.2.0；Claude Code v2.1.311；Codex App（2026-07 并入 ChatGPT，桌面版）；Kimi Code Desktop 1.1.4 / CLI 2.3.3；DSH 0.2.1-rc.3；Pi 1.4.0。
> **硬约束**：任何执行隔离/沙箱改造（WSL、VM、sandbox）都**不得影响用户自己的桌面**（文件、进程、网络、窗口），只能约束 agent 子进程。

## 一、我方 Desktop 现状（盘点）

**会话与导航**
- 左 rail：项目 + 会话（日期分组、Manager 置顶、worktree 徽标、未命名兜底）、项目切换、新建会话/并行 worktree、搜索、便签、Dashboard、Config。
- 会话标签条、Welcome、历史分页、transcript 搜索（Ctrl+O）、消息导航、会话重命名/删除、fork/revert/unrevert。
- checkpoint/rewind 时间线 + per-turn diff；回合软暂停/恢复；turn queue + 网关队列；子代理跳转、后台任务、轨迹视图。

**输入与上下文**
- @文件（模糊）、@agent、slash（本地+网关+自定义）、skills 列表（只读）、MCP 命令（只读）、模型/agent/thinking、附件（图片/视频/音频→Media Agent）、语音输入/TTS、截屏批注、网页元素点选、队列、暂停、审阅改动、聊天选区引用（quote-reply）、输入历史/readline、拖拽。
- 预览内批注：源码行锚、md/docx 引文锚、JSON 路径锚、CSV/XLSX A1、图片/SVG 区域+裁剪截图、PPTX 页码+坐标；锚点旁输入（下方→上方→左右+clamp）、Enter 直发/Ctrl+Enter 草稿、原地高亮/图钉、回合状态、点击外部关闭。

**文件与编辑器**
- 文件树、CodeMirror 编辑+保存+外部变更 watch+冲突处理。
- 预览：图片 8 型 / SVG / CSV / TSV / Markdown / JSON 树 / HTML / PDF / XLSX / DOCX / PPTX。
- diff/review：会话改动树、行评论、hunk 反转、按回合 diff。

**工作台**
- L1 工作台/执行/审阅；L2 文件/浏览器；左 dock 工作/搜索/便签；终端（PTY，Ctrl+`，跟随目录）；浏览器（webview、元素点选）；布局档位 520/640/760、窄屏 overlay。

**执行与反馈**
- 执行视图：概览/待办/子代理/后台/轨迹；用量/配额；审批/权限三档+规则；问答卡；通知/托盘/close-to-tray；流式 Markdown、30+ 工具卡、thinking、成本/Token。
- Goal 编排时间线、Manager、记忆/便签页、Triage/Automations/Dashboard、插件中心（runtime/media/usage/ui）。

**平台**
- 3 主题、命令面板、配置页、应用自动更新、单窗口、固定快捷键。
- **缺**：MCP/Skills/Hooks 管理 UI；桌面端会话导出/分享；OS 级执行沙箱（仅审批门）。

## 二、竞品能力摘要（只列与我们相关的最强项）

**opencode v2**
- 消息级 `Fork from here` / `Rewind to here`（含文件恢复、toast Undo）；`/undo` `/redo`；Git 快照默认开。
- side/split/bottom 三窗格、拖标签、多文件 tab、Focus/Pro 布局；`⌘1–9` tab、背景活动胶囊。
- 选区 `Quote` 工具条 → composer chip；文件/Review 行评论（gutter `+`，评论作为下一条 prompt 上下文）。
- TUI diff 四 scope（All/Committed/Uncommitted/Last turn）+ split/unified + mark reviewed；桌面 Changes 按回合。
- 跨在线 server 搜索会话/项目；`opencode pair`/PWA 远程；30+ 主题 + 可自定义 keybinds（which-key）；GUI plugin SDK；MCP OAuth + 输入表单；`/btw`、`!shell`、外部编辑器。

**Claude Code**
- 分屏/新窗口/ pane 弹出；跨会话消息；`claude agents` 背景会话总览；Cloud/SSH/WSL 多环境。
- checkpoint/rewind（最近 100 个）；worktree 开关；后台任务/子代理。
- **Plan 模式 + VS Code 计划 Markdown 行内批注**（v2.1.70+，可“Send feedback and keep planning”）。
- Desktop diff 行评论 + `Cmd+Shift+D`；VS Code 逐改 Accept/Reject；Artifact 网页评论/自动回复。
- Browser pane + 元素选择（`Cmd+Shift+S`）；多 pane 拖拽/弹出；iOS Simulator；autoVerify；prompt suggestions；voice dictation；权限模式（Auto 默认）+ 权限提示评论；`/skills` `/hooks` `/mcp` + Desktop 连接器；Mods 插件可绘 pane/toast。

**Codex**
- **浏览器 Annotation mode**（`Cmd+Shift+.`，元素/区域 + 样式 Adjust 预览）；Appshots（双 Cmd 截前台窗口）。
- Review pane 全量 Git 视角（Unstaged/Staged/Commit/Branch/Last turn）+ per-hunk stage/revert + diff 内联编辑 + PR review（gh 登录）。
- Worktree + Handoff（Local↔Worktree）+ 永久 worktree；Cloud 会话；Goal mode；Automations；Remote/mobile。
- 可搜索/改键的 Keybindings（CLI `/keymap`）；主题编辑器（accent/contrast/fonts、import/share）；`codex://` deep links；composer predictions；voice chat；plugins/skills/hooks/MCP；审批/沙箱（Read Only/Auto/Full + Auto-review）。

**Kimi Code**
- Goal；Swarm 并行子代理；Tower（mission worktree + 独立 reviewer + 通过才 merge，实验性）。
- Desktop 内置浏览器元素/区域批注 → Composer；对话/文件预览/diff/终端选区 comment/quote；Shift+Cmd+S 截图批注。
- 三档权限（Always Ask / Ask When Needed / Never Ask）+ 危险命令 guard；声明式 Hooks。
- 会话 fork/export/pin/search/archive、AI 标题、side chat、队列/steer；可自定义 Desktop 快捷键；插件市场；MCP 一键（VS Code）。
- Web 会话头 PR 状态（draft/open）；Remote Control 手机接管；CLI/Desktop 同会话占用提示。

**DSH**
- Web + Electron 桌面壳（关窗隐藏继续跑、托盘、单主窗）；三栏 + dockkit（分屏/标签/浮动面板）。
- 右栏四页：文件树 / 终端 / 浏览器 / 文档预览（Markdown/代码/PDF/HTML/图片/表格；Word/PPT 本地转 PDF）。
- 原生划词 Quote（Markdown blockquote + hover 引用卡）；第三方批注插件（编号卡片暂存/气泡内联/摘要+正文锚点）。
- Plan 提交后右栏审阅（批准/拒绝/忽略）；审批卡键盘流（Enter 允许/Esc 拒绝）；提问卡（倒计时/草稿保留）；权限预设（sandbox mode + approval policy）。
- 子代理目录、后台 jobs、定时任务、Goal、Trajectory、点赞点踩；插件市场（Discover/索引源/版本回装）；可自定义快捷键；主题字体/字号；i18n。

**Pi**
- 终端 TUI；会话树 `/tree`（回到历史点编辑即新分支）、`/fork` `/clone`、离开分支摘要、`/compact`、`/export` `/share`。
- steering（Enter）/ follow-up（Alt+Enter）/ Alt+Up 取回；全屏鼠标：滚轮、拖选、选择即复制、OSC8 链接。
- `pi-slopchop`：`/slopchop` `/diff` 审阅工作区，行/文件/整体批注，**FIX/DISCUSS** 意图，模板快捷键，prompt 暂存不自动发；`pi-diff-review` 原生窗口（Monaco）。
- 扩展 API 可替换 TUI 组件/编辑器/header/footer，`custom()` 自定义屏；`pi install` npm/git/local；可自定义 keybindings；主题；无内建子代理/plan/后台（靠包）。

## 三、差距矩阵

图例：✅ 已有；🟡 部分/弱；❌ 缺。价值/成本为 1–5。

| # | 能力 | 我们 | 谁有 | 价值 | 成本 | 优先级 |
|---|---|---|---|---|---|---|
| 1 | **执行沙箱/隔离**（约束 agent 子进程，不影响本机桌面） | ❌（仅审批） | Claude / Codex / DSH | 5 | 5 | **P0** |
| 2 | **Plan 审阅工作流**（计划文档 + 批注 + 批准/拒绝/继续规划） | 🟡（有 plan agent/编排，无计划审阅 UI） | Claude / Codex / DSH / Kimi | 5 | 3 | **P0** |
| 3 | 桌面端会话导出/分享（Markdown/JSON/链接） | ❌（仅 TUI /export） | opencode / Kimi / Pi / Claude(artifact) | 4 | 2 | **P1** |
| 4 | 多面板分屏 + pane 弹出/拖动 | ❌（固定档位布局） | Claude / Codex / opencode / DSH | 4 | 4 | **P1** |
| 5 | 运行中 steer（插话转向，区别排队） | 🟡（队列+暂停，无 steer） | Claude / Codex / opencode / Kimi / Pi | 4 | 3 | **P1** |
| 6 | 自定义快捷键（录制/冲突检查/恢复默认） | ❌（固定） | 全部五家 | 4 | 2 | **P1** |
| 7 | MCP 管理 UI（服务器列表/OAuth/输入表单/启停） | ❌（仅命令只读） | Claude / Codex / Kimi / opencode | 4 | 3 | **P1** |
| 8 | Skills / Hooks 管理 UI（安装/编辑/启停/信任） | 🟡（skills 只读列表） | Claude / Codex / Kimi / opencode / DSH | 4 | 3 | **P1** |
| 9 | 选区引用成 chip（引用到输入框，非直接发送） | 🟡（批注直发；聊天 quote 有） | opencode / DSH / Kimi / Claude | 3 | 2 | **P1** |
| 10 | 会话树/分支可视化（回到任意点、分支摘要） | 🟡（fork/revert 有，无树 UI） | Pi / Claude / opencode | 3 | 3 | P2 |
| 11 | PR 状态 / PR 内 review | ❌ | Kimi(Web) / Codex / opencode(GitHub /oc) | 3 | 3 | P2 |
| 12 | 会话归档/pin/跨会话搜索 | 🟡（搜索有；归档/pin 弱） | 全部 | 3 | 2 | P2 |
| 13 | 跨会话消息 / agent view（背景会话总览） | ❌ | Claude | 2 | 3 | P2 |
| 14 | 插件市场（Discover/索引/版本回装/共享） | 🟡（插件中心，无市场） | DSH / Kimi / Codex / Claude / opencode | 3 | 3 | P2 |
| 15 | 批注意图 FIX / DISCUSS | ❌ | Pi | 2 | 1 | P2 |
| 16 | diff 内联 AI 编辑（在 diff 里直接改） | 🟡（CodeMirror 可改；diff 内不可） | Codex / Claude(VS Code accept) | 3 | 3 | P2 |
| 17 | 远程/移动接管（手机继续任务） | ❌ | opencode / Kimi / Codex / Claude | 2 | 4 | P3 |
| 18 | Prompt suggestions / composer predictions | ❌ | Claude / Codex | 2 | 2 | P3 |
| 19 | 主题编辑器 / 多语言 | 🟡（3 主题、中文） | Codex / DSH | 1 | 2 | P3 |
| 20 | 会话评分/反馈 | ❌ | DSH / Kimi | 1 | 1 | P3 |

**我们领先/对齐（不需要抄）**：文件预览矩阵（Office/PDF/JSON/CSV）、预览内批注与锚点原地反馈、终端/浏览器/元素点选、语音输入+TTS、Goal/Manager 编排、checkpoint+per-turn diff、审批三档、执行/轨迹视图、托盘/close-to-tray。

## 四、建议路线

**P0（下一批，二选一或并行）**
1. **执行沙箱**：默认仍是审批；新增可选「隔离模式」——agent 子进程跑在受限沙箱（Windows AppContainer/Job Object + 受限 token；或用户显式选择的 WSL/VM），**文件/网络/进程不得越出授权工作区，绝不触碰用户桌面**；能力门 + 配置页开关 + 失败回退审批模式。参考 Codex Read Only/Auto/Full、Claude sandbox、DSH permission preset。
2. **Plan 审阅**：plan 节点产出 Markdown 计划 → 工作台「计划」面板（可批注，复用现有批注锚点）→ 批准 / 拒绝并反馈 / 继续规划；批准后进入 execute。参考 Claude VS Code 计划批注、DSH plan review。

**P1（体验补齐，按价值排序）**
3. 桌面会话导出/分享（Markdown + 复制链接；本地文件即可，无需云）。
4. 自定义快捷键（配置页录制、冲突检查、恢复默认）。
5. MCP 管理 UI（列表/启停/OAuth/输入表单）+ Skills/Hooks 管理（信任/启停）。
6. Steer（运行中插话）：复用队列通道，增加「立即注入当前 turn」语义与 UI。
7. 选区引用 chip（把现有批注锚点同时支持「引用到输入框」）。
8. 多面板分屏（先把编辑器/浏览器/终端做成可拖拽 split，再考虑弹出窗口）。

**P2/P3**：会话树、PR、插件市场、FIX/DISCUSS、diff 内联编辑、远程/移动、prompt suggestions、主题编辑器。

## 五、批注模式的结论（补充）

- 常驻「批注模式」在编码 agent 中几乎不存在；只有 **Codex 浏览器 Annotation mode**（元素/区域，需显式开关）与 **Claude HTML 报告 Comment mode**（点击语义冲突）使用模式。
- 文件批注的主流是「选中 → 直接评论/引用」（opencode/DSH/Kimi/Claude），我们 rev4 已对齐；无需恢复模式按钮。

## 来源

- opencode：changelog https://opencode.ai/changelog；TUI/keybinds/attachments/snapshots/agents/skills/permissions/mcp https://opencode.ai/v2/docs/*；PR #58970/#58865/#55664/#56960/#57182；issue #11502。
- Claude：https://code.claude.com/docs/en/{desktop,vs-code,sessions,checkpointing,worktrees,permission-modes,interactive-mode,artifacts,sub-agents,agent-view,voice-dictation,changelog}。
- Codex：https://developers.openai.com/codex/{app/browser,code-review,app/worktrees,cli,ide}；https://learn.chatgpt.com/docs/{projects,reference/commands,reference/slash-commands,agent-approvals-security,image-inputs,notifications,plugins,artifacts-viewer,whats-new}。
- Kimi：https://www.kimi.com/code/docs/en/kimi-code-desktop/*（getting-started/interface-and-sessions/project-and-session-management/input-and-context/task-execution-and-review/built-in-browser/remote-control/settings-and-extensions/changelog）；CLI 文档；issue #2642。
- DSH：https://github.com/deepseek-ai/deepseek-harness（packages/client/ui-*、apps/desktop、docs/guide/plugin-market）；message-quotes；第三方批注插件仓库。
- Pi：https://pi.dev/docs/latest/{usage,sessions,keybindings,packages,settings,slash-commands,usage}；https://pi.dev/packages/pi-slopchop；badlogic/pi-diff-review；npm pi-diff-review。
