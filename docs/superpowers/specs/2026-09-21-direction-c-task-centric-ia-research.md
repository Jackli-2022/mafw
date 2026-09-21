# 方向 C 调研：任务中心信息架构（对话退位、产出物上位）— 可行性与实施路径

> 日期：2026-09-21
> 背景：v5 美学重设计收尾时暂缓的方向（便签板 mem_1789967950090_cf5j5s）。原始定义：按 Codex 任务收件箱 + Claude Artifacts 双栏重构信息架构，聊天退为附属视图。本报告评估实现路径与推翻成本，**不动代码**。
> 状态：调研完成，待用户决定是否立项

## 1. 业界实况（2026-09 调研，官方 docs 优先）

### 1.1 重要修正：业界没有产品真的"推翻聊天中心"

9-21 前调研从 Codex 官网截图得出"对话退位、产出物上位"的印象；本轮深挖官方文档后**结论需要修正**——2026 年主流是聊天的**四条压缩路径**，而非信息架构推翻：

1. **折叠**：Claude Normal 模式把工具调用折叠为一行摘要，默认只露正文（`Ctrl+O` 循环 Normal/Thinking/Verbose）——MAFW 已有同款（`/verbose`、tool 折叠）
2. **旁路**：问询类交互剥离成只读 side chat（Devin side chats / Claude `Cmd+;` /btw），不回写主对话、不落盘——MAFW 已有 `/btw`（gateway 一次性 session）
3. **合流**：杂多工具活动合并成单一 Progress 时间轴（Devin Progress tab：shell/编辑/浏览器合流，点击命令跳转会话时刻）
4. **结果化**：异步任务不直播过程，只投递成果 + 完成通知（Claude Dispatch："messages you the outcome rather than showing you every step"）

### 1.2 各家任务中心的真实形态

| 产品 | 任务面在哪 | 关键结构 |
|---|---|---|
| **Codex** | ChatGPT 内独立顶层视图，历史与主聊天分离；ChatGPT Work 与 Codex 双轨，会话列表**按类型过滤/置顶/归档** | 收件箱≈类型过滤的会话列表；任务粒度显示 credit 消耗 |
| **Claude Code desktop** | **侧栏即收件箱**：status/project 过滤 + 按项目分组 + auto-archive + OS 通知；**pane 系统是核心**——chat/diff/browser/terminal/file/plan/tasks/subagent 任意拖拽、可 pop out | diff 统计徽标（`+12 -1`）→ diff viewer → **行级评论批量提交返工**闭环；task chip（范围外工作一键开新 session 带 worktree）；CI 状态条 + Auto-fix/Auto-merge |
| **Devin** | 会话页 timeline 主轴 + 工具面板；**Review 收件箱**（`/review`）：PR 三桶（assigned/authored/review requested）+ Analysis 侧栏（Bugs/Flags/Security 分级）+ **XS–XL 成本分档 pill** + stacked PR 状态点（绿/红/橙） | 状态语言三色语义；Ask→Agent 两段式（Ask 里内嵌 Agent 进度） |
| **Manus** | 侧栏=收件箱：Projects 区（pin/拖拽排序）+ 任务过滤器（All/Non-project/Favorites/Scheduled）；任务可回放（replay） | 并行多 agent 收敛为一张结果表（Wide Research） |

### 1.3 任务状态语言（跨产品收敛）

- 三色语义：绿=完成/可合、红=失败/严重、橙=阻塞/待审批
- 成本分档 pill：XS–XL t-shirt size，hover 看精确值
- 批准即通知：需要审批 ≠ 页面里等，OS 通知 + 会话内卡片
- 徽标溯源：任务来源/类型用徽标标记（Dispatch badge、Chat/Work 过滤）

## 2. MAFW 现有资产盘点（explore 调研结论）

### 2.1 可直接复用

| 资产 | 位置 | 复用方式 |
|---|---|---|
| 双栏 hook | `mafw.css:2835-2841`（`.mafw-pane[data-layout="chat"]`） | **最直接的 IA 切换杠杆**：columns 改 `minmax(0,1fr) 360px` 即得 pane 内第二列 |
| RightDock 容器 + TabsV2 | `RightDock.tsx:8-38`（tasks/trajectory/usage/notes 四 tab，quota 已并入 usage） | 加 inbox tab 或提升为主列成本低 |
| Goal 数据管线 | `Dashboard.tsx:10-98`（15s 轮询 + KPI + phase 徽标）+ `GoalDetailOverlay.tsx`（goals.get/sessions 下钻） | 任务收件箱的天然骨架 |
| ManagerCard | `ManagerCard.tsx:61-89`（goal phase + wave 进度 + 待决问题徽标，15s 轮询） | 直接改造为收件箱任务卡 |
| DiffReviewPanel | `DiffReviewPanel.tsx:18-156`（hunk 拆分/勾选/回退，SSE `session.diff` 快照） | 已有 diff 审阅闭环的执行侧，缺"评论返工"反馈侧 |
| QuestionWidget 全局 overlay | `MafwShell.tsx:2564-2569` + Approvals/Triage 页 | 已是"非聊天任务面"先例 |
| SSE handlers | `dock.ts`（todo.updated）、`diff.ts`（session.diff）——deps 注入可测 | 传输层与视图无关，直接扩展 |

### 2.2 与任务中心的冲突点

| 冲突 | 现状 | 严重度 |
|---|---|---|
| tasks tab 无收件箱语义 | `MafwShell.tsx:2520` 以 `currentSessionID()` 为键的 per-session 瞬时 todos，无跨会话聚合；与 goals 是两套平行任务模型 | 高 |
| TabStrip chat-first | `TabStrip.tsx:7-16` chat 为首；Rail 点击强制 `setActiveTab("chat")`（`MafwShell.tsx:2038-2040`）——聊天是默认着陆面 | 高（若要推翻） |
| Rail 以会话列表为脊柱 | `Rail.tsx:114-134` 日期分组聊天历史为主内容，goal 只有 ManagerCard 一张小卡 | 中 |
| DiffReviewPanel 绑死 chat tab | `MafwShell.tsx:2322` 挂在 chat 内容列内，非独立栅格列 | 中 |
| milestone/phase_transition 无主动呈现 | `session-events.ts:107` 显式 IGNORED_AT_SHELL；推送只落 manager 会话消息 | 中 |
| 两套 tab 系统 | 页面级 TabStrip + 会话级 SessionStrip，任务中心需要第三种主视图或改造其一 | 低（可不动） |

## 3. 实施路径评估（三档）

### C-lite（推荐）：收件箱语义 + 状态语言 + diff 闭环，不动骨架

业界修正后的结论支持这档：**没有先例推翻聊天中心，各家都在做"任务面的过滤、聚合与状态化"**。

1. **Rail 过滤+分组**（照搬 Claude Code）：会话列表头部加 status 过滤 + worktree/项目分组；成本 1 wave
2. **tasks tab 升级为跨会话任务收件箱**：聚合 todos + goal 摘要卡（ManagerCard 改造）+ 三桶语义（进行中/待审批/待验收——Triage 的 PENDING_CONFIRMATION 直接映射）+ milestone 消费（IGNORED_AT_SHELL 白名单调整 + toast）；成本 1-2 wave
3. **diff 徽标 + 行级评论闭环**（照搬 Claude）：会话内 `+N -M` 统计徽标 → DiffReviewPanel → 行级评论批量提交回传会话让 agent 返工（gateway 需新增评论注入路由）；成本 1 wave
4. **状态语言标准化**：三色语义 + goal 卡成本分档 pill（TrajectoryStore 数据已有）；成本随 2/3 顺带

### C-mid：双栏落地 + pane 化

- 激活 `data-layout` 第二列（360px 工件/任务列），RightDock tabs 支持 pop out 独立窗口——Claude pane 系统的简化版
- 依赖 C-lite 的收件箱内容先存在，否则第二列没有内容可放；**hook 已预留，随需激活，无额外基建**

### C-full（不推荐）：主区默认收件箱、聊天退子视图

- 推翻 TabStrip/Rail 语义，与 9-20 刚落地的四切片（审批三档/diff 审阅/plan-build/worktree）大面积冲突
- 业界无先例：Codex 的"指挥中心"本质是会话列表的类型过滤，Claude/Devin/Manus 全部保留聊天为第一人称视图
- manager 对话驱动模式（MAFW 核心交互）与"任务收件箱"天然契合度低——manager 本身就是常驻会话

## 4. 结论与建议

- 方向 C 的真实价值在**收件箱语义、状态语言、diff 反馈闭环**，而非推翻聊天中心；原始命题（"对话退位"）被调研修正为"对话压缩"
- 建议 **C-lite 立项**（3-4 wave，全部在现有骨架内，gateway 仅加 diff 评论路由一处）；C-mid 的双栏 hook 已在 v5.2 预留，等 C-lite 的收件箱内容就绪后随需激活
- 便签板方向 C 条目可下架（调研完成，决策已收敛为 C-lite 提案）

## 附：调研边界

- Codex 收件箱条目级视觉结构（状态徽标/时长/文件数）：openai.com 全线 403，仅从 Help Center 侧写确认
- Claude 对话/产出物分栏比例、Manus 任务卡视觉细节：官方文档未给出
- 本报告基于 v4.13.0（01897976）代码盘点
