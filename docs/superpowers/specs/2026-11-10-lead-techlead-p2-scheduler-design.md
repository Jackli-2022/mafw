# Lead / Tech Lead · P2：调度器与 COW fork

> 2026-11-10 · Phase P2
> 父设计：`docs/superpowers/specs/2026-11-10-lead-techlead-thread-handoff-design.md`
> 前置：P0 内核对象、P1 工作集与缺页
> 后续：`2026-11-10-standing-goals-design.md`（P2.5 长效 Goal）
> 目标：把人的注意力当 CPU 调度；新 Goal 从话题 COW 分叉；话题边界自动提议但可撤销。

## 1. 背景

P0 让用户不感知 session；P1 让话题可以换入换出。P2 解决「多个 Goal / 多个话题同时存在时，
系统怎么决定什么时候打扰人、怎么从一段讨论分叉出新工作、怎么自动判断话题边界」。

SuperAgent 的启发：

- **Ticket stage** 由结构化事实计算，`person` 才表示「没有人就无法继续」。
- **Subscription** 让 follow-up 直接到 Ticket，不需要重新 Eval。
- **Router 不等待**：状态、候选、后台完成都是消息。
- **Worker slot** + **人类介入优先槽**：新工作不能堵住人继续已有工作。

P2 借这些机制，但保留 MAFW 的 Goal / NodeDriver / Reviewer 内核。

## 2. 目标 / 非目标

### 目标

- **Attention scheduler**：每个活跃 Goal 只有一个 stage；`person` 阶段优先展示；健康状态不占主面。
- **合并打扰**：同一 Goal / 同一原因的 attention 合并；通知去重；不因后台事件反复打断。
- **COW fork**：从当前 topic 分叉新 Goal，共享历史（按引用），新 session + worktree，写时复制。
- **自动话题边界**：检测信号 → 提议分隔 → 用户可 merge/split/undo；不阻塞对话。
- **多 Goal 并发**：Goal × workspace × assignment；人类介入优先于新工作。
- **Pause / Stop / Retry** 三档语义分离。

### 非目标

- 不做主动找活（proactive auto）；最多 observe。
- 不替换 NodeDriver / Reviewer / Plan + Goal Eval。
- 不做跨项目调度。
- 不把 SuperAgent 的 Source / Trigger / Eval / Mandate 全套词汇搬给用户。

### 反目标

- 自动边界把进行中的任务切断，导致上下文碎片化。
- 误报 attention，把健康状态变成噪音。
- 新 Goal 抢占人类介入槽，用户无法继续已有工作。
- COW fork 复制整段历史，成本爆炸。

## 3. 依赖

- P0：`lead_topic`、`sourceRef`、handoff、状态投影。
- P1：working set、summary、recall、resume、compaction。
- **分层**：AutomationEngine / Scheduler = 机制层（cron / 调度 / watchdog / 预算）；Event Layer（P2.4）= 领域层（Source / Trigger / Thread / Subscription / Delivery）；Goal 向 Engine 注册 trigger，Engine emit 事件到 Event Layer。
- Pod / Goal store：`pod_goals`、`pod_goal_revisions`、attention、waves、worktree。
- 现有 presence / notification / tray。

## 4. 设计

### 4.1 Attention scheduler

每个活跃 Goal 一个 stage，按优先级从结构化事实计算（纯函数）：

```ts
type GoalStage =
  | { owner: 'person'; kind: 'answer'; label: string; action: 'answer' }
  | { owner: 'person'; kind: 'plan_approval'; label: string; action: 'approve' }
  | { owner: 'person'; kind: 'review'; label: string; action: 'review' }
  | { owner: 'person'; kind: 'blocked' | 'failed'; label: string; action: 'retry' | 'unblock' }
  | { owner: 'team'; kind: 'queued' | 'working'; label: string }
  | { owner: 'system'; kind: 'idle' | 'waiting'; label: string }
```

规则：

- `person` 只在「没有人就无法继续」时出现：pending attention、plan approval、ready review、blocked/failed。
- Reviewer 正在 review = `team/working`，不是 `person/review`；只有 ready 结果等待用户验收才是 person。
- 每个 stage 的 `count` 必须等于它链接到的列表长度。
- stage 由 store 事实计算，不从自由文本猜。

调度：

- **优先级**：person > team > system；同 person 内按 deadline / goal priority / lastUpdate。
- **合并**：同一 goalId + kind 的 attention 合并；同一原因的重复通知去重。
- **人类介入槽**：并发上限之外保留 1 个槽给「人继续已有工作」；新 Goal 不能占用。
- **不等待**：Lead / Router 不 sleep、不阻塞长任务；报告/候选以后台消息到达。
- **Pause / Stop / Retry**：
  - Pause：停止 dispatch / 新 Eval / 投递，运行中的 turn 不硬中断；恢复后继续。
  - Stop：撤销该 Goal 的授权，不再接收后续。
  - Retry：结束当前 assignment，在同一 session / worktree / branch 上启动新 assignment。

### 4.2 COW fork（新 Goal 从话题分叉）

场景：用户说「基于刚才的讨论，另开一个 Goal 做 X」。

流程：

1. Lead 识别 fork 意图，调用 `mafw_create_goal`（`handoff: 'current-topic'`, `forkFromTopicId`）。
2. Gateway 读取源 topic 的 transcript / summary / sourceRef。
3. 新 Goal 的 `lead-handoff.md` 写入**引用**：`source topic id + messageRange + summary`，
   不复制全部消息（COW）。
4. 新 Tech Lead session + worktree 创建；开场 prompt 带源 topic 的 summary + 关键消息 + 引用。
5. 源 topic 不变；新 Goal 的后续消息写入新 topic。
6. Provenance：`goal.request.sourceRef.topicId` + `topic.forkedFrom`。

规则：

- **写时复制**：源 transcript 只读；新 Goal 的修改/摘要写新记录。
- **不复制整段历史**：超过预算时只带 summary + 关键决策 + 未结事项。
- **可追溯**：新 topic 记录 `forkedFrom`、`forkedAt`、`inheritedMessageRange`。
- **不合并**：fork 后两个 topic 独立；跨 topic 引用只读。

### 4.3 自动话题边界

信号（加权）：

| 信号 | 例子 | 权重 |
|---|---|---|
| 显式措辞 | 「换个话题」「另外」「先到这」 | 高 |
| 语义漂移 | 相邻用户消息 embedding 距离超过阈值 | 中 |
| 空闲 | 距上一条消息 > N 分钟 | 中 |
| 任务闭合 | 当前 Goal 进入终态 / 用户说「好了」 | 高 |
| 话题词变化 | 标题/关键词显著变化 | 低 |

流程：

1. 每条用户消息后异步打分；不阻塞回复。
2. 分数超过阈值 → 写 `topic_boundary` 提议（`status='proposed'`），UI 显示轻量分隔线。
3. 用户可：
   - 接受（默认继续聊，不操作）；
   - merge（合并两个 topic）；
   - split（手动切分）；
   - undo（撤销提议）。
4. 边界只影响 topic 记录 / summary / handoff 范围；**不创建新 session**。
5. 进行中的 Goal 不自动切分；任务闭合信号才允许在终态后提议。

规则：

- **不阻塞**：边界检测异步，失败 fail-open。
- **可撤销**：所有自动边界都有 `proposed/accepted/merged/split` 状态。
- **保守**：置信度不足不提议；宁可少切，不多切。
- **可解释**：UI 显示触发信号（「检测到新话题」/「Goal 已完成」）。

### 4.4 多 Goal 并发

- **执行单元**：Goal × isolated workspace（worktree）× Assignment。
- **并发槽**：普通 worker slots + 1 个人类介入槽；人类消息优先。
- **队列**：新 Goal `queued`，不抢占运行中的 Goal；person 阶段可抢占。
- **隔离**：每个 Goal 独立 worktree / branch；共享 repo 但写隔离。
- **状态**：Goal 定义自己的状态，不跟随 session；session 可换、可重建。

### 4.5 跨 topic 记忆提升

- topic summary → semantic memory（决策 / 偏好 / 项目事实），cueAnchors: topicId / goalId / 项目路径。
- Goal 完成后写 semantic summary；Lead 可在后续对话 recall。
- 不把 Tech Lead 原始日志写入 Lead 记忆；只写结论 / 决策 / 未结事项。

## 5. 数据模型

### `topic_boundary`

| 字段 | 说明 |
|---|---|
| `id` | boundary id |
| `project_dir` | 项目 |
| `lead_session_id` | Lead session |
| `from_topic_id` | 前一个 topic |
| `to_topic_id` | 新 topic（可空，接受后创建） |
| `trigger` | explicit / semantic / idle / goal_closed / keyword |
| `confidence` | 0–1 |
| `status` | proposed / accepted / merged / split / undone |
| `created_at` | 时间 |

### `topic_fork`

| 字段 | 说明 |
|---|---|
| `id` | fork id |
| `source_topic_id` | 源 topic |
| `target_goal_id` | 新 Goal |
| `inherited_from` | 源消息起点 |
| `inherited_to` | 源消息终点 |
| `mode` | `reference` / `summary` |
| `created_at` | 时间 |

### `attention_item`（若现有 attention 不够）

| 字段 | 说明 |
|---|---|
| `id` | attention id |
| `goal_id` | Goal |
| `kind` | answer / plan_approval / review / blocked / failed |
| `priority` | 数值 |
| `coalesce_key` | 合并键 |
| `created_at` / `updated_at` | 时间 |
| `resolved_at` | 解决时间 |

### `goal_assignment`（若现有 NodeDriver 不够）

| 字段 | 说明 |
|---|---|
| `id` | assignment |
| `goal_id` / `revision` | 目标 |
| `session_id` | 执行 session |
| `worktree` | 工作区 |
| `status` | pending / running / ended |
| `started_at` / `ended_at` | 时间 |

## 6. API / 事件

| 接口 | 说明 |
|---|---|
| `GET /api/attention?projectDir=` | person-first 列表；count = list 长度 |
| `POST /api/goals/:id/pause` | 暂停自动推进 |
| `POST /api/goals/:id/stop` | 撤销授权 |
| `POST /api/goals/:id/retry` | 同 session/worktree 重试 |
| `POST /api/lead/topics/:id/fork` | COW fork 新 Goal |
| `GET /api/lead/topics/:id/boundaries` | 边界提议/历史 |
| `POST /api/lead/topics/:id/boundaries/:bid/accept` | 接受 |
| `POST /api/lead/topics/:id/boundaries/:bid/merge` | 合并 |
| `POST /api/lead/topics/:id/boundaries/:bid/undo` | 撤销 |
| `GET /api/scheduler/status` | 开发者诊断：槽位 / 队列 / stage |

事件：

- `goal.stage.changed { goalId, stage }`
- `attention.created { goalId, kind }`
- `attention.resolved { goalId, kind }`
- `topic.boundary.proposed { topicId, boundaryId, confidence }`
- `topic.forked { sourceTopicId, goalId }`

## 7. UI

- **Attention-first 面板**：先列 person 事项（answer / plan approval / review / blocked / failed），
  再列团队健康，再历史；健康状态不占主面。
- **Goal 卡片**：stage、progress、blocker、Tech Lead 入口；不显示 session id。
- **Topic map**：Lead 对话侧边；主题、摘要、fork 关系、边界；可搜索。
- **通知**：合并同因；点击直达 Goal / Tech Lead；系统健康不通知。
- **开发者模式**：`/proc` 式 session / assignment / scheduler 诊断。

## 8. 失败模式

| 失败 | 处理 |
|---|---|
| 自动边界误切 | 保守阈值 + 提议态 + merge/undo；进行中的 Goal 不切 |
| Attention 误报 | stage 由结构化事实计算；健康状态不进 person；count = list |
| 新 Goal 抢占 | 人类介入优先槽；新工作排队 |
| COW fork 成本高 | 只带 summary + 关键消息；引用不复制 |
| 并发 worktree 冲突 | 每 Goal 独立 worktree；共享 repo 只读 |
| 调度饥饿 | 优先级 + aging；person 优先；诊断面板可见 |
| 通知风暴 | coalesce key + 去重 + 窗口 |

## 9. 测试与验收

### 单元

- `deriveGoalStage`：全部 stage 分支；person/team/system；count = list。
- `scheduleAttention`：优先级、aging、coalesce、human slot。
- `detectBoundary`：显式/语义/空闲/Goal 终态；阈值；不切断进行中 Goal。
- `planFork`：引用范围、summary 选择、provenance。
- `pauseStopRetry`：三档语义不混。

### 集成

- 3 个并发 Goal + 1 个人类介入：人能继续已有工作，新 Goal 排队。
- COW fork：源 topic 不变；新 Goal 拿到引用；写隔离。
- 自动边界：提议 → merge/undo；对话不阻塞。
- Attention：健康状态不占 person；plan approval / review / blocked 正确分类。

### 评测

- 标注 30 段多话题对话：boundary precision ≥0.8，recall ≥0.7；误切率 <10%。
- 并发 3 Goal：人类介入延迟 <2s；无饥饿。
- COW fork：上下文 token 相比全量复制下降 ≥50%。

### 指标

- person 事项从产生到用户看到 <5s。
- 通知噪音（非 person 通知）下降 ≥50%。
- 自动边界误切率 <10%。
- 并发 Goal 吞吐提升（相对单 active）。

## 10. 迁移与开关

- 新表随 migration；`attention_item` / `goal_assignment` 优先复用现有 attention / NodeDriver 表，
  不足再建。
- 开关：`MAFW_LEAD_SCHEDULER`（默认关，灰度）、`MAFW_LEAD_AUTO_BOUNDARY`（默认关）、
  `MAFW_LEAD_COW_FORK`（默认开）。
- 自动边界先 observe（只记录不提议），再灰度提议；用户可全局关闭。
- COW fork 先在单项目灰度；失败回退到 P0 的 `lead-handoff.md` 全量快照。

## 11. 开放问题

1. 自动边界默认开还是 observe？P2 建议先 observe 两周，再按项目开启。
2. `attention_item` 是否复用现有 attention 表？P2 建议先复用，字段不足再扩。
3. 人类介入槽是否固定 1 个，还是按并发比例？P2 建议固定 1，简单可预期。
4. COW fork 的 summary 由谁生成：P1 的 topic summary 复用，还是 fork 时重新生成？P2 建议复用 + 追加差异。
