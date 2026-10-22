# Agent Workbench 二期：共享 Terminal + 内嵌浏览器 + 批注草稿 — 设计 spec

2026-10-22 · 状态：待用户确认
上位 spec：`2026-10-22-agent-workbench-design.md`（§6 二期轮廓的落地）；调研依据：`docs/research/2026-10-22-workbench-phase2-research.md`

## 1. 意图与 Why

一期（文件浏览器 + 协同编辑器）落地后，「出舱验收」还剩两个口子：**跑命令要开外部终端、看网页要切系统浏览器**。二期把这两块收进 dock，并把一期「即发即消耗」的标注升级为**可攒、可持久、可批量提交**的批注草稿。

定位不变：chat = 喊话器，dock = 桌面；每个面板看进 agent 工作环境的**同一个实例**（总原则 §2）。

## 2. 范围

| 块 | 内容 | 调研结论 |
|---|---|---|
| T1 共享 terminal | dock 新 tab「终端」：attach 活动会话的 persistent PTY（路线 B） | research §1/§2 |
| B1 内嵌浏览器 | dock 新 tab「浏览」：`<webview>` 简单版 | research §3 |
| A1 批注草稿 | 标注从「即发即消耗直发」升级为「草稿可攒 + 持久 + 批量随消息提交」 | 一期 spec N2/§5.2 遗留 |

**Non-goals**
- N1：terminal 多会话管理 / tmux 式布局（上位 spec N4）——单终端跟随活动会话
- N2：浏览器多 tab / 书签 / 历史管理——单页浏览
- N3：浏览器与 agent 的同页同步（三期+；opencode v2 `browser` 工具面是届时落点）
- N4：只读窥探模式（`terminal/read`）的独立 UI——二期只有 attach；attach 失败给错误 + 重试
- N5：沙箱（三期）
- N6：terminal/浏览器的 TUI 端对应物——本期仅 desktop

**Anti-goals**（沿用上位 spec）
- A1：爆炸半径 ≤ 项目目录（terminal 的 cwd = 会话目录，不提供跳出会话目录的 UI 引导）
- A2：不做「又一个 chat 面板」

## 3. T1 共享 terminal（路线 B）

### 3.1 语义

- dock 新 tab「终端」，跟随**活动会话**（与文件树根同规则：worktree 会话 = worktree 目录）
- 打开时：探测该会话的 persistent PTY——存在则 attach，不存在则以 `cwd = 会话目录`、默认 shell（`GET /api/config/shell` 首项）创建（`POST /api/experimental/session/{sid}/terminal`）
- 人与 agent 同一个 PTY：谁敲的命令互相可见（路线 B 的核心承诺）
- 关闭 dock tab / 切会话：**detach 不杀**（PTY 属于会话，persistent）；显式「关闭终端」才 DELETE
- serve 重启：WS 断开 → tab 内提示「终端已断开」+「重新连接」（重新探测会话终端：有则重 attach，无则新建）

### 3.2 链路

```
renderer (xterm.js)
  ├─ HTTP（经 gateway :3000 既有反代/SDK 通道）：探测/创建/snapshot/connect-token/resize
  └─ WebSocket 直连 serve :4096：`GET /api/experimental/persistent-pty/{id}/connect?ticket=…`
```

- **WS 直连 serve 而非 gateway 反代**（理由：终端流量延迟敏感少一跳；connect-token 一次性 ticket 正好解决 WS 无法带 Basic 头的问题；gateway 现有兜底反代是 HTTP，不为单一路由引入 WS 透传）
- **serve base URL 发现（用户已拍板）**：gateway `/health` 扩一个**只读 `serveUrl` 字段**（additive、零行为变更）——gateway 约束从「只补鉴权注入」放宽为「补鉴权 + 这一个只读字段」；desktop main 经 `/health` 取得 base URL 拼 WS。**WS 不可达时**（external serve 在远端 / WSL mirrored 转发失效等）：tab 内降级提示 +「打开外部终端」出口（WSL 面板 `openTerminal` 同款），不回退 gateway WS 透传
- connect-token 等 HTTP 面**经 gateway 既有反代通道**（P0-3 `/api/shell*` 同款路径；若鉴权注入缺口仍在，plan Task 0 实证并补齐——与 `/health` 字段并列的 gateway 改动点，同 P0-3 先例）
- renderer 侧统一走 `window.api.mafw.terminal.*`（preload → main → SDK/HTTP），WS URL 由 main 拼好下发，renderer 不持凭据
- xterm.js + addon-fit；打开时先 `GET .../snapshot` 灌入屏显文本（含保留历史）再 attach 续流；resize 经 `PUT .../{ptyID}` `UpdateInput.size`

### 3.3 能力门与降级

- 仅 opencode v2 runtime；pi/其他 runtime → tab 显示「当前 runtime 不支持共享终端」（Gate Ruling A 惯例）
- persistent-pty 是 experimental 面：打开时握手探测（create/read 任一成功），失败 → tab 内降级提示 + 「打开外部终端」出口（WSL 面板 `openTerminal` 同款）
- **Go/No-Go 门禁（用户已拍板）**：plan Task 0 必须实证「agent shell 工具的交互命令落进会话 persistent PTY」——若实证为否（握手全通但 agent 侧不可见 = 假共享），**T1 整块 hold 不上线**（核心承诺不妥协），B1 + A1 两块先行交付，terminal 等 runtime 侧就绪再启
- 一期布局不变：terminal tab 激活时 dock 可拉宽（沿用 files/editor 的放宽规则）

## 4. B1 内嵌浏览器（webview 简单版）

### 4.1 形态

- dock 新 tab「浏览」：导航条（后退/前进/刷新/地址栏/「系统浏览器打开」）+ 单个 `<webview partition="persist:workbench-browser">`
- **链接 dock 内打开**（用户已拍）：`setWindowOpenHandler` 与 `will-navigate` 的 http(s) 一律 dock 内导航；非 http(s) 协议（mailto: 等）外抛系统
- 标题/favicon 同步到 dock tab 标签
- 空态 = 地址栏聚焦的欢迎页（无默认主页）

### 4.2 安全基线（逐条落实 research §3.3）

- `webviewTag: true` **所有 MAFW 窗口统一开启**（builder check 裁定：约束本意是锁 guest 能力而非限制窗口数；第二窗口的「浏览」tab 正常工作）
- guest 锁死：`nodeIntegration: false`、contextIsolation 开、不降级 websecurity
- permission handler **默认全拒**（camera/mic/geolocation/notifications/clipboard…），本期无授权 UI
- downloads 拦截：转系统默认下载行为，webview 内不弹自定义管理
- 无 preload 注入（guest 不持任何桌面能力）

## 5. A1 批注草稿

一期 Q1=A 的「即发即消耗直发」升级为**草稿优先**，直发降级为次要路径：

### 5.1 交互

- 编辑器/diff 选中代码 → 弹出输入框写一句话 → 两个动作：**「加入批注」（默认，Enter）** / **「立即发送」**（一期原行为）
- 「加入批注」：批注进入**待发送列表**（composer 上方 chips/列表区：文件 + 行范围 + 摘要，可逐条删、可清空）
- **flush 作用域（builder check 裁定）**：批注**只在 composer 正常发送路径打包**——含会话忙时的 turn-queue（**入队时打包**，入队后新增的批注不跟这条、等下一条）；**允许空文本 + 纯批注发送**；`/btw`、`/waitwhat`、newGoal 的 `chat.sendEnriched` 等其他发送入口**一律不带批注**
- 发送时：待发送批注全部打包为结构化引用块（文件路径 + 行范围 + 选中内容 + 各自批注语）随消息发出，发出后清空
- diff 视图与编辑器同构（同一批注池）

### 5.2 持久化

- 批注按 `会话ID + 文件路径` 持久在**桌面端 JSON**（main 进程写用户数据目录，不经 gateway——纯桌面增强，零 gateway 改动）
- 重启/切会话不丢；会话删除时随会话清理
- 一期直发管线（diff-comment prompt 构造）复用为「立即发送」与批量打包的格式化层

### 5.3 非目标

- 批注的跨会话共享、agent 侧主动读批注、批注挂在代码行上的内联展示（ gutter 标记）——留后续

## 6. 验收判据

1. terminal：桌面内对活动会话敲命令，agent 侧（opencode TUI/另一客户端）可见同屏输出；agent shell 工具的交互命令在桌面终端可见可续敲；serve 重启后有明确断开提示与重连路径
2. 浏览器：dock 内打开任意 http(s) 站点（含拒 iframe 的大站），链接 dock 内开，「系统浏览器打开」可用；权限请求一律静默拒绝；不持凭据的 guest 无 node 能力
3. 批注：选中 → 加入批注 → 关 app 重开 → 批注仍在；发送消息后批注随消息结构化到达会话；「立即发送」保持一期行为
4. pi runtime：terminal tab 显示能力缺失提示，其余两块正常
5. desktop 全量测试 + tsgo + electron-vite build 全绿（TDD 惯例）

## 7. 已决事项（用户拍板）

| 决策 | 内容 |
|---|---|
| terminal 路线 | B：attach 会话 persistent PTY（真共享），非本地 PTY / 镜像 |
| 浏览器技术 | `<webview>`（非 WebContentsView/iframe；依据 research §3） |
| 链接策略 | dock 内打开 + 系统浏览器出口 |
| 批注形态 | 草稿优先（可攒/持久/批量），直发降级为次要路径 |
| 二期范围 | terminal + 浏览器 + 批注草稿三块同批；不含一期外的其他遗留 |
| serve URL 发现 | gateway `/health` 扩只读 `serveUrl` 字段；WS 不可达 → 降级提示 + 外部终端出口（不回退 gateway 透传） |
| 假共享门禁 | Task 0 实证 agent 命令不进会话 PTY → **T1 hold**，B1+A1 先交付，核心承诺不妥协 |

## 8. Builder 的自由度（我的 call，可在实现期调整）

- WS 直连 serve（§3.2；若实证发现 gateway 反代已能透传 WS 且代价低，可改）
- terminal 的默认 shell 选择细节、快照灌入的重放上限
- 批注在 composer 的具体呈现（chips vs 列表）
- xterm 主题 token 对齐 mafw.css 变量的具体映射
- 浏览器 tab 图标（候选 🌐）与 terminal 图标（候选 ⌨/>_）

## 9. 风险与备注

- **experimental API 漂移**：persistent-pty 在 `/api/experimental/` 下，官方明示可无预警变更——握手探测 + 能力门兜底；opencode 升级时列入回归清单
- **多控制者**：另一客户端（opencode TUI）同时 attach 同一会话终端时的仲裁行为未知，plan Task 0 实证；二期桌面侧不做锁
- **WS 直连的凭据面**：ticket 一次性短期，renderer 不持长期凭据；connect URL 不含可复用秘密
- **webview 官方态度**：架构 churn 风险记录在案（research §3.2）；替换面收敛在渲染层
- **批注与会话目录漂移**：会话 move/换目录后旧批注指向旧路径——按 `会话ID+文件路径` 存取天然隔离，不特殊处理
- 既有并行工作流不受影响（不动 gateway cognition 文件）
