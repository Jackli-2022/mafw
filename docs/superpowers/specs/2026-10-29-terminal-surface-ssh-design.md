# Desktop 终端工作台 + SSH 远端会话设计

日期：2026-10-29
状态：已交付（实现 commit 2c3087a..2113443）
调研：`docs/research/2026-10-29-terminal-surface-ssh-research.md`
前置设计：
`docs/superpowers/specs/2026-10-26-terminal-dock-design.md`（终端面板首版）
`docs/superpowers/plans/2026-10-26-terminal-dock.md`
`docs/superpowers/specs/2026-10-26-agent-workbench-layout-ia-design.md`（右工作台 B 两层）
`docs/research/2026-10-27-right-dock-terminal-placement.md`（上一轮「保持底部条」的调研）

本 spec **取代**上述设计中「终端固定在右工作台底部 280px」的形态决策；保留「终端是用户工具、不与 agent 共享」「本地终端跟随目录」两条语义。

## 1. 意图与 Why

用户原话：

- 「我想把 terminal 放到和文件还有编辑器一个地位，主要是可以做像 Xshell 连接远端的功能。」
- 「我这样就可以不出工作台，连接远端。」
- 「文件树之后考虑。」

要解决的问题：

1. 终端现在不是右工作台的「一面」，而是底部 280px 的一条；开关在 L1 行尾，和文件/浏览器不在同一套导航里。
2. 现有底部条只支持「一个目录一个 PTY」，没有会话 tab、没有主机管理、没有 SSH。
3. 用户的远端工作流是 Xshell 式的：多台主机、多个会话、保存密码、断线重连、跳板机；这些在 280px 底条里没有生长空间。
4. 「文件 / 编辑器 / 浏览器」本身的层级也有割裂：L2「文件」里装着文件树 + 编辑器，编辑器又有自己的标题和 tab 条；终端是第三套导航。

本设计先把终端升为 L2 surface（方案 A），把 SSH 会话模型做扎实；文件/浏览器/终端统一标签条（方案 C）作为终态备选，不在本批实现。

## 2. 已确认决策

| 决策 | 内容 |
|---|---|
| 终端地位 | 右工作台 L2：`文件 / 浏览器 / 终端`；底部 280px 终端条退役 |
| 终端内部 | 会话 tab（本地 + 多个 SSH）+ 覆盖式主机抽屉 + 状态条 |
| SSH 范围 | v1 只做终端会话；远端文件树/SFTP/远端编辑器后置 |
| SSH 后端 | **内置 ssh2（主进程）** 为主；系统 ssh 作为后续兼容模式 |
| 凭据 | 支持保存密码/口令；`safeStorage` 加密；**已保存秘密**永不出主进程；用户输入瞬时值除外 |
| 重连 | 手动重连 + 自动重连（指数退避，最多 5 次） |
| 主机校验 | TOFU：首次确认指纹；变化红色阻断，绝不静默继续 |
| 跳板机 | v1 支持一层 ProxyJump（选另一台已保存主机） |
| 本地终端 | 保留一个 tab，继续跟随工作台目录（普通会话=项目目录，worktree=worktree 目录） |
| 后置 | 端口转发、分屏、`~/.ssh/config` 导入、SFTP、远端文件树、会话日志/脚本/触发器 |

## 3. 目标 / 非目标 / 反目标

### 目标

- G1：终端成为右工作台与「文件 / 浏览器」同级的 L2 surface，获得全高；底部条删除。
- G2：在一个终端 surface 内管理本地会话 + 多个 SSH 会话；会话 tab 有连接状态。
- G3：保存主机（非密）+ 密码/口令（加密）；一键连接、断线自动重连。
- G4：SSH 安全底线：主机指纹 TOFU、变化阻断、密码不落日志、不进 renderer。
- G5：复用现有 xterm/persistent PTY 基础设施；本地终端行为不回退。
- G6：会话模型/组件为 C（统一标签条）留出迁移空间，不写死 L2。

### 非目标

- N1：远端文件树、SFTP、远端编辑器、远端 agent（用户明确「之后考虑」）。
- N2：端口转发 UI、分屏、会话日志、快速命令、触发器、X11、串口、RDP。
- N3：`~/.ssh/config` 导入 / 系统 ssh 兼容模式。
- N4：多窗口同时 attach 同一 SSH 会话的仲裁。
- N5：把终端共享给 agent；agent 仍走 BackgroundDock/工具卡。
- N6：重做文件/编辑器/浏览器本身；本批只动终端归属与工作台 surface 接线。

### 反目标

- 终端再长出一条独立的底部/浮动导航，或保留两套终端入口。
- 为了「像 IDE」把终端塞回 280px 底条，导致 SSH 多会话无处安放。
- 在 renderer 里出现**已保存的**密码/口令/私钥明文（用户正在输入的表单瞬时值除外），或把密码写进日志/崩溃报告。
- 主机指纹未校验就建立连接；指纹变化时提供「默认继续」。
- 把 SSH 会话绑到 chat session/目录；SSH tab 应独立于目录，切换项目仍保留。
- 用假会话/假状态冒充已连接；连接状态必须来自 ssh2 事件。

## 4. 目标信息架构

```text
右工作台
├─ L1: 工作台 | 执行 | 审阅
├─ L2（工作台）: 文件 | 浏览器 | 终端
├─ 内容
│  ├─ 文件:   文件树(200px) + 编辑器/文件预览
│  ├─ 浏览器: BrowserDock
│  └─ 终端:   TerminalSurface
│             ├─ 会话 tab 条（本地 + SSH + ＋ + 主机 + ⋯）
│             ├─ 覆盖式主机抽屉（搜索/分组/状态/新建）
│             ├─ 终端区（xterm，全宽）
│             └─ 状态条（主机/地址/连接时长/编码/尺寸）
└─ 底部 280px 终端条：删除
```

### 4.1 L2 与状态

- `WorkbenchSurface` 增加 `"terminal"`；`WORKBENCH_SURFACES` 顺序 `文件 / 浏览器 / 终端`。
- 默认 surface 仍为 `文件`；上次选中的 surface 持久化到 `mafw-workbench-surface`。
- 旧键 `mafw-right-dock-tab=terminal` 迁移到 surface `terminal`；旧底部条键 `mafw-workbench-terminal` 删除，不迁移（新模型下终端不是默认打开的底条）。
- L1 行尾的终端开关按钮删除；Ctrl+` 改为 surface 级开合（见 §4.5）。

### 4.2 终端 surface 布局

```text
┌ 会话 tab 条 ────────────────────────────────────────────┐
│ [本地 · desktop] [prod-01 ●] [db-02 ◐]  ＋   主机  ⋯   │
├ 覆盖式主机抽屉（可选，210-240px）───────────────────────┤
│ 搜索主机…                                               │
│ 生产                                                    │
│  ● prod-01        已连                                  │
│  ● prod-02                                              │
│  ● bastion        跳板                                  │
│ 测试 / 数据库                                            │
│  ◐ staging-01     重连中                                │
│  ● db-02                                                │
│  ＋ 新建 SSH 连接                                        │
├ 终端区（xterm，全宽）──────────────────────────────────┤
│ deploy@prod-01:~/app$ docker compose ps                 │
│ ...                                                     │
├ 状态条 ────────────────────────────────────────────────┤
│ ● prod-01  deploy@10.0.0.12:22  已连接 12:31  UTF-8 80×24│
└─────────────────────────────────────────────────────────┘
```

- 会话 tab 条高 28-32px；tab 可横向滚动；关闭按钮在 hover/active 时显示。
- 主机抽屉**覆盖**在终端上（absolute，左侧，宽 210-240px），默认收起；点「主机」或空态按钮打开，Esc/点外关闭。**不做常驻左列**——640px dock 里常驻列表会把终端压到约 60 列。
- 主机行状态：任一 tab 为 connected 即绿点；同一主机有多个 tab 时显示计数徽标。点击已连接主机 → 聚焦最近使用的 tab；行内 `⋯` / 右键菜单提供「新建会话」，允许再开一个 SSH shell。
- 状态条高 22px；本地会话显示目录 basename，SSH 显示主机名/地址/连接时长。
- 终端区 xterm 全宽；字体/主题沿用现有 `buildTerminalTheme`。
- 空态：无会话时显示「新建 SSH 连接 / 打开本地终端」+ 最近主机；但本地 tab 默认存在，空态主要出现在本地能力不可用时。
- 错误/降级：本地 persistent PTY 不可用 → 本地 tab 显示「当前 runtime 不支持本地终端」+ 外部终端出口；SSH 仍可用。SSH 连接失败 → 终端内显示 ssh2 错误 + tab 红色 + 重连/编辑主机。

### 4.3 会话 tab

| 类型 | 标题 | 状态点 |
|---|---|---|
| 本地 | `本地 · <dirname>` | 绿=已连；黄=连接中；红=断开；灰=空闲 |
| SSH | 主机名（`prod-01`） | 绿=connected；黄=connecting/reconnecting；红=disconnected/error；灰=closed |

- 本地 tab 最多一个；目录变化时替换其 session（旧 PTY 保留在 serve，detach 不杀）。
- SSH tab 独立于目录；切换 chat session/项目不关闭、不重连。
- 关闭 tab：本地 = detach（PTY 保留）+ 从 UI 移除；SSH = end client + 移除 tab。
- 本地 tab 被关闭后，用 `＋` 菜单的「本地终端」重新 attach 当前目录；overflow 菜单保留「结束终端」（DELETE PTY，二次确认）与「在外部终端打开」，对应 `kill`/`openExternal`。
- 会话顺序持久化；新会话追加到末尾，激活。
- tab 溢出：横向滚动 + `⋯` 列出全部会话（v1 简单实现）。

### 4.4 新建/编辑 SSH 连接

表单字段：

- 名称（必填，默认 `user@host`）
- 分组（可选，默认「未分组」）
- 主机（必填）
- 端口（默认 22，1-65535）
- 用户（必填）
- 认证：密码 / 密钥 / Agent
  - 密码：密码输入 + 「保存密码（系统钥匙串加密）」checkbox
  - 密钥：私钥路径 + 口令 + 「保存口令」checkbox
  - Agent：提示「使用系统 SSH agent（Windows OpenSSH agent / Pageant）」
- 跳板机：下拉（无 / 已保存主机）；禁止选自己；v1 一层
- 自动重连：checkbox（默认开）；「最多 5 次」
- 保存并连接 / 测试连接 / 取消

校验：

- 主机不能为空、不能含空白/控制字符；端口整数 1-65535；用户名不能为空。
- 名称同组内唯一（或允许重复但显示区分）；v1 允许重复，列表用 host:port 辅助区分。
- 跳板机不能形成环（A→B→A）；v1 只允许一层，直接拒绝自引用；自身已配置跳板机的主机不可再被选为跳板机（见 §6.5）。
- 「测试连接」走真实连接路径（含 hostVerifier/TOFU、认证），成功 = ssh2 `ready`；不打开 shell。测试中信任的新指纹写入 known_hosts（键 `host:port`，与 profile 是否保存无关）。

### 4.5 键盘与焦点

- `Ctrl/Cmd + \``：surface 级开合。
  - dock 关闭 → 打开 dock + 切到终端 surface。
  - 当前 view 不是工作台 → 切到工作台 + 终端 surface。
  - 当前 surface 是终端 → 切回上一个 surface（默认 `文件`）。
  - 否则 → 切到终端 surface。
- `Esc`：关闭主机抽屉 / 当前对话框；不关闭终端。
- 会话 tab 支持 ArrowLeft/Right/Home/End（roving tabindex，沿用工作台 tab 模式）。
- `Ctrl/Cmd + Shift + \``：新建 SSH 连接（可选；若与现有键位冲突则留给命令面板）。
- 主机抽屉打开时，搜索框自动聚焦；选择主机后抽屉关闭并激活 tab。

### 4.6 响应式

- dock 内容宽 < 600px（`@container`）：主机抽屉仍覆盖；状态条隐藏「编码/尺寸」；会话 tab 标题截断 + tooltip。
- 极窄（< 480px）：隐藏状态条，仅保留红色错误条；SSH 表单改为单列。
- 不做移动端布局。

## 5. 会话模型

### 5.1 类型

```ts
export type TerminalSessionKind = "local" | "ssh"
export type TerminalSessionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error"
  | "closed"

export type TerminalSessionInfo = {
  id: string                 // local:<dirKey> | ssh:<uuid>
  kind: TerminalSessionKind
  title: string
  subtitle?: string
  directory?: string         // local
  hostId?: string            // ssh
  status: TerminalSessionStatus
  reconnectAttempt?: number
  reconnectInMs?: number
  connectedAt?: number      // epoch ms；status=connected 时设置，状态条算连接时长
  error?: string
}
```

### 5.2 本地会话

- `local:<dirKey>`；`dirKey` 沿用现有规则（win32 归一分隔符+折大小写，darwin 折大小写，linux 大小写敏感）。
- 同一目录复用同一个 PTY；`attachLocal(directory)`：
  - list `/api/pty?directory=` → 取最后一个 running → 无则 create（cwd=directory, title="MAFW"）→ connect-token → WS。
  - 与现有 `terminal-bridge` 逻辑一致；保留 `lastPtyByDir` 的 `gone` 语义。
- 目录变化：renderer 更新本地 tab 的「目标目录」并 detach 旧目录（不杀 PTY）；**只有本地 tab 处于激活且终端 surface 可见时才 attach/创建新目录的 PTY**。隐藏时 tab 显示新目录名 + `idle`，不后台起 shell（保留现有「不可见不创建 PTY」不变量）。重新可见时 reset + attach，主进程 ring buffer 重放。
- 本地 tab 关闭 = 从 UI 移除并 detach（PTY 保留）；`＋` 菜单的「本地终端」可重新 attach 当前目录。overflow 菜单保留「结束终端」（DELETE PTY，二次确认）与「在外部终端打开」。
- 本地能力门：`/api/info.capabilities.persistentPty === true`；否则降级。

### 5.3 SSH 会话

- `ssh:<uuid>`；每个 tab 一个 ssh2 `Client` + 一个 shell stream。
- SSH 会话不绑定 `directory`；`cwd` 只用于本地进程（ssh2 不启动本地进程）。
- 同一主机允许多个 SSH tab（Xshell 语义）：tab id 独立；主机抽屉选中已连接主机时**聚焦最近使用的 tab**，右键/`⋯` 菜单提供「新建会话」再开一个。主机行的状态点 = 任一 tab connected；>1 个时显示计数徽标。
- 会话在 desktop main 存活：
  - close-to-tray / 窗口重载：main 不退出，会话保留；renderer 重新 attach 时重放 ring buffer。
  - 应用 Quit：main 退出，SSH 连接断开；下次启动按持久化 tab 恢复，但**默认不主动连接**——SSH 会话在终端 surface 首次可见时才建立。这样不会在用户看聊天时后台连远端或弹出指纹/密码框。
  - 若上次退出时 surface 就是 `terminal` 且 dock 打开，则启动即可见，按恢复策略立即连接（仍需 hostkey/凭据可用）。
  - 恢复的 tab 在连接前显示 `disconnected` + 「连接」；autoReconnect = true 且凭据可用于无交互认证时，首次可见即自动连接。
- ring buffer：每会话保留最近 200,000 字符（与本地一致），从整行边界裁剪，防 ANSI 截断。
- 多窗口：v1 不保证；main 可 fanout，但 UI 假设单主窗口。

### 5.4 持久化

| 数据 | 位置 | 内容 |
|---|---|---|
| 主机（非密） | `terminal-hosts.json`（userData）或 electron-store | id/name/group/host/port/user/auth/keyPath/jumpHostId/autoReconnect/keepalive |
| 密码/口令 | `terminal-secrets.json`（userData，safeStorage 加密） | hostId → { password?, passphrase? } 的 base64 密文 |
| known_hosts | `terminal-known-hosts.json`（userData） | host:port → keyType/publicKey/fingerprint |
| 打开中的 tab | `localStorage` `mafw-terminal-tabs-v1` | activeId + tabs[{id,kind,hostId?,title}] |
| surface | `localStorage` `mafw-workbench-surface` | code/browser/terminal |

- 所有写盘使用原子写（tmp + rename）；Unix 下 secrets 文件 mode 0600。
- secrets 文件损坏/无法解密：视为无保存密码，fail-open 到「输入密码」，不崩溃。
- `safeStorage.isEncryptionAvailable() === false`：禁用「保存密码/口令」，表单显示提示；Linux `basic_text` 同样禁用并提示「系统凭据存储不安全」。

## 6. SSH 架构

### 6.1 模块

建议（builder 可调整文件名，但职责边界保持）：

```text
packages/desktop/src/main/terminal/
├─ terminal-core.ts          # 现有纯逻辑 + 新 dirKey/status/fingerprint helpers
├─ terminal-hub.ts           # 统一会话注册表：local + ssh；attach/detach/input/resize/close
├─ local-terminal.ts         # 现有 serve PTY/WS 逻辑（从 terminal-bridge 抽出）
├─ ssh-session.ts            # 单个 ssh2 Client + shell stream 生命周期
├─ ssh-connect.ts            # 构造 connect config（auth/jump host/keepalive/hostVerifier）
├─ ssh-host-store.ts         # 主机 CRUD + 校验 + 非密序列化
├─ terminal-secrets.ts       # safeStorage 加解密 + secrets 文件
├─ known-hosts-store.ts      # TOFU 存储 + 比较
├─ reconnect-policy.ts       # 退避计算 + 可自动重连判定
├─ redact.ts                 # 日志脱敏
└─ terminal-bridge.ts        # IPC 薄接线（保留文件名，内部委托 hub）
```

Renderer：

```text
packages/desktop/src/renderer/mafw/
├─ terminal/terminal-store.ts       # 会话/主机/抽屉/对话框状态
├─ terminal/terminal-model.ts       # 纯函数：tab 排序/状态映射/标题/reconnect 文案
├─ terminal/terminal-keys.ts        # surface 开合纯逻辑
├─ components/TerminalSurface.tsx   # surface 容器
├─ components/TerminalView.tsx      # 单 xterm 实例
├─ components/TerminalHostDrawer.tsx
├─ components/SshHostDialog.tsx
├─ components/HostKeyDialog.tsx
├─ components/TerminalPromptDialog.tsx
└─ components/TerminalStatusBar.tsx
```

### 6.2 ssh2 连接

```ts
const cfg: ConnectConfig = {
  host, port, username,
  password?, privateKey?, passphrase?, agent?,
  readyTimeout: 120_000, // 覆盖人工指纹/OTP 输入；连接阶段另有 30s 无进展计时
  keepaliveInterval: keepaliveSeconds * 1000, // 默认 15s
  keepaliveCountMax: 3,
  tryKeyboard: true,
  hostVerifier: (key, verify) => { /* §6.4 */ },
}
```

- **超时分层**：TCP/握手阶段 30s 无进展 → 取消（「连接超时」）；一旦进入 hostVerifier / keyboard-interactive 人工环节，暂停 30s 计时，改用 60s（指纹）/120s（OTP）人工预算；`readyTimeout` 取 120s 兜底，避免上述人工输入被 ssh2 提前掐断。
- `client.on("ready")` → `client.shell({ term: "xterm-256color", cols, rows, width: 0, height: 0 }, cb)` → status `connected`。
- `stream.on("data")` → append buffer + fanout `{type:"data"}`。
- `stream.setWindow(rows, cols, 0, 0)` 处理 resize。
- `stream.write(data)` 处理输入（恒等透传；Enter 仍是 `\r`）。
- `client.on("close"|"end")` / `stream.on("close")` → status `disconnected`；若未用户关闭且满足自动重连条件 → `reconnecting` + 退避。
- `client.on("error")` → status `error`（认证/网络/DNS 分类写 `error`，脱敏）。
- `client.on("keyboard-interactive")` → 发 prompt 事件，等待答案，`finish(answers)`；120s 超时取消。

### 6.3 认证

| 方式 | 实现 |
|---|---|
| 密码 | `password`；优先用 secrets 中保存的；没有则连接前弹出密码输入 |
| 密钥 | 主进程读 `privateKeyPath`；有保存口令则用；没有且密钥加密 → 弹口令输入 |
| Agent | `agent: win32 ? "\\\\.\\pipe\\openssh-ssh-agent" : process.env.SSH_AUTH_SOCK`；失败回落密钥/密码（若配置） |
| keyboard-interactive | 弹出 `TerminalPromptDialog`，按 prompt 逐项输入（echo 控制） |

- 密码/口令只存在于主进程内存；连接完成后不保留明文（除非用户勾选保存，保存在加密文件）。
- 认证失败：status `error`，error 文案「认证失败：用户名/密码/密钥不正确」；不自动重试（避免锁定账号）。
- 主机密钥校验在认证之前；未通过不发送凭据。

### 6.4 主机指纹（TOFU）

- `hostVerifier(key, verify)`：
  1. `keyType = ssh2.utils.parseKey(key)?.type ?? "unknown"`。
  2. `fingerprint = "SHA256:" + base64(sha256(key))`。
  3. `knownHosts.get(host, port)`：
     - 无记录：发 `hostkey` 事件 `{sessionId, kind:"new", keyType, fingerprint}`，等待用户 `trust` / `trust-and-save` / `reject`。
     - 有记录且 `publicKey` 相同：`verify(true)`。
     - 有记录但不同：发 `{sessionId, kind:"changed", oldFingerprint}`，等待 `replace` / `reject`；默认 60s 超时 reject。
  4. 用户响应后 `verify(true/false)`；`trust-and-save`/`replace` 写 known_hosts。
  5. **并发弹窗串行化**：renderer 维护一个 modality queue，同一时刻只显示一个 hostkey/prompt 对话框；事件带 `sessionId`，队列项按到达顺序展示。surface 不可见时不弹窗（恢复策略保证此时没有连接）。
- 指纹展示格式 `SHA256:<base64>`；同时显示 host:port、keyType；帮助文案「请与服务器管理员核对」。
- 变化态红色 + 「仍要连接（替换已保存指纹）」危险按钮；取消是默认焦点。
- 不提供「跳过校验」的配置项。

### 6.5 跳板机

- `jumpHostId` 指向另一台已保存主机；v1 只允许一层，禁止自引用/环。
- **跳板机自身不能再配置跳板机**：选择列表里禁用 `jumpHostId` 非空的 host，并提示「该主机自身使用跳板机，v1 不支持链式」；保存/后端校验同样拒绝，不静默忽略。
- 实现：先连接跳板机（用其自己的认证/known_hosts），`forwardOut("127.0.0.1", 0, targetHost, targetPort)` 得到 `sock`，目标 client 用 `sock` 连接。
- 跳板机连接失败/认证失败：目标会话 status `error`，error 文案带「跳板机 <name> 连接失败」。
- 跳板机会话与目标会话共享生命周期；目标关闭时跳板机 client 也 end。
- 跳板机自身的 known_hosts 校验同样走 §6.4。

### 6.6 自动重连

```ts
reconnectDelay(attempt) = 1000 * 2 ** (attempt - 1) // 1,2,4,8,16s；attempt 6 -> null
```

- 只会对「可无交互认证」的会话自动重连：
  - 密码已保存；或
  - 密钥无口令 / 口令已保存；或
  - agent 可用（无法可靠探测时，先尝试；失败转手动）。
- 用户手动关闭 tab → 取消所有 timer，不重连。
- 重连成功 → 新 shell stream，重放 ring buffer（保留断线前输出），状态 connected。
- 5 次失败 → status `disconnected`，error「自动重连失败，已停止」；提供「立即重连」。
- 重连期间 tab 黄色 + `重连中 (n/5)`；状态条显示倒计时。
- 需要 keyboard-interactive/密码输入时：停止自动重连，status `disconnected`，提供「输入凭据并重连」。
- 需要 hostkey 确认（首次/变化）时同样停止自动重连；主机指纹不能在无人值守的循环里反复弹窗。重连只在已知主机 + 可无交互认证时自动进行。

### 6.7 日志与脱敏

- SSH debug 默认关闭；`MAFW_SSH_DEBUG=1` 才开。
- 日志不得出现 `password`、`passphrase`、`privateKey` 内容；连接配置打印前经 `redact`.
- 错误对象只打印 `message`/`code`，不打印完整 config。
- renderer 日志不接触秘密。

## 7. IPC / preload

### 7.1 通道

```text
mafw-terminal-probe                 → { localAvailable, sshAvailable, reason? }
mafw-terminal-list                  → TerminalSessionInfo[]
mafw-terminal-local-attach          { directory } → TerminalSessionInfo
mafw-terminal-ssh-create            { id?, hostId } → TerminalSessionInfo
mafw-terminal-ssh-restore           { id, hostId } → TerminalSessionInfo
mafw-terminal-attach                { sessionId, key } → { ok, replayed }
mafw-terminal-detach                { sessionId, key } → void
mafw-terminal-input                 { sessionId, data } → void
mafw-terminal-resize                { sessionId, cols, rows } → void
mafw-terminal-close                 { sessionId } → void   // 本地=detach；SSH=end client
mafw-terminal-kill                  { sessionId } → void   // 仅本地：DELETE PTY
mafw-terminal-open-external         { directory } → void
mafw-terminal-reconnect             { sessionId } → void
mafw-terminal-hosts-list            → SshHostProfile[]
mafw-terminal-hosts-save            { profile, secret? } → SshHostProfile
mafw-terminal-hosts-remove          { id } → void
mafw-terminal-hosts-test            { profile, secret? } → { ok, error? }  // 走同一 hostVerifier/认证路径，停在 ready
mafw-terminal-hostkey-respond       { requestId, action: "trust" | "trust-and-save" | "replace" | "reject" } → void
mafw-terminal-prompt-respond        { requestId, answers?: string[] } → void
mafw-terminal-event                 (main → renderer push)
```

- `hosts-test` **不得绕过 TOFU**：走与真实连接相同的 hostVerifier/认证路径；用户从测试里选择 `trust-and-save` 时写 known_hosts（即使 profile 尚未保存；键是 `host:port`，安全语义正确）。测试成功 = `ready`（认证通过），不打开 shell；失败返回脱敏 error。
- `kill` 仅对本地会话有效（DELETE PTY）；SSH 会话用 `close` end client。

### 7.2 事件

```ts
export type TerminalEvent =
  | { type: "data"; sessionId: string; data: string }
  | { type: "status"; sessionId: string; status: TerminalSessionStatus;
      reconnectAttempt?: number; reconnectInMs?: number; connectedAt?: number; error?: string }
  | { type: "hostkey"; requestId: string; sessionId: string; host: string; port: number;
      keyType: string; fingerprint: string; kind: "new" | "changed"; oldFingerprint?: string }
  | { type: "prompt"; requestId: string; sessionId: string; title: string;
      instructions?: string; prompts: { prompt: string; echo: boolean }[] }
```

### 7.3 preload 命名空间

```ts
window.api.mafw.terminal = {
  probe(): Promise<TerminalProbe>
  sessions: {
    list(): Promise<TerminalSessionInfo[]>
    attachLocal(directory: string): Promise<TerminalSessionInfo>
    createSsh(input: { id?: string; hostId: string }): Promise<TerminalSessionInfo>
    restore(input: { id: string; hostId: string }): Promise<TerminalSessionInfo>
    attach(sessionId: string, key: string): Promise<{ ok: boolean; replayed: boolean }>
    detach(sessionId: string, key: string): Promise<void>
    input(sessionId: string, data: string): Promise<void>
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    close(sessionId: string): Promise<void>
    kill(sessionId: string): Promise<void>
    reconnect(sessionId: string): Promise<void>
  }
  openExternal(directory: string): Promise<void>
  hosts: {
    list(): Promise<SshHostProfile[]>
    save(profile: SshHostProfileInput, secret?: SshSecretInput): Promise<SshHostProfile>
    remove(id: string): Promise<void>
    test(profile: SshHostProfileInput, secret?: SshSecretInput): Promise<{ ok: boolean; error?: string }>
  }
  hostkey: { respond(input: { requestId: string; action: "trust" | "trust-and-save" | "replace" | "reject" }): Promise<void> }
  prompt: { respond(input: { requestId: string; answers?: string[] }): Promise<void> }
  onEvent(cb: (ev: TerminalEvent) => void): () => void
}
```

- renderer 只经 preload；不许直接 import `ssh2`/`node:*`。
- `SshHostProfile` 返回给 renderer 时**不含** `password`/`passphrase`/`privateKey` 内容；只含 `hasPassword`/`hasPassphrase` 与 `privateKeyPath`。

## 8. 数据 schema

### 8.1 主机

```ts
export type SshAuthMethod = "password" | "key" | "agent"

export type SshHostProfile = {
  id: string
  name: string
  group: string
  host: string
  port: number
  username: string
  auth: SshAuthMethod
  privateKeyPath?: string
  jumpHostId?: string | null
  autoReconnect: boolean
  keepaliveSeconds: number
  hasPassword?: boolean
  hasPassphrase?: boolean
  createdAt: number
  updatedAt: number
}

export type SshHostProfileInput = Omit<SshHostProfile, "id" | "createdAt" | "updatedAt" | "hasPassword" | "hasPassphrase"> & { id?: string }

export type SshSecretInput = {
  password?: string
  passphrase?: string
  clearPassword?: boolean
  clearPassphrase?: boolean
}
```

### 8.2 known_hosts

```ts
export type KnownHostEntry = {
  host: string
  port: number
  keyType: string
  publicKey: string       // base64 raw host key
  fingerprint: string     // SHA256:...
  addedAt: number
  lastSeenAt: number
}
```

### 8.3 会话恢复

```ts
type PersistedTab = { id: string; kind: "local" | "ssh"; hostId?: string; title?: string }
type PersistedTerminal = { activeId: string | null; tabs: PersistedTab[] }
```

- localStorage key `mafw-terminal-tabs-v1`。
- 只持久化 UI 身份；不持久化输出/密码/状态。

## 9. 工作台接线与迁移

### 9.1 `WorkbenchShell` / `WorkbenchCodeView`

- `WorkbenchSurface` 加 `"terminal"`；L2 渲染 `文件 / 浏览器 / 终端`。
- 删除 `terminalOpen` / `onToggleTerminal` props、L1 行尾按钮、`.mafw-rw-terminal` 底条。
- `WorkbenchCodeView` 增加第三个 pane：`<TerminalSurface>`，与 EditorDock/BrowserDock 一样常挂载、`display:none` 切换（保 xterm 实例与 scrollback）。
- 文件树只在 surface `code` 渲染；浏览器/终端不显示文件树。
- `TerminalSurface` 需要 `sessionDirectory`（本地 tab 跟随目录）和 `active`（是否可见，用于 fit/聚焦）。

### 9.2 Ctrl+` 纯逻辑

```ts
export type TerminalSurfaceHotkeyState = {
  dockOpen: boolean
  view: WorkbenchView
  surface: WorkbenchSurface
  previousSurface: Exclude<WorkbenchSurface, "terminal">
}
export function terminalSurfaceHotkeyAction(s: TerminalSurfaceHotkeyState): {
  openDock: boolean; view: WorkbenchView; surface: WorkbenchSurface
}
```

- 当前不是工作台/终端 → `{openDock:true, view:"workbench", surface:"terminal"}`。
- 当前是终端 → `{openDock:true, view:"workbench", surface: previousSurface}`。
- dock 关闭 → 打开 + 终端。
- `previousSurface` 在切到终端前记录（默认 `code`）。

### 9.3 旧键迁移

- `workbenchStateFromStorage` 的 `LEGACY_TABS.terminal` 从 `surface: "code"` 改为 `surface: "terminal"`。
- 删除 `mafw-workbench-terminal` 读写；启动时 `localStorage.removeItem("mafw-workbench-terminal")` 一次性清理。
- 旧 `mafw-right-dock-tab=terminal` 迁移到 terminal surface；`mafw-workbench-tab=terminal` 同理（当前 `legacySurface` 只认 browser/editor，需扩展）。

## 10. 测试与验收

### 10.1 自动化

纯逻辑（node --test，与 src 同目录）：

- `terminal-model.test.ts`：tab 排序/激活/本地替换/标题/状态映射/重连文案。
- `terminal-keys.test.ts`：Ctrl+` 三分支；previousSurface 记录。
- `ssh-host-model.test.ts`：表单校验（空 host/端口/用户、跳板机自引用）、默认值、脱敏字段。
- `known-hosts.test.ts`：指纹格式化、首次/匹配/变化、替换。
- `reconnect-policy.test.ts`：1/2/4/8/16s、5 次后停止、可自动重连判定。
- `workbench-views.test.ts`：surfaces 含 terminal、normalize、legacy 迁移。

Main（deps 注入，fake ssh2/fs/safeStorage）：

- `ssh-connect.test.ts`：config 组装（密码/密钥/agent/jump host/keepalive）、hostVerifier 首次/匹配/变化、超时 reject。
- `ssh-session.test.ts`：ready→shell、data→buffer/fanout、input/resize、close/error→status、自动重连调度、用户关闭取消 timer、keyboard-interactive prompt/answer。
- `terminal-hub.test.ts`：local+ssh 混合、attach/detach fanout、close、restore、ring buffer replay。
- `ssh-host-store.test.ts`：CRUD、校验、原子写、坏文件 fail-open。
- `terminal-secrets.test.ts`：safeStorage 可用/不可用、加密/解密、清除、不返回明文。
- `known-hosts-store.test.ts`：读写/比较/替换/坏文件。
- `redact.test.ts`：password/passphrase/privateKey 不出现在输出。

Renderer/接线契约（沿用现有 design-contract 风格）：

- `workbench-shell-wiring.test.ts`：含 `TerminalSurface`；不再含 `TerminalDock` 底条；L2 含 terminal。
- `terminal-surface-wiring.test.ts`：`TerminalSurface` 使用 `window.api.mafw.terminal`；不直接 import ssh2/node。
- `terminal-preload.test.ts`/类型检查：preload 命名空间与 types 镜像。
- `workbench-shell-css.test.ts`：`.mafw-rw-terminal` 删除；新 `.mafw-terminal-surface` 存在；底条规则不再被引用。

### 10.2 验收判据

1. 工作台 L2 显示 `文件 / 浏览器 / 终端`；终端 surface 全高；底部 280px 条不再存在。
2. 新建 SSH 主机（密码）→ 首次指纹确认 → 连接成功；保存密码后重连无需再输入。
3. 新建 SSH 主机（密钥/口令）→ 连接成功；口令保存/不保存两条路径都正确。
4. 多会话：本地 + 2 个 SSH 同时开；切换 tab 保 scrollback；关闭 SSH tab 断开，关闭本地 tab 不杀 PTY。
5. 主机指纹变化：红色阻断；取消不连接；替换后写 known_hosts。
6. 跳板机：通过已保存 bastion 连接目标；bastion 失败时错误归因正确。
7. 自动重连：断网/杀 sshd → 状态 `reconnecting` + 倒计时；5 次后停止；手动重连可恢复。
8. 本地终端跟随目录：切换 worktree/项目，本地 tab 切到新目录；SSH tab 不变。
9. Ctrl+`：从文件切到终端；再按回文件；dock 关闭时打开并进终端。
10. 重启 desktop：tab 恢复但终端 surface 不可见时不后台连接；首次切到终端时，有保存密码/密钥的 SSH 自动连接，没有的显示「输入凭据」。
11. **已保存**密码/口令不出现在 renderer API 返回值、日志、localStorage；用户输入瞬时值除外；secrets 文件为密文。
12. desktop `npm test` 全绿、`npx tsgo --noEmit -p tsconfig.json` rc=0、`npx electron-vite build` rc=0。
13. GUI 冒烟：真实 OpenSSH 服务器（至少一台密码、一台密钥；有 bastion 更好）完成 1-10。
14. 本地 tab 关闭后 `＋`→「本地终端」可重新 attach 原 PTY（scrollback 重放）；「结束终端」DELETE 后重开是新 shell。
15. 「测试连接」不绕过 TOFU：新主机弹指纹；取消则测试失败；信任后 known_hosts 有记录。
16. 同一主机开两个 SSH tab：主机抽屉显示计数；点击聚焦最近 tab；右键「新建会话」可再开一个。

## 11. 风险与备注

- **ssh2 兼容性**：老服务器算法/键盘交互差异；用真实 OpenSSH 8.x/9.x 冒烟；必要时暴露算法覆盖（后置）。
- **Windows agent**：ssh2 对 Windows OpenSSH agent 命名管道的支持需实测；v1 以密码/密钥为主，agent 失败要给出明确错误。
- **safeStorage**：Linux 无 secret store 时 `basic_text`；必须禁用保存密码并提示，不能静默降级。
- **打包**：`ssh2` 为纯 JS，但依赖 `asn1`/`bcrypt-pbkdf` 等；确认 electron-builder 产物包含；不需要 node-gyp 重构建。
- **xterm 实例数量**：多 SSH tab 常挂载会占内存；v1 限制 10 个会话（超出提示关闭），后续按需懒挂载。
- **会话不在 app 退出后存活**：SSH 连接随 main 退出；tab 恢复 + 自动重连是预期语义，不承诺 Xshell 式后台 daemon。
- **多窗口**：不在验收；main fanout 可工作，但输入仲裁未定义。
- **安全**：主机指纹变化必须阻断；保存密码是可选功能，默认勾选但用户可取消；私钥路径不校验权限（后续可加）。
- **C 终态**：本批组件不要把「L2 tab」写死；`TerminalSurface` 应可在 C 中作为主标签条的一个 tab 容器复用。

## 12. Builder 的自由度（我的 call，可在实现期调整）

- 模块/文件命名与拆分方式（保持职责边界）。
- 主机/known_hosts 存储用 electron-store 还是纯 JSON（需可注入测试）。
- 主机抽屉宽度、动效、tab 溢出菜单的具体形态。
- 状态条信息密度（窄宽可隐藏编码/尺寸）。
- keyboard-interactive 对话框的具体布局。
- 自动重连次数/退避上限（spec 默认 5 次，可配置常量）。
- `ssh2` 的算法覆盖默认值（以兼容性测试为准）。
- 本地 tab 在目录变化时是「替换 session」还是「新开 tab」；spec 要求默认只保留一个本地 tab。

## 12.1 Builder check 收口（2026-10-29）

独立 builder 读 spec 后提出的 8 个问题，处理如下（均已写入正文）：

| 问题 | 收口 |
|---|---|
| 「renderer 永不见明文」是否字面 | 不字面。**已保存秘密**永不出主进程；用户输入的表单/OTP 瞬时值允许在 renderer 内存/DOM；不通过 API 返回、不持久化、不日志。 |
| `readyTimeout` 20s 会掐断人工输入 | 改 120s 兜底；TCP/握手 30s 无进展取消；指纹 60s、OTP 120s 人工预算；进入人工环节暂停 30s 计时。 |
| 重启后何时恢复/连接 | tab 立即恢复，**SSH 连接延迟到终端 surface 首次可见**；不在聊天时后台连远端/弹窗。上次 surface 就是终端时按可见处理。hostkey 事件带 `sessionId`，弹窗串行队列。 |
| 目录变化时是否后台建本地 PTY | 否。只更新目标目录并 detach 旧目录；本地 tab 激活 + surface 可见才 attach/创建，保留「不可见不起 shell」不变量。 |
| 「测试连接」是否绕过 TOFU | 不绕过。同一 hostVerifier/认证路径，停在 `ready`；测试中信任的指纹写 known_hosts。 |
| 跳板机自身还有跳板机 | v1 禁止链式：选择列表禁用 + 后端校验拒绝，不静默忽略。 |
| 同一主机能否多 tab | 可以。每 tab 独立 ssh2 Client；抽屉聚焦最近 tab，右键「新建会话」再开；状态点 + 计数徽标。 |
| 本地 tab 关闭/重开/kill/右键菜单 | 关闭=detach+移除，`＋`→「本地终端」重开；保留「结束终端」（DELETE PTY，二次确认）和外部终端；context menu 从 TerminalDock 迁到 TerminalSurface/TerminalView。 |

## 13. 开放问题（需用户确认）

无阻塞项。以下为后续增量，不在本批：

- 端口转发 UI（v1.1）。
- 分屏（v1.1）。
- `~/.ssh/config` 导入 / 系统 ssh 兼容模式（v2）。
- SFTP / 远端文件树（用户明确后置）。
- 会话日志 / 快速命令 / 触发器（v2）。
