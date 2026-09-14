# Desktop 交互逻辑 × 业界对比缺陷调研

> 调研日期：2026-09-14。对象：MAFW Desktop（`packages/desktop`，Electron + SolidJS 全量源码深扫）。
> 业界对照（2026-09 快照）：**Claude Cowork / Claude Desktop**（帮助中心全文精读）、**Cursor**（2026-08~09 changelog）、**opencode**（官方 docs）、**Hermes**（2026-09-11 前轮调研）、**Codex**（官方站 403，基于前轮已知功能）。
> 所有我方结论附 `文件:行号` 引用；业界结论注明出处。

---

## 0. TL;DR

MAFW Desktop 的**单会话精细交互**（权限卡对账、语音全链路、分屏、可观测性 Dock）达到或超过业界水平；**agent 时代的编排语义**全面落后：steering（busy 消息被静默丢弃）、离场闭环（无托盘无 OS 通知）、任务一等实体（Goal 后端最强 UI 最弱）、审批模式化（引擎有 desktop 未暴露）。

四个结构性缺陷（P0）：

| # | 缺陷 | 位置 | 业界对照 |
|---|---|---|---|
| 1 | busy 时消息静默丢弃，无队列无提示 | `ChatPane.tsx:827-830` | Cursor/Cowork/Hermes 均有 steering；我方 TUI 已有 `queuedTurns` |
| 2 | 离场体验为零：无 Tray、无 OS 通知 | 全库 grep 零 Tray | Cowork "关笔记本继续跑"+跨表面；架构已支持（gateway daemon 独立存活） |
| 3 | Goal 编排 UI 与后端能力倒挂 | `Dashboard.tsx:29` 等 | Cursor Projects：coordinator/委派/订阅一个导航入口 |
| 4 | 权限审批无模式选择器 | pi `approvalPolicy` 未暴露 | Cowork Manual/Auto/Skip 聊天框内切换 |

---

## 1. 我方现状全貌（九个切面）

### 1.1 导航结构
- 单窗口三栏：Rail（264px 可折叠 32px）+ TabStrip（chat/goals/memory/approvals/triage/automation 六 tab + 轨迹按钮）+ RightDock（320px 拖拽 240-480）— `MafwShell.tsx:1799`
- Session tab：`openSessionTab`（`MafwShell.tsx:188-204`）、`+` 新建（1973）、`✕`/右键关闭（1896/1912）、双击重命名（1862-1887）
- **分屏（tmux 模型）**：最多 4 pane（434）、禁同向嵌套（694-702）、tab 拖入边缘 drop zone（608-627）、占位 pane 选择器（`SplitPlaceholder.tsx`）、标题栏双击最大化、分隔条拖拽 MIN_PX=160
- 子代理导航：`openSubagentSession` 只换内容 pane + `subagentStack` 返回按钮（`ChatPane.tsx:1735-1739`）
- 缺陷：**tab 与分屏布局均不跨重启持久化**（`MafwShell.tsx:278-286` 主动清 legacy key，启动恒回 Welcome）；`GraphPage`（`pages/Graph.tsx:26`）死代码零引用；`backToParent` 调试 toast 残留（121）

### 1.2 聊天交互
- 渲染：`SessionTurn`（@mafw/session-ui）+ MarkedProvider；per-turn ErrorBoundary；MAFW 定制工具卡（`MafwToolCards.tsx:304-333`，Python 卡含 matplotlib 网格）+ 用户插件卡（completed/error 才渲染，`UserPluginCards.tsx:14-39`）
- 流式：SSE delta 增量 + 三态 phase bar（Perplexity 式，`ChatPane.tsx:1868-1875`）+ Running 呼吸点 + TaskBar
- **打断**：发送按钮变停止（2054-2063）；Esc/Ctrl+C 仅 focused+sending；**busy 时普通消息静默 return（827-830）无队列无提示**；语音有"对讲机打断"（abort 再发，831-833）；agent 切换 busy 确认（2188-2205）
- fork/revert/unrevert：userActions（167-205）+ revert 自绘确认弹窗 + fork toast 开新 tab + unrevert 非模态面板；manager"新话题"用原生 `window.confirm`（`MafwShell.tsx:253`）
- 历史：初始 100 条 + `renderLimit=10` 本地扩展 + `before` cursor 分页（`ChatPane.tsx:1457-1507`）+ prepend 视口补偿；智能粘性滚动（`ChatPaneScroll.ts`，SNAP=120）+ 跳到最新 pill + MessageNav 回合导航（≥2 turns）
- 输入框：TextareaV2 自增高 200px、Enter/Shift+Enter、图片粘贴 canvas 降采样 + 拖拽 + `+` 附件、@ 仅 agent（最多 3 chips）、`/` 弹 CommandPicker（本地+MAFW+opencode 命令合并）、语音（VAD 分段 + TTS 音色面板 + 流式播放 + barge-in）
- **缺**：无 @file、无 ↑↓ 历史、无 draft 持久化（keyed Show per sessionID，`ChatPane.tsx:120-126`，切 tab 丢草稿）
- 权限审批：PermissionCard 串行队列 + Y/A/N 键盘 + 高风险 1.5s 双击 arm + 危险片段红色高亮 + 60s/SSE 重连幽灵卡对账（`MafwShell.tsx:843-880`）
- ask_user：AskCard 单/多选 + 1-9 键盘 + 折叠摘要
- ModelPicker：Popover + 搜索 + 最近 3 + 分组 + 上下文/多模态/思考徽标 + ↑↓/Enter；context pill（70%/90% 变色）+ 成本 tooltip

### 1.3 键盘
- 全部 renderer 级：Ctrl+K 会话搜索（`Rail.tsx:140-150`）、Ctrl+J 任务列表、Ctrl+T RightDock、Esc/Ctrl+C 中断、Ctrl+=/-/0 + 滚轮缩放（默认强制 zoom=1）
- 死代码：`mafw-menu.ts` 的 `CmdOrCtrl+Shift+M` 从未挂载；preload `onMenuCommand/onDeepLink/onNavigateMafw`（`preload/index.ts:84-135`）renderer 零订阅——**deep link 主进程已注册 mafw:// 协议但 renderer 断链**
- 无全局命令面板（Ctrl+K 只搜会话）

### 1.4 Goal 编排
- Goals 页：4 KPI 卡 + goal 卡列表 + 右键 View/Pause/Resume/Cancel（`Dashboard.tsx:26-36`），15s 轮询
- **"View Details" 只调 `goals.get()` 不渲染结果**（`Dashboard.tsx:29`）；GraphPage 死代码
- ask_user：全局 QuestionWidget overlay（文本回答/Cancel）+ Approvals 页二值区块（Approve/Reject 非文本）——两处口径不一
- 里程碑推送：无专门 UI，noReply 消息以普通消息落 manager 会话
- ManagerCard：phase + wave 进度 + 待决徽标，但 `onOpenQuestions` prop 从未传入（`Rail.tsx:319-324`）
- /btw：CommandPicker 支线问答 + toast
- 对比：TUI 反而有 goal 详情下钻（`GET /api/goals/:id/sessions` → transcript overlay），desktop 没接

### 1.5 Triage/Approvals/Automations
- 共同模式：卡片列表 + 右键菜单 + 10s 轮询 + Loader + 空态；无批量、无键盘、无分页
- Triage 只有 View/Dismiss（无 propose-decision UI，MCP 工具有）；Automations 只有 toggle（无创建/编辑 UI）

### 1.6 通知反馈
- ToastV2 全覆盖（2000-5000ms）；**破坏性确认三种风格混杂**：原生 `window.confirm`（Rail 删会话 181、新话题 253、Config runtime 切换 205、插件删除 312）× mafw-confirm 自绘 × 双击 arm
- 消息复制依赖 Electron 全局右键菜单，气泡无复制按钮

### 1.7 RightDock
- tasks（折叠已完成 + pending 窗口 + 📌 pin + TaskBar hover-intent）/ trajectory（KPI + 回合手风琴 + SSE 去重 merge）/ usage（上下文堆叠条 + 分模型 + Top3）/ quota（进度条 + pacing + 倒计时）/ notes（便签板镜像 + 倒计时红高亮）
- 缺陷：props 类型漏 `"notes"`（`RightDock.tsx:9-12`）靠 `@ts-nocheck`

### 1.8 窗口级
- **无托盘**（grep 零命中）；关窗即退 app（gateway daemon 独立存活，`main/index.ts:157-161` 注释明确）
- 单实例锁 + second-instance 聚焦；多窗口基础设施在（window-registry）但无"新建窗口"入口
- electron-window-state 尺寸持久化；无边框 + titleBarOverlay；崩溃恢复原生 dialog；自动更新

### 1.9 我方领先项
- 权限卡体系（串行队列 + 幽灵卡对账 + 键盘化 + 双击 arm）——超过 Cursor/Cowork 桌面
- **语音全链路**（VAD 分段上传、流式 TTS、播放互斥、barge-in 人声打断、自动播去重）——超过 Cursor 与 Cowork 桌面
- **分屏 tmux 模型**（拖拽分区预览、路径漂移处理）——Cowork/Cursor 桌面均无
- RightDock 可观测性（用量/配额/轨迹/便签）——业界无同级对照
- 双层分页 + 粘性滚动 + MessageNav

---

## 2. 业界基线（2026-09，七回路）

### 2.1 Steering（中途转向）——三家全部有
- **Cursor**（changelog 2026-08-19）："send a message to steer the agent while it's working without interruption. Follow-ups wait for the next tool call instead of cutting the agent off. Type a follow-up and hit Send now, or press ⏎ twice."——排队到下一个 tool call 边界注入
- **Claude Cowork**："Steering: You can jump in to course-correct or provide additional direction mid-task"；跨表面（"Start a task on one surface, steer it from another"）
- **Hermes**：/steer /queue /busy 三种中途干预 + 队列管理
- **opencode**（TUI）：busy 消息排队（我们 TUI v2 已对齐，desktop 未对齐）

### 2.2 离场体验（离开屏幕后的回路）
- **Cowork**："Sessions keep running even when the desktop app is closed"；"Work continues if you close your laptop"；任务跨表面接力（手机上答 Claude 的提问）；配合 quick entry 全局热键（Mac）+ deep link（claude://）
- **Cursor Projects**（changelog 2026-09-10）：跑在云端自己的计算机上，"closing your laptop doesn't stop it"；subscriptions 让 agent watch Slack/定时/追 PR 而无需 prompt
- **Claude Desktop**：quick entry（全局热键唤起快速输入，Linux 依赖 GlobalShortcuts portal 侧证其为全局快捷键）；deep link 协议
- OS 通知是桌面 agent 标配回路：用户必须有"回来看"的信号

### 2.3 审批模式化（节奏控制）
- **Cowork**：三模式 **Manual / Auto / Skip**，"You can change the mode at any time from the mode selector in the chat box"
  - Manual：逐次审批；Auto：模型自审（数据外泄/prompt injection 检查）+ 自动放行，"If Claude keeps running into blocks, it switches back to asking your permission"（自动降级），代价是消耗更多 usage；Skip：完全免审
  - **删除硬门槛**：永久删除文件无视模式必须显式 Allow
- **opencode**：permission 配置对象语法细粒度规则（前轮调研）
- **Hermes**：破坏性命令三选确认（Approve Once/Always/Cancel）
- 对照我们：PermissionCard 精细但无节奏控制；pi runtime `approvalPolicy`（autoApprove/autoDeny）已存在于引擎、desktop 未暴露

### 2.4 编排任务一等实体
- **Cursor Projects**（2026-09-10）：coordinator agent 不写代码只规划+委派+回收（与 MAFW manager/goal 同构）；**shared context**——每个 Project 维护跨 agent 同步的文件集（agent 学到的东西沉淀给未来所有 agent，与谐波记忆同构理念）；subscriptions（Slack/定时/PR 事件驱动）
- **Cowork**：Tasks list 一等实体（"⋮" 溢出菜单/垃圾桶删除）；`/schedule` 斜杠命令建定时任务 + 侧栏 Scheduled 固定入口（轻触发 + 重管理两个面）；Projects 把相关任务组成持久 workspace（自带文件/上下文/指令/记忆）
- 对照我们：后端（wave/loop/phase/budget/milestone/outcomes 表）业界最强，UI 最弱

### 2.5 阅读侧
- **Claude**：chat search（对话搜索+记忆跨对话续接）；"Edit with Claude"——高亮 artifact 文本原位下指令，"no need to describe the section in your task thread"
- **opencode**：/undo /redo（回退后原消息回到输入框可改再发）
- **压缩可见性**：Cowork 长任务无超时无上下文限制（内部压缩），业界普遍让用户感知压缩边界
- 对照我们：无 transcript 搜索；CompressionDivider 死代码（compaction 无感知）；无消息复制按钮

### 2.6 方案先行确认
- **Cowork**：任务创建第 4 步 "**Review Claude's approach, then let it run**"——计划审查是创建流的一环
- **opencode**：Tab 键 Plan/Build 双模式（Plan 禁改动只出方案）
- 对照我们：Welcome 页新建 Goal 直接乐观插入"创建新 Goal"消息（`MafwShell.tsx:224-247`），无方案确认步

### 2.7 命令发现与全局入口
- 斜杠命令三家标配；Claude quick entry（全局热键）+ deep link；opencode which-key + leader 键
- 对照我们：CommandPicker 已有（好），但无全局热键、deep link 断链、无命令面板

### 2.8 其他业界参考点
- Cowork 权限模式与连接器开关收敛到聊天框周边（mode selector + "+" 菜单），而非散落设置页
- Cursor custom modes：任意 skill 可 pin 成常驻模式（"always on" skills）
- Claude break reminders / quiet hours（健康型交互）
- Claude 月度 recap；无痕对话；对话分享三层（撤销/公开链接/指定人）

---

## 3. 缺陷清单（按优先级）

### P0（结构性）

1. **busy 消息静默丢弃**（`ChatPane.tsx:827-833`）：sending 时普通消息直接 return，无队列、无提示——静默数据丢失，比禁用输入框更糟。语音反而有打断语义。**我方 TUI 已有 `queuedTurns` 先例。**
2. **离场闭环为零**：无 Tray、无 OS 通知。gateway 是 daemon（任务照跑）但用户无任何"回来看"的信号；权限卡、ask_user、里程碑、回合完成四类事件都只活在窗口内。
3. **Goal 详情视图缺失**：View Details 不渲染（`Dashboard.tsx:29`）、GraphPage 死代码、里程碑无专门 UI、ManagerCard `onOpenQuestions` 未接线；TUI 的 goal 下钻 API 现成未用。
4. **审批无模式化**：逐次审批疲劳；pi `approvalPolicy` 引擎已有未暴露。

### P1（功能缺失）

5. @file 引用（仅 @agent）；↑↓ 输入历史；composer draft 持久化
6. 会话内文本搜索（Ctrl+K 只搜会话列表）；CompressionDivider 复活；消息复制按钮
7. 会话分享（opencode /share）；tab+分屏布局跨重启恢复
8. Triage propose-decision UI；Automations 创建/编辑（Cowork /schedule 在聊天框可建）
9. Goal 创建方案确认步（Cowork 式 review approach）；新建窗口入口（基础设施已在）

### P2（质量债）

10. 破坏性确认三风格统一（window.confirm × mafw-confirm × 双击 arm）
11. 死代码清理：GraphPage / HandoffCard / CompressionDivider / mafw-menu 快捷键 / preload onDeepLink 断链
12. Approvals 徽标口径（不含 user-question，`MafwShell.tsx:1839`）；RightDock 类型补 notes；裸 `<button>` 违规（`Rail.tsx:298,327`、`WelcomeHome.tsx:121`）；调试 toast/console.log 清理；全局命令面板

---

## 4. 实施优先级建议

1. **P0-1 busy 排队 + steering**：desktop 版 queuedTurns，`session.idle` 续发
2. **P0-2 离场闭环**：Tray + OS 通知（idle/permission/question/milestone）+ 关窗进托盘
3. **P0-3 Goal 详情视图**：接现成 `GET /api/goals/:id/sessions`
4. **P1**：审批模式选择器、@file、draft、会话搜索等
5. **P2**：统一 + 清理

实施计划见：`docs/superpowers/plans/2026-09-14-desktop-interaction-p0.md`

## 来源

- Claude Cowork get started / Claude Desktop install（support.claude.com，2026-09-14 抓取全文精读）
- Cursor changelog 2026-08-17 ~ 2026-09-10（cursor.com/changelog）
- opencode docs（opencode.ai/docs）
- Hermes / Codex / opencode TUI 前轮调研（2026-09-11 / 2026-09-14 记忆）
- MAFW desktop 源码深扫（explore agent，2026-09-14）
