# Lead / Tech Lead · P0：内核对象最小闭环

> 2026-11-10 · Phase P0
> 父设计：`docs/superpowers/specs/2026-11-10-lead-techlead-thread-handoff-design.md`
> 研究依据：`docs/research/2026-11-10-session-topic-industry-research.md`
> 目标：用户不感知 session；Lead 创建 Goal 时把当前话题原文交给 Tech Lead；两个入口 + 按需状态卡。

## 1. 背景

现状已经具备 Pod 协作 Goal Loop（Lead / Tech Lead / Builder / Reviewer）、隐藏 Tech Lead 会话、
`discussing` Goal 和 `ContextManifest`。缺的是三件事：

1. Lead 创建 Goal 时只传 title / objective / charter，Tech Lead 看不到当前讨论原文，用户要重复说。
2. 用户找不到稳定的 Tech Lead 入口；`PodTechLeadInvite` 与 GoalDetailPanel 两套入口状态不一致。
3. Lead 没有结构化的 Goal 状态视图，用户问「进展如何」要靠人翻页面。

P0 只解决这三件事，不改变 Goal / NodeDriver / worktree / revision / Reviewer 内核。

## 2. 目标 / 非目标

### 目标

- Lead 识别到可执行意图后**直接创建** `discussing` Goal，不做创建前确认。
- Gateway 自动抓「当前话题」= 上次 handoff 之后的 user / assistant 文本，生成 `sourceRef`。
- 完整话题原文写入 `<goalDir>/context/lead-handoff.md`，加入 ContextManifest。
- Tech Lead 开场 prompt 带 snapshot + 全文文件；Tech Lead 可直接和用户对话。
- 两个入口一等公民：Goal 卡片「与 Tech Lead 讨论」+ Lead 对话移交卡「已交给 Tech Lead · 去继续」。
- Lead 按需读 Goal store 的结构化状态投影，生成状态卡；不读 Tech Lead 原始日志。
- 用户看不到 session tab / session id / 「新建 session 还是 compaction」选择。

### 非目标

- 不恢复 `/new-topic`（所有用户入口已退役；rotate 仅 HTTP/SDK 内部兼容）。
- 不做自动话题边界。
- 不做旧 topic 切回继续（P1）。
- 不做 working set / page fault / compaction policy（P1）。
- 不做 COW fork / attention scheduler（P2）。
- 不改 NodeDriver / Builder / Reviewer / Plan + Goal Eval。

### 反目标

- 每条消息都生成 Goal，草稿列表变成新的 session 列表。
- 移交时丢原文、丢 provenance，Tech Lead 只看到摘要。
- 把 session id 暴露给用户，或要求用户管理 session。
- 移交后用户还要把同样的话再说一遍。

## 3. 现状与依赖

- **Lead**：`manager-session` kv，per-project / per-runtime slot；`role:'lead'`、pinned、
  exempt from trim/evict/archive；用户入口 `/new-topic` 已退役。
- **Goal 创建**：`mafw_create_goal`（Lead 调用）→ `PodTechLeadService.createGoal`：
  `discussing` Goal + 隐藏 Tech Lead 会话 + ContextManifest，不自动启动 NodeDriver。
- **sourceRef**：`GoalSourceRef = { sessionID?, messageID?, snapshot(≤4000), capturedAt }`，
  已落盘到 `request.json`；目前几乎总是空。
- **Tech Lead**：隐藏会话（`role:'tech-lead'`）；`/api/pods/:podId/goals/:goalId/tech-lead(/messages)`；
  `mafw_pod_goal_direction`。
- **桌面**：`PodTechLeadInvite`（Lead composer 上方）、`GoalDetailPanel` 的 Tech Lead 入口、
  `requestPodTechLeadOpen`。
- **依赖**：runtime 的 flat history 出口（`session.messages`）；gateway DB 统一数据层；
  Pod / Goal store；ContextManifest。

## 4. 设计

### 4.1 对象模型

```
User
  │
  ▼
Lead thread（项目级 manager：对话记忆 + 项目级知识）
  │  意图 → Goal
  ├──────────────► Goal（持久工作单元，discussing）
  │                   │
  │                   ▼
  │              Tech Lead thread（goal 级深度上下文；可直接对话）
  │                   │
  │                   ▼
  │              Builder / Reviewer
  │
  └── 状态投影 ◄── Goal store
```

- **Lead thread**：用户可见；每个项目一条；连续对话。
- **Topic**：Lead thread 的一段；只在 handoff 时落库，作为 provenance，不是通用话题系统。
- **Goal**：持久工作单元；`discussing` 是草稿形态；可 handoff / resume / 换 session。
- **Tech Lead thread**：goal 级；隐藏 session；复用普通 session 消息通道。
- **Session**：内部 frame；用户不可见。

### 4.2 数据模型

#### `lead_topic`（gateway DB 新表，走现有 migration）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | TEXT PK | topic id |
| `project_dir` | TEXT NOT NULL | canonical project dir |
| `lead_session_id` | TEXT NOT NULL | 所属 Lead session |
| `title` | TEXT NOT NULL | 首条用户消息截断 / 轻量模型 / 时间戳回退 |
| `start_message_id` | TEXT NOT NULL | 上次 handoff 之后的第一条消息；没有则 session 首条 |
| `end_message_id` | TEXT NOT NULL | handoff 时的最后一条已完成消息 |
| `goal_id` | TEXT NOT NULL | 关联 Goal |
| `owner_role` | TEXT NOT NULL | `lead` / `tech-lead` |
| `owner_session_id` | TEXT | 当前处理该 topic follow-up 的 session |
| `created_at` | TEXT NOT NULL | ISO |

索引：`(project_dir, created_at desc)`、`(goal_id)`。

#### `GoalSourceRef` 扩展

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

`normalizeGoalSourceRef` 接受新字段；旧调用不受影响。`GOAL_SOURCE_SNAPSHOT_MAX` 保持 4000。

#### Goal 状态投影（派生，不建表）

```ts
interface LeadGoalStatus {
  goalId: string
  title: string
  stage: 'discussing' | 'direction_review' | 'planning' | 'plan_review'
       | 'queued' | 'implementing' | 'reviewing' | 'completed' | 'aborted' | 'discarded'
  progress: { done: number; total: number }
  blockers: string[]
  pendingAttention: number
  lastUpdate: string
}
```

从 `pod_goals` / `pod_goal_revisions` / attention / waves 投影；不读 Tech Lead transcript。

### 4.3 流程

#### 4.3.1 创建 Goal + 当前话题 handoff

1. Lead 识别到可执行意图，调用 `mafw_create_goal`（`handoff: 'current-topic'`）。
2. Gateway 解析 `projectDir` / `leadSessionId` / `goalId`。
3. 计算 topic 起点：
   - 查 `lead_topic` 该 project 最近一条 `end_message_id`；
   - 从该消息之后取；没有则从 session 首条取。
4. 通过 `runtime.session.messages` 拉取 flat 消息；过滤：
   - 只保留 `user` / `assistant` 的 text part；
   - 排除 tool call/result、system、compaction 标记、正在执行的 assistant 消息。
5. 生成 snapshot：≤4000 字；超长保留开头 + 结尾，中间标注省略。
6. 写全文 `<goalDir>/context/lead-handoff.md`；加入 ContextManifest（`stage baseline` 之外的可选 ref）。
7. 写 `lead_topic` 行；`owner_role='tech-lead'`，`owner_session_id=Tech Lead session`。
8. `PodTechLeadService.createGoal` 开场 prompt：
   ```
   [CONTEXT MANIFEST]
   ...
   <lead-handoff>
   {snapshot}
   </lead-handoff>
   以下是用户与 Lead 的当前话题原文（全文见 context/lead-handoff.md）。
   请基于它继续，不要重复询问已确认的内容。
   ```
9. 返回 `{ goalId, sessionID, sourceRef, handoffPath }`；桌面显示移交卡。

#### 4.3.2 两个入口

- **Goal 卡片 / GoalDetailPanel**：「与 Tech Lead 讨论」→ `requestPodTechLeadOpen(goalId)`。
- **Lead 对话**：`PodTechLeadInvite`（已有）+ 移交卡（新增）：
  ```
  已交给 Tech Lead：{goal.title}
  [去继续]
  ```
- 两个入口都不显示 session id；只显示 Goal 标题、阶段、Tech Lead 状态。

#### 4.3.3 状态卡（问才出）

- Lead 每回合由 gateway 注入紧凑 `<goal-status>`（最多 5 个活跃 Goal）：
  ```
  <goal-status>
  - 登录重构 | executing | 3/5 | blocked: plan approval | attention: 1
  </goal-status>
  ```
- 用户问「进展如何」时，Lead 基于该块回答，并给 Tech Lead 入口。
- UI 状态卡**不常驻**；用户点击「状态」或问进展时出现。
- 不注入 Tech Lead 原始 transcript。

### 4.4 API / MCP

| 接口 | 变更 |
|---|---|
| `mafw_create_goal` | 新增 `handoff?: 'current-topic' \| 'none'`（默认 `current-topic`）、`topicId?: string`；缺省时 gateway 自动生成 sourceRef |
| `POST /api/pods/:podId/goals` | 透传 `handoff` / `topicId`；返回 `sourceRef`、`handoffPath` |
| `GET /api/goals/:goalId/source` | 返回 `sourceRef` + `lead-handoff.md` 全文 |
| `GET /api/lead/topics?projectDir=` | handoff 审计列表（不是用户主界面） |
| `GET /api/lead/goal-status?projectDir=` | 状态投影（供 Lead 注入 / 桌面状态卡） |
| `POST /api/pods/:podId/goals/:goalId/tech-lead/messages` | 已有；Tech Lead 直接对话复用 |

写入 `lead_topic` 失败不阻断 Goal 创建：记录 warning，`sourceRef` 仍写 snapshot。

### 4.5 UI

- **Lead chat**：移交卡；状态卡按需；`PodTechLeadInvite` 保留。
- **Goal 卡片**：「与 Tech Lead 讨论」+「来源：<topic title>」。
- **Goal 详情**：「上下文来源」区，显示 snapshot 摘要 + 全文入口。
- **会话列表**：Lead / Tech Lead 不出现在用户 session 列表；保留 Config/开发者模式的排障入口。
- 不新增裸 button/input；全部用 `@mafw/ui` v2。

## 5. 失败模式

| 失败 | 处理 |
|---|---|
| snapshot >4000 | 开头 + 结尾 + 全文文件；UI 标注「上下文较长」 |
| runtime history 不可用 / 已压缩 | 用 `lead-handoff.md` 全文；创建时 fail-open，sourceRef 至少写空 snapshot |
| Lead session 丢失 / 被替换 | P0 旧 topic 只读；从 handoff 文件 + memory 恢复可读；不承诺连续 thread |
| Tech Lead session 不可用 | Goal 保持 `discussing`；移交卡显示重试 |
| 重复创建 Goal | `goalId` 冲突提示；Lead 应挂到已有草稿 |
| 移交空 topic | 拒绝并提示「当前话题没有可移交内容」 |
| `lead_topic` 写入失败 | Goal 仍创建；记录 warning；sourceRef 保留 snapshot |

## 6. 测试与验收

### 单元

- `buildLeadHandoff`：范围从上次 handoff 之后；只取 user/assistant text；排除 tool/system；截断开头+结尾。
- `normalizeGoalSourceRef`：新字段兼容；旧 payload 不变。
- `goalStatusProjection`：stage / progress / blockers / attention / lastUpdate。
- `leadTopicTitle`：首条消息截断；空消息回退时间戳。

### 集成

- Lead 调 `mafw_create_goal` → `lead_topic` 行 → `sourceRef.topicId` → `lead-handoff.md` 存在。
- Tech Lead 开场 prompt 包含 snapshot 与文件引用；`session.messages` 能读到。
- Goal 卡片 / 移交卡都能打开 Tech Lead；不出现 session id。
- 用户问「进展如何」→ Lead 回复包含 stage / progress / blocker。

### GUI

- 900 / 1280 宽度：Lead 创建 Goal、打开 Tech Lead、返回 Lead；无 session tab。
- 状态卡按需出现，不常驻。
- 移交卡在 Lead composer 上方；Goal 卡片入口在 GoalDetailPanel。

### 指标

- 带非空 `sourceRef` 的 Goal 占比 >90%。
- handoff 后用户重复描述次数下降。
- 从 Goal 创建到打开 Tech Lead 的点击数 ≤1。
- 手动 session / compaction 操作次数下降。

## 7. 迁移与开关

- 新表 `lead_topic` 随 gateway DB migration 创建；不 backfill 存量 Goal。
- 功能开关 `MAFW_LEAD_HANDOFF`（默认开）；关闭时回退现有 `mafw_create_goal` 行为（无 sourceRef / 无 handoff 文件）。
- 存量 `manager` / `manager-archived` 行保持只读兼容，不作为当前 Lead。
- 不恢复 `/new-topic`；`POST /api/manager/session/rotate` 与 SDK 保持内部兼容。

## 8. 开放问题

1. `handoff` 默认值是否始终 `current-topic`，还是允许 Lead 显式 `none`？P0 建议默认 `current-topic`，`none` 只给自动化/测试。
2. 状态投影注入 5 个活跃 Goal 是否足够？P0 先 5，超过按 lastUpdate 排序。
3. Topic 标题是否调用轻量模型？P0 建议首条消息截断 + 时间戳回退，避免额外模型调用。
4. `lead_topic` 用 gateway DB 新表还是 kv scope？P0 建议新表，便于查询与审计。
