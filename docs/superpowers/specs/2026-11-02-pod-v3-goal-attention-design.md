# Pod v3：Goal 入口、授权边界与人类注意力模型设计

- 日期：2026-11-02
- 状态：设计定稿，待用户批准后进入实施计划
- 前置调研：
  - `docs/research/2026-11-02-pod-usage-logic-audit.md`
  - `docs/research/2026-11-02-dsh-superagent-vs-mafw-pod.md`
  - `docs/research/2026-11-02-agent-loop-architectures.md`
- 前置实现：`2026-10-29-project-pod-lite-design.md` 至 `2026-11-02-pod-task-add-delete-design.md`

## 1. 意图

Pod 已经有确定性 Goal 编排、任务投影、A2A、邮箱、评审与项目记忆，但用户无法从 Pod 完成最自然的主线：

> **交给团队一个目标 → 离开时继续工作 → 只在真正需要我时出现 → 回来看到可信结果。**

当前问题是三层不一致：

- 产品叙事是「固定三人团队」；
- 执行是单 active Goal 的串行 plan→execute→review；
- 前端平铺 roster、raw goal id、task、mailbox、memory，没有统一工作入口与正确的人类注意力模型。

v3 的目标不是增加 agent 数量，而是让现有能力形成一个可理解、可信任的产品。

### 一句话定位

**Pod 是项目里可长期托付目标的团队入口；底层继续用确定性工作流保证每个目标可验收、可审计。**

## 2. 用户已确定的方向与本文设计取舍

### 已确定

- Pod 是项目级固定班底，不改成大规模动态 swarm；
- 左栏只读，主要发送/操作集中在右侧；
- 任务与长期记忆分层，任务状态不自动写入谐波记忆；
- 参考 DeepSeek `dsh-superagent-prototype` 的工作生命周期与注意力模型；
- 本批先收敛 Goal 入口与状态模型，**不改并行执行架构**。

### 本文的设计取舍（未当作用户额外要求）

1. **保留 Goal 名词**，不全局改名 Ticket/Mandate/Assignment；只借鉴语义。
2. **提供 Pod 内 Goal composer**，而不是强迫用户跳到 Lead 聊天；Lead 对话与 composer 最终调用同一 Goal intake。
3. **waves task 只是 Goal 内部计划步骤**；manual task 在 UI 改为「备注」，不再默认暗示会执行。
4. **阶段由 gateway 纯函数投影**，桌面不自行拼 nextAction/任务状态。
5. **Reviewer 工作不等于人类待审**；badge 只计真正的人类阻塞动作，未读消息单独显示。
6. **不默认增加最终人工验收门**；完成的 PASS Goal 是「最近结果」，不阻塞队列。
7. **「休眠」改为真实「暂停自动推进」**：当前节点允许完成，不启动后续节点或新 Goal；「停止 Goal」仍是独立 destructive action。
8. 本批顺带修会直接破坏上述语义的正确性问题，不实施完整 Outbox、follow-up ownership 或 proactive Eval。

## 3. 目标与非目标

### 目标

- 从 Pod 创建/排队 Goal，创建 Pod 后立即可以交付第一个目标。
- 用同一个服务端读模型回答：当前工作是什么、进行到哪、谁需要行动、下一步是什么。
- 计划批准、提问、失败/阻断等人类阻塞点进入「需要你」与 rail badge。
- Reviewer review、execute 等团队内部状态不再冒充人类待办。
- Goal 标题、阶段、verdict、结果与证据替代 raw id 成为主展示。
- manual、A2A、waves 的执行边界清楚；不存在默认创建但永不执行的「工作」。
- 休眠、失败、广播、plan schema、任务收口和 Pod 记忆截断不再与 UI 承诺冲突。

### 非目标

- 多 active Goal、多 Builder、worktree fan-out、动态 specialist；
- 完整 Source/Trigger/Eval/Policy/Mandate 体系；
- proactive auto 找活；
- 全量 durable Effects/Outbox；
- follow-up owner/handback 全生命周期；
- Reviewer 异模型、成员级预算；
- 重写 NodeDriver 或让 Lead 取代状态机；
- TUI Pod 面板；
- 大规模视觉换皮。

## 4. 核心领域模型

### 4.1 权威边界

| 对象 | 权威 | 用户语义 |
|---|---|---|
| Pod | 项目级协调与持久上下文 | 项目团队入口 |
| Goal | 一件被托付、可执行和验收的工作 | 用户交付工作的唯一单位 |
| Goal authorization | Goal 的来源、请求方式与范围 | 为什么可以做、做什么 |
| waves task | Goal 当前轮的内部计划步骤 | 不是独立工作入口 |
| note | 不进入执行器的项目备注 | 仅记录，不占执行待办 |
| A2A request | 外部工作请求 | 本批仍不自动变成计划步骤 |
| node run | 一次 plan/execute/review 执行 | 可重试、可审计的执行记录 |
| receipt/review | 结构化执行与验收事实 | 决定 Goal 阶段与结果 |
| message | 协调日志与 handoff | 不直接等于人类待办 |
| Pod memory | 项目约定、术语与决策 | 不保存任务板状态 |

### 4.2 Goal authorization（轻量版）

本批只记录，不实现完整 Policy：

```ts
type GoalAuthorization = {
  source: 'desktop' | 'lead' | 'a2a' | 'automation' | 'user'
  requestMode: 'explicit' | 'inferred'
  scope?: string
}
```

规则：

- Pod composer 与 Lead 明确创建：`requestMode='explicit'`；
- 本批 UI/API 不接受 `inferred` 自动执行；预留给未来 observe→auto；
- authorization 写入 `requests/<goalId>.json`，供 state/详情读取；
- 不用 prompt 文本代替执行授权；授权字段由 gateway 写入；
- A2A 本批保持现有协议行为，但 UI 标为「外部请求」，不能把它显示为已纳入 waves 的执行工作。

### 4.3 Goal composer 是唯一新增工作入口

Pod 主按钮：**交给团队一个目标**。

字段：

- `title`：短标题，必填；
- `objective`：目标/背景，必填，进入 charter；
- `acceptance[]`：可选，目标级期望结果；写入 request 与 charter，plan prompt 必须把它分解为 wave task acceptance；v3 不另设第二套 Goal 级判分器，最终 verdict 仍以 wave rubric 为准；结果页同时展示原始目标验收与逐任务证据；
- `boundaries[]`：可选，约束；
- `planReview`：`auto | manual`，缺省沿用现状 `auto`；UI 提供「计划完成后先让我确认」。

不暴露：waveId、node、sourceKey、ownerMemberId、taskId。

提交后：

- 生成 goalId 与 request/charter；
- `source='desktop'`、`requestMode='explicit'`；
- 走统一 Goal intake，再进入现有 Pod 单 active 队列；
- 返回 `started | queued`；queued 时明确「当前 Goal 完成后自动开始」；
- 不提供 start-now 插队按钮。

Lead 对话创建 Goal 继续可用，但必须复用同一 intake 服务，不能形成第二套文件写入逻辑。

## 5. 统一 Goal intake

新增应用层 `GoalIntakeService`（名称可由实现者按现有结构微调），从 `mcp/handlers/create-goal.ts` 抽取公共能力：

- 校验 project/goalId/title/charter/boundaries/planReview；
- 写 charter 与 request；
- 记录 authorization；
- 发射 `goal_created`；
- 返回 goalId 与队列状态。

两个调用面：

1. 现有 MCP `mafw_create_goal`；
2. 新 `POST /api/pods/:podId/goals`。

**禁止在路由里复制一份 create-goal 文件写入逻辑。**

### API

```http
POST /api/pods/:podId/goals
{
  "title": "修复 Pod 状态语义",
  "objective": "……",
  "acceptance": ["……"],
  "boundaries": ["不改并行架构"],
  "planReview": "manual"
}

200 {
  "goalId": "……",
  "status": "started | queued",
  "queueReason": "active_goal | paused | archived | budget | null",
  "goal": PodGoal
}
```

错误：Pod/项目不存在 404；参数错误 400；重复 goalId 409（若服务端自动生成则仅内部冲突）。

SDK/preload 增加 `pod.createGoal`。

## 6. 服务端阶段投影

### 6.1 原则

参考 DeepSeek Super-agent 的 Ticket stage 与 DeepSeek Harness 的 session projection：

- 领域侧根据已提交事实计算完整读模型；
- 客户端消费成品值，不折叠内部事件、不猜状态；
- 阶段互斥且覆盖所有情况；
- `person` 仅表示没有人动作就无法继续当前 Goal；
- label 由前端根据稳定 code 本地化，gateway 不下发中文硬编码。

新增纯模块，例如 `core/pod/pod-stage.ts`：

```ts
type PodGoalStage = {
  owner: 'person' | 'team' | 'system'
  kind:
    | 'plan_approval'
    | 'question'
    | 'blocked'
    | 'queued'
    | 'working'
    | 'waiting'
    | 'ended'
  queueReason?: 'active_goal' | 'paused' | 'archived' | 'budget' | 'state_error'
  action?: {
    type: 'open_plan_review' | 'open_question' | 'open_goal' | 'open_result'
    goalId: string
    questionId?: string
  }
}

type PodGoalResult = {
  ready: boolean
  verdict: 'PASS' | 'FAIL' | 'MAX_RETRIES' | 'ERROR' | 'CANCELLED' | null
}
```

输入为 GoalState、PodGoal、队列原因、投递失败等结构化事实；不得从自由文本猜「等待人」。

### 6.2 失败分类与队列语义

**Loop 中间 review FAIL 不是终态**：先同轮修复一次，再进入下一轮；不产生失败结果，也不需要人决定队列。

终态必须区分：

| 终态 | 含义 | 队列 |
|---|---|---|
| PASS | 验收通过 | 继续下一 Goal |
| MAX_RETRIES | 多轮自主尝试后仍未达成 | 记录未达成结果，继续下一 Goal |
| ERROR | 技术/契约失败（session、timeout、artifact 等） | 记录技术失败，继续下一 Goal |
| FAIL | 非 MAX_RETRIES 的业务失败/拒答等 | 保留具体原因，继续下一 Goal |
| CANCELLED | 用户主动取消 | 继续下一 Goal |

终态失败进入「最近结果 / 结果待处理」，**不进入会永久占用 badge 的 attention**。结果动作是「查看证据」或「基于失败反馈重新提交」，不是把已终止 Goal 当作仍可 advance 的活跃 Goal。现有非终态 node retry 保留。

`executeArchive` 必须保留 ERROR 与 MAX_RETRIES，不得把所有 `archive_fail` 都记成 FAIL。

### 6.3 阶段优先级

| 顺序 | 条件 | owner / kind | UI |
|---|---|---|---|
| 1 | 已终止 | system / ended | 按真实 verdict 展示结果 |
| 2 | `AWAIT_PLAN_APPROVAL` 且 approval=pending | person / plan_approval | 等待你批准计划 |
| 3 | pendingQuestion / ASKING_USER | person / question | 等待你回答 |
| 4 | 非终态 state 损坏/缺失，无法自动推进 | person / blocked | 需要处理/重试 |
| 5 | queued | team / queued + queueReason | 说明真实等待原因 |
| 6 | nodeSession/可继续执行 | team / working | 规划/执行/团队复核中 |
| 7 | 暂停自动推进、等待后续显式请求 | system / waiting | 已暂停/等待触发 |

队列原因不得一律写成「当前 Goal 完成后开始」：

- `active_goal`：可以这样说；
- `paused/archived`：显示已暂停；
- `budget`：显示等待预算，不冒充人工阻塞；
- `state_error`：进入 person/blocked；
- 无 queueReason 的 legacy queued 回退 active_goal 仅当确实存在其他 active Goal。

`result.ready` 与 stage 分开：

- 终态且已有 outcome + 至少一份 receipt/review/artifact/结果说明可读 → `ready=true`；
- 本批不引入 viewed/ack 状态，因此 UI 用「最近结果」，不声称精确未读数；
- Reviewer 正在 review → `team/working`，绝不进入「需要你」。

### 6.4 PodGoal DTO

向后兼容新增：

```ts
interface PodGoal {
  // 既有字段保留
  title: string
  phase: string | null
  verdict: 'PASS' | 'FAIL' | 'MAX_RETRIES' | 'ERROR' | 'CANCELLED' | null
  stage: PodGoalStage
  resultReady: boolean
}
```

`PodDetail` 新增：

```ts
attention: Array<{
  id: string
  goalId: string
  kind: 'plan_approval' | 'question' | 'blocked'
  title: string
  action: PodGoalStage['action']
}>
```

- attention 仅由 `owner='person'` 且未终止的 Goal 生成；
- unread、resultReady、queued budget 均不进入 attention；
- 同一 Goal 只产生一个最高优先级 attention。

### 6.5 数据获得与结果证据

优先复用 `findGoalStatePath/loadGoalState` 和 archive outcome，在 read model 组装时解析标题/phase/stage；不得让桌面分别读取 state 文件。

`pod_goals` 增 `verdict` 持久字段（additive migration），archive 时记录真实 outcome：

- `status` 只表达队列生命周期：queued/active/done/aborted；
- `verdict` 表达验收结果，包含 MAX_RETRIES；
- legacy `done + verdict=null` 显示「已结束」，不猜 PASS；
- FAIL/MAX_RETRIES/ERROR 不得显示「完成」。

逐任务 evidence 不复制进 `pod_tasks`：review report 仍是权威。新增 `GET /api/pods/:podId/goals/:goalId/result`，按需返回解析后的 review rubric、receipt、artifact refs、原始 Goal acceptance 与最终 verdict；任务板只保留状态镜像，结果页从该 endpoint 取证据。

## 7. 暂停、停止、重试

### 7.1 暂停自动推进

Pod UI 用 `paused ↔ active`，移除 active↔idle 的「休眠/唤醒」按钮。

暂停语义：

- 不启动新 Goal；
- 不 promote queued Goal；
- 当前正在执行的节点允许完成并写产物；
- 节点完成后不创建下一个节点 session；
- 消息、回执、review 等事实继续记录；
- 不强制 abort 当前 turn。

恢复语义：

- 有 active Goal 且停在某节点之间 → 从持久 state advance；
- 无 active Goal 且有 queued → 按 FIFO promote；
- 不重复执行已完成节点。

暂停期间的边界：

- 批准计划/回答问题：**接受并落库，但不 advance**；UI 显示「已记录，恢复后继续」，不能返回 409 丢失用户输入；
- 当前节点完成后若路由到 archive：允许归档与记录结果，但不 promote 下一 Goal；
- watchdog/recovery 可探测、终止死 session、保存可恢复状态，但 paused 时不得重启节点；
- legacy per-goal `PAUSE` 必须接入同一 advance gate，不能继续成为第二套无效暂停；Pod paused 与 Goal paused 的作用域在 UI 分开。

实现门应位于 NodeDriver 创建下一节点前与 PodGoalService enqueue/promote，而不是只改 Pod status 字段。

### 7.2 停止/取消 Goal

- active Goal 沿用 ABORT/CANCELLED；destructive 两步确认；
- queued Goal 提供「取消排队」：将 PodGoal 标为 aborted + verdict=CANCELLED，不创建/启动 state；不运行 NodeDriver archive；
- 取消 queued 不得误触发另一个 queued Goal 之外的 state 写入，也不得影响 active Goal；
- Pod 路径与 Dashboard 使用相同确认组件与语义；
- 停止与暂停不得共用图标或文案。

### 7.3 重试与重新提交

- 非终态 node retry 只暴露已有能力，要求 `confirm:true`；
- 已终止 FAIL/MAX_RETRIES/ERROR 的结果提供「基于失败反馈重新提交」：创建新 Goal，携带原 Goal 引用与反馈，不伪造对已终止 Goal 的 advance；
- 本批不实现新的 Assignment/Executor 模型。

## 8. 任务与备注

### 8.1 类型显式化

`PodTask` 增加只读 `kind`：

```ts
kind: 'plan' | 'note' | 'external_request'
```

由 gateway 根据 sourceKey/goalId/externalTaskId 派生，客户端不解析 sourceKey。

### 8.2 Plan task

- 任务板只表示**选中 Goal 的当前轮计划**，默认 active Goal；本批不做 round 历史表或 round 选择器；历史轮次从结果页的 receipt/review 文件查看；
- 新建「加入计划」仅在计划可编辑时出现；
- 无可编辑 Goal 时禁止提交，不得退化为 note；
- owner 未实现前不显示「系统」或成员任务数；
- acceptance 与 artifact refs 可直接查看；rubric evidence 在结果页按需从 review report 读取，不必先进入编辑，也不复制进 pod_tasks；
- 运行中/终态不显示编辑删除按钮，取代点击后的 409。

### 8.3 Note

- UI 文案改为「备注」，不再叫手工任务；
- 可编辑标题、可删除；
- 不计入执行待办、成员任务数或「需要你」；
- 与计划任务分区，不进入五态执行泳道；
- 既有 manual 行保留，按 kind=note 展示，无需数据迁移。

### 8.4 External request

- 单独标为「外部请求（未纳入执行计划）」；
- 不计入 plan task 进度；
- 本批不改变 A2A tasks/get/cancel 协议；统一 admission 留后续。

## 9. 人类注意力与左侧 rail

### 9.1 三组信息分开

| 信息 | 含义 | 是否进主 badge |
|---|---|---|
| attention | 没有人就无法继续 | 是 |
| unread | 有未读协调消息 | 否，单独 inbox 数 |
| resultReady | 有可查看结果 | 否，主面板结果区 |

rail badge 只计算 attention 数；>9 仍显示 9+。

### 9.2 左栏只读面

顺序：

1. **需要你**：attention 数及最高优先级项；
2. **当前 Goal**：标题 + 阶段，不显示 raw id/status 英文；
3. **团队复核中/执行中**：team 状态；
4. **最近结果**：最近完成项；
5. 最近消息摘要与 unread；
6. 进入右侧的明确链接。

移除没有真实生产者的成员任务数和 waiting 标签。计数点击必须打开相同过滤条件的列表，count=list.length。

## 10. 右侧 Pod 信息架构

不再把 status→members→queue→board→inbox→memory 全部放在一个长滚动列。

### 默认「工作」面

1. 主按钮「交给团队一个目标」；
2. 需要你；
3. 当前 Goal（标题、阶段、下一动作、暂停/停止）；
4. 当前 Goal 的计划步骤与验收证据；
5. 排队与历史（标题 + 真实 verdict）；
6. 备注。

### 「团队」面

- Lead/Builder/Reviewer 职责；
- 当前/最近 session；
- 打开快照；
- 直接介入入口（如保留）必须说明会改变执行并记录协调日志；
- 邮箱与投递状态。

### 「记忆」面

- 项目约定与近期 decisions 优先；
- 原始 POD/POD_MEMORY/GLOSSARY 编辑为高级操作；
- 覆盖风险提示。

### 「结果」面/Goal 详情

- 目标与授权来源；
- plan/acceptance；
- 每任务 rubric 结果与 evidence；
- receipt/artifact 链接；
- 最终 verdict；
- 可执行下一动作（重试、查看会话、返回队列）。

## 11. 必配套正确性修复

### C1 广播投递

新增 per-recipient delivery 记录（建议表 `pod_message_deliveries`）：

```text
message_id, member_id, session_id, delivered_at,
status, attempts, last_error, next_retry_at,
PRIMARY KEY(message_id, member_id)
```

- direct 与 broadcast 都按接收成员结算；
- `pendingForSession(member)` 只排除该成员已投递的消息；
- broadcast 被第一人消费后，其他成员仍 pending；
- legacy delivered broadcast 迁移时对当时 roster 补 delivered，避免升级后重复回放；
- `readAt` 仍是展示侧已读，不与 agent delivered 混用。

**pending/pull-by-design 不是失败。** 当前节点不会等待普通 mailbox 才能继续，因此本批不存在「Goal-blocking 普通邮件」类型；所有邮件硬失败（连续 3 次或永久拒绝）只进入**系统健康**，不产生 person attention，也不点亮主 badge。团队在「团队 › 邮箱」中可 retry/dismiss；成功或 dismiss 后清除该健康问题。重试退避沿用现有策略，本批不实现完整 Outbox。

### C2 Plan structured schema

- `waves.tasks[]` 支持字符串 legacy 与 `{title,acceptance?,taskId?}`；
- structured output 与文件解析共用同一任务契约；
- plan 完成继续 `ensureWaveTaskIds`；
- acceptance 不再因 structured 主路径被 schema 拒绝。

### C3 Review/archive 状态

- 新增终态 `skipped`（UI「已跳过」），不再映射 failed；
- archive 不改动 skipped；
- FAIL Goal 保留失败任务与证据；PASS 不留永久红卡；
- 无 rubric 的 FAIL 不得把已 pass/done 的任务无证据翻回 reopened；粗粒度回退只处理当时仍 open 的任务。

### C4 Pod memory 预算

总预算仍 4096 字符：

- 近期 decisions 最多先取 1600；这是上限/保留权，不是固定占用；
- 未使用的 decisions 额度必须返还给 POD/POD_MEMORY/glossary，无 decisions 时稳定文件仍可用满 4096；
- 稳定文件按 POD/POD_MEMORY/glossary 顺序共享剩余额度；
- 截断必须带明确 marker；
- decisions 不得因稳定文件先占满而被静默吃掉。

### C5 Force notify

- mailbox notify 不再强行写入运行中的节点 session；
- coordination session 可即时/queue 投递；节点 session 保留下次 prompt handoff；
- 「直接介入」是独立显式动作，不伪装成普通邮件提醒。

### C6 误导性 dead data

- ownerMemberId 未接线前，隐藏成员任务数与 owner「系统」；
- waiting 无生产者时不展示；
- raw goal/session/agent id 移到折叠详情。

## 12. 兼容与迁移

- `PodGoal`、`PodTask`、`PodDetail` 只新增字段；旧 gateway 缺字段时桌面使用明确「旧版不支持阶段投影」降级，不自行伪造 stage。
- `pod_goals.verdict` additive；旧值 null。
- manual 行不迁移，按 note 展示。
- 新 delivery 表按上述 legacy 规则回填，防止广播重复投递。
- `sleep/wake` API 可暂时保留兼容；桌面不再调用 sleep 伪装暂停。其语义文档标为 legacy，后续版本再移除。
- `pods.tasks.delete` 等 v2 契约保持不变。
- route catalog → `emit:openapi` → SDK contract 重新生成，禁止手改生成物。

## 13. 测试与验收（设计层）

实施按 TDD，先写以下测试再改实现。

### 纯函数

- stage 优先级全覆盖：plan approval/question/blocked/queued/working/waiting/ended；
- Reviewer review 永不产生 person attention；
- PASS resultReady 不阻塞下一 Goal；
- legacy verdict=null 显示 ended 而非 PASS；
- task kind 三分；
- `classifyNodeFailure` 四通道、errorCode/lastFailure 与 attempt/round 语义；
- no-progress 计数、清零与第三次转 question；
- 回答注入正确 resumeNode，合法产物前可重放、完成后 consumed；
- 随机 approvalId 的重复/跨轮/过期/新 plan 失效/legacy 一次性兼容；
- Pod memory 预算与 decisions 保留。

### 服务

- composer 与 MCP 共用 intake，文件/request/authorization 一致；
- started/queued；
- 暂停不启动下一节点，恢复不重复节点；
- FAIL 保留 verdict；
- 广播三个成员分别消费；
- skipped/archive 状态；
- note 删除；
- force notify 不进入运行节点。

### 路由/契约

- `POST /api/pods/:podId/goals`；
- actor/Lead 权限与项目边界；
- 新 DTO 字段；
- catalog/contract 无 dead route。

### 桌面

- 创建 Pod 后可立即交目标；
- badge=attention，unread/resultReady 不计；
- count 与过滤列表一致；
- 无计划时加入计划不会降级为 note；
- FAIL 不显示完成；
- raw id 不出现在主展示；
- acceptance/artifact/evidence 可直接查看；
- 暂停/停止文案与行为一致。

### 全量门禁

- gateway `tsc` + 全量 jest；
- desktop `tsgo -p` + 全量测试 + electron-vite build；
- SDK 测试 + build + contract；
- 交付时报告新增测试数、全量通过数、版本号与 commit。

## 14. Loop 控制补强（来自 Codex / Claude / LangGraph 对照）

本批不引入新图框架，只对现有 NodeDriver 补以下契约。

### 14.1 失败分类先于 failNode

新增纯函数 `classifyNodeFailure`，输入是 runtime errorCode、artifact 错误码、node/attempt，而不是对 message 做模糊文本匹配：

- `retryable_environment`：仅明确白名单中的 provider/network 408/429/5xx、临时 spawn/写入错误；同 round、attempt+1，受 maxAttempts 限制；
- `terminal_contract`：artifact 缺失/非法、rubric 不可解析等契约错误；不盲目重试，记录 ERROR；
- `terminal_session`：session/timeout 在 attempt 耗尽后的技术失败；记录 ERROR；
- `business_review`：review FAIL，继续走现有 reviewFix/replan，绝不进入 failNode。

未知 runtime 错误默认 terminal_session，不为了「可能可恢复」而盲烧重试预算。driver 必须在 `onSessionError` 中保留 errorCode。

`GoalStateV3` 增加结构化 `lastFailure`：

```ts
lastFailure?: {
  class: 'retryable_environment' | 'terminal_contract' | 'terminal_session'
  code: string
  message: string
  node: 'plan' | 'execute' | 'review'
  attempt: number
  at: string
} | null
```

`lastError` 继续用于显示/兼容；节点 run 保存失败历史，合法产物完成后清除当前 lastFailure。不得用一个 archive_fail 把它们全写成同一种 FAIL。

### 14.2 attempt 进入节点上下文

重试 prompt 必须包含：当前 attempt、maxAttempts、上次结构化 `lastFailure`、已有产物/工作区提示。

- 节点先检查已有文件与产物，再决定增量工作；
- 不假设上次副作用被回滚；
- 不用同一份 prompt 让模型机械复读；
- attempt 不增加 round，预算不重置。

### 14.3 反 spin 与求助

保留现有 sameSignature 检测，并增加 host 计算的 no-progress 计数：连续节点结束没有产物变化、没有有效新证据或重复同类技术失败时计数。

- 连续 3 次 no-progress → 进入 pendingQuestion，说明阻塞与需要的决定；
- 有有效产物/证据推进则清零；
- 缺少用户输入时走现有 askUser，不新增一个假装终态的 BLOCKED；
- 达到 maxRounds 才形成 MAX_RETRIES；达到节点 attempt 上限才形成技术 ERROR。

### 14.4 显式批准与恢复

- 每份新 plan 被接受时生成**随机 opaque `approvalId`**并保存在当前 `planApproval`；approve/reject 必须同时匹配当前 pending id；decision、出现新 plan 尝试/产物、进入终态都会使其失效；重复、跨轮、过期返回 409；不得用 goalId+round+stateVersion 推导新 id；
- legacy 只指升级前已存在且 `planApproval` 记录本身无 id 的在飞批准：允许按 goalId+round 兑现一次并立即标记 decided；凡当前记录含 id 而请求缺 id，一律 409，不能走 legacy 旁路；
- pending question 继续以 questionId 为排他锚点；
- 暂停时接受回答/批准但只落库，恢复时按同一 id 继续，不重复执行；
- 终态后重新提交是新 Goal、新预算；原 Goal 不复活。

### 14.5 恢复与幂等

- 保持产物优先；节点未完成但产物已合法落盘时可兑现；
- 所有 request/response/approval/retry 都以显式 id 幂等；
- state/产物原子写；
- 恢复不把 queued 当 delivered，不把 delivered 当 handled；
- 本批不承诺恢复运行中的工具调用或后台任务，只承诺从持久 Goal/产物继续。

### 14.6 提问回答必须进入恢复节点

`PendingQuestion` 增加明确的 `resumeNode: 'plan' | 'execute' | 'review'`，`node` 保留为提问来源；不能再由 handleAnswer 一律硬编码 plan。

- 既有 plan clarification / review「是否继续重试」默认 resumeNode=plan，保持现状语义；
- 新增 no-progress 提问恢复到被卡住的节点（可为 execute/review）；
- `userResponse` 保存 questionId、原问题、回答、resumeNode、respondedAt；
- 下一次对应节点 prompt 必须同时注入原问题与回答，并携带 lastFailure/上次评审反馈；
- 回答只有在该恢复节点产出合法产物后才标记 consumed；崩溃或 attempt 重试时仍可重放，避免先清回答再丢工作；
- 暂停期间只写 userResponse 与 nextNode=resumeNode，不 advance；恢复后按该节点继续。

## 15. 后续（不在本批批准范围）

- follow-up owner / handback / handled；
- durable Effects / Outbox；
- Goal×workspace×Assignment 与人类介入优先槽；
- 依赖自动解锁、多 Builder×worktree；
- Source/Trigger/Eval 主动工作，默认 observe；
- specialist 与 Reviewer 异模型；
- Lead/Curator 归纳式 Pod 记忆。

## 16. 设计验收标准

本批完成时，新用户不需要知道 wave/node/sourceKey，即可：

1. 创建 Pod 并交付一个 Goal；
2. 看懂它在排队、规划、执行还是团队复核；
3. 在计划批准或提问时看到明确 badge 和动作；
4. 暂停自动推进并安全恢复；
5. 区分备注、计划步骤和外部请求；
6. 看到真实 PASS/FAIL/ERROR/CANCELLED；
7. 阅读验收证据和产物；
8. 让下一个 queued Goal 在前一个结束后自动开始。

做到这些，Pod 才从「实现对象观测面板」变成「可托付目标的项目团队入口」。
