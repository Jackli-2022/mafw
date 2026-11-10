# Lead / Tech Lead 话题移交设计

> 2026-11-10 · 状态：draft for review
> 关联：`docs/architecture/pod.md`、`docs/architecture/goal.md`、
> `docs/research/2026-11-10-session-topic-industry-research.md`

## 1. 问题

1. 用户与 Lead 的讨论是连续的，但换话题时要在「新开 session」和「compaction」之间做资源决策。
2. Lead 创建 Goal 后，用户找不到 Tech Lead 入口；现有入口（`PodTechLeadInvite`、GoalDetailPanel）不稳定、不统一。
3. Lead 创建 Goal 时只传 title / objective / charter，Tech Lead 拿不到当前讨论原文，用户要重复说一遍。
4. `/new-topic` 归档旧 Lead，旧话题「可读但不可续」，与用户约 60% 的复用率冲突。

## 2. 目标

- Lead 是**面向用户的 manager**：可以聊天、讨论、记住对话；对项目有**全局但不等同 Tech Lead 的深度**——知道目标、优先级、决策、状态，不持有实现细节。
- Lead 只判断**是否可执行**，不做 Goal 类型分类；Quick / Standard / Standing 由 Tech Lead 判断。
- **Lead 掌握当前 Goal 的状态**：阶段、进度、阻塞、待你决策的事项；来自 Goal store 的结构化投影，不读 Tech Lead 的原始工作日志。
- Tech Lead 是**深度工作上下文**：goal 级的计划、代码、测试、阻塞点；它**可以直接和用户对话**——问澄清问题、讲方案、讨论取舍，不是 SuperAgent 那种只能干活、不能问人的 worker。比 Lead 清楚得多。
- 任何可执行意图 → **Goal 草稿**；Lead 负责分派、跟踪状态、汇报，技术方案由 Tech Lead 决定。
- Goal 草稿默认携带**当前话题原文**交给 Tech Lead。
- 两个入口都要有：Goal 卡片上的「与 Tech Lead 讨论」，以及 Lead 对话里的移交卡。
- Session 保持内部；**用户不感知 session**——session 是内核对象，用户只操作对话 / 话题 / Goal。

## 3. 非目标 / 反目标

**非目标**

- P0 不做自由讨论的自动话题边界（P1 调研，见业界调研文档 §6）。
- Lead 不做技术方案、不持有实现细节；这些归 Tech Lead。
- 不把 Tech Lead 做成 SuperAgent 的 worker（无 `ask_user`、只能执行、问题只能走结构化上报）；Tech Lead 必须能直接和用户对话。
- 不改 Tech Lead / Builder / Reviewer 的内部执行模型。
- 不做跨项目 thread 合并。

**反目标（做错就是失败）**

- 每条消息都生成 Goal，草稿列表变成新的 session 列表。
- 移交时丢原文、丢 provenance，Tech Lead 只能看到摘要。
- 把 session id 暴露给用户，或要求用户管理 session。
- 移交后用户还要把同样的话再说一遍。

## 4. 现状（已有能力）

- **Lead**：`manager-session` kv，per-project / per-runtime slot；`role:'lead'`、pinned、exempt from trim/evict/archive；用户入口的 `/new-topic`（桌面 / slash / plugin / gateway built-in）已退役，`POST /api/manager/session/rotate` 与 SDK 仅保留内部兼容。
- **Goal 创建**：`mafw_create_goal`（Lead 调用）→ `PodTechLeadService.createGoal`：创建 `discussing` Goal + 隐藏 Tech Lead 会话 + ContextManifest，不自动启动 NodeDriver。
- **sourceRef**：`GoalSourceRef = { sessionID?, messageID?, snapshot(≤4000), capturedAt }`，已落盘到 `request.json`。
- **Tech Lead**：隐藏会话（`role:'tech-lead'`）；`/api/pods/:podId/goals/:goalId/tech-lead(/messages)`；`mafw_pod_goal_direction`。
- **桌面入口**：`PodTechLeadInvite`（Lead composer 上方）、`GoalDetailPanel` 的 Tech Lead 入口、`requestPodTechLeadOpen`。
- **缺口**：
  - 开场 prompt 只包含 title / objective / charter，**没有 sourceRef.snapshot**。
  - `sourceRef` 需要 Lead 手动填，几乎总是空。
  - `/new-topic` 归档旧 Lead，旧话题不可续。
  - 两个入口的可见性/文案/状态不一致。

## 5. 模型

```
User
  │
  ▼
Lead thread（项目级 manager：对话记忆 + 项目级知识）
  │  意图 → Goal 草稿
  ├──────────────► Goal（持久工作单元）
  │                   │
  │                   ▼
  │              Tech Lead thread（goal 级深度工作上下文）
  │                   │
  │                   ▼
  │              Builder / Reviewer
  │
  └── 状态汇报 ◄── Goal store
```

- **Lead thread**：用户可见；每个项目一条；消息 + 话题分隔（topic marker）。
- **Topic**：Lead thread 的一段；`id`、`title`、`startMessageId`、`endMessageId`、`goalId?`、`ownerRole`、`ownerSessionId`。
- **Goal 草稿**：Lead 的结构化输出；title、objective、acceptance、boundaries、sourceRef、status。
- **Tech Lead thread**：goal 级；由移交的 topic 原文 + ContextManifest 起步；对应隐藏 session；Tech Lead 可直接和用户对话。
- **Session**：内部 frame。Lead 可以是一条长会话（靠 compaction + memory）；Tech Lead 每个 goal/revision 一个。

### 5.1 OS 映射：session 是内核对象

| OS | MAFW | 用户是否感知 |
|---|---|---|
| 进程 / 地址空间 | session（执行上下文） | 否 |
| 线程 | topic（对话段） | 是（话题） |
| 作业 / 进程组 | Goal（持久工作单元） | 是（Goal） |
| shell / init | Lead（用户接口 + 调度） | 是（对话） |
| 进程监督者 | Tech Lead（管一个 Goal 的 session） | 是（对话） |
| 物理内存 | context window | 否 |
| 页 | message / tool result | 否 |
| 页表 | topic / message index | 否 |
| 工作集 | 当前 topic 的 resident context | 否 |
| 缺页中断 | recall（拉回旧 topic / 记忆） | 否（自动） |
| 页面置换 | compaction / eviction | 否 |
| swap | transcript store | 否 |
| 磁盘 / 归档 | memory system | 否 |
| TLB | pinned profile / goal snapshot / hot cache | 否 |
| fork / COW | 新 Goal 从 topic 分叉 | 否 |
| 调度器 | attention scheduler（谁需要人） | 部分（通知） |
| 系统调用 | HTTP / MCP / Experience Action | 否 |
| `/proc` | 开发者 session 列表 | 否（排障） |

规则：

- 用户操作 topic / Goal / 对话；session 是内核对象，不出现在 UI。
- 换话题 = **context switch**；回到旧话题 = **page fault**；compaction = **page eviction**；新 Goal = **COW fork**。
- session 列表 = `/proc`，只给排障，不做用户主界面。
- 用户永远不选「new session 还是 compaction」。

## 6. 流程

### 6.1 连续对话与话题边界（P0 不新增用户命令）

- **P0 不重新引入 `/new-topic`**：仓库已经在 desktop / slash / plugin / gateway built-in 四个入口退役它，P0 不再反转这个决定。
- **P0 的「当前话题」定义**：上一次 handoff 之后的消息；没有 handoff 时，从 Lead 会话开头算起。
- `lead_topic` 只在 handoff 时落库，是 **handoff provenance**，不是通用话题系统；不新增用户可见的 topic 命令。
- Lead 的连续对话靠现有 session + 记忆系统；compaction 可自动发生，handoff 时把原文镜像到 Goal 工作区（见 6.3），不依赖 runtime 的 compaction 后历史。
- Lead 的讨论是**项目级**：方向、优先级、范围、取舍、状态；一旦进入实现细节，Lead 应该建议或移交给 Tech Lead，而不是硬答。
- P1 再评估显式/自动边界（显式措辞、语义漂移、空闲、任务闭合）。

### 6.2 Goal 草稿

- Lead 解析意图，生成 Goal 草稿卡（标题、目标、验收、边界、建议 Tech Lead、来源 topic），并**直接创建** `discussing` Goal；草稿卡是这个 Goal 的 UI 呈现。
- 用户可以在 Tech Lead thread 里继续讨论、修改；P0 **不设创建前确认**步骤。
- P0 复用现有 `discussing` Goal 作为草稿的持久形态，不新增状态机；UI 把它呈现为「草稿」。
- Lead 可以先把项目级的方向/范围/取舍聊清楚；一旦识别到可执行意图，就**直接创建** `discussing` Goal。实现细节讨论在 Tech Lead thread。
- `sourceRef` 由 **gateway 自动生成**，不依赖 LLM 复制 4000 字：从 topic 表取当前 topic 的消息范围，生成 snapshot。

### 6.3 Handoff（默认当前话题）

- 默认移交范围：`topic.startMessageId .. 当前消息`。
- 生成 `sourceRef`：
  - `sessionID`：Lead session id；
  - `messageID`：当前消息 id；
  - `snapshot`：topic 原文，≤4000 字；超长时保留开头 + 结尾，并附 `topicId` 供全文拉取；
  - `topicId` / `messageRange`：P0 扩展字段（向后兼容）。
- **snapshot 内容**：只取 user / assistant 的 text，不含 tool call/result、system、compaction 标记；范围从 topic 起点到最后一条**已完成的** user / assistant text（不含正在执行的 assistant 消息）。
- **全文**：handoff 时把完整 topic 原文写入 `<goalDir>/context/lead-handoff.md`，并加入 ContextManifest；snapshot 超 4000 字时 Tech Lead 用该文件补全。这样不依赖 runtime 的 compaction 后历史，也不新增 MCP 工具。
- Tech Lead 开场 prompt = ContextManifest + `sourceRef.snapshot` + 「以下是用户与 Lead 的当前话题原文，请基于它继续，不要重复询问已确认的内容」。
- **handoff 是对话转移，不是把工作丢给静默 worker**：Tech Lead 接手后可以直接在 thread 里和用户继续讨论（澄清、方案、取舍），不需要 Lead 中转。
- **话题所有权转移**：handoff 后，Tech Lead 订阅当前 topic；这段话题的**深度工作 follow-up** 默认归 Tech Lead 处理（对齐 SuperAgent 的 Subscription：人的 follow-up fan-out 给 Ticket，不再走 Eval）。Lead 仍可聊项目级状态、优先级、范围，但技术细节指向 Tech Lead；Tech Lead 遇到超出 Goal scope 的请求才 hand back。
- 原 Lead thread 不删除；移交卡记录 `goalId` 和 Tech Lead 入口。
- Provenance：`goal.request.sourceRef` + `topic.handedOffToGoalId`。

### 6.4 入口

- **Goal 卡片 / GoalDetailPanel**：「与 Tech Lead 讨论」（已有入口，统一文案与状态）。
- **Lead 对话**：`PodTechLeadInvite`（已有）+ **移交卡**（新增）：「已交给 Tech Lead · 去继续」。
- **Lead 状态卡**：当前 Goal 的阶段、进度、阻塞、待决策；数据来自 Goal store，不由 Tech Lead 手写摘要。
- **Tech Lead thread 复用普通 session 的消息通道**：和普通 session 一样可以发消息、流式输出、渲染工具卡；不另做 worker 专用 UI。
- **工作台 Goal 列表**：每个 Goal 的 Tech Lead 入口。
- 所有入口都不显示 session id；只显示 Goal 标题、阶段、Tech Lead 状态。

### 6.5 返回与汇报

- Tech Lead 的结论/状态写入 Goal store；Lead 在对话中汇报（读 store，不依赖自己的聊天记忆）。
- **Lead 的 Goal 状态来源**：每次 Lead 回合注入一个紧凑的 `<goal-status>` 投影（活跃 Goal 的阶段、进度、阻塞、待决策、最后更新时间）；用户问「进展如何」时，Lead 直接基于它回答，不读 Tech Lead 的原始 transcript。
- **Tech Lead 可以直接和用户对话**：在 Tech Lead thread 里提问、解释方案、讨论取舍；不需要 Lead 转发，也不受 SuperAgent worker「工具里没有 ask_user」的限制。
- 结构化 attention（`human_action` / askUser）只在后台/自动化运行、没有用户 thread 在场的场景使用；用户回答后回到对应的 Tech Lead session。
- 用户从 Tech Lead 回到 Lead：thread 切换；Lead 仍有记忆。
- Tech Lead → Lead 的回传 P0 只读（状态/结论），不做自动对话合并。
- Lead 处理：状态、优先级、范围、新话题、停止/暂停；技术细节指向 Tech Lead，不抢深度 follow-up。

## 7. 数据模型（P0）

### 7.1 `lead_topic`（handoff provenance，只在 handoff 时写入）

| 字段 | 说明 |
|---|---|
| `id` | topic id |
| `projectDir` | canonical project dir |
| `leadSessionId` | 所属 Lead session（P0 通常不变） |
| `title` | 话题标题（首条用户消息 / 轻量模型；失败回退时间戳） |
| `startMessageId` | topic 第一条消息（上次 handoff 之后） |
| `endMessageId` | handoff 时写入 |
| `goalId` | 移交后关联的 Goal |
| `ownerRole` | `lead` / `tech-lead`（handoff 后切换） |
| `ownerSessionId` | 当前处理该 topic follow-up 的 session |
| `createdAt` | 时间 |

P0 不维护 `open/closed` 状态机；没有 handoff 就不落 topic 行。这样避免把 topic 表做成第二个 session 列表。

### 7.2 `GoalSourceRef` 扩展

```ts
interface GoalSourceRef {
  sessionID?: string
  messageID?: string
  snapshot: string          // ≤4000，保持兼容
  capturedAt: string
  topicId?: string          // 新增
  messageRange?: { from: string; to: string } // 新增
}
```

`normalizeGoalSourceRef` 接受新字段；旧调用不受影响。

### 7.3 `manager-session`

P0 不改语义：仍是 per-project / per-runtime 的 Lead slot。P0 不新增 `/new-topic`，也不主动归档 Lead。若 runtime / 用户操作导致 Lead 被替换：关闭当前 handoff 窗口，旧 topic 通过 `<goalDir>/context/lead-handoff.md` 与 runtime 历史只读；P0 不承诺跨 session 的连续可编辑 thread（P1 再做）。

## 8. API / MCP

- `mafw_create_goal` 新增可选参数：
  - `topicId?: string`
  - `handoff?: 'current-topic' | 'full-thread' | 'none'`（默认 `current-topic`）
  - `sourceRef?` 保留；若缺省且 `handoff=current-topic`，gateway 自动生成。
- `GET /api/lead/topics?projectDir=`：列出 handoff 记录（供 UI/审计；不是用户主界面）。
- `GET /api/pods/:podId/goals/:goalId/tech-lead/messages`：已有，不变。
- `GET /api/goals/:goalId/source`：返回 sourceRef + `<goalDir>/context/lead-handoff.md` 全文（用于 UI 展示「上下文来源」）。
- P0 **不新增** `POST /api/session/:id/topic-boundary`；`/new-topic` 保持退役状态。

## 9. UI

- **Lead chat**：话题分隔线（轻量）；移交卡；`PodTechLeadInvite` 保留。
- **Goal 卡片**：「与 Tech Lead 讨论」+「来源：<topic title>」。
- **Goal 详情**：「上下文来源」区，显示 snapshot 摘要 + 全文入口。
- **会话列表**：Lead / Tech Lead 不出现在用户 session 列表；保留 `/proc` 式排障入口（Config/开发者模式）。
- 不新增裸 button/input；全部用 `@mafw/ui` v2。

## 10. 上下文与记忆

- **Lead**：P0 沿用现有 Lead session + 记忆系统（pinned profile / recall / 自动 compaction）；**不新增** per-turn 的 topic 摘要组装。Lead 的项目级知识 = Goal 表 + 决策 + **Goal 状态投影**；**不加载** Tech Lead 的原始工作日志。P1 再做「当前 topic 全文 + 历史 topic 摘要 + 检索」的上下文注入。
- **Tech Lead**：深度工作上下文——移交原文（`lead-handoff.md` + snapshot）+ ContextManifest + 计划/代码/测试/阻塞点。
- **Handoff 记忆**：写一条 episodic memory `handoff:<goalId>`，内容 = topic 标题 + 已确认决定 + 未结问题；cueAnchors 包含 `goalId`、`topicId`、项目路径。
- **Goal 完成**：写 semantic summary；Lead 可在后续对话中 recall。

## 11. 迁移

- 存量 `/new-topic` 归档的 Lead session：映射为只读 handoff 记录；当前 Lead 保持现状。P0 不恢复 `/new-topic`，旧 topic 先只读，P1 再支持「切回继续」。
- 存量 Goal 的 `sourceRef` 不 backfill；新 Goal 生效。
- 功能开关：`MAFW_LEAD_TOPIC_HANDOFF`（默认开），失败回退到现有 `mafw_create_goal` 行为。

## 12. 失败模式

| 失败 | 处理 |
|---|---|
| snapshot >4000 | 保留开头+结尾，全文写入 `<goalDir>/context/lead-handoff.md` 并加入 ContextManifest；UI 标注「上下文较长」 |
| Lead session 丢失 | P0 从 handoff 记录 + `<goalDir>/context/lead-handoff.md` + memory 恢复可读；P1 再做连续 thread 重建 |
| Tech Lead session 不可用 | Goal 保持 `discussing`；邀请卡显示重试 |
| 用户 handoff 后改需求 | 新 Goal revision；provenance 指向原 topic |
| 重复创建 Goal | `goalId` 冲突提示；Lead 应挂到已有草稿 |
| 移交空 topic | 拒绝并提示「当前话题没有可移交内容」 |

## 13. 验证 / 指标

**测试**

- 纯函数：topic 边界、sourceRef 生成（含截断）、handoff prompt 组装、`normalizeGoalSourceRef` 兼容。
- 集成：Lead 创建 Goal → Tech Lead session 收到 snapshot → 邀请卡 → 打开 Tech Lead → 返回 Lead。
- GUI：900 / 1280 宽度下创建 Goal、打开 Tech Lead、返回；无 session tab 出现。

**指标**

- 带非空 `sourceRef` 的 Goal 占比（目标 >90%）。
- handoff 后用户重复描述的次数（目标下降）。
- 从 Goal 创建到用户打开 Tech Lead 的点击数（目标 ≤1）。
- 手动 session / compaction 操作次数（目标下降）。

## 13.5 Phase specs

> 进度（2026-11-10）：P0 与 P0.5 已交付并合入 `feat/gateway-kernel-d1-batch2`（merge `d50f4f18`，记录见 `docs/releases/2026-11-10-lead-techlead-p0.md`）；P1 及之后未开工。

- ✅ **P0**：`2026-11-10-lead-techlead-p0-kernel-objects-design.md` —— 内核对象最小闭环：`lead_topic`、`sourceRef` 自动生成、`lead-handoff.md`、两个入口、按需状态卡。
- ✅ **P0.5**：`2026-11-10-goal-shapes-quick-goals-design.md` —— Goal 形态：同一 Goal 路径上的 Quick / Standard / Standing 模式；Tech Lead triage 写 `goal_mode`，不新增第二套执行器。
- ◐ **P0.6**：`2026-11-10-runtime-switch-design.md` —— Runtime 切换：session 是 per-runtime frame；Goal / Topic / Event / Worktree 持久；checkpoint / restore。（独立线，仓库已有 runtime switch / checkpoint 实现，未纳入本次交付验证。）
- ⬜ **P1**：`2026-11-10-lead-techlead-p1-working-set-design.md` —— 工作集与缺页：topic summary、warm/cold、recall、compaction policy、旧 topic resume。
- ⬜ **P2**：`2026-11-10-lead-techlead-p2-scheduler-design.md` —— 调度器与 COW fork：attention scheduler、自动边界、多 Goal 并发、fork。
- ⬜ **P2.4**：`2026-11-10-event-layer-design.md` —— 事件层：Source / Trigger / Thread / Subscription / Decision / Delivery。
- ⬜ **P2.5**：`2026-11-10-standing-goals-design.md` —— 长效 Goal：cron / event trigger、GoalRun、Tech Lead triage（full / report / action / skip）。

## 14. 决策状态

### 已决（已写进正文）

- 当前话题 = 上次 handoff 之后的对话；**不恢复 `/new-topic`**。
- snapshot 只取 user / assistant text；范围止于最后一条已完成的 text。
- 全文写入 `<goalDir>/context/lead-handoff.md` + ContextManifest；不新增 MCP 工具。
- **Lead = 面向用户的 manager**：可以聊天、讨论项目级方向/优先级/范围；不持有实现细节，技术方案归 Tech Lead。
- **Lead 不做 Goal 类型判断**：只判断「是否可执行」；Quick / Standard / Standing 由 Tech Lead 决定。
- **Lead 掌握当前 Goal 状态**：阶段、进度、阻塞、待决策；来自 Goal store 的结构化投影，不读 Tech Lead 原始日志。
- **Tech Lead = 可直接对话的专家**：能问澄清问题、讲方案、讨论取舍；不是 SuperAgent 那种只能干活、不能问人的 worker。
- handoff 是**对话转移**：Tech Lead 接手后直接和用户继续讨论，不需要 Lead 中转。
- P0 **不做创建前确认**：Lead 识别到可执行意图就直接建 `discussing` Goal；实现细节讨论在 Tech Lead thread。
- P0 Lead 记忆 = 现有 session + 记忆系统；不做 per-turn topic 摘要组装。
- Lead 被替换时，旧 topic 只读；P1 再做连续 thread。
- `lead_topic` 只在 handoff 时落库，不是通用话题表。

### 待你拍（会改变实现）

1. **handoff 后 Lead 怎么答技术细节**：A) 答项目级 + 指路 Tech Lead（推荐）；B) 尽量从摘要答，答不了再转；C) 直接让用户去 Tech Lead 窗口。
2. **Lead 记忆的 P0 范围**：现有 session + 记忆系统够不够？还是要 P0 就做「当前 topic 全文 + 历史 topic 摘要 + 检索」的上下文注入？后者工作量大很多。
3. **一个 topic 多个 Goal**：P0 建议一个 topic 一个 active handoff；后续 Goal 是挂同一 topic，还是每次 handoff 新建 topic？
4. **旧 topic 切回继续**：P0 只读，还是 P0 就要能切回原话题继续聊？

### Builder 自行决定

- Topic 标题生成方式（首条用户消息 / 轻量模型 / 时间戳回退）。
- snapshot 截断时开头/结尾的比例。
- 移交卡与 `PodTechLeadInvite` 的具体文案、位置、动效。
