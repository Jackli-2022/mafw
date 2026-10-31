# 鲸群进左栏（Pod Left Rail）设计

- 日期：2026-10-30
- 状态：待批准
- 相关：`docs/superpowers/specs/2026-10-29-project-pod-lite-design.md`、`2026-10-30-pod-a2a-handoff-design.md`、`2026-10-27-left-rail-visual-polish-design.md`
- 调研：本文 §1（业界 6 家，2026-10 实读）

## 1. 背景：业界把 agent 导航放进了左栏

2026-10 实读六个产品的当前形态（来源见 §1.3）：

| 产品 | 位置 | 每行信息 |
|---|---|---|
| VS Code | **左侧活动栏** Agent Sessions 视图 | 会话名 + 最近活动时间 + 未审阅改动数 |
| Cursor 2.0 | **左栏 agent 列表取代项目树**（编辑器视图），另有 agent view | 状态、进度、输出日志、上下文 pills |
| Zed | Threads Sidebar **默认停左**，Agent Panel 同侧；项目/Git 面板挪右 | 按项目分组的 thread 列表 |
| Codex 桌面 | 左栏竖排 agent 堆叠 | 多线程会话，线程内挂 subagent |
| Devin Desktop | 更激进：Kanban（Agent Command Center）成为默认视图 | Space = 任务，内含一队 agent |
| Claude Code | 无专门左栏，agent teams 用 tmux 分屏 | 终端取舍，不采用 |

共性四条：① 一个统一的「按 agent」列表承担跨 agent 导航；② 每行只给名字 / 最近活动 / 待处理数量；③ 选中项决定右侧内容；④ 团队比单人复杂时多一层容器（Space ⊃ team，thread ⊃ subagent）。

**结论**：MAFW 的 Pod（项目级固定 3 人 + 当前 goal + 任务板 + 邮箱）比单会话重、比 Devin 的 Space 轻，落在「左侧导航 + 右侧深操作」这一档最合适。当前它只在「右工作台 › 执行 › 鲸群」，属于二级下拉里的深操作，与业界方向相反。

### 1.3 来源
- VS Code: https://code.visualstudio.com/learn/foundations/agent-sessions-and-where-agents-run （2026-10-28 页面）
- Cursor: https://cursor.com/changelog/2-0
- Zed: https://zed.dev/blog/parallel-agents
- Devin Desktop: Cognition「Agent Command Center / Spaces」发布说明
- Codex: openai.com/codex、桌面端介绍
- Claude Code agent teams: https://code.claude.com/docs/en/agent-teams

## 2. 目标与非目标

### 目标
1. 左 rail 新增「鲸群」入口，一眼看到三个人在干什么、有没有要我动手的事。
2. 左 dock 内可直接**发消息**，交互与普通会话一致（Enter 发送 / Ctrl+Enter 换行）。
3. 尽可能复用现有模块（会话打开、消息渲染、readline、UI 原子），不新造第二套。

### 非目标
- 不做 Kanban 主视图（Devin 那种把编辑器变成一列的形态）。
- 不搬右栏「执行 › 鲸群」的深操作（建任务、记忆编辑、会话快照、goal 队列）。
- 不改 Pod 数据模型（表结构零变更）；不改 agent 工具协议。
- 不做 per-member AgentCard / 外部认证 / push webhook。

### 反目标（技术上行但算失败）
- 左 dock 里再造一个「迷你聊天窗」，导致同一条消息两套渲染、两套输入法行为。
- 把「立即提醒」做成默认行为，用户随便贴个备注就把 agent 叫起来烧 token。

## 3. 交互规格

### 3.1 左 rail 图标

- 位置：`工作 / 搜索 / 便签` 之后（destination 组第 4 个）。理由：它属于「去哪儿」而非「工具」。
- 图标：新增 glyph `team-three`（24×24 viewBox、stroke 1.5、`currentColor`，与现有图标同规格）。现有集合无人群语义图标，`dot-grid`/`bubble-5` 语义不符。
- badge：`待审任务数 + 未读消息数`（定义见 §4.3），>9 显示 `9+`；0 不显示。
- tooltip / `aria-label`：`鲸群 · {n} 项待处理`（沿用 `railAriaLabel` 约定，数字必须进无障碍名）；无待处理时只说「鲸群」。
- 激活态：沿用 `.mafw-icon-rail-icon.active` 填充块（与工作/搜索/便签一致），不新造样式。
- 点击语义：沿用 `toggleFace`——点已激活 = 收起；点别的 = 切换并保持打开。

### 3.2 左 dock 的 `pod` 面

面宽沿用 `LEFT_DOCK_WIDTH`（默认 264 / min 180 / max 400），push/overlay 判定沿用 `resolveMode`，不改预算公式。

自上而下：

1. **头部**：`鲸群` + 项目名（`railProjectName` 同源）+ 状态 pill（活跃 / 空闲 / 休眠，来自 `pod.status`）+ 刷新按钮。
2. **成员区**（列表，三项固定顺序 Lead → Builder → Reviewer）：
   - 左：角色色点 —— `working` = `--accent`，`available` = `--text-3`，`sleeping` = 虚线描边，`waiting` = `--accent` 半透明。
   - 中：`显示名` + `agent 名`（mono 小字）+ 状态词。
   - 第二行：**当前动作**——该成员有未结束 session 时显示「会话中 · {会话标题}」（标题来自 `sessionStore`，缺失回退「会话中」）；否则「待命」/「休眠」。
   - 右：`打开会话 ↗`（无 session 时禁用，tooltip「暂无活跃会话」）。
3. **当前 goal 卡**：`{goalId 短码} · {phase} · loop {n}`，数据取 `PodDetail.goals` 的 active 项 + `/api/goals` 列表（phase/loop 已有字段）；**不显示标题**（`/api/goals` 无 title，取标题需拉 timeline，代价不划算）。点击打开 Goal 详情 overlay（复用 `onOpenGoal`）。
4. **计数条**（底部固定，三项可点）：
   - `待审 N` = 任务状态 `review` → 打开右工作台「执行 › 鲸群 › 任务板」
   - `待办 N` = `pending` + `in_progress` + `blocked` + `reopened`
   - `邮箱 N` = 未读数（§4.3）→ 打开「执行 › 鲸群 › 邮箱」
5. **输入区**（见 3.3）：收件人 + kind + 文本 + 「立即提醒」开关 + 发送。

**空态**：项目无 Pod（lookup 返回 404 JSON）→ 「创建鲸群」按钮（`pod.ensure`）；gateway 路由缺失（响应非 JSON / 404 但 Content-Type 是 HTML）→ 「当前 gateway 不支持鲸群，请升级」；**worktree 会话**（`benchRoot() !== currentProject()`）→ 不提供创建，显示「worktree 会话不绑定鲸群，请在主项目打开」；离线 → 现有 `ConnBanner`。

### 3.3 发送语义（默认贴条）

- **贴条（默认）**：`POST /api/pods/:podId/messages`，写 `pod_messages`，`toMemberId` 可空（广播）。不烧 token，对方下次被 prompt 时经 `[POD HANDOFF]` 看到。
- **立即提醒（开关）**：请求体带 `notify: true`。gateway 找该成员未结束 session → `promptAsync({ delivery: 'queue' })` → 标记 `deliveredAt`。
- **约束**：`notify: true` 必须带 `toMemberId`（广播 + 提醒 → 400）；无活跃会话时开关禁用，tooltip「{成员} 当前没有活跃会话，消息会在下次派活时送达」；不自动建 session。
- **响应**：`{ message, delivery?: 'delivered' | 'pending' | 'disabled' }`。老 gateway 没有该字段 → UI 显示「已发送（投递状态未知）」，不做承诺；`delivery: 'pending'` → 消息行继续显示「待投递」。
- kind：`note`（默认）/ `request` / `review` / `decision` / `escalation`，复用 `PodInbox` 的选项与文案。

### 3.4 键盘与焦点

- 输入框：`Enter` 发送、`Ctrl+Enter` 换行（复用 `applyReadlineKey`）。
- `Esc`：输入框有内容时清空；空时关闭左 dock（overlay 模式）。
- overlay 模式下选中会话 / 打开 goal 后左 dock 自动关（沿用 `shouldCloseOnSelect`）。
- rail 图标与现有项同一 roving tabindex 流程；badge 变化不抢焦点。

## 4. 数据与接口

### 4.1 读（复用，零新增读接口）
- `pod-store`（Solid 单例）：`open(dir)` → `GET /api/projects/:id/pod/lookup`，`get(id)` 刷新，`listMessages(id)`，`pod.updated` 200ms 合并。
- **常驻订阅归 shell**：`MafwShell` 在项目就绪后 effect `podStore.open(benchRoot() ?? currentProject())`，左右两栏共用同一 store（右栏 `PodDock` 不再自己 `open`，只在需要时 `refresh`）。目录口径统一为 `benchRoot() ?? currentProject()`，与右栏现状一致；SSE 从 `reconnecting` 回到 `connected` 时补一次 `refresh()`。
- 成员→session：`PodDetail.sessions`（`memberId` → `endedAt === null` 的最新一条）。

### 4.2 写
- 贴条：`pod.sendMessage`（不带 `notify`）→ 行为不变。
- 立即提醒：`pod.sendMessage(..., { notify: true })` → 路由 `await delivery.deliver(id, { force: true })` → 响应带 `delivery`。
- **已读**：点击某条消息 → `POST /api/pods/:podId/messages/:messageId/read`（复用已有 `PodMessageService.markRead`，补路由 + 广播 `pod.updated`）。

### 4.3 badge 与未读（纯函数，可测）

```
unread(messages, selfMemberId) = messages.filter(m =>
  m.readAt == null &&
  m.fromMemberId !== selfMemberId &&
  (m.toMemberId === selfMemberId || m.toMemberId == null))

podRailBadge(tasks, messages, selfMemberId) =
  tasks.filter(t => t.status === 'review').length + unread(messages, selfMemberId).length
```

`selfMemberId` = lead（UI 以 Lead 身份操作）。>9 → `9+`。**只有点击某条消息才标记已读**（用户裁决），打开面板不清零。

### 4.4 任务状态投影补 `review`（用户裁决）

现状：`applyReceipt` 把 execute 回执 `done` 直接写成 `done`，`review` 没有生产者，待审恒为 0。
改为：

- `applyReceipt`：回执 `done` → **`review`**（待验收）；`failed` → `failed`；`skipped` → `failed`（不变）。
- `reopenForReview`（Reviewer FAIL）：`in_progress` + `review` + `done` → `reopened`。
- Reviewer PASS → goal 归档 → `reconcileArchive(ok: true)` 已把 `review` 归入 open 集合 → `done`（无需新代码）。
- `startExecution` 不取 `review`（保持只取 `pending` / `reopened`）。
- `ALLOWED_TRANSITIONS` 已支持 `in_progress → review`、`review → done|reopened`，状态机不动。
- 手动任务（`createManual`）不受影响。

## 5. 复用清单（诚实版）

| 复用 | 说明 |
|---|---|
| `pod-store` | 直接复用；新增 `markRead`、`sendMessage` 的 `notify`/`delivery` 字段 |
| `PodInbox` 的 kind/收件人选项与 `A2A`/`待投递` 徽标 | 复用 `podMessageProtocolLabel` / `podMessageDeliveryLabel` |
| `openSessionTab` / `onOpenGoal` | 直接复用 MafwShell 现有回调 |
| `applyReadlineKey`、`composer-readline` | 输入框复用同一纯逻辑 |
| `ButtonV2`/`TextInputV2`/`TooltipV2`/`ToastV2`、`dock-panel` 骨架 | 直接复用 |
| `left-dock.ts` 的 `toggleFace`/`resolveMode`/`railAriaLabel` | 直接复用，不改 |

**不复用（必须说明）**：聊天 composer 不是独立组件，它内联在 `ChatPane.tsx`（2425 行）。**不**为本次需求抽取——会同时牵动附件、@引用、agent/model pill、审批条、批注队列，风险远大于收益。左 dock 用「小输入框 + 复用 readline 纯逻辑 + 复用 composer 的 CSS 类」，视觉一致但不共享组件树。

## 6. 后端改动（已按裁决扩大）

1. `POST /api/pods/:podId/messages`：body 接受 `notify?: boolean`；`notify && !toMemberId` → 400；响应加 `delivery?: 'delivered' | 'pending' | 'disabled'`。
2. `PodMessageDelivery.deliver(id, { force?: boolean })`：`force` 跳过 `decide() === 'push'` 门，直接找未结束 session 推送；成功后 `deps.notify(podId)` 广播（新增可选 dep，缺省不广播）。
3. `POST /api/pods/:podId/messages/:messageId/read`：调用已有 `markRead`，成功后广播 `pod.updated`。
4. 任务投影：`applyReceipt` done→`review`；`reopenForReview` 纳入 `review`（§4.4）。
5. SDK/preload：`pod.sendMessage` body 加 `notify`、返回加 `delivery`；新增 `pod.markRead`；`route-catalog` 登记读路由并 `npm run emit:openapi`。
6. 无 DB schema 变更（`read_at` 列已存在）。

## 7. 测试计划

**gateway（jest）**
- `applyReceipt` done → `review`；failed 不变；`reopenForReview` 把 `review` → `reopened`；`reconcileArchive(true)` 把 `review` → `done`；`startExecution` 不取 `review`
- `deliver({ force: true })` 对 `pull`（goal node）会话生效；无 session → `pending`；广播 + notify → 400
- `markRead` 路由置 `read_at` 并广播；未知 messageId → 404
- 响应 `delivery` 三态

**desktop（node --test）**
- `podRailBadge`：0 / 正常 / >9 / 自己发的不计 / 广播计入 / 已读不计
- 成员当前动作解析（有/无 session、标题缺失回退）
- 空态分类：404 JSON → 创建；HTML → 请升级
- 输入区：Enter 发送、Ctrl+Enter 不发送、无会话时开关禁用、Esc 两级

**GUI 冒烟（dev app + 真 gateway）**
- rail 图标与角标；点成员开会话；贴条后对方「待投递」；立即提醒在有会话成员上生效且角标不变错；点消息已读后角标下降；宽/窄各一档 push/overlay；无障碍名含数字

## 8. 风险与权衡

- **信息密度**：264px 塞三张成员卡 + goal + 计数 + 输入区，窄于 240 会挤。对策：输入区默认折叠成一行，点开才展开。
- **语义诚实**：`delivery: 'queue'` 在 opencode 上是「回合结束后优先送达」，文案不得说「立刻打断」。
- **角标抖动**：`pod.updated` 高频时靠 store 的 200ms 合并。
- **review 投影的连带影响**：右栏任务板「完成」列会变少、「待审」列变多；Goal 归档前任务停在 review 是预期语义，需要同步任务板文案与既有测试。
- **左栏拥挤**：rail 从 6 项变 7 项，可接受；为此新增专用 glyph，不复用 dot-grid。

## 9. 我替你做的判断（可推翻）

1. 位置放「便签」之后，而不是新建会话之下（它属于导航而非首要动作）。
2. badge = 待审 + 未读；「待办」不进 badge（它是存量不是待办事项）。
3. 「立即提醒」逐条开启，不做全局默认。
4. 不抽取 ChatPane 的 composer（§5 末尾）。
5. 计数条三项点击先进右工作台对应面板，不做左 dock 内联筛选。
6. 常驻订阅归 shell，目录口径 `benchRoot() ?? currentProject()`，右栏 `PodDock` 改为消费者。
7. 投递成功补 `pod.updated` 广播，让「待投递→已投递」与角标实时。
8. goal 卡不显示标题，只给 goalId 短码 + phase + loop。
9. 老 gateway 无 `delivery` 字段 → UI 不承诺投递结果。
10. worktree 会话不提供「创建鲸群」（避免在 worktree 目录里建出碎片 Pod），只在主项目允许创建。

## 10. Builder check 决议（2026-10-30）

| # | 问题 | 决议 |
|---|---|---|
| 1 | 未读语义 / 能否下降 | 未读 = `readAt` 为空 且非自己发 且（收件人=Lead 或广播）；**点击消息才标记已读**（用户裁决）；新增 read 路由 |
| 2 | 待审无生产者 | **本次改投影**：execute 回执 → `review`（用户裁决） |
| 3 | 常驻订阅与目录口径 | shell 级 effect 持有，目录统一 `benchRoot() ?? currentProject()`，右栏改为消费者 |
| 4 | 投递状态无实时事件 | `deliver` 成功后广播 `pod.updated` |
| 5 | goal 卡标题无接口 | 不显示标题，只显示 goalId 短码 + phase + loop |
| 6 | notify 契约与版本偏斜 | 广播+notify → 400；响应带 `delivery` 三态；老 gateway 无字段不承诺 |
| 7 | 「不支持」与「无 Pod」难区分 | 404 JSON = 无 Pod（给创建）；非 JSON（HTML）= 路由缺失（给升级）；不改现有 store 空态测试语义 |
