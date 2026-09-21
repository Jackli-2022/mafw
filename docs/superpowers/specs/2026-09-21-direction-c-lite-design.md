# Direction C-lite：任务收件箱 + diff 返工闭环 + 状态语言 — 设计文档

> 日期：2026-09-21
> 前置调研：2026-09-21-direction-c-task-centric-ia-research.md（业界修正：聊天四条压缩路径而非推翻；MAFW 资产盘点）
> 决策：用户选 C-lite，之后规划 C-mid（双栏落地），C-full 观望
> 状态：设计已获用户批准（§1–§4 + 波次）

## 1. 目标 / 非目标

**目标**：给 desktop 补上「任务收件箱语义」——跨会话聚合的任务面、diff 反馈闭环、状态语言标准化。全部在现有三栏骨架内，gateway 仅加一处路由。

**非目标**：
- 不推翻 TabStrip/Rail 语义（C-full 观望）
- 不激活 ChatPane 双栏第二列（C-mid 再议，hook 已预留）
- 不改 todos 的 per-session 数据模型本体（收件箱是聚合视图，todos 语义不变）
- 不做 RightDock pane 化 / pop out（C-mid）

## 2. 设计

### §1 任务收件箱（RightDock tasks tab 升级）

tasks tab 内容从「当前会话 todos」升级为三桶收件箱（`components/InboxDock.tsx` 新组件，TaskList 保留为收件箱内「本会话」子区）：

**🔴 进行中**
- 运行中 goal：phase 徽标 + wave 进度（复用 ManagerCard 数据管线 `goals.list()` 15s 轮询），点击开 goal 详情 overlay（复用 GoalDetailOverlay）
- 活跃会话（有未完成 todos）：todos 计数 + 会话名，点击开对应 tab
- worktree 并行会话：⎇ 徽标（worktree-label 复用）

**🟠 待你处理**（各页面已有详情，收件箱为聚合入口 + 点击跳转）
- 待审批 permission.asked（`/api/approvals` 轮询已有）
- triage PENDING_CONFIRMATION
- 待答问题 ask_user（questions.list）

**🟢 待验收**
- 最近 10 个归档 goal（goals.list 返回序，verdict + 完成时间），点击开 goal 详情 overlay
- 有未审阅 diff 的会话（store.session_diff 非空 → 「审阅改动」入口）

数据源全部现成（goals/approvals/triage/questions 轮询 + todos/session_diff store），**零新 gateway API**。

**milestone 消费**：`session-events.ts` 的 IGNORED_AT_SHELL 中 `phase_transition` 移出 → 新 SSE handler（deps 注入可测）→ toast（「Goal X 进入 REVIEWING」）+ 收件箱刷新信号。

**tasksAllDone 细线收起**：本会话 todos 全完成时维持现有收起行为；收件箱桶 badge 计数替代原 TaskBar 职责（TaskBar 内联保留）。

### §2 diff 徽标 + 行级评论返工闭环

- **徽标**：会话有 `store.session_diff` 时，ChatPane 标题栏显示 `+N -M` 统计徽标（从 diffs 现算 add/del 行数），点击开 DiffReviewPanel（入口已有，补徽标）
- **评论返工（新）**：DiffReviewPanel 每 hunk 加可选评论输入框；「发给 agent 返工」→ `POST /api/sessions/:id/review-comments`（gateway 新路由 `routes/review-comments.ts`：hunk 定位 + 评论文本组装为结构化返工指令 → `runtime.session.prompt` 注入会话（对齐 approvals-respond 的模式）→ agent 返工出新 diff → SSE session.diff 刷新面板）
- gateway 改动仅此一处路由 + 契约登记；deps 注入可单测

### §3 Rail 过滤 + 分组

- 会话列表头部过滤 chips：**全部 / 进行中（有未完成 todos）/ ⎇ 并行（worktree）/ Manager**；单选，默认全部
- 日期分组保留；过滤为纯前端（store.session + todos 键集合 + worktree-label 判定，零 API）
- ManagerCard 不受过滤影响（恒置顶）

### §4 状态语言标准化

- 语义类 token（mafw.css）：`.mafw-status-ok`（accent）/ `.mafw-status-fail`（danger）/ `.mafw-status-pending`（warning）——复用现有色 token，仅语义化封装；收件箱桶标、goal 卡、任务行统一使用
- goal 卡**成本分档 pill**：累计 token → XS/S/M/L/XL（阈值：<50k / <500k / <5M / <50M / ≥50M，hover 显示精确值与成本）；数据 `TrajectoryStore.getModelUsageStats` 聚合（gateway goal-sessions 或 Dashboard 现有轮询补字段——优先前端聚合 goal.sessions 的 tokenSummary，避免 gateway 改动）

## 3. 实施波次

| Wave | 内容 | 验收物 |
|---|---|---|
| A | §1 收件箱（InboxDock + milestone toast + tasks tab 换装） | 契约/聚合测试 + 截图 |
| B | §2 diff 徽标 + 评论返工（gateway 路由 + jest + 面板改造） | gateway jest + 手动闭环截图 |
| C | §3 Rail 过滤 + §4 状态语言/pill | 契约测试 + 截图 |

每波独立 commit + 版本号与哈希汇报（用户惯例）；C-mid 双栏激活不在本 spec。

## 4. 落地文件映射

| 区域 | 文件 |
|---|---|
| 收件箱 | `components/InboxDock.tsx`（新）、`RightDock.tsx`、`MafwShell.tsx`（挂载 + 轮询聚合）、`session-events.ts`（phase_transition 出白名单）、`sse/handlers/`（milestone handler） |
| diff 闭环 | `DiffReviewPanel.tsx`（评论框 + 提交）、`ChatPane.tsx`（+N -M 徽标）、gateway `routes/review-comments.ts`（新）+ `route-catalog.ts` 登记 + SDK `sessions.reviewComments` |
| Rail | `Rail.tsx`（过滤 chips）、`worktree-label.ts`（复用） |
| 状态语言 | `mafw.css`（语义类）、`Dashboard.tsx`/`ManagerCard.tsx`（pill） |
| 测试 | `packages/desktop/tests/design-contract.test.ts` 扩展 + 收件箱聚合纯函数单测 + gateway jest |

## 5. 测试与验收策略

1. 收件箱聚合逻辑收敛为纯函数（输入 goals/approvals/triage/todos/diff 快照 → 三桶 items），bun test 全覆盖
2. milestone handler：deps 注入单测（toast 调用 + 刷新信号）
3. gateway review-comments 路由 jest（校验 400 / 会话缺失 404 / prompt 注入参数）
4. design-contract 扩展：语义类 token 存在 + 徽标规则
5. 每波截图门禁双主题（沿用直连 automation API + Media Agent 辅助）

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 收件箱轮询叠加（goals/approvals/triage/questions 已各自 15s） | 不加新轮询，聚合全部消费现有数据；统一 15s 节拍 |
| review-comments 注入打断运行中会话 | promptAsync busy 队列语义（session.prompt 队列化），不 abort；文档标注 |
| diff 徽标与 SplitView 多 pane 的归属混淆 | 徽标按 leaf.sid 挂各自 pane 标题栏（diffPanelFor 同模式） |
| 三桶为空时的观感 | 沿用 EmptyState（glyph + 引导语） |
