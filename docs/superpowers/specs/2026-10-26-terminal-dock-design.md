# Desktop 内嵌终端（用户工具型，不共享）— 设计 spec

2026-10-26 · 状态：待用户确认
上位 spec：`2026-10-22-agent-workbench-design.md`（五件套之 terminal）；
被修订对象：`2026-10-22-workbench-phase2-design.md` §3 T1（共享 terminal，路线 B，已 HOLD）；
wire 依据：`docs/research/2026-10-22-phase2-wire-probe.md`（2.1.0 实证，当前运行 serve 仍为 2.1.0，基线有效）。

## 1. 意图与 Why

T1 的 Go/No-Go 门禁实证（2026-10-22）：opencode 2.1.0 的 persistent PTY 是**用户终端**设施，agent shell 工具不落会话 PTY → 「真共享」承诺无法兑现 → T1 整块 HOLD。

用户裁决（2026-10-26 头脑风暴）：**先把「终端面板」与「共享」解耦**——以不共享的用户工具形态交付终端面板，核心承诺（人与 agent 同一 PTY）待上游就绪后恢复。门禁防的是「拿假共享冒充核心承诺」；显式降级 scope 不算冒充。

**定义时刻**（用户原话）：「比如要启动 desktop，我就得另开终端。」开发回路（起 dev server / 跑测试 / git 操作）被迫出舱到外部终端。本 spec 收掉这个口子。

**明确定位**：这是**给用户用的终端**，不是 agent 的工作间。agent 的命令不出现在这里；agent 侧可见性走既有的 BackgroundDock/工具卡通道，不经本面板。

## 2. 业界归属模型对照（2026-10-26 调研）

| 派系 | 产品 | 终端归属 |
|---|---|---|
| agent 工作间派 | opencode TUI/Desktop、Devin、Cursor Cloud Agents | 跟随会话（终端绑 sessionID / 每 agent 一 VM） |
| 用户工具派 | VS Code、Cursor 本地 IDE、Zed、Kimi Code Desktop | 跟随项目/窗口（底部终端面板属 workspace，与会话无关） |

Cursor 一家两派：云端 agent 终端跟随 agent，本地 IDE 终端跟随窗口——按「终端服务于谁」分流。本面板是用户工具 → 走用户工具派。用户原话佐证：「他们基本上都是 chat 固定然后 terminal 在后台」。

## 3. 形态

- dock 新 tab「终端」（图标 builder 自由，候选 `>_`），沿用 BrowserDock 的 tab 模式
- **跟随目录（directory），不跟随会话**（用户已拍板）：终端按**目录**注册——活动会话的 `directory` 定锚（普通会话=项目目录，worktree 会话=worktree 目录，与文件树根同规则）；同目录会话共用一个终端，切到别的目录才换
- 打开时：该目录已有终端 → attach（cursor 续播）；没有 → 以 `cwd = 会话目录`、默认 shell 创建
- **persistent（用户已拍板，边界收窄）**：终端进程由 serve 托管，desktop **窗口关闭（close-to-tray）/窗口重载/渲染层崩溃**后不杀，重开接回（含 scrollback 续播）；关闭 dock tab = detach 不杀，显式「关闭终端」才删除。**不保「托盘 Quit 整个应用」**（builder check Q1 裁定）：bundle 模式 Quit 树杀 gateway 进程树是托盘功能的既定设计语义（首次勾选有弹窗告知），serve 同树被杀、PTY 全灭属预期行为，不为本面板改 gateway/serve 生命周期
- **serve 重启的诚实语义**：serve 关闭会杀全部 PTY（probe §3 `shutdown`）——persistent 保桌面层重启，不保 serve 层重启。检测到 PTY 消失 → tab 内提示「终端已随服务重启关闭」+「重新打开」（同 cwd 新建）
- 单终端/目录：v1 不做 tmux 式多 tab（沿上位 spec N4 精神）

## 4. 链路

```
renderer (xterm.js + addon-fit)
  └─ IPC ── desktop main
       ├─ HTTP → gateway :3000 /api/terminal/*（新增薄反代，注入 Basic → serve /api/pty*）
       └─ WebSocket → serve :4096 直连（一次性 ticket，main 持有并打开，数据经 IPC 管到 renderer）
```

- **serve base URL 发现**：gateway `/health` 扩只读 `serveUrl` 字段（沿用 phase2 §3.2 已拍板项，additive 零行为变更）
- **gateway 新增 `/api/terminal/*` 薄反代**：list（按目录）/create/delete/resize/connect-token → serve `/api/pty` 组，注入 serve Basic 凭据。**注意这是新建鉴权注入层，不是照抄先例**（builder check Q2 裁定）：AGENTS.md 记录 `/api/shell` 经 :3000 仍 401，「v2 鉴权桥」从未落地；密码权威来源 = gateway spawn serve 时解析 stdout `server password` 行（gateway 已持有）。工作量按「新建凭据持有/注入层」计
- **serve 持有模式门（builder check Q3 裁定）**：仅 gateway **owned**（自己 spawn、持有密码）的 serve 启用本面板；adopted（收养他人 serve，无密码）与 external（`MAFW_SERVER_SERVE_URL`，可能远端）→ 能力门降级「当前 serve 模式不支持内嵌终端」，不提供密码配置入口
- **WS 鉴权形态**：一次性 ticket 为基线方案（main 持有票据并打开 WS，renderer 不见票据）；plan Task 0 可实证 location-scoped WS 是否接受 Basic 头直连，可行则省掉 connect-token 交换（builder check Q5 裁定：原 ticket 方案是推断非铁律）
- **WS 由 desktop main 持有**（非 renderer 直连，修订 phase2 §3.2 的「main 拼 URL 下发 renderer」——我的 call）：①生产构建 renderer 是 `file://` Origin，serve 的 Origin 白名单（无 Origin/localhost/oc://renderer…）对 `file://`/`Origin: null` 的行为未实证，main 走 Node 无 Origin 天然放行，消除整类风险；②ticket 不出 main，「renderer 不持凭据」更严格；③终端带宽下 IPC 管流开销可忽略
- **后端选 location-scoped `/api/pty` 组**（我的 call，probe §2 已实测 create/list/resize/delete/WS/cursor replay）：目录模型与 location-scoped 天然对齐；session 绑定的 `/api/experimental/session/{sid}/terminal`（snapshot/takeover/role）留给未来共享升级，本版不用
- 打开时握手探测（list/create 任一成功），失败 → tab 内降级提示 +「打开外部终端」出口（WSL 面板 `openTerminal` 同款）
- 重连：WS 断开 → 「终端已断开」+「重新连接」（重新 list：活着则带已知 cursor 重 attach 续播；已被杀则按 serve 重启语义走新建）
- resize：xterm fit 变化 → 反代 `PUT /api/pty/{id}` size

## 5. 能力门与降级

- 仅 opencode v2 runtime（persistent PTY 面）；pi/其他 runtime → tab 显示「当前 runtime 不支持内嵌终端」（Gate Ruling A 惯例）
- serve 持有模式门：adopted/external serve 无注入凭据 → 降级提示（§4，builder check Q3）
- serve 版本钉扎 2.1.0；opencode 升级时 pty 面列入回归清单（experimental/半官方面漂移风险）
- 会话目录对 serve 不可达等边界：创建失败按握手失败同路径降级
- **多窗口**（builder check Q4 裁定）：v1 允许多窗口 attach 同一目录 PTY，桌面侧不做锁（沿 phase2 §9）；serve 的实际仲裁行为（广播/互踢）由 plan Task 0 实证记录，不为未知行为预先设计 UI

## 6. Goals / Non-goals / Anti-goals

**Goals**
- G1：不出舱跑命令——dock 内对当前会话目录起一个真实 shell（**真实运行，非玩具/mockup**，用户明示）
- G2：persistent——desktop 关窗重开终端活着、scrollback 接回
- G3：跟随目录的归属模型（§3）

**Non-goals**
- N1：**不共享**——agent 命令不进本面板、本面板不展示 agent 终端活动（明确定位，非缺陷）
- N2：多终端 tab / 分屏 / tmux 式管理（v1 单终端/目录）
- N3：TUI 端对应物（本期仅 desktop）
- N4：只读窥探、多控制者仲裁（单人单端场景不涉及）
- N5：沙箱/CUA（三期）

**Anti-goals**（沿上位 spec）
- A1：不提供跳出会话目录的 UI 引导（用户自己 `cd` 是用户自由，UI 不引导）
- A2：不做「又一个 chat 面板」
- A3（新）：**不冒充共享**——UI 文案不出现「与 agent 共享」类暗示；面板就是用户终端

## 7. 解冻路径（不在本期交付，仅锚定）

上游 opencode v2.1.4（2026-10-23）已出实验性 `tui_open_terminal`/`tui_write_terminal`（#57506），方向正对「agent 写会话终端」。解冻评审条件：升级 serve ≥2.1.4 → 重跑 wire 实证（serve 模式 + 非 TUI 客户端下是否可用；agent 输入是否落会话 persistent PTY）→ 通则把后端从 location-scoped 切换到 session-bound attach，恢复 phase2 §3 的共享语义，**本版交付的面板 UI/IPC/注册表全部保留**。记忆指针：`mem_1792980700607_6bfeex`。

## 8. 验收判据

1. dock「终端」tab 打开 → 真实 shell 落在活动会话目录，可执行命令（起 dev server、跑测试、git）
2. 起常驻进程 → 关闭窗口（close-to-tray 隐藏）或重载窗口 → 重开 → 终端活着，scrollback 续播接回（**不含托盘 Quit 整个应用**——Quit 树杀 gateway/serve 是既定设计语义，终端随全栈退出）
3. 同目录切会话终端不变；切到别的项目/worktree 目录换成该目录的终端
4. serve 重启后 tab 提示「终端已随服务重启关闭」+「重新打开」可重建（同 cwd）
5. WS 异常断开有「终端已断开」+「重新连接」路径
6. pi runtime 下显示能力缺失提示；pty 面握手失败给降级提示 + 外部终端出口
7. desktop 全量测试 + tsgo + electron-vite build 全绿（TDD 惯例）

## 9. 已决事项（用户拍板）

| 决策 | 内容 |
|---|---|
| 共享解耦 | 终端面板以不共享的用户工具形态先交付；核心承诺（同一 PTY）待上游解冻恢复 |
| persistent | 终端随 serve 托管持久，桌面重启不杀 |
| 归属模型 | 跟随目录（directory），不跟随会话——用户工具派 |
| 真实运行 | 必须是真 shell 真命令，非 mockup |
| persistent 边界 | 保窗口关闭/重载/崩溃；不保托盘 Quit（bundle 树杀是全栈退出的既定语义） |

## 10. Builder 的自由度（我的 call，可在实现期调整）

- 后端用 location-scoped `/api/pty` 组（§4）；若 plan Task 0 重探发现该面缺陷（如 replay 不完整），可改 session-bound 面 + 桌面侧目录→ptyID 注册表
- WS 由 main 持有经 IPC 管流（§4；若实证 renderer `file://` Origin 直连可行且更简单，可改回）
- tab 图标（候选 `>_`）、xterm 主题 token 对齐 mafw.css 的具体映射
- gateway 反代路由的具体形状（`/api/terminal/*` 命名可调）、是否进 gateway-sdk 命名空间
- 目录注册表的载体（main 进程内存 Map 起步；跨 desktop 重启的 ptyID→cursor 持久化按需）
- scrollback 续播上限

## 11. 风险与备注

- **experimental/半官方面漂移**：`/api/pty` 组的形状以 2026-10-22 probe 为基线（2.1.0）；升级列入回归清单
- **xterm.js 新依赖**：desktop 包新增 xterm + addon-fit；包体增量可接受，主题映射跟随 mafw token
- **与 T1 HOLD 的关系**：本 spec 不解冻 T1，是显式 descope 交付；phase2 spec §3 保持 hold 原文，本 spec 为终端面板的当前真相源
- **gateway 改动面**：`/health` 只读字段 + `/api/terminal/*` 反代，不动 cognition/记忆面；遵循「路由正则兼容 query string」（AGENTS.md §6.5）
- **GUI 冒烟**：与其他 dock 工作同例，自动化之外的窗口冒烟单列待办
