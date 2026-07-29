# Manager Agent（v7.0）— 设计规格

> 日期：2026-07-30 | 关联：AGENTS.md v6.8 | 状态：设计完成

## 目标

在 LangGraph loop engine 之上增加一个对话式主 Agent（Manager），实现"聊天员工"形态：

- 用户自然语言派任务 → Agent 澄清后触发 goals
- 管理 loop 生命周期，中间有阻塞时询问用户
- 完成后主动汇报

**零侵入** LangGraph 对单个 goal 的收敛逻辑。

---

## 架构

```
用户 ⇅ 聊天（opencode session / MAFW chat UI — 同一个 sessionId 两端渲染）
        │
   Manager Agent（每项目一个常驻 session，pinned，永不 evict/trim/archive）
   - 身份：第四种 Phase Agent（通过 Phase Identity 机制注入）
   - 约束：不写代码、不碰文件、只通过 mafw_* 工具操作
   - 生命周期：L1 压缩 → L2 轮换 → L3 记忆 → DB 真相
        │  mafw_set_goal / get_goal_status / list_goals /
        │  answer_question / get_evidence / cancel_goal /
        │  list_pending_questions
        ▼
   Gateway API（现有 + 新增 respond/questioning 端点）
        │
   LangGraph（不变：每个 goal 独立 plan→execute→review→archive）
        │  ★ plan/review 节点内 interrupt() HITL 机制
        │  ★ +1 微型节点 askUser（挂起/恢复）
        ▼
   Phase Agents（mafw-plan / mafw-execute / mafw-review — 不变）
```

**关键约束**：
- Manager **不在 LangGraph 图内**——是图的客户端，不是其嵌套
- `mafw_set_goal` 必须先复述确认（Interview 逻辑上移）
- 状态只能从工具查询获得，禁止凭记忆

---

## Section 1：Manager Identity 与工具集

### 1.1 身份注入

```yaml
[MAFW MANAGER IDENTITY]
Role: 你是用户的项目员工。你接收任务、澄清需求、启动 goal、跟进进度、汇报结果。
Constraints:
  - 你不写任何代码，实现工作必须通过 mafw_set_goal 委派
  - goal 状态只能从工具查询获得，不许凭记忆回答进度
  - 用户没有问进度时，不主动汇报中间态，只在完成/失败/被阻塞时发言
  - 不确定是否为任务时先澄清，创建 goal 前必须复述确认
```

### 1.2 工具集

| 工具 | 用途 | 权限 | 备注 |
|---|---|---|---|
| `mafw_set_goal` | 创建 goal（须先复述确认） | 写入 | |
| `mafw_get_goal_status` | 查单个 goal 状态/进度/verdict | 读取 | |
| `mafw_list_goals` | 列出活跃 goal | 读取 | |
| `mafw_answer_question` | 代用户回答 loop 阻塞问题 | 写入 | respond API 薄封装，复用同一套 questionId 幂等仲裁 |
| `mafw_get_evidence` | 读 evidence report / diff 摘要 | 读取 | |
| `mafw_cancel_goal` | 取消 goal（须用户确认） | 写入 | |
| `mafw_list_pending_questions` | 列出当前挂起的 loop 问题 | 读取 | 查 question 账本的 pending 项 |

**安全边界**：Manager 无 bash / edit / read 文件权限。

---

## Section 2：Loop 内 HITL — `interrupt()` 机制

### 2.1 机制选择

采用 **`interrupt()`**，不走 ERROR 中继。理由：

1. **Checkpoint 即挂起状态**。恢复是原子的
2. **问答进入图历史**。审计、复盘都能拿到原文
3. **少一跳**。用户回答原文进 state，不被转述篡改
4. **恢复点精确**。`Command(resume={})` 从挂起处继续

### 2.2 图形状

```
原图:  plan → execute → review → archive*
修正:  plan → [pendingQuestion? → askUser → plan] → execute → review → archive*
               ↑                              │
               └────────resume────────────────┘
```

改动：+1 微型节点 `askUser` + 2 条边 + 1 个 `draftPlan` 字段。**主干不变**——execute/review/archive 链路不受影响。

### 2.3 节点代码

```typescript
// plan 节点 — 只生成计划，不挂起
async function planNode(state, services) {
  // 恢复路径：draftPlan 已存在且有用户回答 → 精化，不重新生成
  if (state.draftPlan && state.userResponse) {
    return finalizeWithAnswer(state);
  }

  const draft = await generatePlan(state);

  return {
    draftPlan: draft,
    pendingQuestion: draft.status === "need_clarification"
      ? {
          questionId: uuid(),
          node: "plan",
          loop: state.round,
          questions: draft.ambiguities,
          askedAt: new Date().toISOString(),
        }
      : null,
  };
}

// askUser 微型节点 — 唯一职责：挂起 / 恢复
async function askUserNode(state) {
  const resume = interrupt({
    type: "user_question",
    goalId: state.goalId,
    questionId: state.pendingQuestion!.questionId,
    node: state.pendingQuestion!.node,
    questions: state.pendingQuestion!.questions,
  });

  return {
    userResponse: {
      questionId: state.pendingQuestion!.questionId,
      answer: resume.answer,
      respondedAt: new Date().toISOString(),
    },
    pendingQuestion: undefined as any,  // 清槽：reducer 区分 null=显式清空 vs undefined=不更新
  };
}
```

条件边：
- `plan` 之后：`state.pendingQuestion ? → askUser : → execute`
- `askUser` 之后：`→ plan`（带 draftPlan + userResponse 精化路径）

同一模式应用于 `review` 节点。review 失败时判定升级阈值，若需 interrupt 则返回 `pendingQuestion` 并走 askUser。

### 2.4 LoopState 扩展

```typescript
// loop-state.ts — 新增字段
import { Annotation } from "@langchain/langgraph";

export const LoopState = Annotation.Root({
  // ... 现有字段不变 ...

  draftPlan: Annotation<any>({
    value: (a, b) => b ?? a,
    default: () => null,
  }),

  pendingQuestion: Annotation<{
    questionId: string;
    node: "plan" | "review";
    loop: number;
    questions: string[];
    askedAt: string;
  } | null>({
    // reducer 修正：null = 显式清空，undefined = 不更新
    value: (a, b) => b === undefined ? a : b,
    default: () => null,
  }),

  userResponse: Annotation<{
    questionId: string;
    answer: string;
    respondedAt: string;
  } | null>({
    value: (a, b) => b === undefined ? a : b,
    default: () => null,
  }),
});
```

### 2.5 pendingQuestion 单槽不变量

图挂起期间不可能挂起第二次（因为正在等用户），所以单槽是结构性保证：
- 每次 interrupt 生成唯一 `questionId`（uuid）
- plan 有多个疑问时打包成 `questions: []`
- 响应按 questionId 幂等匹配，过期 questionId 返回 409

### 2.6 Review 升级 interrupt 判决表

| 情况 | 路由 |
|---|---|
| PASS | → archive_success |
| ERROR（环境/依赖/系统异常） | → archive_fail（带诊断） |
| FAIL，不同签名（新问题） | → plan 重试 |
| FAIL，同签名连续第 1 次 | → plan 重试 |
| FAIL，同签名连续 ≥2 次，loop 预算有余 | → interrupt（走 askUser → plan） |
| FAIL，loop 预算耗尽 | → archive_max_retries |

**同签名检测**：独立可替换模块（接口：给定两次 review 的 critical_issues，返回布尔值）。初版用归一化精确匹配（标准化空白和标点），MinHash 相似度 >0.8 作为升级路径，接口设计上对具体算法是透明的。

**review 恢复路由**：review interrupt 的 answer 语义和 plan 不同。用户对 review 的回答通常是 redirect 性质："忽略这条 issue"或"按 X 约束重做"。恢复后 askUser → plan（重做计划），不是 repeat review。

---

## Section 3：Interrupt → 双通道渲染

### 3.1 Gateway 捕获 interrupt

Node 调用 `interrupt()` 时，LangGraph 抛出 `__interrupt__` 事件。Gateway 捕获后：

1. 写入 question 账本事件流（见 Section 4）
2. 广播 SSE：`{ type: "user_question", goalId, questionId, node, loop, questions }`
3. 文件幂等备份：`.mafw/user-questions/{goalId}/{questionId}.json`

### 3.2 双通道渲染

- **OpenCode 插件端**：Manager session 中直接展示 question 卡片。用户自然语言回答 → Manager 调 `mafw_answer_question`（中继路径，多一跳但保持聊天一致性）
- **MAFW Chat UI**：Desktop 前端 EventSource 收到 SSE → 渲染 question widget。用户填回答 → 前端直接 POST `/api/goals/{goalId}/questions/{questionId}/respond`（直连路径，低延迟）

**两条路径特征**：

| 路径 | 延迟 | 可靠性 | 适用 |
|---|---|---|---|
| Manager 中继 | +1 LLM round-trip | 低（manager 可能转述失真） | 澄清类 question |
| Widget 直连 | 即时 | 高 | 需要精确回答的问题 |

### 3.3 Respond API

```
POST /api/goals/{goalId}/questions/{questionId}/respond

Body:
{
  "type": "answer" | "cancel" | "redirect",
  "answer": "..."
}
```

处理逻辑：

| type | 行为 |
|---|---|
| `answer` | 校验 questionId 对应 question 状态为 pending → `Command({ resume: { answer } })` → graph 从 askUser 恢复 |
| `cancel` | question 账本标 cancelled + goal 标 cancelled + **不 resume** + checkpoint 文件保留（审计） + 线程从调度器注销 + SSE 通知客户端 |
| `redirect` | 同 answer，语义上向 plan 传递补充约束 |

响应：`{ status: "accepted" | "conflict" | "not_found" }`

---

## Section 4：Question 账本

### 4.1 存储格式 — 事件溯源（JSONL append-only）

```jsonl
{"type":"asked",     "questionId":"abc-123", "goalId":"goal-x", "node":"plan",  "loop":1, "questions":["..."], "askedAt":"2026-07-30T..."}
{"type":"answered",  "questionId":"abc-123", "answer":"用户原文", "answeredAt":"2026-07-30T..."}
{"type":"cancelled", "questionId":"abc-123", "cancelledAt":"2026-07-30T..."}
```

路径：`.mafw/question-ledger.jsonl`

### 4.2 当前态查询

按 questionId fold 事件流的最后一条记录，派生 `status`：
- 最后一条是 `asked` → `"pending"`
- 最后一条是 `answered` → `"answered"`
- 最后一条是 `cancelled` → `"cancelled"`
- 不存在 → 不存在

### 4.3 用途

1. **幂等仲裁**——相同 questionId 重复 respond → 检查当前态，已 answered/cancelled 返回 409
2. **Manager 工具**——`mafw_list_pending_questions` 读 jsonl fold 当前态，返回 pending 项列表
3. **UI 展示**——"这个 question 属于哪个 goal，当前状态是什么"

### 4.4 Boot Reconciliation

Gateway 重启时：

1. 扫描 question 账本中所有最后态为 `asked` 的 questionId
2. 逐个检查对应 thread 的 checkpoint 是否仍然处于 `__interrupt__` 状态
3. 一致的 → 重新广播 SSE（客户端可能在断线期间错过了）
4. 不一致的（checkpoint 已不存在但账本挂 pending）→ 标 orphaned → 写入一条 `{"type": "orphaned", ...}` 事件

这一步让 3.1 的文件备份在重启后有实际意义。

---

## Section 5：AutomationEngine 唤醒

### 5.1 路径统一

全部唤醒走 AutomationEngine 规则文件，不新造 ManagerWaker 模块。两种 trigger 类型：

```json
// 路径 A — cron 批量汇报
{
  "id": "manager-report-completed",
  "enabled": true,
  "trigger": { "type": "cron", "schedule": "*/5 * * * *", "timezone": "UTC" },
  "action": { "type": "manager:report_completed" }
}

// 路径 B — event 即时唤醒（失败/阻塞）
{
  "id": "manager-report-failed",
  "enabled": true,
  "trigger": {
    "type": "event",
    "on": ["goal.failed"],
    "perGoalCooldown": "60s"
  },
  "action": { "type": "manager:report_failed" }
}

// 路径 B' — awaiting_user（默认关闭）
{
  "id": "manager-report-question",
  "enabled": false,
  "trigger": {
    "type": "event",
    "on": ["goal.awaiting_user"],
    "perGoalCooldown": "60s"
  },
  "action": { "type": "manager:report_question" }
}
```

### 5.2 事件发射矩阵

| 归档节点 | 发射事件 |
|---|---|
| `archive_success` | `goal.completed` |
| `archive_fail` | `goal.failed` |
| `archive_max_retries` | `goal.failed` |

### 5.3 事件路径防护

Event 路径自带两层：

1. **perGoalCooldown**：同 goal 同类事件 N 秒内只触发一次
2. **状态去重**：唤醒前检查 goal 的 `(goalId, stateVersion)` 对是否已被汇报

**实现方式**：event trigger 注册在 eventBus 上。重启时重新注册；规则文件热重载时先 off 旧 listener 再 on 新 listener，防止 listener 翻倍。

### 5.4 去重标记

Goal state 文件加两个字段：

```typescript
// goal state 扩展
stateVersion: number;   // 单调递增计数器，每次状态迁移 +1
reportedAt: string | null;  // Manager 回合成功跑完后写入
```

去重判断：`({goalId}, stateVersion)` 对是否之前已被汇报。`reportedAt` **写入时机**：Manager session 该回合的 promptAsync 成功回复后才写——注入即写的话，LLM 回合失败会被误标为已汇报，cron 兜底失效。

### 5.5 唤醒排队 + 合并

```
wake prompt 到达时 Manager session 忙?
  是 → 进入 pending wake queue
  否 → 直接注入
  队列投递时:
    shift → 注入 → Manager 回复 → 写 reportedAt
    → 此时队首变为空 queue（合并：同一事件源只保留最新）
    → 继续 shift
```

不打断用户当前回合。Managr 回复完本次后自动消费排队的下一条。

### 5.6 唤醒 prompt 模板

```
[MANAGER SYSTEM WAKE] Goals updated. Active: N completed, M failed.
See mafw_get_goal_status for details. Do NOT fabricate results.
```

约 80 tokens。Goal 列表不内联——Manager 用工具查。

### 5.7 三个 action type

| action type | 用途 | 默认启用 |
|---|---|---|
| `manager:report_completed` | goal PASS → 唤醒汇报 | enabled |
| `manager:report_failed` | goal FAIL/ERROR → 唤醒汇报 | enabled |
| `manager:report_question` | pending question → 转述给用户 | **disabled**（卡片已直达 chat） |

用户可单独关闭。

### 5.8 AutomationEngine 前置重构

加 `manager:*` action 和 `'event'` trigger 前，先做：

1. `executeAction()`：switch 硬编码 → handler 注册表 `Map<string, (rule: AutomationRule) => Promise<void>>`
2. `validateRule()`：action 白名单 → 注册表 key set 动态校验
3. `AutomationRule.trigger`：单一 `{ type: 'cron' }` → union type `CronTrigger | EventTrigger`
4. `loadRules()` / `start()`：cron-only → 按 trigger type 分发（cron 走 scheduleRule，event 走 eventBus.on）
5. 新增 `executeRule()` 中 `action` handler 不匹配时的日志（非 fatal，跳过）

总改动量 ~80 行。

### 5.9 系统规则保护

Manager 唤醒规则是命脉。Gateway 启动时扫描 `.mafw/automations/`，若有 manager 规则缺失则从内置模板重建，但尊重用户显式设置的值。检测逻辑：

```
for id in ["manager-report-completed", "manager-report-failed", "manager-report-question"]:
  if !fs.existsSync(path) → write default from template
  else read existing: if enabled !== template.enabled → keep user's value
```

---

## Section 6：Manager Session 生命周期

### 6.0 核心原则

Manager session 不是任何状态的真相源：

| 状态 | 真相源 |
|---|---|
| goal 进度/phase/wave | LoopState + checkpoint |
| 待回答问题 | question 账本 |
| 历史汇报 | 事件日志 |
| 用户偏好和长期约定 | 记忆层（HarmonicIndex） |

### 6.1 Bootstrap

Manager session 创建时机：

1. 项目首次注册到 Gateway 时自动创建（`onRegister` 钩子）
2. 创建时注入 Manager Identity + 项目概览（目录结构摘要）
3. 用 Cognitive Router 选择模型（默认 Clade Sonnet）
4. session 元数据标记 `{ mafw: { role: "manager", pinned: true, exemptFromTrim: true, exemptFromEvict: true, exemptFromArchive: true } }`
5. Rail 渲染独立图标，置顶

**注意**：opencode session 和 MAFW chat UI 使用**同一个 sessionId**——不是各开一个。避免出现两个 Manager 实例。

### 6.1 L1 — 例行压缩

- **触发**：上下文用量 ~60% 时
- **保留**：identity 块（~1k tokens） + active goals 快照（~2k，DB 实时生成） + 最近 15 轮原文 + pending questions 全文 + 滚动摘要
- **压缩后立即重新锚定**：identity + 快照 + pending questions 重新注入，摘要只负责"聊过什么"
- **语义**：插入摘要消息，原文保留在库（opencode compact 语义，不删消息）

### 6.2 L2 — 会话轮换

- **触发**：压缩 ≥5 次，或用户手动 `/rotate`
- **执行**：归档旧 session → 开新 session → 注入 manager-handoff.json
- **handoff 内容**：

```json
{
  "handoverAt": "2026-07-30T...",
  "activeGoals": [...],           // mafw_list_goals 工具实时查询
  "pendingQuestions": [...],      // mafw_list_pending_questions 工具实时查询
  "userStandingPreferences": [...], // 记忆层检索
  "recentDecisions": [...],       // 旧 session 摘要提取
  "previousSessionId": "..."      // 回溯链接
}
```

Rail 上旧的 pin 位换给新 session，旧保留链接可回溯。

### 6.3 L3 — 记忆层

用户偏好、反复约定、"上次那个项目我们试过 X 不行"→ 产生即写入 `HarmonicUnit`。Manager 需要时通过 `mafw_search_hybrid` 检索。

### 6.4 UI 标记

- 压缩点：会话里渲染分隔线（"已压缩 · 查看摘要"）
- 轮换后：新 session 第一条消息为 handoff 摘要卡片
- 用户对"agent 还记得什么"必须可感知

### 6.5 禁止事项

- 不静默删消息（会断 parentID 链）
- 不只靠应急 compact（触发太晚，prompt 不知道 goalId 必须保留）
- 压缩 + 重新锚定必须是原子操作，中间不能有用户消息插入

---

## Section 7：与现有件咬合

| 已有件 | 新用途 | 改动量 |
|---|---|---|
| Phase Identity 注入机制 | Manager 第四种身份 | 配置新增（~30 行 yaml） |
| LangGraph + interrupt() | plan/review 节点内 HITL | LoopState +4 字段，graph.ts +1 节点 +2 条件边 |
| SSE event 系统 | `user_question` / `goal.completed` / `goal.failed` 事件 | +3 event type |
| AutomationEngine | event + cron 双路径唤醒 | trigger union type + handler 注册表（~80 行重构） |
| ChatSessionManager | SSE 流式传输 | **零改动**（传输层不变） |
| FileCheckpointer | 挂起状态持久化 | **零改动** |
| 记忆系统 (HarmonicIndex) | 长期记忆（L3） | **零改动** |
| SchedulerLedger | 审计 | **零改动** |
| CognitiveRouter | Manager model 选择 | **零改动** |
| Session metadata | pin/exempt 标记 | +4 新字段 |

---

## Section 8：新增代码清单

### Gateway — AutomationEngine

| 文件 | 类型 | 行数 |
|---|---|---|
| `automation-engine.ts` — handler 注册表重构 | 改 | ~40 |
| `automation-engine.ts` — event trigger 类型扩展 | 加 | ~40 |
| `automation-engine.ts` — `manager:*` action handler（3 个） | 加 | ~60 |
| `automation-engine.ts` — 系统规则保护 + 热重载修复 | 加 | ~30 |
| **小计** | | **~170** |

### Gateway — LangGraph

| 文件 | 类型 | 行数 |
|---|---|---|
| `loop-state.ts` — 扩展 draftPlan / pendingQuestion / userResponse / stateVersion | 改 | ~20 |
| `graph.ts` — +1 askUser 节点 + 2 条件边 + event 发射 | 改 | ~25 |
| `plan.node.ts` — HITL 分支逻辑 | 改 | ~30 |
| `review.node.ts` — 同签名检测 + HITL 升级逻辑 | 改 | ~35 |
| 同签名检测器模块 | 新 | ~25 |
| **小计** | | **~135** |

### Gateway — API + 账本

| 文件 | 类型 | 行数 |
|---|---|---|
| `index.ts` — question 账本读写 + respond API + boot reconcile | 加 | ~90 |
| **小计** | | **~90** |

### Gateway — Manager 工具

| 文件 | 类型 | 行数 |
|---|---|---|
| `core/tools/manager-goal.ts` | 新 | ~40 |
| `core/tools/manager-question.ts` | 新 | ~30 |
| `core/tools/manager-evidence.ts` | 新 | ~20 |
| 工具注册 | 改 | ~10 |
| **小计** | | **~100** |

### Config + Identity

| 文件 | 类型 | 行数 |
|---|---|---|
| `skills/manager-identity.yaml` | 新 | ~30 |
| `.mafw/automations/manager-report-completed.json` | 新（模板） | ~15 |
| `.mafw/automations/manager-report-failed.json` | 新（模板） | ~15 |
| `.mafw/automations/manager-report-question.json` | 新（模板） | ~15 |
| `config.ts` — Manager session bootstrap 配置 | 改 | ~10 |
| **小计** | | **~85** |

### Desktop（`mafw-desktop/` / `frontend/`）

| 文件 | 类型 | 行数 |
|---|---|---|
| Question widget 组件（渲染 + respond 提交逻辑） | 新 | ~80 |
| Session pin UI（Rail 独立图标 + 置顶 + 未读标记） | 加 | ~50 |
| 压缩分隔线 + 点击"查看摘要"交互 | 加 | ~40 |
| Handoff 摘要卡片组件 | 新 | ~50 |
| EventSource 扩展（接 `user_question` 事件） | 改 | ~15 |
| **小计** | | **~235** |

### 总计

| 层 | 行数 |
|---|---|
| Gateway — AutomationEngine | ~170 |
| Gateway — LangGraph | ~135 |
| Gateway — API + 账本 | ~90 |
| Gateway — Manager 工具 | ~100 |
| Config + Identity | ~85 |
| Desktop | ~235 |
| **总计** | **~815** |

---

## Section 9：风险与缓解

| 风险 | 缓解 |
|---|---|
| **Manager 状态幻觉**（凭记忆报进度） | Identity 约束（"只能从工具查询"）+ 唤醒 prompt 只给 goalId 列表不给状态数据 |
| **双重控制**（用户同时跟 Manager 聊 + 手动操作 goal） | 状态在 Gateway，Manager 只是客户端之一，不影响正确性 |
| **事件路径唤醒风暴** | perGoalCooldown 60s + (goalId, stateVersion) 去重 |
| **interrupt 节点重跑时 draft 丢失** | plan 节点检测 draftPlan 已存在时跳过重新生成；pendingQuestion 显式 return（非 mutation）写入 checkpoint |
| **question 重复 respond** | 账本事件溯源 + 按 questionId fold 当前态，已 answered/cancelled 返回 409 |
| **Manager session 上下文爆炸** | L1 例行压缩 + L2 轮换 + L3 记忆层 |
| **系统规则被误删** | 启动时检测缺失则从模板重建，尊重 explicit disable |
| **question 账本损坏** | JSONL append-only + 文件备份 + boot reconcile 自动修复不一致 |

---

## 附录 A：LoopState 完整定义

```typescript
import { Annotation } from "@langchain/langgraph";

export const LoopState = Annotation.Root({
  // 现有字段
  goalId: Annotation<string>({ value: (a, b) => b ?? a }),
  projectDir: Annotation<string>({ value: (a, b) => b ?? a }),
  mafwDir: Annotation<string>({ value: (a, b) => b ?? a }),
  round: Annotation<number>({ value: (a, b) => b ?? a ?? 0, default: () => 1 }),
  maxRounds: Annotation<number>({ value: (a, b) => b ?? a ?? 0, default: () => 3 }),
  wavePlanPath: Annotation<string | null>({ value: (a, b) => b ?? a, default: () => null }),
  receiptPath: Annotation<string | null>({ value: (a, b) => b ?? a, default: () => null }),
  reviewVerdict: Annotation<"PASS" | "FAIL" | "ERROR">({ value: (a, b) => b ?? a, default: () => "FAIL" as const }),
  reviewReportPath: Annotation<string | null>({ value: (a, b) => b ?? a, default: () => null }),
  reviewFeedback: Annotation<string>({ value: (a, b) => b ?? a, default: () => "" }),
  lastError: Annotation<string | null>({ value: (a, b) => b ?? a, default: () => null }),
  phase: Annotation<string | null>({ value: (a, b) => b ?? a, default: () => null }),

  // v7.0 新增：HITL
  draftPlan: Annotation<any>({ value: (a, b) => b ?? a, default: () => null }),
  pendingQuestion: Annotation<{
    questionId: string;
    node: "plan" | "review";
    loop: number;
    questions: string[];
    askedAt: string;
  } | null>({ value: (a, b) => b === undefined ? a : b, default: () => null }),
  userResponse: Annotation<{
    questionId: string;
    answer: string;
    respondedAt: string;
  } | null>({ value: (a, b) => b === undefined ? a : b, default: () => null }),

  // v7.0 新增：去重
  stateVersion: Annotation<number>({ value: (a, b) => b ?? a ?? 0, default: () => 0 }),
});

export type LoopStateType = typeof LoopState.State;
```

## 附录 B：修正后的 Graph 定义

```typescript
export function buildExecutionGraph(options: GraphOptions) {
  const workflow = new StateGraph(LoopState)
    .addNode("plan", options.plan, { retryPolicy: { maxAttempts: 2 } })
    .addNode("askUser", options.askUser)                    // ★ 新增
    .addNode("execute", options.execute, { retryPolicy: { maxAttempts: 2 } })
    .addNode("review", options.review, { retryPolicy: { maxAttempts: 2 } })
    .addNode("archive_success", options.archiveSuccess)
    .addNode("archive_fail", options.archiveFail)
    .addNode("archive_max_retries", options.archiveMaxRetries)

    .addEdge("__start__", "plan")
    .addConditionalEdges("plan", routeAfterPlan, {          // ★ 改：不再直连 execute
      askUser: "askUser",
      execute: "execute",
    })
    .addEdge("askUser", "plan")                              // ★ 新：恢复后回 plan 精化
    .addEdge("execute", "review")
    .addConditionalEdges("review", routeAfterReview, {
      plan: "plan",
      archive_success: "archive_success",
      archive_fail: "archive_fail",
      archive_max_retries: "archive_max_retries",
    })
    .addEdge("archive_success", END)
    .addEdge("archive_fail", END)
    .addEdge("archive_max_retries", END);

  return workflow.compile();
}

export function routeAfterPlan(state: typeof LoopState.State): string {
  if (state.pendingQuestion) return "askUser";              // ★ 新
  return "execute";
}

export function routeAfterReview(state: typeof LoopState.State): string {
  if (state.reviewVerdict === "ERROR" || state.lastError) return "archive_fail";
  if (state.reviewVerdict === "PASS") return "archive_success";
  if (state.round >= state.maxRounds) return "archive_max_retries";
  if (state.pendingQuestion) return "askUser";              // ★ 新：review 升级 interrupt
  return "plan";
}
```

## 附录 C：EventTrigger 接口扩展

```typescript
interface CronTrigger {
  type: "cron";
  schedule: string;
  timezone: string;
}

interface EventTrigger {
  type: "event";
  on: string[];              // 事件名列表，如 ["goal.failed", "goal.completed"]
  perGoalCooldown: string;   // "60s" / "5m"
}

type Trigger = CronTrigger | EventTrigger;

interface AutomationRule {
  id: string;
  enabled: boolean;
  trigger: Trigger;
  action?: { type: string };
  skill?: string;
  args?: Record<string, any>;
  onResult?: { type: "triage" | "goal"; auto_confirm?: boolean; template?: string };
  goal_defaults?: { maxLoops?: number; metrics?: Record<string, { target: number; unit: string }> };
}
```
