# MAFW Pod 使用逻辑审计与业界对照

- 日期：2026-11-02
- 状态：调研完成（未改产品代码）
- 触发：审视当前 Pod 的设计、架构与桌面端使用/展示逻辑，对照 CrewAI、Claude team，判断产品使用逻辑是否有问题，并归纳优势/劣势。
- 方法：三路并行只读审计（后端/spec、桌面端用户旅程、业界官方资料），主会话抽查关键代码与官方来源。子代理模型按用户指定为 `gateway/volcengine/deepseek-v4.1-flash`。

## 0. 结论先行

**是，当前 Pod 的使用逻辑有实质问题；但核心执行架构不需要推倒。**

问题主要不在 `NodeDriver / waves / 产物门 / review rubric`，而在三层之间不一致：

1. **产品叙事**说「项目级固定三人团队」；
2. **执行事实**是「单 active goal、plan→execute→review 的串行流水线，Gateway 负责投影和路由」；
3. **前端**把 roster、goal id、task、mailbox、memory 等内部对象直接平铺给用户，却没有一条「把目标交给团队 → 只在需要我时介入 → 查看结果」的主线。

因此，当前 Pod 更准确的描述是：

> **项目级持久化的确定性 Goal 工作流 + 角色化观测/留言/记忆层**，尚不是前端文案所暗示的「三人持续协作团队」。

这不是说 Pod 没有价值。它已经在**可复现、可审计、结构化验收、项目记忆分层**上形成差异；问题是这些优势大多没有转化为用户能理解和操作的价值。

最高优先级不是增加成员、动态 swarm 或重做视觉，而是：

- 建立一个主动作：**交给团队一个目标**；
- 建立正确的人类注意力模型：**什么真的需要我**；
- 让控制与状态诚实：**休眠、完成、待审、手工任务必须名实一致**；
- 先修若干正确性问题，再谈并行和 specialist。

> 增补：DeepSeek 刚开源的 `dsh-superagent-prototype` 与上述方向高度一致，并给出了更具体的 Ticket stage、Router/Executor、Mandate、follow-up ownership、durable effects 与 panel 约束。见 `docs/research/2026-11-02-dsh-superagent-vs-mafw-pod.md`。

---

## 1. 审计边界与证据等级

### 已做

- 实读 `CONTEXT.md`、Pod 六组 spec/plan、既有四份调研、`gateway/src/core/pod/*`、Goal 编排相关文件、Pod 路由/工具、桌面 Pod 全部主要组件与 store/model。
- 主会话重点抽查：休眠、goal 归档状态、任务投影与手工任务、review 收口、广播 delivered 状态、plan structured schema、Pod 记忆截断、左栏计数。
- 官方资料核对：CrewAI Flow/Crew/Tasks/生产架构，Claude Agent Teams/Projects/Subagents/Managed Agents 等。

### 未做 / 限制

- 未做真实用户测试；本文的「用户会困惑」属于基于代码事实的 UX 推断。
- 本轮未启动桌面 GUI 做逐步点击截图审计；界面事实来自实际渲染代码与数据流。
- 未验证运行中的 gateway 是否已部署最新 Pod 代码；「完成」指仓库实现与测试，不等于本机已部署。
- CrewAI 是开发者框架，不能直接拿其代码配置体验与 MAFW 桌面 UX 比易用性；本文只比较概念模型、控制与验收逻辑。Claude Projects 是更贴近的终端产品 UX 参照。

---

## 2. Pod 当前进度与 spec 清单

Pod 已不是概念稿，主体功能已分六批落地。

| 批次 | 已有实现 | 主要 spec / plan |
|---|---|---|
| Project Pod Lite 后端 | 项目级三人 roster、成员 session 绑定、单 active goal + FIFO 队列、任务板、邮箱、Pod 文件记忆、成本钩子 | `docs/superpowers/specs/2026-10-29-project-pod-lite-design.md`；`plans/2026-10-29-project-pod-lite-backend.md` |
| 桌面鲸群面板 | 右工作台「执行 › 鲸群」、成员/目标/任务/邮箱/记忆、快照 | `specs/2026-10-30-pod-desktop-panel-design.md`；对应 plan |
| A2A handoff | Pod AgentCard、message/send、task get/cancel、artifact、push/pull handoff | `specs/2026-10-30-pod-a2a-handoff-design.md`；对应 plan |
| 左栏鲸群面 | 只读、待办优先、未读/待审徽标、发送集中右栏、chat「记入鲸群」 | `specs/2026-10-30-pod-left-rail-design.md`；`plans/2026-10-31-pod-left-rail.md` |
| Review / 任务编辑 | 逐任务 rubric、acceptance、同轮复核、标题/验收编辑 | `specs/2026-10-31-goal-acceptance-review-fix-design.md`；`specs/2026-10-31-pod-task-plan-edit-design.md` |
| 任务增删 v2 | 稳定 taskId、legacy source key 迁移、新增/删除计划任务 | `specs/2026-11-02-pod-task-add-delete-design.md`；对应 plan |

另有：`plans/2026-10-31-pod-hardening-roadmap.md`，其中 rubric 与 readiness 已做，已读回执未完成。

### 仍主要停留在设计或未完整实现

- spec 中的事件驱动唤醒、Lead 主动拆任务/分配/调队列/升级；
- Lead 归纳式 memory capture；
- 成员级模型配置、Reviewer 异模型；
- 多 active goal、wave fan-out、worktree 隔离、依赖自动解锁；
- per-recipient 广播扇出、成员已读回执；
- per-member/per-goal 成本与可见预算；
- TUI 鲸群面板、per-member A2A AgentCard。

---

## 3. 实际架构：它是什么，不是什么

### 3.1 真实执行拓扑

1. Goal 创建后进入 `PodGoalService.enqueueGoal`；必要时自动 ensure Pod。
2. `NodeDriver` 串行推进 plan→execute→review；每个节点创建一个新的 runtime session，并绑定 `mafw-plan / mafw-execute / mafw-review` 身份。
3. 完成由 `turn.completed + 可解析产物文件` 双门判定；review 后进入同轮 fix、下一轮或 archive。
4. `waves.json` 由 Gateway 投影为 `pod_tasks`；execute receipt 与 review rubric 再覆盖任务状态。
5. Lead 实际是项目 Manager session 的 `coordination` 绑定；Builder/Reviewer 的节点 session 结束后关闭并保留快照。

**事实：一个 wave 的多个任务不是多个 Builder 并行领取，而是同一 execute 节点顺序处理。** 三人 roster 是三种职责的稳定命名，不是三个持续在线、彼此讨论的 teammate。

### 3.2 已经成立的基础

- Goal 状态机和产物门清晰；
- 任务有稳定 id，计划编辑不会把状态错位到别的任务；
- review 有逐任务结果与证据模型；
- Goal/Pod/session/task 的归属与持久化基本清晰；
- Pod 文件与谐波记忆分层方向正确，任务状态没有自动写入长期检索记忆；
- A2A、消息、审计和快照为未来开放协作保留了接口。

### 3.3 叙事偏差

Spec 中的「Lead 拆任务、定优先级、分配、升级、归纳记忆」并未成为运行时事实：

- Manager identity prompt 未包含 Pod/鲸群/任务板/handoff 语言（对 `gateway/src/skills/manager-identity.ts` 检索无命中）；
- 任务板由 Gateway 确定性投影，不是 Lead 建；
- 唤醒路由主要改状态并 promote，不是唤醒 Lead 做协调推理；
- 节点会话按轮新建，持久的是 roster、文件和记录，不是连续成员上下文。

所以需要在两个产品方向中明确选择：

- **A. 协调者团队**：补 Lead 的真实路由、委派、升级与记忆收口；
- **B. 确定性项目工作流**：保留现状，把 Lead 改称「协调会话」，把成员解释为「职责/阶段」，不再暗示多人实时协作。

本文建议：**用户体验采用 A 的单入口，底层执行保留 B 的确定性。** 不必让 LLM 接管状态机，也可以让用户只面对一个「交代目标」的协调者。

---

## 4. 使用逻辑问题（按严重度）

以下把代码事实与产品推断分开。

### P0-1：没有「把目标交给 Pod」的主入口

**事实**

- 创建 Pod 后只出现三个空闲成员，没有下一步动作：`packages/desktop/src/renderer/mafw/components/PodDock.tsx:163-181`。
- PodDock/PodRailFace/PodGoalQueue 没有创建 goal 的入口；真实路径在 Welcome → 新建 Goal → Manager chat → `mafw_create_goal`。
- 面板提供的是手工任务、加入计划、邮箱、记忆，均不能替代「提交一个目标」。

**推断**

用户在「团队」页面无法做最自然的一件事：「我有件事交给你们」。创建即死路，是首要使用逻辑问题，不是按钮位置的小问题。

### P0-2：「新建任务」混合了会执行与不会执行的对象

**事实**

- 默认创建模式是 manual：`PodTaskBoard.tsx:82,129-136`。
- `createManual` 只写一条任务行：`gateway/src/core/pod/pod-task-service.ts:133-151`；execute 读取的是 waves，不是这些 manual 行。
- 手工任务没有 `goalId/externalTaskId`，因此前端不提供编辑/删除：`PodTaskBoard.tsx:202,232-260`；后端其实支持删除：`pod-task-service.ts:234-242`。
- 「加入计划」在没有 active goal 时会静默退化为手工任务：`PodTaskBoard.tsx:132,155-177`。
- A2A request 也会生成任务行，但不进入 waves 执行器。

**推断**

用户无法从相同 UI 判断「这是一条备忘」还是「团队会执行的工作」。手工任务会永久占用待办计数，形成假工作队列。应改名「备注/跟踪事项」并允许删除，或真正接入执行；不能继续以默认「手工任务」暗示会派工。

### P0-3：「待我处理」没有建模真正的人类阻塞点

**事实**

- 左栏计数 = `review` 任务 + 未读：`pod-rail-face-model.ts:118-131`；rail badge 同样只看 review + unread：`pod-rail-badge.ts:19-26`。
- 计划批准会使 goal 停在 `AWAIT_PLAN_APPROVAL`，askUser 会等待回答，但二者不计入 Pod 的待我处理；PodGoal DTO 也没有 phase/verdict/title。
- `review` 在系统里通常是 Reviewer 的工作，不等于需要用户复核。

**推断**

最坏情况是团队已停下来等人，Pod 却显示「执行中」且 badge=0；同时内部「待审」又可能误导用户以为必须自己处理。人类注意力与 agent 内部进度混在了一起。

### P0-4：生命周期控制和结果状态不诚实

**事实**

- UI「休眠」只切 `active↔idle`：`PodDock.tsx:138-153`；队列只被 `paused/archived` 阻挡：`gateway/src/core/pod/pod-goal-service.ts:35-36,55,90-102`。运行 goal 不停，新 goal 仍可启动。
- 归档时除 CANCELLED 外全部映射为 `done`：`pod-goal-service.ts:70-82`；因此 FAIL/ERROR 也可在 UI 显示「完成」。
- 真正的 `paused/archived` 没有正常 UI 路径。

**推断**

这是控制语义错误，不是视觉瑕疵。「休眠」若只是降低消息推送，应据此命名；若是暂停团队，就必须真正阻断执行与启动。Goal 完成、执行结束、验收通过、失败、取消必须是不同状态。

### P0-5：前端展示内部对象，无法回答「在做什么」

**事实**

- 顶部和队列显示 raw goal id：`PodDock.tsx:196-201`、`PodTaskBoard.tsx:60-62`；缺 goal 标题、phase、下一动作。
- 任务板跨 goal 混排，没有 goal/round 分组；每轮 plan 又会清当前 goal 的投影，既不是干净当前轮，也不是可靠历史日志。
- 任务 `ownerMemberId` 在 waves 投影中始终为 null：`pod-task-service.ts:84-97`，成员任务计数因此长期为空。
- 验收要点要进入编辑才能读；产物只有数量，没有打开/复制动作。
- 左右「待办」定义不同，计数点击只是滚动不过滤。

**推断**

界面是一个不错的数据库镜像，但不是一个回答「目标是什么、进展如何、结果在哪」的工作台。

### P0-6：Pod 的核心优势没有被用户感知

**事实**

- rubric evidence 没有成为 Pod 任务/结果的主要展示；
- acceptance/artifact 不可直接阅读；
- plan approval 与提问在别的页面；
- Reviewer/Builder 会话可打开，但 UI 不说明「在这里输入会直接影响该节点」；
- 邮箱以 Lead 身份代发，系统又写 Lead→Lead 的归档消息，用户与系统的作者身份不易区分。

**推断**

我们投入最多的确定性验收、审计、可干预能力，反而没有形成可感知价值。先展示结果与证据，比继续加 roster 功能更重要。

---

## 5. 额外发现的正确性问题（与 UX  redesign 分开处理）

这些不是「产品风格选择」，应独立立项修复并加回归测试。

### C1：广播只有第一个接收者会消费

`pod_messages` 只有一个 `delivered_at`；pending 查询对指定成员或广播都过滤 `delivered_at IS NULL`：`gateway/src/core/pod/pod-store.ts:673-679`。任一成员 `commitDelivered` 后，广播对其他成员不再 pending：`pod-message-delivery.ts:65-92`。

**应为**：per-recipient delivery/receipt，或明确禁止广播进入 agent handoff，只把广播当人类可读日志。

### C2：结构化 plan schema 会丢掉对象任务契约

`PLAN_OUTPUT_SCHEMA` 将 `waves.tasks` 限定为 `string[]`：`gateway/src/core/goal/node-prompts.ts:9-42`；而后续设计已要求 `{title, acceptance[], taskId}`。结构化交卷主路径与文件路径契约不一致，可能让 acceptance 根本没进入 waves。

**应为**：单源 wave task schema，字符串只作 legacy 输入兼容；结构化输出与文件解析共用校验。

### C3：Pod 记忆截断方向会丢最新决策

`renderContext` 先放 POD/POD_MEMORY/glossary，再追加 decisions，最后 `slice(0, 4096)`：`gateway/src/core/pod/pod-memory-service.ts:56-85`。超预算时先丢的恰恰是近期 decision。`captureGoal` 也只是原始摘要写文件，不是 spec 中的 Lead 归纳。

**应为**：分层预算，近期决策优先保留；长期记忆走归纳/去重，而非无限 dump。

### C4：评审/归档板态可能永久矛盾

- receipt 的非 done（含 skipped）→ failed：`pod-task-service.ts:106-126`；
- rubric skipped → failed：`:290-300`；
- archive 的收口集合不含 failed：`:338-345`；
- 无 rubric 的 FAIL 可把 done 也翻回 reopened：`:313-316`。

结合 goal FAIL→UI 完成，会出现同一 goal 同时「完成」和永久红卡。

### C5：force notify 与节点完成语义存在冲突风险

「立即提醒」可强制向运行中的节点 session 写入 queued 用户消息；节点又按 idle 判定完成并结束 session。需要明确 steer/queue/下一次派活三种语义，不能把邮箱提醒当成无副作用操作。

### C6：readiness / owner / waiting 多处在 UI 展示但缺少真实生产者

成员任务数为 0、`waiting` 状态无写入、owner 多为「系统」。这类「看起来已接好」的展示比暂无功能更容易误导。

---

## 6. 业界对照：应该学什么，不应该学什么

### 6.1 先澄清「Claude team」不是单一产品

- Claude Team plan：订阅/席位，不是 agent team；
- Claude Tag：Slack 中的人类团队协作；
- Claude Code Agent Teams：会话内临时 agent 团队；
- Claude Projects：长期项目协调会话 + 多 threads；
- Managed Agents：存储的 Agent 对象 + 持久 sessions + coordinator。

对 MAFW 最有参考价值的是 **Agent Teams（协作机制）+ Projects（持久项目 UX）**，不能只拿前者比较。

### 6.2 对照表

| 维度 | CrewAI | Claude Agent Teams | Claude Projects | MAFW Pod 当前 |
|---|---|---|---|---|
| 用户如何开始 | 代码/config 定义 agents、tasks、process 后 kickoff | 自然语言要求 lead 创建 teammates | 在一个长期项目会话里持续交付工作 | 先创建/自动获得 Pod，但 Pod 页面不能交目标 |
| 团队寿命 | Crew 一次执行；Flow 可持久 | 会话级，不可完整 resume | 项目级持久 | 项目级持久 |
| 控制者 | hierarchical manager 或 Flow | lead agent + 共享任务列表 | 协调会话路由到 threads | NodeDriver 状态机 |
| 并发 | task async / Flow / 平台能力 | 多 teammate 并行、可自领任务 | 多 threads 并行 | 单 active goal，节点串行 |
| 任务权威 | Task + expected_output + context | 共享任务列表 + 依赖 + 自动解锁 | thread 是工作单元 | waves 权威；manual/A2A 行不执行 |
| 人类注意力 | human_input / Flow feedback / Enterprise HITL | lead 面板、权限向上冒泡、可直接找 teammate | Overview：Waiting on you / Ready for review / Working 等 | review+unread；漏 plan approval 和 askUser |
| 验收 | task guardrails、structured output、checkpoint/fork | 可用 TaskCompleted/TeammateIdle hooks | 人在 thread/PR 验收 | 产物门 + 结构化 rubric，但证据不够可见 |
| 记忆 | crew 共享与 scoped memory | 独立上下文 + 项目文件 | 项目 instructions + project memory | Pod 文件 + 谐波记忆，方向清晰但 capture 粗 |
| 主要强项 | 可编程工作流与任务级校验 | 灵活讨论、并行探索、直接干预 | 长期托付工作与人类注意力组织 | 确定性、审计、固定边界、项目持久 |
| 主要代价 | 需要设计与开发工作流 | token/协调成本、实验性、同目录冲突 | 云端与计划额度，协调偏好非硬约束 | 使用主线混乱、串行、Lead 名实不符 |

### 6.3 CrewAI：最重要的不是「角色」，而是 Flow-first

CrewAI 官方生产架构明确建议从 Flow 开始：Crew 提供协作智能，Flow 提供状态、控制流、持久化与可观测性；Crew 是 Flow 内的工作单元。

这对我们是正向验证：**确定性 NodeDriver 不是方向错误。** 需要借鉴的是：

- task 级 guardrail 在产出被接受前就校验，而不是等整个 execute 后到 review；
- structured output 与状态持久化是同一工作流契约；
- human feedback 是流程中的一等状态，不是散落在别的页面。

官方：<https://docs.crewai.com/v1.15.34/en/concepts/production-architecture>

### 6.4 Claude Agent Teams：借直接干预与任务依赖，不必借动态 roster

优势：

- 用户用自然语言形成团队；
- teammates 可自领未阻塞任务，依赖完成自动解锁；
- 用户可直接打开任一 teammate 并纠偏；
- mailbox 与共享任务列表是一等协作面。

代价与限制：

- 实验性、会话级、无法完整恢复；
- 每成员独立上下文导致成本增长；
- 同目录编辑有冲突；
- 任务状态也可能滞后，并非天然可靠。

官方：<https://code.claude.com/docs/en/agent-teams>

对我们的启示：**「直接介入」必须显式命名和记录；依赖/解锁比动态增加成员更值得后续实现。** 不需要为了像 Claude 而放弃固定班底。

### 6.5 Claude Projects：最接近我们的前端使用逻辑参照

Projects 的主线是：

1. 用户向一个长期协调会话交付目标、bug、任务流；
2. 协调者决定新建或复用 thread；
3. 用户离开时工作继续；
4. 回来后 Overview 以 `Ready for review / Waiting on you / Working / Landing / Idle / Resolved` 组织注意力；
5. 需要控制时再进入具体 thread，直接 steer、回应 approval 或停止；
6. 项目 instructions 与 memory 贯穿新工作。

它没有要求用户先理解 roster、wave、node、task sourceKey、mailbox delivery，才能开始。

官方：<https://code.claude.com/docs/en/claude-projects>

对我们最值得借的是**目标入口与人类注意力模型**，不是云端多 thread 的规模。

---

## 7. 我们的优势与劣势（校准版）

### 7.1 优势

| 优势 | 为什么仍然成立 | 需要避免的夸大 |
|---|---|---|
| **默认集成的确定性验收** | 产物门、attempt、结构化 rubric、稳定 taskId 已在同一执行链里 | CrewAI 有 guardrails，Claude 有 hooks；不能说业界没有质量门。我们的差异是默认集成与统一契约 |
| **本地优先的项目级持久工作流** | roster、goal 队列、消息、Pod 文件、快照跨会话保留 | Claude Projects/Managed Agents 也持久；不能说只有我们持久 |
| **可审计与可恢复** | goal_node_runs、时间线、receipt/review 文件、transcript 快照、A2A 链接 | 审计数据存在 ≠ 已变成好用界面；目前证据展示不足 |
| **明确的记忆边界** | 任务状态不自动进入长期检索；Pod 项目文件与跨项目谐波记忆分层 | capture 与截断仍需修，方向对不等于完成 |
| **可预测的单 active 执行** | 对本地资源、冲突与成本更可控，适合先做可靠串行 | 它不是天然成本安全：预算可见性与运行中硬门仍不完整 |
| **开放 A2A 与本地控制** | 有标准化 handoff/artifact，不完全是私有群聊 | per-member card、广播扇出等仍未完成 |

### 7.2 劣势

| 劣势 | 本质 |
|---|---|
| **产品主线不清** | 目标、任务、消息、成员会话、记忆同时出现，用户不知道哪个是「开始工作」 |
| **人类注意力模型错误** | 内部 review 被当成人待办，真正的人阻塞点反而不可见 |
| **团队叙事大于执行事实** | 固定角色其实是串行职责，Lead 缺乏实际协调代理性，成员上下文按节点更换 |
| **控制与状态名实不符** | 休眠不停工作、失败显示完成、手工任务不执行、owner/waiting 是死数据 |
| **并行与隔离弱** | 单 active goal、wave 内串行、主目录执行，无多 Builder×worktree |
| **任务图与 specialist 弱** | waves 只有粗顺序，无依赖自动解锁；固定三人无处放安全/性能/文档专家 |
| **优势不可感知** | rubric 证据、acceptance、artifacts、决策记忆没有成为结果页核心内容 |
| **正确性债** | 广播、plan schema、board 状态、memory 截断等会进一步破坏用户信任 |

---

## 8. 建议的产品模型：目标驱动，确定性执行

### 8.1 一句话定位

> **Pod 是项目里可长期托付目标的团队入口；底层用确定性工作流保证每个目标可验收、可审计。**

这比「固定三人多代理协作」更符合现状，也比「数据库投影面板」更有用户价值。

### 8.2 主用户旅程

1. 打开项目/Pod，第一动作是 **「交给团队一个目标」**；创建 Pod 后立即进入同一动作，不停在空 roster。
2. 用户只需给目标、验收约束、必要上下文；不必先理解 wave 或 task source。
3. 需要人时进入统一 **「需要你」**：批准计划、回答问题、处理阻断、最终决定有争议的验收。
4. 工作时显示 **当前目标、当前阶段、谁在处理、下一步是什么**；无需用户刷成员状态。
5. Reviewer 的工作显示为「团队复核中」，不计入人类待办；失败任务显示 rubric 证据。
6. 完成后显示 **结果、产物、验收证据、变更与决策**；排队目标自动接续，历史按 goal/round 隔离。

### 8.3 建议的信息架构

**Pod 主面（默认）**

- 主输入/按钮：交给团队一个目标；
- 需要你（仅真正的人类动作）；
- 当前目标（标题、阶段、下一动作、进度、成本）；
- 当前目标任务与验收证据；
- 排队与历史。

**团队（次级）**

- Lead/Builder/Reviewer 职责与状态；
- 打开会话/快照；
- 直接介入（明确说明会改变执行，并记录到协调日志）；
- 邮箱与 handoff；
- 成员/模型/预算设置。

**项目记忆（高级）**

- 展示归纳后的决策、约定、术语；
- 原始 POD/POD_MEMORY/GLOSSARY 文件编辑放高级区，带冲突/覆盖提示。

### 8.4 保留与停止

**保留**

- 固定职责、NodeDriver、产物门、稳定 taskId、rubric、A2A、记忆分层；
- 单 active goal 可作为当前明确模式，但 UI 要写清「串行：当前完成后自动开始下一个」。

**停止**

- 不再把 manual task 当默认「工作」入口；
- 不再把 `review` 直接等同于人类待审；
- 不再显示没有实际生产者的 owner/waiting/任务数；
- 不在语义修复前优先做动态成员、300-agent swarm 或视觉换皮。

---

## 9. 优先级建议

### 第一批：语义与正确性（先做，小步修复）

1. 休眠改为真实 paused 语义，或改名/移除；明确暂停是否影响运行 goal、队列和新 goal。
2. PodGoal 携带 title/phase/verdict/nextHumanAction；FAIL 不再显示完成。
3. 「待我处理」加入 plan approval、pending question、失败/阻断；Reviewer 的 review 单独算「团队复核」。
4. 手工任务改名为备注并允许删除，或接入执行；修复「加入计划」静默降级。
5. 修广播 per-recipient delivery、plan task schema、skipped/failed 收口、memory 截断。

### 第二批：目标驱动主界面

1. Pod 创建与空态直接进入「交给团队一个目标」；主面板也能创建/排队 goal。
2. 当前目标替代 raw goal id；显示阶段、下一动作与真实进度。
3. 任务板按 active goal + round 作用域；acceptance、artifacts、rubric evidence 可直接查看。
4. 直接介入成员会话时明确语义、记录来源，避免「打开会话」和「发邮箱」两套不可解释的通道。

### 第三批：架构能力（产品主线稳定后）

1. 任务级 guardrail / 更严格 receipt schema；
2. 显式依赖与自动解锁；
3. 独立任务可 fan-out 到多 Builder×worktree，Reviewer 汇总；
4. 按需 specialist，而不是无限制动态 roster；
5. Lead/curator 归纳式项目记忆、成员模型与预算细化。

---

## 10. 最终判断

**Pod 的底层方向是对的，前端产品逻辑确实还没收敛。**

我们不需要在「确定性流水线」与「智能团队」之间二选一：CrewAI 自己也把 Crew 放进 Flow，Claude Projects 也把协调者和工作 threads 分层。真正的问题是当前 UI 同时把两种抽象都暴露给用户，却没有给其中一个清晰主权。

建议主权交给 **目标**：

- 用户面对目标与需要自己的动作；
- 团队面对职责与交接；
- 状态机面对执行与验收；
- 记忆面对项目约定与决策；
- 其余内部对象退到按需展开的位置。

只要把这条主线立住，Pod 现有的确定性、审计和记忆分层才会从「实现复杂度」变成「用户价值」。

---

## 11. 主要官方来源

- CrewAI Production Architecture（Flow-first）：<https://docs.crewai.com/v1.15.34/en/concepts/production-architecture>
- CrewAI Tasks：<https://docs.crewai.com/v1.15.34/en/concepts/tasks>
- CrewAI Processes：<https://docs.crewai.com/v1.15.34/en/concepts/processes>
- CrewAI Human Feedback in Flows：<https://docs.crewai.com/v1.15.34/en/learn/human-feedback-in-flows>
- CrewAI Checkpointing：<https://docs.crewai.com/v1.15.34/en/concepts/checkpointing>
- Claude Code Agent Teams：<https://code.claude.com/docs/en/agent-teams>
- Claude Code Projects：<https://code.claude.com/docs/en/claude-projects>
- Claude Code Subagents：<https://code.claude.com/docs/en/sub-agents>
- Claude Managed Agents（multiagent）：<https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration>
- Anthropic multi-agent research architecture：<https://www.anthropic.com/engineering/multi-agent-research-system>

既有内部参照：

- `docs/research/2026-10-29-agent-team-swarm-tower-pod.md`
- `docs/research/2026-10-30-task-handoff-memory-boundary.md`
- `docs/research/2026-10-31-pod-vs-industry.md`
- `docs/research/2026-10-31-pod-vs-codex-kimi-grok.md`
- `docs/research/2026-10-31-agent-chat-vs-team-log.md`
