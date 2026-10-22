# Workbench 二期调研：共享 terminal + 内嵌浏览器

2026-10-22 · 服务于 `docs/superpowers/specs/2026-10-22-agent-workbench-design.md` §6 二期（terminal + 浏览器简单版）立项前的技术选型。

## TL;DR

1. **terminal 走路线 B（serve 侧 persistent PTY），且比一期 spec 设想得更好**：v2 的 persistent PTY **原生绑定 sessionID**、带 `foregroundProcess` 与 read/attach 分离的控制模型——桌面 attach 到会话现有终端即兑现「人与 agent 同一个 shell，谁敲都可见」，**不需要自己起 PTY，也不需要镜像**。一期 spec §6 写的「v2 `/api/shell` 通道」应修正为 `persistent-pty` 面（`/api/shell` 是无 TTY 的后台命令通道，不适合交互终端）。
2. **浏览器简单版用 `<webview>`**：iframe 被 X-Frame-Options 挡掉大半互联网（出局）；WebContentsView 是官方正统但 HTML 弹层/右键菜单永远压不住它（Electron #49039 仍 open），恰好打中 dock 这个弹层密集区；webview 不受 XFO 限制、DOM 内布局零成本，「官方冷淡」风险在小范围二期可接受（§3）。
3. 三期沙箱底座：desktop 已有 WSL 管理面（distro 安装/opencode 部署/外部终端），「专用 WSL 发行版 + 项目目录挂载」是 Windows 上阻力最小路径，本调研不展开（三期立项再议）。

## 1. opencode v2 PTY 面（实证自 https://opencode.ai/v2/openapi.json，146 ops）

### 1.1 `pty` 组（7 ops，location-scoped，通用 PTY）

`GET/POST /api/pty`、`GET/PUT/DELETE /api/pty/{id}`、`POST .../connect-token`、`GET .../connect`（WS）。
`Pty` schema：`{id(^pty), title, command, args[], cwd, status(running|exited), pid, exitCode?}`。
这是「和自由 PTY 会话打交道」的通用面，**不绑定会话**。

### 1.2 `persistentPty` 组（11 ops，prototype，**绑定 session**）

- `POST /api/experimental/session/{sessionID}/terminal` —— 为会话创建终端（`CreateInput{command?, args, cwd?, title, env, size{cols,rows}}`）
- `GET /api/experimental/session/{sessionID}/terminal/read` —— **只读窥探会话「最近被控制的终端」**：「Read the last physical rows **without changing selection or taking control**」；可带行数含保留历史；无终端返回 null；**selection 是 server-local，重启重置**
- `GET/PUT/DELETE /api/experimental/persistent-pty/{ptyID}`（UpdateInput = resize + attachmentID）
- `GET .../snapshot` —— `{info, text, checkpoint(base64), cursor{x,y}}`：**重连/跨端恢复的权威快照**
- `POST .../connect-token` → `{ticket, expires_in}`（短期一次性票）→ `GET .../connect`（WebSocket：「Stream persistent PTY output through the OpenCode server」）
- `POST .../handoff` → `{directory, instanceID, ticket, expiresAt}`：**跨实例移交**（长交互进程跨会话/跨端接管的官方通道）
- `POST /api/experimental/persistent-pty/shutdown`

`PersistentPty.Info` = `Pty` 超集 + **`sessionID`** + `foregroundProcess(string|null)` + `size{cols,rows}` + `output{head,tail}`（输出游标）。

### 1.3 关键推论

- **会话与终端的绑定是一等的**：终端属于 session，有前台进程追踪、有「谁控制着」的 selection 概念、read 可不夺权窥探。这正是 opencode TUI 展示 agent 交互命令的机制（方向见 anomalyco/opencode#23449「Agent should use integrated terminal (PTY)」；changelog 已含「persistent PTY support for Windows x64 and ARM64」#56245）。
- **桌面共享终端 = attach 已有会话终端**：`terminal/read` 窥探 → `connect-token` + WS attach。agent 的 shell 工具与人的键盘落在同一个 PTY，天然互相可见。读/写权限分级有业界先例（见 §2）。
- **connect-token 设计顺便解决鉴权**：HTTP 拿一次性 ticket，WS 握手带 ticket，不必在 WS 里塞 Basic/Bearer 头。

### 1.4 风险与缺口（如实）

| 风险 | 说明 | 对策 |
|---|---|---|
| prototype 稳定性 | 路由在 `/api/experimental/` 下，OpenAPI 明示「may change without compatibility guarantees」 | 版本钉扎 + 能力探测（握手失败降级为只读镜像或隐藏 tab）；契约层隔离（`window.api.mafw.terminal.*` 背后是 SDK/直连，可换） |
| WS 反代 | gateway 现有 `/api/*` 兜底反代是 HTTP；`connect` 是 WS upgrade | 两条路：desktop 直连 serve（4096，ticket 已解决鉴权）**或** gateway 加 WS 透传。倾向直连——流量大、延迟敏感，少一跳 |
| pi runtime | 无此面 | 能力门：tab 在 pi 下显示「当前 runtime 不支持共享终端」（Gate Ruling A 惯例） |
| serve 重启 | selection server-local 重启重置；persistent PTY 进程随 serve 死 | snapshot/handoff 语义接受「重启即断」，行内提示重开 |
| 多实例同 attach | read/attach 控制模型暗示单控制者 | 二期桌面独占 attach；TUI 同时 attach 的仲裁行为列实证项 |

## 2. 业界「共享终端」对照

| 产品 | 模式 | 对 MAFW 的启示 |
|---|---|---|
| **Zed** | 频道内真·共享终端（同一 shell，多人可见可敲） | 路线 B 的语义参照：共享 = 同一个 PTY |
| **VS Code Live Share** | 共享终端**默认只读**，host 可授权写 | 权限分级先例：attach 分 read/write 两档；二期可只做写（单人产品，agent 不是「客人」），但 read 窥探模式白送（`terminal/read`） |
| **dsh** | `terminal_open/read/send/signal/close/list` 六工具 + 持久 PTY 注册表、owner 隔离 | 「注册表 + owner」模型与 v2 persistentPty 同构，佐证方向 |
| **ACP v2（草案）** | agent **自有终端**显示流（`terminal_update` + `terminal_output_chunk` + 权威快照）；客户端 fs/terminal 执行面**删除**，改由客户端提供 MCP server 承载 | 业界收敛方向：终端由 runtime 拥有、客户端订阅/attach——路线 B 与之一致；路线 A（桌面本地 PTY）是逆趋势 |
| **Codex** | `thread/backgroundTerminals/list|terminate|clean` RPC（只读管理面） | 后台终端管理面我们已有（P0-3 BackgroundDock） |

结论：**路线 A（桌面本地 PTY）与业界方向相反且兑现不了 spec 承诺；路线 C（镜像）是假共享；路线 B 是唯一直路，且 v2 原生面已备。**

## 3. 浏览器简单版（深入调研）

### 3.1 三条技术路线，两条有硬伤

| 方案 | 致命/硬伤 | 判定 |
|---|---|---|
| `iframe` | **X-Frame-Options / CSP `frame-ancestors` 会挡掉大半个互联网**（Google/GitHub/多数大站全拒嵌；VS Code Simple Browser 就是这个形态，只能看允许嵌入的站点） | ❌ 出局——「通用浏览器」不成立 |
| `<webview>` | 官方文档长期挂「不建议使用」警告（Chromium guest-view 架构在变动）；已知 resize/焦点/compositing quirks | ✅ **二期采用**（理由见 §3.2） |
| `WebContentsView` | 官方正统（BrowserView 已 deprecated），但它是**合成在 DOM 之上的原生 view：HTML UI 永远盖不住它**——右键菜单/弹层/toast/地址下拉全部压在网页下面（Electron #49039 仍 open）；dock 拖拽调宽/开关动画要手动同步 bounds；不支持圆角裁剪 | ❌ 二期不采用——overlay 硬伤恰好打中 dock（全 app 弹层最密集的区域） |

关键澄清：`<webview>` **不受 X-Frame-Options 限制**——guest WebContents 是顶层浏览上下文，不是 frame，任何网站都能开。

### 3.2 为什么逆着官方建议选 `<webview>`

1. WebContentsView 的 overlay 问题是**场景级冲突**：我们的浏览器住在 dock tab 里，而 dock 上方会频繁出现右键菜单、toast、命令面板、地址栏下拉——这些全会被原生 view 压住。workaround（覆盖时隐藏 view）= 可见闪烁；把导航条也做成 native view = 工程量爆炸。
2. webview 的「官方冷淡」风险可控：架构变动喊了多年但 Electron 42 仍正常维护；二期范围小（导航条 + 一个 guest 面），未来真要换 WebContentsView，UI 壳与导航状态机原样保留，替换面只有渲染层。
3. dock 内布局零成本：webview 参与 DOM 流，拖拽调宽、tab 切换、开关动画天然跟手。

### 3.3 安全基线（webview 版）

- `webviewTag: true` 按需开启；guest 侧 `nodeIntegration: false`、contextIsolation 保持开、不降级 websecurity
- 独立 `partition: "persist:workbench-browser"`（与主 UI 存储隔离，cookie/登录态持久化在独立会话）
- `setWindowOpenHandler`：target=_blank/弹窗默认转 dock 内导航或外抛（拍板项 3）
- `will-navigate`：http(s) 放行，其他协议（mailto: 等）外抛系统
- permission handler **默认全拒**（camera/mic/geolocation/notifications/clipboard），二期不做授权 UI
- downloads：二期拦到系统默认下载行为或直接禁用（拍板项）
- 导航条最小集：后退/前进/刷新/地址栏/「在系统浏览器打开」；标题/favicon 经 webview 事件同步到 dock tab

### 3.4 业界先例与三期伏笔

- **opencode desktop 官方已内嵌真实浏览器且 agent 可驱动**：v2 `browser` Code Mode 命名空间「controls the browser attached by the OpenCode desktop app」——tab/导航/页面快照与搜索/点击与表单/截图（要求 focused visible tab）/文件传输/console 与网络检查/性能 trace/Lighthouse。anomalyco/opencode#26772 是把它面板化给用户的 feature request。**三期「同页协同」的 runtime 侧抓手确认存在**：届时 MAFW 的「agent 浏览 ↔ 用户视口同步」可以对标这套 tab 模型。
- VS Code Simple Browser = iframe（受限先例，反面教材）。
- Wave Terminal 等用 webview 嵌 web 部件（正面先例）。

结论：二期 = `<webview>` 简单版 + 上述安全基线；三期同页协同重评估 WebContentsView（彼时 agent 同步是主诉求，overlay 问题可经「交互时网页全屏、overlay 让位」的模式设计规避）。

## 4. 三期速览（不展开，仅记录锚点）

- 沙箱底座：desktop 已有 WSL 管理面（`src/main/wsl/`：装 distro、装 opencode、起 server、开外部终端）——「专用 WSL 发行版 + 项目目录挂载（/mnt/c 或 bind）+ 爆炸半径 ≤ 项目目录（spec A1）」是 Windows 阻力最小路径。
- 「agent 命令在沙箱跑」= serve 跑在沙箱内（WSL 面板的 opencode server 正是此形态）；「人也能登进去」= 共享 terminal attach 到沙箱内 serve 的会话终端——**二期路线 B 的架构选择直接决定三期的接入成本**（B 路径下三期只是「serve 换个地方跑」）。
- 屏幕流 / CUA 观察窗：三期立项再议（spec 已拍 CUA 暂缓）。

## 5. 建议与待拍板

**建议**：terminal = 路线 B（attach 会话 persistent PTY，能力门降级）；浏览器 = `<webview>` 简单版。两者并行不冲突，可同批交付。

**待用户拍板**：
1. 路线 B 确认（证据见 §1/§2）。
2. WS 直连 serve（推荐，ticket 鉴权）vs gateway WS 反代（多一跳、统一出口）。
3. 外链策略：dock 内一律打开 vs 外部浏览器（默认建议：http(s) 外链 dock 内打开，特殊协议外抛）。
4. 二期是否含「composer 草稿模式 / 持久批注」增强（一期遗留的二期项），还是另立一批。
