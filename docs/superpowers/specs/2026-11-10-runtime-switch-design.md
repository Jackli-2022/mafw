# Runtime 切换设计：Session 是 Frame，Goal 是持久对象

> 2026-11-10 · Phase P0.6（横切）
> 父设计：`docs/superpowers/specs/2026-11-10-lead-techlead-thread-handoff-design.md`
> 目标：runtime 切换时 Goal / Topic / Event / Worktree 不丢；session 是 per-runtime frame，可重建；用户不感知 session。

## 1. 背景

MAFW 支持多个 runtime（opencode / pi / claude / dsh）。session id 是 runtime 私有的：换 runtime 后旧 id
不可用，runtime 原生历史也未必能被新 runtime 读取。现有实现已经有部分基础：

- `manager-session` kv 按 `byRuntime` 分槽；`LeadSessionRegistry.runtimeName` 是 getter，热切换读写新槽，旧槽保留。
- `PodSessionSupervisor` 按 `(podId, memberId, goalId, revision, kind)` 作用域重建 session。
- session registry 记录 `runtimeName` / `generation` / `scope`。

但新的模型里，Lead topic、Tech Lead、Quick Worker、GoalRun 都需要 per-runtime 绑定。如果只把状态放在
session 里，runtime 一切换就丢。P0.6 定义：**哪些是持久的，哪些是 per-runtime 的，怎么切换。**

## 2. 目标 / 非目标

### 目标

- **持久对象 runtime-agnostic**：Project / Goal / Topic / GoalRun / Event / Delivery / Worktree /
  handoff 文件 / memory / outbox。
- **session 绑定 per-runtime**：`(objectType, objectId, runtime) → sessionId`；旧 runtime 的绑定保留为 dormant。
- **切换 = checkpoint / restore**：暂停新 dispatch → 快照 working set → 在新 runtime 重建 session →
  重新绑定 → 恢复投递。
- 切回旧 runtime：活着就复用旧 binding；死了就从持久对象 rehydrate。
- 切换只在**安全点**发生；in-flight turn 不重放副作用；超时 defer，不强制 interrupt。
- 能力缺失 fail-closed / 中性 503；不丢数据。
- 用户只看到「正在切换」，看不到 session id / 列表。

### 非目标

- 不做 in-flight tool call 的 live migration。
- 不要求跨 runtime 读取对方的原生 transcript；用 gateway 侧镜像。
- 不在 runtime 切换时改变 Goal / Review / 权限语义。
- 不做跨机器迁移（先单 gateway）。

### 反目标

- 切换后 Goal / Topic 丢失，或用户要重新描述。
- in-flight tool call 被重放，产生重复副作用。
- 旧 runtime 的 session 被删除，切不回去。
- 能力缺失却假装成功。
- 把 session id 暴露给用户。

## 3. 模型

```
Runtime-agnostic（持久）
  Project · Goal · Topic · GoalRun · Event · Delivery · Worktree
  Handoff file · Memory · Outbox · Attention

Per-runtime（可重建）
  Lead binding      (opencode | pi | claude | dsh) → session
  Tech Lead binding (opencode | pi | claude | dsh) → session
  Quick Worker binding
  GoalRun binding

Runtime 切换 = checkpoint → restore
  quiesce → snapshot → materialize → bind → resume → commit
```

OS 映射：

| OS | MAFW |
|---|---|
| CPU ISA / 机器 | runtime |
| 进程 / 地址空间 | session |
| 进程镜像（per ISA） | session binding |
| checkpoint / restore | rehydrate session |
| 持久卷 | worktree / goal files / handoff |
| 作业说明 | Goal / Topic / GoalRun |
| 中断 | in-flight turn |
| ABI / 设备驱动 | runtime adapter / capability contract |

## 4. 数据模型

### `session_bindings`

| 字段 | 说明 |
|---|---|
| `id` | binding id |
| `object_type` | lead / tech_lead / quick_worker / goal_run / worker / probe |
| `object_id` | projectDir / goalId / topicId / runId / session scope |
| `project_dir` | 项目 |
| `runtime` | opencode / pi / claude / dsh |
| `session_id` | runtime 私有 id |
| `status` | active / dormant / dead / switching / failed |
| `generation` | 重建代数 |
| `created_at` / `last_active_at` | 时间 |
| `last_error` | 失败原因 |

唯一索引：`(object_type, object_id, runtime)`。

### `runtime_switches`

| 字段 | 说明 |
|---|---|
| `id` | switch id |
| `project_dir` | 项目（可空 = 全局） |
| `from_runtime` / `to_runtime` | 方向 |
| `reason` | user / upgrade / capability / recovery |
| `status` | running / success / partial / failed |
| `started_at` / `ended_at` | 时间 |
| `affected` | JSON：重建的 bindings / 跳过的对象 |
| `error` | 失败原因 |

### 引用调整

- `lead_topic` / `goal_runs` 不再只存一个 `session_id`；改为引用 binding（或 `session_bindings` 查询）。
- `GoalSourceRef` 增加 `runtime?: string`，记录来源 runtime（旧 sessionID 只在该 runtime 有意义）。
- `manager-session` 保持兼容；新代码以 `session_bindings` 为准，旧槽作为迁移来源。

## 5. 切换事务

1. **Lock**：per project / global 切换锁；并发切换拒绝。
2. **Quiesce（安全点）**：停止新 dispatch；等待当前 turn 完成到安全点。
   **不强制 interrupt、不重放 tool 副作用。** 超时（默认 60s）→ 放弃本次切换（defer），
   保持旧 runtime；提示「当前有正在执行的回合，稍后再试」；用户可手动重试。
   只有显式 `force` 模式才允许 interrupt，默认关闭。
3. **Snapshot**：对每个 active binding 持久化 working set：
   - Lead：当前 topic 的 start/end message、summary、未结事项、Goal 状态投影；
   - Tech Lead：ContextManifest、handoff、goal files、plan/eval 状态、worktree 路径；
   - Quick Worker：intent、scope、已有 diff、预算；
   - GoalRun：trigger payload、mode、已有结果；
   - Event：thread seq、pending deliveries、outbox。
4. **Materialize**：在目标 runtime 物化 identity / tools / agent presets（`agents.install`、tool factory）。
5. **Bind**：
   - 目标 runtime 已有 live binding → 复用；
   - 否则创建 session，注入持久状态（见 §6 seed）。
6. **Rebind**：Pod lead / goal revision / session registry / attention 绑定。
7. **Resume**：Event Layer 继续投递；outbox 重试；cron 不受影响；pending approvals 保留。
8. **Commit**：旧 binding 标 `dormant`；写 `runtime_switches` success。
9. **Failure**：回滚到旧 binding；标 `switch_failed`；不丢数据；用户可重试。

## 6. Rehydrate seed

### Lead

```
<user-profile> pinned
<project-state> 目标 / 优先级 / 决策 / 活跃 Goal 状态投影
<topic-summary> 当前 topic 摘要 + 未结事项
<recent-messages> 最近 N 条 user/assistant 文本
<topic-index> warm topic 摘要（P1）
```

不注入 Tech Lead 原始日志；不重放旧 tool call。

### Tech Lead

```
[CONTEXT MANIFEST]
<lead-handoff> snapshot + context/lead-handoff.md
<goal-files> goal.md / request.json / direction.json / waves.json / goal-eval.json
<revision-state> 当前 revision / plan approval / probes / review
<worktree> 路径（git 持久）
```

### Quick Worker / GoalRun

```
intent / scope / diff / budget / trigger payload / mode
```

## 7. 能力差异

- 目标 runtime 缺 surface（如 `session.messages`）→ **中性 503**，保留旧 binding，不切换。
- 模型差异：重新物化 identity / system prompt；不假设旧 runtime 的格式。
- 工具差异：重新注册 tools；未知工具 fail-closed；身份 policy 不变。
- 历史差异：只用 gateway 镜像（`lead_topic` / `topic_message_index` / `lead-handoff.md`）；
  不读对方 runtime 私有存储。
- 切换后能力降级：标记 `degraded`，状态卡/Config 显示；不假装完整。

## 8. UI

- Config：runtime 选择 + 切换进度（quiesce / snapshot / bind / resume / commit）。
- 不显示 session id；显示对象级状态（Lead / N Goals / M runs）。
- 失败：中性文案 + 重试；旧 runtime 继续可用。
- 状态卡：runtime + rehydrated 计数（仅开发者模式）。
- 用户切换后可以继续聊；旧 topic 摘要可用。

## 9. 失败模式

| 失败 | 处理 |
|---|---|
| 切换时 turn 未结束 | 等安全点；超时 defer；保持旧 runtime；不 interrupt、不重放副作用 |
| 目标 runtime 创建 session 失败 | 回滚旧 binding；`switch_failed`；可重试 |
| 能力缺失 | 503 中性；不切换；不丢数据 |
| 并发切换 | 锁拒绝；提示稍后 |
| 旧 binding 已死 | 从持久对象 rehydrate；不依赖旧 session |
| 事件投递中断 | outbox 持久化；切换后重试 |
| Standing Goal cron | Engine 层不受影响；run 在新 runtime 继续 |
| 切回旧 runtime | dormant binding 活着 → 复用；死了 → rehydrate |

## 10. 测试与验收

### 单元

- `resolveBinding`：per-runtime、active/dormant/dead、generation。
- `planSwitch`：quiesce / snapshot / bind / rollback 步骤。
- `checkCapabilities`：缺 surface → 503；不切换。
- `buildLeadSeed` / `buildTechLeadSeed`：注入内容、不重放 tool call。
- `bindingLifecycle`：active → dormant → active；failed 回滚。

### 集成

- 活跃 Lead topic 切换 runtime → 新 session 能接上话题 + Goal 状态；旧 binding dormant。
- 活跃 Tech Lead/Goal 切换 → worktree / plan / handoff 保留；turn 未结束 → defer，不切换。
- 切回旧 runtime → 复用旧 session 或 rehydrate。
- Standing Goal cron 在切换后继续；GoalRun 不重复。
- Event outbox 切换后重试成功。
- 能力缺失 → 503，数据不丢。

### GUI

- Config 切换进度；无 session tab / id；失败可重试。

### 指标

- 切换成功率 ≥99%（能力满足时）。
- rehydrate 后用户重复描述次数 <1 次/切换。
- 数据丢失 = 0。
- 切换时间：Lead-only <5s；含 Tech Lead/Goal <30s（不含等待 turn）。

## 11. 迁移与开关

- 新表 `session_bindings` / `runtime_switches` 随 migration。
- Backfill：`manager-session` byRuntime slots + Pod session scope → bindings。
- 开关 `MAFW_RUNTIME_BINDINGS`（默认开）；关闭时回退现有 `byRuntime` slot 行为。
- 旧 runtime binding 保留 N 天（默认 30），之后归档；切回时仍可 rehydrate。
- 现有 `manager-session` 保持兼容读取。

## 12. 开放问题

1. **已决：只在安全点切换**——无 in-flight turn 才执行；超时 defer，不强制 interrupt。
   显式 `force` 模式默认关闭，仅开发者/测试可用。
2. 旧 binding 保留多久？建议 30 天；之后只保留持久对象。
3. 是否允许 per-project 切换 runtime？建议先全局，后续按项目。
4. Tech Lead 的 worktree 在 runtime 间共享：git 持久，OK；但 runtime 私有缓存（语言服务器 / 终端）需重建。
