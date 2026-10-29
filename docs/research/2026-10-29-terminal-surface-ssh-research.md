# 右 dock 终端地位与 SSH 远端连接调研

日期：2026-10-29
问题：右 dock 的终端是否应从「底部 280px 常驻条」升为与「文件 / 浏览器」同级的 L2 surface？现有文件、编辑器、浏览器为什么观感割裂？业界怎么做？SSH 远端连接应做到什么程度？

结论摘要：

1. **终端升为 L2 surface（方案 A）**，内部再做本地/SSH 会话 tab 与主机管理；底部条退役；C（文件/浏览器/终端统一标签条）作为终态备选。
2. 现有割裂的根因不是控件样式，而是**层级语义**：L2「文件」里面装的是文件树 + 编辑器，编辑器又有自己的标题和 tab 条；终端既不是 L1 也不是 L2，而是另一套底部常驻条。
3. 业界没有唯一答案：VS Code / Zed / JetBrains 默认把终端放底部面板，但三家都支持把终端开进主编辑区；Xshell / Tabby 这类终端客户端本来就是「会话 tab + 主机管理」为主界面。**当终端从辅助工具变成工作区时，主区域 tab 是更合适的模型。**
4. SSH v1 建议做「终端会话」而非远端工作区：保存主机、多会话 tab、密码/密钥/agent、保存密码（safeStorage）、跳板机、主机指纹、手动 + 自动重连。远端文件树/SFTP 明确后置。

## 一、现状（代码级）

### 1.1 层级与 chrome

右工作台由 `WorkbenchShell.tsx` 组装：

- L1（38px）：`工作台 / 执行 / 审阅`；工作台视图行尾有一个终端开关图标。
- L2（32px）：`文件 / 浏览器`（`WORKBENCH_SURFACES`，`workbench-views.ts:25-28`）。
- 内容：
  - `文件` → `WorkbenchCodeView`：左文件树 200px（`FilesDock`）+ 右侧 `EditorDock` 或 `BrowserDock`（`WorkbenchCodeView.tsx:31-66`）。
  - `浏览器` → `BrowserDock`。
  - `执行` → 五个二级分区；`审阅` → `ChangesDock`。
- 终端：`WorkbenchShell.tsx:197-205` 的 `.mafw-rw-terminal`，高 280px、`max-height:45%`、`is-collapsed` 时 `display:none`；只在工作台视图显示（`terminalStripVisible`，`workbench-views.ts:79-82`）。

实际渲染出来的「条」：

| 面 | 顶部 chrome | 内容 |
|---|---|---|
| 文件 + 编辑器 | L1 38 + L2 32 + 编辑器标题 32 + 编辑器文件 tab 条约 28 | 文件树 200 + CodeMirror |
| 浏览器 | L1 38 + L2 32 + 浏览器标题 32 + 地址栏 32 | webview |
| 终端 | L2 32 + 终端标题 32 | xterm（底条 280） |
| 执行 | L1 38 + L2 32 | 分区内容 |
| 审阅 | L1 38 | diff |

### 1.2 割裂清单（按观感影响排序）

1. **「文件」这一层装的是编辑器**：L2 叫「文件」，实际内容是文件树 + 编辑器 + 文件预览；编辑器不是 L2 的对等项，但它的标题和 tab 条让它看起来像第三层。
2. **编辑器有两条头**：L2 下面还有 `DockPanelHeader title="编辑器"`（`EditorDock.tsx:869`）和 `.mafw-editor-tabs`（`:927`）。同一块区域两层导航，且 L2 不控制编辑器 tab。
3. **终端不在同一套层级里**：终端既不是 L1 也不是 L2，而是底部常驻条；开关在 L1 行尾，面板头又写目录名（`TerminalDock.tsx:248`）。
4. **四个面四种 chrome**：文件树一条头、编辑器两条、浏览器两条、终端一条底条；同类「面板头」出现多种高度、padding、分隔线。
5. **切换语义不一致**：文件/浏览器是互斥 L2；编辑器 tab 是另一套互斥；终端是常驻浮层式底条。用户要在三套导航之间建立心智模型。
6. **终端底条限制远端工作**：280px（最多 45%）只适合看日志/跑一条命令；SSH 多会话、长输出、主机切换都憋屈。终端没有会话 tab、没有主机管理、没有 SSH。

### 1.3 之前的 terminal 工作

- 设计：`docs/superpowers/specs/2026-10-26-terminal-dock-design.md`；计划：`docs/superpowers/plans/2026-10-26-terminal-dock.md`。
- 实现：`TerminalDock.tsx`（xterm + fit）、`main/terminal/terminal-bridge.ts`（每目录一条 WS、fanout、ticket、scrollback replay）、`main/terminal/terminal-core.ts`（纯逻辑）、preload `window.api.mafw.terminal.*`。
- 关键决策：
  - **不共享给 agent**：这是用户终端，不是 agent 工作间；agent 侧仍走 BackgroundDock/工具卡。
  - **跟随目录**：普通会话=项目目录，worktree=worktree 目录；同目录会话共用一个 PTY。
  - **persistent**：serve 托管 PTY，桌面关窗/重载/渲染层崩溃后不杀；serve 重启则 PTY 全灭，面板提示「已随服务重启关闭」并允许重开。
  - **单终端/目录**：v1 不做多 tab、分屏。
- 2026-10-27 用户裁决：终端只属工作台视图，执行/审阅不显示终端；Ctrl+` 开合（`workbench-views.ts:79-89`，commit `019357d0`）。
- 2026-10-27 归属调研：`docs/research/2026-10-27-right-dock-terminal-placement.md`，当时结论是保持底部条，理由是 IDE 默认 + 同屏 + 跨视图。本轮需求把「终端作为 SSH 工作区」的权重提高了，因此重新评估。

### 1.4 现状的结构性限制

- 会话键是 `directory`（`terminal-bridge.ts` 的 `dirKey`），一个目录只能有一个终端；无法开多个 SSH 会话。
- 没有主机配置、凭据、known_hosts、重连策略。
- 底条高度固定 280px，且与编辑器/浏览器互斥（工作台视图内可以同时看到代码 + 终端，但终端只有 280px）。
- 终端 UI 与工作台表面（文件/浏览器）不是同一套 surface 模型，迁移成本会随功能增加而上升。

## 二、业界做法

### 2.1 IDE：终端默认在底部，但都支持进主区域

| 产品 | 默认 | 终端进主区域 | 关键机制 |
|---|---|---|---|
| **VS Code** | 底部 Panel | ✅ Terminal Editor：`Terminal: Create New Terminal in Editor Area`、拖 tab 进编辑区、`terminal.integrated.defaultLocation: "editor"` | 终端 tab 与文件 tab 同一编辑器组；支持 split/group；面板有自己的最大化/关闭 |
| **Zed** | 底部 Panel（`terminal.dock: bottom`，默认高 320） | ✅ Center Terminal：命令面板 `workspace: new center terminal`，作为普通 tab 与文件并列 | panel 可 dock 左/右/底；center terminal 是常规 tab |
| **JetBrains** | 底部 Tool Window | ✅ 右键 Terminal 头 → `Move to Editor` | tool window header 自带动作；terminal tab 可 split right/down；SSH session 可从工具栏新建 |
| **Cursor / Windsurf** | 同 VS Code | 继承 VS Code | 未改终端模型 |

结论：**底部是 IDE 的默认，主区域 tab 是显式可选模式**。VS Code 甚至提供 `defaultLocation` 让用户把「编辑器区」设为默认。两种模式都被主流 IDE 承认，不是异端。

### 2.2 终端客户端：会话 tab + 主机管理是主界面

| 产品 | 模型 | 远端能力 |
|---|---|---|
| **Xshell** | 多 tab、tab group、split/merge、Session Manager、Tab Manager、Quick Command、Compose Pane | SSH1/2、SFTP、Telnet、Rlogin、Serial、RDP；Jump Host、Proxy、Keepalive、Auto Reconnect、Authentication Profile、主密码/云同步 |
| **Tabby** | 多 tab、嵌套 split pane、profile/connection manager、session restore | SSH2、SFTP、端口转发、Jump Host、Agent Forwarding、X11、Zmodem、加密凭据容器 |
| **Wave** | block 平铺工作区（终端/文件预览/编辑器/浏览器/AI） | Durable SSH（断线/重启存活、自动重连）、远端文件编辑、SFTP 同步 |
| **Windows Terminal** | tab + pane，profile | 本身不是 SSH 客户端；靠 `ssh` 命令 |

结论：**当终端是主工作区时，tab + 会话管理 + 分屏 + 凭据/主机配置是基本盘**，不是高级功能。Xshell/Tabby 的「一个窗口管所有远端会话」正是用户说的「像 Xshell」。

### 2.3 Agent 桌面

| 产品 | 终端归属 | 备注 |
|---|---|---|
| **Claude Code Desktop** | pane 系统的一员（chat/diff/browser/terminal/file/plan/tasks/subagent） | pane 铺在宽主区网格，可 pop out；不是窄栏互斥 tab |
| **opencode desktop** | session tab 为中心；文件树/终端存在但布局仍在动荡 | 不足为范式 |
| **Kimi Code Desktop** | 无内嵌终端（唤起外部终端） | 不参照 |
| **Codex** | `backgroundTerminals` RPC 管理后台终端 | 终端是后台资源，不是主界面 |
| **pi-web-ui** | server PTY + persistent ai-bash | 终端是持续可见的工作面 |

结论：agent 桌面里，终端要么是宽主区的 pane，要么是后台资源；**窄栏底部条不是唯一形态**。我们的右 dock 本质是「窄栏」，所以需要显式选择：底部（同屏）还是 L2（全高）。

### 2.4 远端开发（Remote SSH）与「SSH 终端」的区别

| 能力 | SSH 终端（Xshell/Tabby） | 远端工作区（VS Code Remote-SSH / Zed Remote / JetBrains Gateway） |
|---|---|---|
| 远端 shell | ✅ | ✅ |
| 远端文件树/编辑器 | 通常另开 SFTP/file manager | ✅ 原生 |
| 语言服务器/任务 | ❌ | ✅ 跑在远端 |
| Agent/模型 | 本地 | 本地 UI + 远端工具链 |
| 实现成本 | 中（ssh2 + 终端） | 高（远端 server/文件同步/扩展宿主） |

本轮用户明确「文件树之后考虑」，所以 v1 只做**SSH 终端会话**，不做远端工作区。设计上保留 `TerminalSession` 抽象，未来 SFTP/远端文件树可复用同一条 SSH 连接。

### 2.5 收敛规律

1. **同屏 vs 全高是核心取舍**：底部面板的同屏价值真实存在（改代码 ↔ 看日志、浏览器 ↔ dev server）；主区域 tab 的全高/多会话价值也真实存在（SSH 运维、长输出、多主机）。
2. **主流产品都允许两种位置**，而不是二选一。VS Code 的 `defaultLocation` 是最成熟的先例。
3. **终端客户端的会话管理是主界面的一部分**：主机列表、会话 tab、状态、重连、凭据。把这些塞进 280px 底条会持续打架。
4. **安全是 SSH 客户端的底线**：主机指纹校验、凭据加密、known_hosts、不把密码写日志。Xshell/Tabby 都把「加密凭据容器」作为卖点。
5. **窄栏内不要让主机列表永久占宽**：640px 的 dock 里，174px 常驻列表会让终端只剩 466px（约 60 列）。覆盖式抽屉/弹出层更合适。

## 三、方案对比

### A. 终端升为 L2 surface（推荐先落地）

```text
工作台 L1
├─ L2: 文件 | 浏览器 | 终端
├─ 文件: 文件树 + 编辑器/预览
├─ 浏览器: webview
└─ 终端: 会话 tab + 主机抽屉 + 状态条 + xterm
```

- ✔ 终端获得全高；多会话 tab 有空间；层级统一（终端与文件/浏览器同级）；主机管理不再寄生在底条。
- ✔ 改动可控：复用现有 PTY/xterm/bridge；新增 SSH backend 与会话模型。
- ✘ 终端与编辑器/浏览器互斥，失去同屏；底条的「边看代码边看日志」需要后续用「底部模式/分屏」补。
- ✘ 编辑器仍在「文件」surface 内，A 不能完全消除「编辑器像第三层」的观感；真正的统一要等 C。

### B. 保持底部条，强化为真面板

```text
工作台 L1
├─ L2: 文件 | 浏览器
└─ 底部: 终端面板（会话 tab / 可拖高 / 最大化）
```

- ✔ 保留同屏；符合 IDE 默认；改动最小。
- ✘ 终端仍不是「平级」；默认 280px，SSH 多会话/长输出仍憋屈；主机管理没有自然位置。
- ✘ 与用户「terminal 和文件/编辑器一个地位」的诉求正面冲突。

### C. 统一标签条（终态备选）

```text
工作台 L1
└─ 文件树 + 主标签条：文件 tab / 浏览器 tab / 终端 tab
```

- ✔ 终端、文件、浏览器真正同地位；chrome 最少；最接近 VS Code 编辑器区。
- ✔ 未来加「终端编辑器」「浏览器预览」「diff tab」都自然。
- ✘ 改动最大：要重构 L2、编辑器 tab、浏览器导航、终端会话 tab 的状态模型；tab 溢出/分组需要设计。
- ✘ 一次性重做工作台 IA，风险高。

### 推荐

**A 先行，C 作终态。** 理由：

- 用户的主诉求是「不出工作台连远端」；SSH 需要全高、多会话、主机管理，A 直接满足。
- A 可以把「终端会话模型 / SSH backend / 主机管理」先做扎实，C 只是把同一批组件换一个 tab 容器，不需要重写。
- B 的同屏优势保留为后续「终端位置」偏好（VS Code `defaultLocation` 式），而不是 v1 的阻塞项。

## 四、SSH 技术路线

### 4.1 三条路线

| 路线 | 优点 | 缺点 |
|---|---|---|
| **系统 OpenSSH**（PTY 里起 `ssh`） | 复用 `~/.ssh/config`、agent、known_hosts、ProxyJump、`-L`；零认证代码；最兼容 | 无法自动填保存的密码；自动重连需要重新输入；无法结构化连接状态；SFTP/端口转发要另起进程/解析 |
| **内置 ssh2**（Node 库，主进程） | 保存密码/口令、结构化状态、跳板机、端口转发、SFTP 都可复用同一条连接；跨平台一致 | 要自己实现 known_hosts、认证 UI、键盘交互、密钥读取；`~/.ssh/config` 需后续导入；Windows agent 支持较弱 |
| **混合** | 密钥/agent/config 走系统 ssh，密码走 ssh2 | 两套后端、两套状态、两套测试；v1 复杂度最高 |

### 4.2 推荐：内置 ssh2 为主

用户明确要「保存密码 + 自动重连」，这两点系统 ssh 无法可靠满足（`SSH_ASKPASS` 在 Windows 上要 8.4+ 且对多提示/OTP 不友好）。内置 ssh2 是 Xshell/Tabby/Electerm 一类产品的标准路线，也为后续 SFTP/远端文件树留了同一条连接。

系统 ssh 作为**后续兼容模式**：用于 `~/.ssh/config` 导入、agent、用户已有 known_hosts；v1 不做，避免双后端。

### 4.3 v1 能力边界

必须：

- 保存主机（非密字段）：名称、分组、host、port、user、认证方式、密钥路径、跳板机、自动重连。
- 认证：密码、密钥（含口令）、agent（尽力）。
- 保存密码/口令：`safeStorage` 加密；renderer 永不见明文。
- 多会话 tab：本地 + 多个 SSH；连接状态、关闭、切换。
- 主机指纹：TOFU 确认 + 变化阻断。
- 跳板机：一层 ProxyJump（选另一台已保存主机）。
- 手动重连 + 自动重连（指数退避，最多 5 次）。
- 本地终端：继续跟随工作台目录，保留一个 tab。

后置：

- 端口转发（本地/远程/动态）。
- 分屏（同一 tab 左右/上下）。
- `~/.ssh/config` 导入 / 系统 ssh 兼容模式。
- SFTP / 远端文件树 / 远端编辑器。
- 会话日志、脚本、快速命令、触发器、X11、串口、RDP。

## 五、安全与数据

- 密码/口令：`safeStorage.encryptString` 后写入 `terminal-secrets.json`（userData）；主进程按需解密；不落日志、不进 renderer、不进崩溃报告。
- 主机指纹：`known-hosts.json`（userData），key=`host:port`，存 keyType + 公钥 + SHA256 指纹；首次 TOFU，变化红色阻断。
- 私钥：只存路径；连接时主进程读文件；不在 renderer 暴露内容。
- 日志：SSH debug 默认关闭；开启时脱敏 password/passphrase/privateKey。
- 多窗口：v1 假设单主窗口；多窗口 attach 同一 SSH 会话的行为不在验收内。

## 六、来源

- VS Code Terminal Basics / Terminal Editors / Custom Layout：
  <https://code.visualstudio.com/docs/terminal/basics/>
  <https://code.visualstudio.com/docs/configure/custom-layout>
- VS Code Remote-SSH：
  <https://code.visualstudio.com/docs/remote/ssh/>
- Zed Terminal / Remote Development：
  <https://zed.dev/docs/terminal>
  <https://zed.dev/docs/remote-development.html>
  <https://zed.dev/blog/remote-development>
- JetBrains Terminal / SSH session：
  <https://www.jetbrains.com/help/idea/terminal-emulator.html>
  <https://www.jetbrains.com/help/idea/running-ssh-terminal.html>
- Xshell features / manual：
  <https://www.xshell.com/en/xshell-all-features/>
  <https://cdn.netsarang.net/docs/Xshell8_manual.pdf>
- Tabby README / user guide：
  <https://github.com/Eugeny/tabby>
- Wave Terminal：
  <https://www.waveterm.dev/>
  <https://github.com/wavetermdev/waveterm>
- Electron safeStorage：
  <https://www.electronjs.org/docs/latest/api/safe-storage>
- ssh2 hostVerifier / agent：
  <https://github.com/mscdex/ssh2>
- 本仓库：
  `WorkbenchShell.tsx`、`WorkbenchCodeView.tsx`、`FilesDock.tsx`、`EditorDock.tsx`、`BrowserDock.tsx`、`TerminalDock.tsx`、`mafw.css`、`workbench-views.ts`、`MafwShell.tsx`
  `docs/superpowers/specs/2026-10-26-terminal-dock-design.md`
  `docs/superpowers/plans/2026-10-26-terminal-dock.md`
  `docs/research/2026-10-27-right-dock-terminal-placement.md`
  `docs/research/2026-10-26-right-dock-workbench-consistency-survey.md`
