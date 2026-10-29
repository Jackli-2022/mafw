# 项目级鲸群 Pod Lite（3 人）设计

日期：2026-10-29
状态：Draft（待评审）
调研：`docs/research/2026-10-29-agent-team-swarm-tower-pod.md`
相关：
- `docs/superpowers/specs/2026-07-30-manager-agent-design.md`（Manager 定位）
- `docs/superpowers/specs/2026-10-26-batch3-subagent-fullstack-design.md`（子代理面）
- `docs/superpowers/specs/2026-10-08-goal-orchestration-p1-design.md`（goal 节点）
- `docs/superpowers/specs/2026-10-27-t2-instruction-entries-design.md`（每会话指令注入）

## 1. 意图与 Why

用户原话：

- 「更倾向于鲸群，探讨一下」
- 「项目级别的」
- 「可以先 3 人」

要解决的问题：

1. 现在 MAFW 有**每项目一个 Manager session**，但 Manager 是“单人”，没有稳定的小团队、任务板、邮箱和团队记忆。
2. 子代理是**goal/父会话临时 spawn**，goal 结束就散；项目经验只能回到全局记忆，缺少“这个项目自己的方言/决策/教训”。
3. goal 的 plan→execute→review 是**塔**，适合治理，但没有“长期班底”的角色连续性；同一个项目反复做 goal，每次都要重新解释上下文。
4. 直接上大规模 swarm 成本高、难验证；用户明确要的是**项目级小团队**，不是 100 个临时 worker。

本设计把“鲸群”收敛为 **项目级 Pod Lite**：

> **一个项目一个 Pod；Pod 常驻，但成员不是一直跑；Goal 是投给 Pod 的工单，Pod 内部按 3 人责任链执行；Tower 仍然管 plan/approval/final review。**

## 2. 已确认决策

| 决策 | 内容 |
|---|---|
| 范围 | **项目级**：一个项目一个 Pod；v1 不做 goal 级 Pod、不做跨项目 Pod |
| 编制 | **3 人**：Lead + Builder（兼 Tech Lead）+ Reviewer；Curator v1 由 Lead 兼任 |
| 责任链 | **单责任链 + 双角色**：Lead 对结果负责，Builder 对实现负责，Reviewer 独立质量门 |
| 治理 | Tower 保留 plan、人工批准、最终 review、预算/风险门 |
| Reviewer 门 | **Reviewer = 现有 goal `review` 节点**；不新增 pre-review 门；Reviewer FAIL 走现有 review 失败/下一轮，Pod 任务板标记 `reopened` |
| 成员生命周期 | 身份/角色持久；session 按 goal/node 创建；NodeDriver 完成后可删除 session；Pod 保存 transcript 快照；wake 重开新 session |
| 唤醒 | 事件驱动；空闲休眠，不常驻烧 token |
| 并发 | v1 **一个 active goal**；queued goals 创建但不 start；active 直到 archive/abort；Pod `paused` 只停 Pod 协调，不 suspend goal |
| 任务板 | **first-class 协调 overlay**：显式 task id/status/owner；waves/receipts 是执行权威；归档时对账 |
| 记忆 | Pod 自己的 `POD.md` / `POD_MEMORY.md` / `decisions/`；Lead 写，成员读；注入所有 Pod-owned session（含 plan）；归档后 queued capture |
| 成本 | 只统计 **Pod-tagged turns**；Manager 普通聊天不计入 Pod；子代理按 `pod_id` 归集 |
| Pod key | 注册项目根 canonical realpath；worktree 映射到父 Pod；项目移动/重命名不自动迁移 |
| UI | 右工作台「执行」下新增「鲸群」subtab；live session 可在 SessionStrip 跳转；已结束 session 打开 transcript 快照 |
| 非目标 | 不做 100+ swarm、不做动态 Task Force、不做自治合并/发布、不做跨项目 Pod |

## 3. 目标 / 非目标 / 反目标

### 目标

- G1：项目首次使用时自动创建/恢复一个 3 人 Pod；跨重启、跨项目切换保持 roster 与记忆。
- G2：Pod 有共享任务板、邮箱、团队记忆、成本视图；用户能看到谁在做什么。
- G3：Goal 作为工单进入 Pod；Lead 拆任务，Builder 执行，Reviewer 独立验收（现有 review 节点），Tower 负责 plan/approval/archive。
- G4：Reviewer 能阻断不合格产物；Builder 不能推翻；冲突升级给人。
- G5：Pod 记忆在 goal 结束后更新，并在下一个 goal 注入；减少重复解释。
- G6：不改变现有 goal 状态机与节点身份；Pod 是协调/记忆层，不是新的执行引擎。

### 非目标

- N1：不做大规模 swarm、动态 task force、多 Pod 协作、跨项目 Pod。
- N2：不做 Pod 自治合并、删除、发布、改权限；高风险动作仍走人工门。
- N3：不做“常驻聊天室”；成员不常驻轮询。
- N4：不做 Pod 记忆自动写入全局谐波记忆（可后续人工提升）。
- N5：不做新的 goal 状态机/节点；v1 只镜像/绑定现有节点。
- N6：不做 Pod 市场、Pod 模板编辑器的完整 UI；v1 固定 3 人模板。

### 反目标

- Pod 变成“3 个 agent 一直在线聊天”，token 失控。
- Pod 自己给自己打分，Reviewer 变橡皮图章。
- Pod 绕过 Tower 直接合并/发布/改权限。
- Pod 记忆变成无边界 dump，污染后续 goal。
- 为了“鲸群”重写 goal 编排，导致现有稳定性回退。
- 一个项目多个 Pod 抢同一批文件，v1 不解决这种并发。

## 4. 角色与决策权

### 4.1 编制

| 成员 | 角色 | 主要职责 | 权限 | 默认模型 |
|---|---|---|---|---|
| **Lead** | Pod Lead / Manager | 用户接口、范围、优先级、预算、任务拆解、升级、Pod 记忆 | 不直接改代码；可读写 Pod 状态/任务/消息/记忆 | 复用 Manager 模型 |
| **Builder** | Tech Lead / 实现 | 架构、实现、任务拆解、技术风险、代码质量 | 可编辑/执行；可读写任务/消息；不改范围/预算 | goal execute 模型 |
| **Reviewer** | 独立验收 | 跑测试、看 diff、查证据、阻断不合格 | 只读 + 测试；可读写 review 任务/消息；不能改产物；shell 只读是审计约束，不是 sandbox | 与 Builder 不同模型优先 |
| **Curator**（v1 由 Lead 兼任） | 记忆/方言 | 维护 `POD.md`、`POD_MEMORY.md`、决策日志、术语 | 只写 Pod 记忆 | Lead 模型 |

### 4.2 决策矩阵

| 事项 | 最终决定 | 说明 |
|---|---|---|
| 做什么、优先级、预算、是否接这个 goal | Lead | 可升级给人 |
| 技术方案、实现路径、任务拆分 | Builder | 不能单方面改范围/预算 |
| 质量是否通过、能否合并 | Reviewer | 可阻断；Builder 不能推翻 |
| 范围 vs 技术冲突 | Lead 先裁决；技术不可行由 Builder 升级 | 记录 decision |
| 质量 vs 交付冲突 | Reviewer 优先；Lead 可升级给人 | 人最终裁决 |
| 高风险动作（合并/删除/发布/改权限） | 人 | 任何 agent 不能自批 |

### 4.3 成员与 session 的关系

**成员是持久身份，session 是工单/会议的临时载体。**

- Lead：复用现有 Manager session（identity `manager`，项目级、pinned）；plan 节点需要时由 Lead 成员开一个 `mafw-plan` session，Owner = Lead。
- Builder：每个 goal 的 execute 节点创建一个 `mafw-execute` session；Owner = Builder。
- Reviewer：每个 goal 的 review 节点创建一个 `mafw-review` session；Owner = Reviewer。**Reviewer 就是现有 review 节点，不再加一道 pre-review。**
- Session 生命周期跟随 NodeDriver：节点完成可删除；Pod 在删除前保存 transcript 快照（`pod_session_snapshots`），已结束任务点开快照，不假设 session 永远存在。
- 成员的身份、角色、模型、记忆持久；session 结束后不保留“常驻上下文”，靠 Pod 记忆 + transcript 快照恢复。

> 身份命名：`pod_members.agent_name` 对 Lead 存 `manager`，不是 `mafw-pod-lead`；`mafw-pod-lead` 只作为未来拆分身份的预留名，v1 不物化。

这样做的理由：

- 避免 3 个常驻 session 的上下文腐烂和 token 成本；
- 保留“团队记得项目”的效果（记忆在 Pod，不在单次 session）；
- 与现有 goal 节点身份（`mafw-plan` / `mafw-execute` / `mafw-review`）兼容，不需要重写状态机。

## 5. Pod 生命周期

### 5.1 创建

- 项目第一次创建 goal 时，`PodService.ensure(projectDir)` 自动创建 Pod（幂等）。
- 也可以在桌面「鲸群」面板点「创建鲸群」显式创建。
- 默认配置：3 人、一个 active goal、预算继承 goal/项目配置。
- 配置开关：`pod.enabled`（默认 true）、`pod.maxMembers`（默认 3）、`pod.maxConcurrentGoals`（默认 1）。

### 5.2 状态

- Pod：`active`（有 active goal）、`idle`（无 active goal）、`paused`（用户暂停）、`archived`。
- 成员：`available`、`working`、`waiting`（等 review/输入）、`sleeping`、`retired`。
- 成员状态由事件更新，不轮询。

### 5.3 唤醒/休眠

事件：

- `goal.created` / `pod.work_order.assigned` → 唤醒 Lead；
- `goal.plan.ready`（plan 节点成功）→ Lead 创建/刷新 Pod tasks；
- `pod.task.assigned` → 唤醒对应成员；
- `pod.message.created` → 唤醒收件人（或聚合通知）；
- `goal.node.started` → 绑定对应成员；
- `goal.review.failed` → 任务板标记 `reopened`，唤醒 Builder；
- `goal.completed` / `goal.failed` → Lead 收口，Pod 回 `idle`；
- 空闲 TTL（默认 10 分钟）→ 成员 `sleeping`；session 可随 NodeDriver 结束删除，Pod 保留 transcript 快照；wake 时按需新建 session。

原则：**事件驱动，不轮询；空闲不烧 token。**

### 5.4 并发

- v1 一个 Pod 同时只接一个 active goal；新 goal 进入 `pod_goals` 队列（`queued|active|done|aborted`）。
- 队列入口唯一：`PodService.enqueueGoal(goalId)` 挂在 `startGoal` 的唯一入口；active 存在时只创建 goal/request，不调用 `startGoal`。任何绕过 `startGoal` 的创建路径 v1 不支持，需在文档/API 标注。
- active 的判定：goal 创建后直到 `archive_success`/`archive_fail`/`ABORT` 都占槽；plan approval、askUser 等待也算 active。Pod `paused` 只停 Pod 协调，不 suspend goal；要暂停 goal 用现有 RunState。
- 队列状态在 Pod 面板可见；Lead 可以调整顺序；active 归档后 `PodService` 自动 promote 下一个 queued goal 并调用 `startGoal`。
- 多个 goal 需要并行时，v1 提示“排队”或建议拆项目；v2 再引入 Task Force/多 Pod。

## 6. 工作流

```text
用户
 │ 创建 goal
 ▼
Tower：goal plan → 人工批准（可选） → execute → review → archive
 │
 ├─ goal.created
 ▼
Pod Lead（Manager）
 │ 1. 复述工单/确认范围（必要时问用户）
 │ 2. plan 完成后创建 Pod tasks（从 plan/waves 派生）
 │ 3. 分配 Builder / Reviewer
 ▼
Builder（Tech Lead）
 │ 4. 认领 task；实现；更新任务/产物
 │ 5. 请求 Reviewer 验收
 ▼
Reviewer（现有 review 节点）
 │ 6. 跑测试/看 diff/查证据
 │ 7. PASS → archive；FAIL → 现有 review 下一轮，任务板标记 reopened
 ▼
Tower archive
 │ 8. Lead 收口，queued capture Pod memory
 ▼
Pod idle（成员休眠）
```

关键约束：

- **Pod 不替代 Tower**：plan approval、review、archive 仍由现有 goal 编排执行；Reviewer 就是现有 review 节点，不新增第二道 review。
- **Pod 任务板是协调 overlay**：goal waves/node runs 仍是执行权威；Pod 任务从 waves 派生，状态镜像，不另造一套执行状态。
- **Reviewer 是独立门**：Reviewer 的 review session 不能由 Builder 代替；Builder 不能把 Reviewer 的 FAIL 改成 PASS。
- **Lead 不写代码**：Lead 只做协调/记忆；技术判断由 Builder 负责。

### 6.1 任务板投影规则

- **waves → pod_tasks**：每个 wave 的 `tasks: string[]` 投影为一行 `pod_tasks`；`source_key = wave:<waveIndex>:task:<taskIndex>`，幂等 upsert。当前 wave 的 task 只是字符串，所以 Pod 任务板必须自己生成 task id/status，不能假装 waves 已有结构化任务。
- **状态同步**：wave 未开始 → `pending`；execute 节点开始 → `in_progress`；receipt 中有对应 task 条目 → 按 `taskId/status` 更新；review FAIL → `reopened`；archive 时仍未完成 → `failed`。
- **手工任务**：`source_key = manual:<uuid>`，由 Lead 创建，不参与 wave 对账；用于“先调研一下”“补一个测试”这类协调任务。
- **冲突规则**：receipt/节点状态是权威；`pod_tasks` 只做展示/协调，不回写 goal state。对账在 `goal.node.completed` 和 `archive` 两个点执行。
- **Reviewer 任务**：Reviewer 的 FAIL 不新建执行任务，只把对应 task 标 `reopened`；现有 review FAIL → 下一轮 execute 的语义不变。

## 7. 数据模型

### 7.1 表

```sql
project_pods(
  id TEXT PRIMARY KEY,              -- pod_<sha1(projectDir)[:12]>
  project_dir TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,             -- active|idle|paused|archived
  config_json TEXT NOT NULL,        -- maxMembers/maxConcurrentGoals/budget
  active_goal_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

pod_members(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL,
  role TEXT NOT NULL,               -- lead|builder|reviewer|curator
  display_name TEXT NOT NULL,
  agent_name TEXT NOT NULL,         -- manager / mafw-execute / mafw-review
  model_provider TEXT,
  model_id TEXT,
  status TEXT NOT NULL,             -- available|working|waiting|sleeping|retired
  config_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)

pod_member_sessions(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  goal_id TEXT,
  node TEXT,                        -- plan|execute|review|coordination
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  transcript_ref TEXT,              -- pod_session_snapshots.path
  created_at TEXT NOT NULL,
  ended_at TEXT
)

pod_goals(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  status TEXT NOT NULL,             -- queued|active|done|aborted
  enqueued_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  UNIQUE(pod_id, goal_id)
)

pod_session_snapshots(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  goal_id TEXT,
  node TEXT,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,               -- ~/.mafw/pods/<podId>/sessions/<sessionId>.json
  created_at TEXT NOT NULL
)

pod_tasks(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL,
  goal_id TEXT,
  source_key TEXT NOT NULL,         -- wave:<i>:task:<j> | manual:<uuid>
  title TEXT NOT NULL,
  description TEXT,
  owner_member_id TEXT,
  status TEXT NOT NULL,             -- pending|in_progress|blocked|review|done|failed|reopened
  dependencies_json TEXT,
  artifact_refs_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(pod_id, source_key)
)

pod_messages(
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL,
  from_member_id TEXT NOT NULL,
  to_member_id TEXT,                -- null = broadcast
  kind TEXT NOT NULL,               -- note|request|review|decision|escalation
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
)
```

### 7.2 Pod 记忆（文件）

目录：`~/.mafw/pods/<podId>/memory/`

```text
POD.md                 # 项目 charter、roster、规范、用户偏好
POD_MEMORY.md          # 决策、教训、术语、开放问题
glossary.md            # 项目方言/术语
decisions/
  2026-10-29-<slug>.md # 单条决策记录
```

规则：

- Lead 是唯一写入者（v1）；Reviewer/Builder 通过 message 提议，Lead 决定是否写入。
- 每条记忆有 `authority`（user/agent/tool/pipeline）和 `verified` 日期（可选）。
- 注入：**所有 Pod-owned session（含 plan/execute/review）**启动时注入 `POD.md` + `POD_MEMORY.md` 的**确定性摘要**（预算 2–4KB，优先最近决策/术语/未解决问题，不做 LLM 二次摘要）；完整内容通过 `mafw_pod_memory_read` 按需读取。plan session 也由 Lead 成员拥有，因此计划阶段能看到项目方言。
- 不直接写全局谐波记忆；后续可人工/管线提升。
- goal 归档后，`PodMemoryService.captureGoal(goalId)` 入队执行“记忆收口”：从 goal state/receipts/reviews/trajectory **确定性提取**候选（决策、教训、术语、未解决问题），再由 Lead 在一个专用 `mafw-pod-memory` session 里做一次归纳并写入；Lead 不可用时写确定性 fallback。失败 goal 也记录失败模式。capture 不阻塞 archive。

### 7.3 存储位置

- 运行状态：`~/.mafw/memory/gateway.db`（现有 GatewayDatabase）。
- Pod 记忆/工件：`~/.mafw/pods/<podId>/`（项目目录不污染；后续可加“导出到项目 docs/agents”）。
- goal 产物仍按现有路径（waves/receipts/reviews），Pod 只存引用。

## 8. API / 工具

### 8.1 REST

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/projects/:projectId/pod` | 获取/确保 Pod（idempotent） |
| POST | `/api/projects/:projectId/pod` | 显式创建 Pod |
| GET | `/api/pods/:podId` | Pod 详情（members/tasks/messages/cost） |
| PATCH | `/api/pods/:podId` | 状态/预算/配置 |
| GET | `/api/pods/:podId/tasks` | 任务板 |
| POST | `/api/pods/:podId/tasks` | 创建任务 |
| PATCH | `/api/pods/:podId/tasks/:taskId` | 更新任务 |
| GET | `/api/pods/:podId/messages` | 邮箱 |
| POST | `/api/pods/:podId/messages` | 发消息（成员/用户） |
| POST | `/api/pods/:podId/wake` | 唤醒 |
| POST | `/api/pods/:podId/sleep` | 休眠 |
| GET | `/api/pods/:podId/cost` | 成本 |
| GET | `/api/pods/:podId/goals` | 队列/active/done goals |
| GET | `/api/pods/:podId/sessions/:sessionId/transcript` | 已结束 session 的 transcript 快照 |

### 8.2 工具（MCP/插件）

- `mafw_pod_status`：Pod/成员/任务概览。
- `mafw_pod_task_create` / `mafw_pod_task_update`：Lead/Builder/Reviewer 更新任务板。
- `mafw_pod_message`：成员发消息（to = member 或 broadcast）。
- `mafw_pod_memory_read` / `mafw_pod_memory_write`：读/写 Pod 记忆；write 仅 Lead（v1）。
- 现有 `mafw_spawn_subagent` / `mafw_message_subagent` / `mafw_subagent_result` 保留；PodService 内部复用 SubagentService，不重复造轮子。

### 8.3 事件

- `pod.created`
- `pod.updated`（status/config）
- `pod.member.updated`
- `pod.task.updated`
- `pod.message.created`
- `pod.memory.updated`
- `pod.work_order.assigned`

事件进现有 canonical/SSE 管线；桌面 dispatcher 新增 handler；TUI 可后续消费。

## 9. UI

### 9.1 入口

- 右工作台 →「执行」→ 新增「鲸群」subtab（与 概览/待办/子代理/后台/轨迹 同级）。
- 成员 session 在 SessionStrip 显示 Pod 徽标；点击 roster 打开 live session；已结束则打开 transcript 快照。
- goal 详情显示 Pod 徽标 + 任务板链接。

### 9.2 鲸群面板

```text
┌ 鲸群 · look ────────────────────────────────┐
│ 状态: active   Active goal: g-123   Queue: 1  [休眠] │
│ 预算: $2.40 / $20 today                     │
├ 成员 ───────────────────────────────────────┤
│ Lead      Manager      working   g-123      │
│ Builder   Tech Lead    working   2 tasks    │
│ Reviewer  Verifier     waiting   1 review   │
├ 任务板 ─────────────────────────────────────┤
│ 待办(2)     进行中(1)    待审(1)    完成(3)  │
│ ...                                        │
├ 邮箱 ───────────────────────────────────────┤
│ Reviewer → Builder: 测试失败，见 task-7     │
│ Lead → all: 范围确认，先做 A/B              │
├ 记忆 ───────────────────────────────────────┤
│ POD.md · POD_MEMORY.md · 3 decisions        │
└─────────────────────────────────────────────┘
```

### 9.3 交互

- 点击成员卡 → 打开 live session；已结束则打开 transcript 快照；无 session 显示“空闲”。
- 任务卡 → 打开关联 goal/session/artifact。
- 邮箱 → 发消息给成员或广播；消息可转任务。
- 记忆 → 只读查看；Lead 可编辑；其他成员只能提议。
- 休眠/唤醒 → 只影响主动调度，不销毁 roster/memory。
- 高风险动作 → 显示人工审批入口，不在 Pod 内自批。

### 9.4 前置依赖

Pod UI 依赖以下现有缺口（不在本 spec 内实现，但必须一起排期）：

1. **inputbar 导航**：输入框里能引用/跳转 Pod 成员或任务。
2. **subagent 跳转**：从任务卡/成员卡打开子会话。
3. **background task 状态**：成员正在跑的任务在后台面板可见。

没有这三个，Pod 只能停留在后台 API 层。

## 10. 权限与安全

- **角色权限**：Lead 不改代码；Builder 可编辑/执行；Reviewer 只读+测试；Curator（v1 Lead）只写 Pod 记忆。
- **Pod API 硬校验**：所有 Pod mutation（task/message/memory/member）按 `session_id -> pod_member.role` 校验；非成员/跨项目 403。
- **执行层权限（v1 限制）**：`mafw-review` 现有 allowlist 允许 shell，v1 无法从工具层硬保证“Reviewer 只读”（shell 仍可能写文件）。Reviewer 的只读是**审计 + diff 检查 + 人工抽检**约束，不是 sandbox；真正硬隔离留 v2。
- **人工门**：合并、删除、发布、改权限、跨项目访问必须人工批准；agent 不能自批。
- **Reviewer 独立**：Reviewer 不能由 Builder 代替；Reviewer 的 FAIL 不能被 Builder 覆盖；Lead 只能升级给人。
- **Pod 边界**：Pod 只能访问所属项目目录/已授权 worktree；不能读其他项目 Pod 记忆。
- **审计**：任务/消息/review/记忆写入都记录 actor、时间、goal；成本按成员/goal 归集。
- **注入安全**：Pod 记忆中的用户内容按不可信文本处理；不把记忆内容当系统指令执行；敏感信息脱敏。

## 11. 经济性

- **预算**：Pod 日预算 + 每 goal 预算；继承现有 goal budget；超限暂停并通知。日预算对 **Pod-tagged turns** 是硬门；Manager 的普通聊天不计入 Pod 预算。
- **模型分工**：Lead/Reviewer 用强模型；Builder 用强编码模型；Curator 后置时用便宜模型。允许 per-role 覆盖。
- **空闲休眠**：无 active goal 时 Pod `idle`；成员 `sleeping`；不轮询。
- **并发**：v1 一个 active goal，避免多 goal 同时烧钱。
- **成本归集**：`pod_member_sessions` + trajectory；按成员/goal/任务聚合。Lead 复用 Manager session 时，只有带 `pod_id`/`goal_id` 元数据的 turn 计入 Pod；其余 Manager 聊天不计入。成员 spawn 的子代理按 `pod_id` 归集。
- **上限**：maxMembers=3、maxConcurrentGoals=1、maxTurns/maxCostUsd 继承 goal 配置。

## 12. 失败模式与恢复

| 失败 | 症状 | 处理 |
|---|---|---|
| Lead 瓶颈 | 所有任务等 Lead 分配 | 任务板支持 Builder 认领；Lead 只做优先级/升级 |
| Reviewer 橡皮图章 | 什么都 PASS | 不同模型/独立上下文；确定性测试；人工抽检 |
| 任务板漂移 | 任务状态与 goal 不一致 | 从 waves/node events 同步 + 归档对账；receipt 是权威 |
| 记忆过期/污染 | 下个 goal 被旧决策误导 | Lead 收口；authority/verified；定期 stale review |
| 孤儿 session | 成员显示 working 但 session 已结束 | 启动 reconcile + 事件校正 |
| 成本失控 | 成员反复重试 | 预算帽 + max turns + 暂停 |
| 重复工作 | Builder/Reviewer 做同一件事 | 任务 owner 唯一；文件所有权；worktree |
| 权限升级 | Pod 试图自批合并 | 审批策略硬门；审计 |
| Pod split-brain | 两个 active goal 同时改同一项目 | v1 单 active goal + 队列 |
| Session 被删 | 成员显示 working 但 session 不存在 | Pod 保存 transcript 快照；wake 新 session；reconcile 标记 ended |
| Worktree/项目移动 | Pod 记忆分裂 | Pod key 用注册项目根；worktree 映射父 Pod；移动不自动迁移，文档提示 |
| Reviewer shell 写入 | 只读不是硬隔离 | 审计 + git diff 检查 + 人工抽检；v2 sandbox |

恢复：

- gateway 启动时 `PodService.reconcile()`：读 DB + goal state + session 存在性，修正成员/任务状态。
- Pod 暂停/恢复不销毁 roster/memory；恢复后从任务板继续。
- goal 失败/取消：Lead 记录失败模式，任务板标记失败，Pod 回 idle。

## 13. 验收

### 13.1 功能

1. 新项目创建 goal → 自动创建 Pod（3 人）；重复创建幂等。
2. Pod 面板显示 roster/tasks/messages/memory/cost；成员 session 可跳转。
3. goal plan→execute→review→archive 正常；Pod 任务板与节点状态一致。
4. Builder 执行、Reviewer 验收（现有 review 节点）；Reviewer FAIL 走现有 review 下一轮，任务板标记 `reopened`；Builder 不能覆盖。
5. Pod 记忆在 goal 归档后更新；下一个 goal 的成员 session 能读到摘要。
6. 重启 gateway/desktop、切换项目后 Pod 恢复；不重复创建。
7. 无 active goal 时 Pod idle；成员不持续跑。
8. 高风险动作仍走人工审批；Pod 不能自批。
9. 第二个 goal 创建时进入 `queued`，不 start；active 归档后自动 promote。
10. 已结束成员 session 可打开 transcript 快照；wake 时新建 session。
11. Pod 记忆注入 plan/execute/review session；归档后 queued capture 写入。
12. Pod 日预算只统计 Pod-tagged turns；Manager 普通聊天不计入。

### 13.2 非功能

- 不改变现有 goal 状态机/节点身份；现有 goal 测试全绿。
- Pod API 幂等；并发 ensure 不重复建。
- 事件驱动，无轮询；空闲 token 成本接近 0。
- 审计日志完整；成本可按成员/goal 归集。

### 13.3 测试

- 单元：PodService ensure/reconcile、任务状态机、消息、记忆注入、权限。
- 路由：REST 幂等/404/409/权限。
- 集成：goal 生命周期 + Pod 任务板 overlay + Reviewer FAIL 走现有下一轮 + 任务板 `reopened`。
- 桌面：Pod panel、roster、task board、message、session jump、cost。
- E2E：一个真实 goal 全链路（Lead→Builder→Reviewer→archive→memory）。
- 回归：gateway/desktop 全量；现有 goal/manager/subagent 测试不回归。

## 14. 分期

### Phase 1：后端 Pod Lite

- `PodService` + DB tables + REST + MCP tools。
- 3 人 roster；任务板/邮箱/记忆文件。
- Goal 事件绑定：`goal.created` / `goal.plan.ready` / `goal.review.failed` / archive；Lead=Manager、Builder=execute、Reviewer=review；`pod_goals` 队列 + 自动 promote。
- 权限/预算/审计。
- 不做 UI（先用 API/CLI 冒烟）。

### Phase 2：桌面鲸群面板

- 「执行 → 鲸群」subtab；roster/task board/inbox/memory/cost。
- 成员 session 跳转；SessionStrip Pod 徽标。
- 前置：inputbar 导航、subagent 跳转、background task 状态。

### Phase 3：Curator + Task Force

- Curator 从 Lead 拆出；记忆 stale review；技能沉淀。
- Goal Task Force：按需加入专家（仍受 maxMembers/预算限制）。
- 多 active goal/多 Pod 评估后再放开。

## 15. 本 spec 的决定（可改）

1. **自动创建**：项目首个 goal 自动 ensure Pod；`pod.enabled=false` 可关。
2. **Lead = 现有 Manager**：identity `manager`；plan session 归 Lead 成员；不物化 `mafw-pod-lead`。
3. **Session 临时化**：Builder/Reviewer 按 goal/node 开 session；NodeDriver 完成后可删；Pod 保存 transcript 快照；wake 新建 session。
4. **一个 active goal + 队列**：`pod_goals` 管 `queued|active|done|aborted`；active 直到 archive/abort；Pod paused 不 suspend goal。
5. **Reviewer = 现有 review 节点**：不新增 pre-review 门；FAIL 走现有 review 下一轮，任务板标记 `reopened`。
6. **任务板是 first-class overlay**：显式 task id/status/owner；waves/receipts 仍是执行权威；归档对账。
7. **Pod 记忆在 `~/.mafw/pods/<podId>/memory/`**；注入所有 Pod-owned session（含 plan）；归档后 queued capture。
8. **UI 放「执行 → 鲸群」**；live session 跳转；已结束 session 打开 transcript 快照；左 rail 独立图标留到使用验证后。
9. **Pod key = 注册项目根 canonical realpath**；worktree 映射父 Pod；项目移动/重命名不自动迁移。
10. **Pod API 硬校验**：task/message/memory/member mutation 按 session→member→role 校验；执行工具仍按 identity policy；Reviewer shell 只读是审计约束，不是 sandbox。
11. **成本**：只统计 Pod-tagged turns；Manager 普通聊天不计入；日预算对 Pod-tagged turns 是硬门；子代理按 `pod_id` 归集。
12. **Reviewer 模型**：优先不同模型；单 provider 时允许同模型但独立上下文。
13. **durable task 边界**：v1 Pod 任务板独立，不复用 `mafw_task_submit`；Phase 2 再评估。

## 16. 开放问题（不阻塞 Phase 1）

1. Pod 是否应对所有项目默认开启，还是只在用户显式创建时开启？（本 spec 默认自动，可关）
2. Lead 复用 Manager session 是否会让 Manager 上下文过载？Phase 1 冒烟验证。
3. Pod 记忆是否需要导出到项目仓库（`docs/agents/`）供团队共享？v1 先不导出。
4. 多 active goal 的阈值：v1 单 active；何时允许 2 个？需要评估数据。
5. `pod_member_sessions` 的 transcript 快照保留期：默认跟随 trajectory retention；是否需要独立 TTL？
6. Reviewer shell 只读的 v2 硬隔离方案（sandbox/worktree 只读挂载）需要单独设计。

> 已在本 spec 决定、不再作为开放问题的：Reviewer 门、session 生命周期、任务板形态、队列语义、Lead 身份、Pod key、成本口径、权限边界。

## 17. 参考

- 调研：`docs/research/2026-10-29-agent-team-swarm-tower-pod.md`
- Manager：`docs/superpowers/specs/2026-07-30-manager-agent-design.md`
- 子代理：`docs/superpowers/specs/2026-10-26-batch3-subagent-fullstack-design.md`
- Goal 编排：`docs/superpowers/specs/2026-10-08-goal-orchestration-p1-design.md`
- Instruction entries：`docs/superpowers/specs/2026-10-27-t2-instruction-entries-design.md`
- Claude Code Agent Teams：https://code.claude.com/docs/en/agent-teams
- MiniMax Agent Team：https://www.minimax.io/blog/minimax-agent-team-long-running-1779893953
- Cursor Agent Swarm：https://cursor.com/blog/agent-swarm-model-economics
- Anthropic Multi-Agent Research：https://www.anthropic.com/engineering/multi-agent-research-system
