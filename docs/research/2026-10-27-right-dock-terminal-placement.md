# 右 dock 终端归属调研：L2 tab vs 底部横条（现状）

日期：2026-10-27
问题：右 dock 的终端该迁入工作台 L2 tab 行（代码 / 浏览器 / 终端），还是保持现状（L1 行尾开关钮 + 跨视图底部横条）？只调研不决策。

## 一、现状（代码级）

- **结构**（`WorkbenchShell.tsx`）：L1 行 = `工作台 / 执行 / 审阅` tabs + spacer + **终端开关钮**（icon-only，`aria-pressed`）；L2 行（仅工作台视图内）= `代码 / 浏览器`；终端渲染为 **dock 底部横条** `.mafw-rw-terminal`（`height:280px; max-height:45%; border-top`，`is-collapsed` 时 `display:none` 保实例保 scrollback，`mafw.css:2868-2869`）。
- **跨视图**：终端条在三个 L1 视图（工作台/执行/审阅）下方**都可见**——「终端跨视图持久」是 10-26 B/B1 布局的 GUI 验收项（既定需求，非偶然行为）。
- **默认开**：`mafw-workbench-terminal` localStorage 持久化，缺省开（cf8224ae 终审修复「终端默认开」）。
- **无键盘快捷键**（无 Ctrl+\` 绑定）。
- **来历**：2026-10-26 workbench-merge spec 定稿「IDE 骨架：文件树 200px + 编辑器/浏览器主 tab + **底部终端 280px 可收起**」——底部横条是当时的**设计决策**，不是历史遗留。

## 二、业界做法

### 2.1 IDE 参照系（终端=底部面板是压倒性默认）

| 产品 | 终端归属 | 要点 |
|---|---|---|
| **VS Code** | **底部 Panel**（默认）；1.84 起可「Move Terminal into Editor Area」**opt-in** | 面板与编辑器**同屏**是默认体验；编辑区 tab 化是显式用户选择，有专门命令/菜单项，社区插件（Terminal in Editor Tab）都是「搬运」语义而非默认 |
| **Cursor / Windsurf** | 同 VS Code（底部 Panel） | 继承基座，未改动终端模型 |
| **Zed** | **dockable Panel，默认 dock bottom**（`terminal.dock: bottom`，default_height 320px） | 可配 left/right，但即便 dock 到右侧也是与编辑器**并排的 panel**，不是编辑区 tab；Ctrl+\` 开合。侧证：Zed agent 面板 default_width 恰为 **640px**（与我们工作台默认档相同） |
| **JetBrains** | Terminal = **tool window**，默认底部 | 方向感规范：「横窗放宽内容（终端/日志）」——宽内容就该横放底部 |

### 2.2 六家 agent 桌面（10-26 六家复测 + 本轮补查）

| 产品 | 终端归属 | 与本题的相关性 |
|---|---|---|
| **Claude Code Desktop** | **pane 系统的一员**（chat/diff/browser/terminal/file/plan/tasks/subagent + iOS Simulator），pane 可 pop out 独立窗口再 dock 回 | 唯一「终端即 tab/pane」的大厂案例——但其 pane 铺在**宽主区网格**里，pane 间可并排同屏；不是窄栏内互斥 tab |
| **opencode desktop** | 2026 新布局以 session tab 为中心；文件树/终端在新布局中存在但社区反馈 buggy（reddit 1vgbx5v、issue #36997/#42031），旧布局可回退 | 布局仍在动荡期，不足为范式依据 |
| **dsh** | **Web 侧栏终端**（多 tab / shell 选择 / 刷新恢复）；右栏可弹新窗口全屏 | 侧栏内终端=带自持 tab 条的**面板**，与其余面板同屏而非互斥 |
| **Kimi Code Desktop** | **无内嵌终端面板**（`kimi app [path]` 唤起外部终端）；右栏是文件树 | 不参照 |
| **Codex** | `backgroundTerminals` RPC 管理后台终端（list/terminate/clean），非主界面面板 | 终端在 Codex 是后台资源不是工作台面 |
| **pi 生态（pi-web-ui）** | server PTY + persistent ai-bash：agent 在**可见交互终端**里跑命令 | 终端是**持续可见**的工作面，不是切走的 tab |

### 2.3 收敛规律

1. **窄栏/侧栏语境下，终端=横放底部面板**（VS Code/JetBrains/Zed/dsh 四家一致）；编辑区 tab 化只在**宽主区**语境出现（Claude pane 网格、VS Code opt-in）。
2. **同屏可见是底部面板存在的核心理由**：看代码/预览页面的同时盯 dev server 日志或构建输出。Zed 社区对并行 agent 的诉求原文就是「终端与 agent 面板同屏可见」。
3. **面板有自己的 chrome**：VS Code 面板头（标题+最大化/关闭）、JetBrains tool window header——开关 affordance 长在面板上，不寄生在别的 tab 行里。

## 三、方案对比

### B：迁入 L2 tab（代码 / 浏览器 / 终端）

- ✔ L1 行变纯 tab 行，模型统一；终端激活时获得全部内容高度（~600-700px vs 280px）。
- ✘ **丢同屏**：终端与代码/浏览器互斥——IDE 底部面板的核心理由被砍掉（改代码↔看输出、浏览器预览↔dev server 日志都是高频同屏对）。
- ✘ **跨视图回归**：L2 行只存在于工作台视图，终端将从执行/审阅视图消失——直接违反 10-26 B/B1 验收项「终端跨视图持久」（既定需求）。
- ✘ 推翻 10-26 workbench-merge spec 的 IDE 骨架决策与 cf8224ae「终端默认开」修复，需要新 spec 明确推翻理由。

### A：保持底部横条（现状）

- ✔ 同屏 + 跨视图 + 默认开，三条既定需求全保；与 IDE 压倒性默认一致。
- ✘ L1 行尾开关钮语义上是**动作**不是 tab（今日已统一填充选中样式，视觉违和已缓解）；底部条常驻吃 280px 垂直空间。

### C：A + 增量补强（不动结构的小件，按需立项）

- **C1. Ctrl+\` 快捷键**：VS Code/Zed 肌肉记忆，当前无任何键盘入口。成本极小。
- **C2. 终端条 slim header**：标题「终端」+ 收起 chevron（+ 现有外部终端出口迁入），开关 affordance 长在面板自己身上（VS Code 面板头 / JetBrains tool window header 模式）；L1 行钮可保留为快捷开关或退役。
- **C3. 最大化面板**：长 scrollback 场景把终端临时撑满内容区（VS Code maximize panel 语义），回应「tab 化能拿到全高」的唯一实质诉求。

## 四、结论（调研建议，待用户裁决）

**保持现状（A）**：底部横条是 IDE 参照系在窄栏语境的一致解，且承载三条既定需求（同屏/跨视图/默认开）；B 的实质收益只有「全高」，可由 C3 点对点解决，不值得付出同屏与跨视图回归。若痛点是开关钮突兀或缺键盘入口，走 C1/C2 增量。

## 来源

- VS Code Terminal Basics /「Move Terminal into Editor Area」（1.84+）：<https://code.visualstudio.com/docs/terminal/basics>、SO/Reddit 相关问答
- Zed 终端文档与 panel system：<https://zed.dev/docs/terminal>、<https://zed.dev/blog/new-panel-system>（`terminal.dock: bottom`、`default_height: 320`、agent `default_width: 640`）
- opencode desktop 新布局社区反馈：reddit r/opencode 1vgbx5v、GitHub issue #36997 / #42031、X @opencode「Introducing Tabs」
- Claude Code Desktop pane 系统、dsh 侧栏终端、Kimi/Codex/pi 生态：`docs/research/2026-10-26-six-way-frontend-gap-resurvey.md` §2
- IDE 方向感（宽内容横放）：`docs/research/2026-10-26-right-dock-workbench-consistency-survey.md` §二（JetBrains）
- 本仓库：`WorkbenchShell.tsx`、`mafw.css:2801-2869`、`MafwShell.tsx:1480-1571`、`docs/superpowers/specs/2026-10-26-workbench-merge-design.md`、commit `cf8224ae`
