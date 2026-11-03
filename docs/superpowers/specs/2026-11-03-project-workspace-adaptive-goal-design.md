# 项目工作空间与自适应 Goal 执行设计

- 日期：2026-11-03
- 状态：用户已批准（2026-11-03）
- 范围：Desktop 信息架构、Lead / Tech Lead / Worker 职责、Goal 与 Session 归属、文件派工
- 非目标：本轮不实现代码；不改变谐波记忆系统；不引入 DeepSeek 的外部事件授权系统

## 1. 意图

把 Desktop 从「工作页管 Session、鲸群页管 Pod、Goals 页管另一套 Goal」改为一个项目工作空间：

- 用户通过持续的 Lead 项目对话交代工作、协商方向、接收结果。
- 用户也可以为任何新话题拉一个自由 Session；自由讨论默认不是 Goal。
- 一旦明确要求做事，无论大小，Lead 都创建一个 Goal。
- Lead 不决定技术拆解和执行拓扑；Tech Lead 在 Goal + revision 内决定如何做。
- 小任务可以由一个普通 Worker Session 直接完成；复杂任务才使用完整协作编排。
- Goal 拥有自己的身份、状态、历史和结果，不跟随任何 runtime Session 的生命周期。
- Pod 任务继续以文件为真相源；派工内容显式进入 Worker prompt，不依赖共享记忆或任务板隐式同步。

成功不是「三个现有页面各自更完整」，而是用户不再需要理解底层有几个 Session、哪支团队在工作，也不会在多个页面看到互相矛盾的同一项工作。

## 2. 用户已经确认的决定

以下不是设计者的推测：

1. 日常主形态是「进入项目，跟 Lead 说话，右侧看所有工作」，而不是先进入 Goal 列表或成员列表。
2. 想讨论一个新话题时，会拉一个自由 Session；它不需要自动成为 Goal。
3. 小事也存在，例如一次小 debug，一个普通 Worker Session 就足以完成。
4. Lead 对所有明确执行请求都创建 Goal，包括小事。
5. Tech Lead 决定 Goal 如何执行；Lead 不理解或决定这些执行细节。
6. Pod 任务仍采用文件形式；例如 Lead / Tech Lead 给 Worker 发消息时，显式携带任务信息并进入 prompt。
7. 记忆继续使用当前谐波记忆系统，不把任务状态或派工真相搬进记忆。
8. 快速任务完成后至少要明确通知用户并留下结果；默认不需要用户验收，也不计入「需要你」。
9. 用户对任何结果不满意时都可以打回给 Tech Lead，包括无需验收的快速结果；Lead 只收集反馈并转交，不自行决定修法。

## 3. 业界依据与取舍

### 3.1 DeepSeek Super-agent

官方设计文章与 `dsh-superagent-prototype` 给出以下直接相关的依据：

- **Session 是系统实现细节，不应是用户认知负担。** 系统应接管会话管理与上下文同步，让用户面对一个连续 Agent。
- Router 维护全局连续性并统一对外交互；Worker 在隔离上下文中执行具体工作。
- Worker 内部可以再有 Subagent 或 Agent Team，这对 Router 透明。对应到 MAFW：Tech Lead 的执行策略属于 Goal 内部，不应要求 Lead 理解。
- Ticket 自己定义状态，不跟随 Executor Session；执行会话可以替换、恢复或重试。
- 面板应优先回答「需要我什么、系统是否健康、一件工作的来龙去脉」，并坚持「一个概念一个地方」「计数等于列表」「健康状态不占空间」。
- 官方也明确指出聊天窗口中心可能是路径依赖；工作项详情应允许领域化的计划、改动、结果界面，而不只是聊天和时间线。

来源：

- [Super-agent 设计探索](https://mp.weixin.qq.com/s/zoS7GlReWPhfCjENGxXCdg)
- [Philosophy](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/000-philosophy.md)
- [Domain model](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md)
- [Execution](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)
- [Panel](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md)

它是研究原型，不是正式产品。本文借鉴职责边界与使用逻辑，不照搬其 Source / Trigger / Eval / Mandate 词汇或外部平台授权实现。

### 3.2 其他对照

- Claude Projects：持续项目协调对话 + threads + Overview；Overview 按待输入、工作中、待审、完成等状态组织。
- Claude Agent Teams / Devin Managed Devins：团队属于执行过程，不是需要用户持续管理的项目级业务首页。
- Claude Agent View：子 Agent 不单独成为顶层工作行；用户从工作项进入完整会话。
- GitHub Copilot Projects：项目对话、工作概览、session / plan / changes / result 在同一工作上下文内连接。
- Linear：不同页面是同一工作对象的视图；不能各自维护不同真相源。

## 4. 当前实现的结构性问题

代码走查确认：

1. 左栏「工作」以 Session 为中心；右侧「执行 › 鲸群」与左栏鲸群面又分别呈现 Pod；Dashboard 还有另一个 Goals 首页。
2. Dashboard 的 `/api/goals` 来自 gateway 内存 `activeGoals`，不是 Pod Goal 读模型；它跨项目、缺标题，讨论/排队 Goal 与重启后的终态历史都会缺失。
3. Pod API 已返回全部 Goal，但左栏只显示当前 Goal + 最近 3 条，右侧也只保留 3 个终态，且没有完整历史入口。
4. Goal 详情以节点时间线为中心；计划批准、方向裁定、提问、结果证据、revision 历史分散在不同面板。
5. 同一 Goal 在 Dashboard 使用 `phase/raw id`，在 Pod 使用 `stage/revision`，在详情混用两套状态；同一执行 Session 从不同入口打开还会得到不同名称。
6. 固定三节点 NodeDriver 容易让「Goal」等同于完整流水线，无法自然表达一个 Worker 就足够的快速任务。
7. `waves.json` 已是计划任务的重要文件真相源，`pod_tasks` 是 DB 投影；但 UI、任务编辑、派工与回执仍需明确服从同一文件生命周期，不能变成双权威。
8. Goal 状态文件、`goal_sessions`、`pod_member_sessions` 和 runtime Session 各自承担部分关系；必须明确哪个是业务状态，哪些只是索引或证据。

## 5. 领域模型

### 5.1 Project

一个注册项目是一个工作空间与上下文边界。一个项目至多一个 Pod；Pod 是项目背后的团队、权限和共享记忆载体，不是用户需要每天进入的第三个首页。

新模型中的所有新 Goal 都属于一个项目 Pod；项目首次接收工作时自动 ensure Pod，不要求用户先做团队设置。Desktop、TUI、MCP 与自由讨论等入口都汇入同一 Lead intake，不再产生新的 Pod-less Goal。存量 Pod-less Goal 只按第 10 节做可证明归属的只读迁移。

### 5.2 自由讨论 Session

自由讨论回答「我想聊一个新话题」。

- 默认属于当前项目，拥有独立话题上下文。
- 可以提问、探索、讨论方案，不自动产生 Goal，不进入工作计数。
- 可以归档、恢复、导出；归档或删除讨论不影响由它产生的 Goal。
- 当用户明确要求执行时，自由 Session 显式 handoff 给 Lead，由 Lead 创建 Goal；自由 Session 自己不能绕过 Lead 创建 Pod Goal。
- Goal 同时保存来源 Session / message 指针和来源内容的不可变快照摘要。之后删除来源讨论不影响 Goal；原讨论本身保持原样。

### 5.3 Lead

Lead 是项目级连续交互与协调身份。

负责：

- 接收明确工作请求；无论大小都创建一个 Goal。
- 保存用户意图、来源讨论和跨 Goal 上下文。
- 向用户呈现状态、必要人工行动和结果。
- 协调跨 Goal 的优先级、暂停和项目级策略。

不负责：

- 技术拆解、worker 数量、是否需要 spike、节点选择或具体验证方案。
- 亲自执行 Goal 内的实现工作。
- 要求用户理解底层 Session 拓扑。

Lead 可以记录用户显式偏好，例如「直接做」「先让我看方案」「组织协作」，但不能把它扩展成自己的技术执行决策。其中「先让我看方案」必须落成 `planReview: manual` 硬约束，Tech Lead 不能用快速路径绕过；其他偏好是 Tech Lead 选路时必须考虑的输入。

### 5.4 Goal

Goal 是所有已明确授权工作的统一业务对象，包括快速任务和协作任务。

Goal 拥有：

- 标题、意图、来源引用、当前 revision、当前阶段和当前所需行动。
- 验收条件、产物、结果、通知与历史。
- 独立于任何 runtime Session 的状态；Worker 退出、gateway 重启或执行器替换都不能使 Goal 消失或改变业务结论。

UI 可以统称「工作项」，但不在本轮另建一套与 Goal 平行的小任务对象。

### 5.5 Revision

打回或继续同一项工作时使用同一 Goal 的新 revision。revision 不是新的列表对象，不复制来源讨论，不重写旧 revision 证据。快速结果也支持打回：用户反馈进入同一 Goal 的下一 revision 并直接交给 Tech Lead，Tech Lead 再决定快速修复、补充验证或升级为协作路径。

### 5.6 Tech Lead

Tech Lead 是 Goal + revision 内的技术负责人。

负责：

- 判断直接执行或协作编排。
- 决定是否需要探针、计划细化、独立 Reviewer、额外验证或升级执行路径。
- 产出文件形式的任务与验收条件。
- 确保每次派工显式携带足够任务信息。
- 汇总技术结果并交给 Lead 呈现。

Tech Lead 不扩大用户授权。工具权限、破坏性操作和必须人工批准的边界仍由用户请求与审批策略决定，不能由 Tech Lead 自行豁免。

### 5.7 Worker / Reviewer / Assignment

Worker 或团队是 Goal 的执行细节。Assignment 表示某个角色在某个 revision 承担的一次具体执行；它是文件和索引中的技术概念，不成为新的用户首页对象。

- 快速任务通常只有一个 Worker Assignment。
- 协作 Goal 可以有 plan / probe / execute / review 等多次 Assignment。
- Worker Session 是 Assignment 的 transcript 与 steer 入口；可以替换或重试，不拥有 Goal 状态。
- Assignment 有持久文件，记录本次派工的准确内容；重试沿用同一 Assignment 并新增 attempt，改变任务或指令则创建新 Assignment。
- 默认由 Lead 统一对用户汇报；直接进入 Worker / Reviewer 会话是高级干预和诊断能力，不是常规使用路径。

## 6. 自适应执行路径

### 6.1 共同入口

1. 用户在 Lead 项目对话中明确要求做事，或在自由讨论中明确把讨论转为执行。
2. 自由讨论通过显式 handoff 把来源快照与指针交给 Lead；其他入口也汇入同一 Lead intake。
3. Lead 自动 ensure 项目 Pod，调用唯一 Goal intake，创建 Goal、revision 1 与来源引用。
4. Lead 把 Goal 交给当前 revision 的 Tech Lead；Lead 不预判执行拓扑。
5. Tech Lead 选择路径并通过结构化提交让 driver 写入执行文件；Tech Lead 不需要直接获得文件编辑权限。
6. 工作概览和 Lead 对话立即看到同一个 Goal。

### 6.2 快速路径

适用于范围清晰、低歧义、能够由一个 Worker 完成并验证的工作。

- driver 路由为 `start → Tech Lead 策略/最小计划 → 一个 Worker execute → archive`，不经过独立 Reviewer 节点。
- Tech Lead 的结构化提交同时记录 `strategy: quick` 和最小任务文件；不需要为此开放 Tech Lead 的文件编辑权限。
- 不强制人工计划批准，但 `planReview: manual` 与既有审批策略仍然是硬门。
- 不强制独立 Reviewer；Tech Lead 可根据风险或验证结果增加审查或升级为协作路径。
- 仍保留 Goal、任务文件、验收条件、结果与必要验证证据。
- driver 对 receipt、验收证据和必需产物做机械完整性校验；失败时交回 Tech Lead 选择修复、重试或升级。
- 完成后 Lead 必须向用户发一次简短结果通知，Goal 留下可回看的结果卡；它不计入「需要你」，也不要求人工验收。
- 结果卡始终提供「打回给 Tech Lead」。用户填写不满意之处后，Lead 原样收集并转交；同一 Goal 开启下一 revision，旧结果和证据保持不变。
- 无独立 Reviewer 时，终态显示「已完成 · 未独立评审」，不伪造 `verdict: PASS`；真实 verdict 仍只来自实际评审或其他明确证据。

### 6.3 协作路径

适用于复杂、高风险、多依赖或长周期工作。

- 复用现有讨论、方向裁定、probe、Plan + Goal Eval、计划批准、Builder、Reviewer、结果与打回能力。
- 只保留当前阶段真正需要的人类行动，不把所有阶段都变成固定打扰。
- 后续小修正可以由 Tech Lead 选择快速跟进，但不得改写历史审批和验收证据。

### 6.4 状态投影

外层统一使用面向人的状态：

- 需要你：回答问题、批准计划、裁定方向或处理必须人工介入的失败；只有明确要求人工验收时才包含结果验收。
- 排队中。
- 进行中。
- 结果可读：包括快速任务的非阻塞完成通知；与「需要你」分开计数。
- 已结束：完成、失败、取消等真实终态；没有实际评审时 verdict 可以为空。

内部 `discussing`、`planning`、`implementing`、`reviewing`、`node.phase` 等只出现在执行详情，不在列表中互相竞争。

## 7. 文件派工与记忆边界

### 7.1 文件是任务真相源

保留现有 Goal 文件布局与 revision 隔离：

- `goal.md`：用户意图与目标。
- `request.json`：intake、来源引用、授权与上下文 allowlist。
- `direction.json`：必要的方向决定。
- `waves.json`：任务、稳定 taskId、依赖与验收条件。
- `goal-eval.json`：协作路径需要的整体验收条件；快速路径不伪造该文件。
- `assignments/<assignmentId>.json`：一次派工的结构化任务、角色、taskId、验收、上下文和产物路径。
- `assignments/<assignmentId>.prompt.md`：实际交给执行者的完整 prompt 快照，保证事后可审计「Worker 当时被告知了什么」。
- receipts / reviews / probes：执行与验证证据。

快速路径也使用一个最小 `waves.json`，通常只有一个 wave / task，从而避免再发明一套小任务文件格式；差异由执行策略与流程控制表达，而不是靠文件缺席猜测。`goal-eval.json` 与评审 verdict 在快速路径可以合法缺席。

### 7.2 显式 prompt 派工

每次 Worker / Reviewer prompt 必须显式包含：

- Goal id、revision、Assignment / task id。
- 任务正文与范围。
- 验收条件与必须产出的证据。
- 上下文文件引用及允许读取的边界。
- 结果、receipt 或报告的写入位置。
- 与本次派工直接相关的消息或决定。

Worker 不应被要求「去任务板看看现在有什么」或依赖某条谐波记忆碰巧被检索到才能知道任务。

派工前原子写入 Assignment 文件与 prompt 快照。重试同一 Assignment 时新增 attempt 并保留同一授权与任务内容；任何任务、范围或指令变化都生成新 Assignment，不能覆盖旧 prompt。

### 7.3 DB 与 Session 是投影或索引

- `pod_tasks` 是 `waves.json` + receipts 的可重建投影；编辑任务必须写回文件后再投影。
- Assignment 列表和「当前 Assignment」从派工文件、Goal state 与既有 node runs 投影，不再新增第二个权威任务表。
- `goal_sessions` 与 `pod_member_sessions` 提供审计、导航与快照索引，不拥有 Goal 业务状态。
- runtime Session 提供 transcript 和执行能力，不是 Goal 列表的替代品。

### 7.4 记忆不变

谐波记忆继续承载长期事实、偏好、教训和指针。任务文件是当前工作真相源；需要长期保留的结果可以记录「文件路径 + 一句话 gist」。本轮不改变检索、写入、consolidation、decay、sticky 或 pinned 机制。

## 8. Desktop 信息架构

### 8.1 项目工作空间

一个项目工作空间包含三个互相链接的视图，而不是三个各自维护状态的页面：

1. **Lead 项目对话**：交代工作、协商、接收结果。
2. **工作概览**：需要你、进行中、结果通知 / 可读结果、全部历史。
3. **工作项详情**：当前行动、讨论、计划、改动、结果；执行时间线和关联 Session 收在次级详情。

自由讨论有独立入口「新话题」和列表。打开自由讨论时，中间显示该 Session，右侧仍可显示项目工作概览，但讨论本身不计入工作项。

### 8.2 现有页面的归宿

- **现工作页**：从 Session 管理页重构为项目工作空间；自由讨论成为其中明确的一类对话。
- **现鲸群页**：退役为日常主导航。团队、成员、Pod 记忆和策略进入「项目资源 / 团队与设置」；当前执行成员在 Goal 详情按需出现。
- **现 Pod 任务板**：计划任务进入对应 Goal 详情的「计划 / 任务」视图；不再维护 active Goal 全局任务板。
- **现 Pod 邮箱**：迁入「团队与设置 / 协作诊断」，用于查看 handoff、投递故障和高级干预；常规结果与提问不经过邮箱页。
- **现手工 notes**：保留在「项目资源」，与计划任务分开，不进入 Goal 工作计数。
- **现 Dashboard Goals 目的地**：退役并重定向到当前项目工作空间；非 Goal 的工具链接迁入项目资源或全局设置，原内存 Goal 列表与专属控制不再保留。
- **现 GoalDetailOverlay**：从节点时间线 overlay 演进为统一工作项详情；计划批准、提问、方向、结果和打回在同一处完成。
- **现 PodResultPanel**：结果内容并入工作项详情，不再成为只能从队列按钮抵达的独立末端。

### 8.3 统一身份与行动

- 同一 Goal 在对话卡片、概览、详情和通知中使用同一 title、stage、verdict、revision 与 result 状态。
- 概览计数等于点击后可见列表；所有历史 Goal 可到达，不再只显示最近 3 条。
- 打开任何 Assignment Session 时都显示 Goal 标题、revision 和角色；已结束会话打开 transcript。
- Goal 的取消、批准、打回等行动只有一套确认与终态语义，与入口无关。
- 本轮暂停只保留现有 Pod 级暂停，不新增 per-Goal pause；UI 不再把遗留 Dashboard 的 Goal PAUSE 当成另一套语义。
- 健康团队、空闲成员和正常系统不占用主页面空间。

## 9. 读模型与 API 方向

需要一个服务端权威 Goal 读模型，供 Lead 卡片、工作概览和详情共同使用：

- project / pod 归属。
- Goal id、title、来源引用、active revision。
- 统一外层 stage、owner、当前所需行动。
- 真实 verdict、resultReady、结果摘要。
- 当前策略（快速 / 协作）与当前 Assignment 摘要。
- 详情按需加载计划、改动、结果、revisions 和执行证据。

现有 `/api/goals` 内存列表不再承担用户 Goal 列表职责。Goal 详情必须按 Goal 自身解析项目 / Pod，不能 fallback 到 Desktop 当前恰好打开的项目。

Goal 的规范身份是 `(canonicalProjectDir, goalId)`。gateway 可以维护一个可重建的 goalId 索引用于 deep link，但同 id 多项目命中时必须要求项目消歧，不能沿用「最新一条获胜」的反查。详情链接携带项目键；项目内路由再使用 goalId。

具体路由拆分可以在实现计划中确定，但不允许再用多个端点的不同字段拼接出互相矛盾的外层状态。

## 10. 迁移与兼容

1. 保留现有 Goal 文件、revision、receipt、review、probe 与 transcript，不重写旧证据。
2. 现有自由 Session 保持可打开、搜索、归档和恢复。
3. 历史 Lead 归档会话仍是普通可读历史，不成为当前 Lead。
4. 为存量 Goal 建立项目 / Pod 归属时只接受可证明的目录与文件关系；禁止找不到归属时回落到第一个注册项目。
5. 对可证明归属的历史终态 Goal 也可补入 Pod 读模型，避免「重启后历史消失」；无法证明归属的记录进入迁移报告，不静默错挂。
6. 存量 Pod-less Goal 只在归属可证明时以只读历史导入；新执行入口一律经过 Lead + 项目 Pod，不再延续 Pod-less 写入分支。
7. `pod_tasks` 可从文件重建；手工 note 与计划任务继续区分。
8. 旧导航入口和 Deep Link 可重定向到新工作空间，但不再实例化第二套 Goal 详情状态。
9. 本轮不迁移或重写谐波记忆数据。

## 11. 非目标与边界

- 不实现 DeepSeek 的 Source / Trigger / Eval / Mandate、外部 IM / GitHub 监听或主动投机执行。
- 不重新设计工具权限、审批策略本身；仅要求执行路径不得绕过它们。
- 不改变进程 PID、gateway.pid、serve sidecar 或 desktop sidecar 的进程管理逻辑。代码里的 `pid` 也可能是 `projectID` / `providerID` 的局部缩写，不属于 Pod / Goal 领域标识。
- 不在本轮新建跨项目全局 Inbox；先把单项目工作空间与统一 Goal 读模型做正确。
- 不做视觉风格换新；本轮是信息架构、领域归属和执行逻辑。
- 不把自由讨论自动转为 Goal，不让 Tech Lead 代替用户扩大授权。

## 12. 验收场景

### 12.1 自由讨论

- 新建话题只产生自由 Session，不产生 Goal，不增加工作计数。
- 明确「按这个做」后产生一个 Goal，并保留来源 Session / message 引用。
- 删除来源讨论不影响 Goal；取消 Goal 不删除来源讨论。

### 12.2 小 debug

- 用户向 Lead 明确提出一个小修复后，仍创建一个 Goal。
- Tech Lead 选择快速路径，一个 Worker 完成；没有强制完整计划审批与独立 Reviewer。
- Goal 在概览中可见，完成后留下结果、改动和验证证据。
- Lead 发出一次完成通知；结果不计入「需要你」，无需人工接受即可结束。
- 用户不满意时可打回给 Tech Lead；反馈进入同一 Goal 的下一 revision，Tech Lead 决定修复路径，旧结果与证据不被改写。
- 没有独立评审时显示「已完成 · 未独立评审」，不产生虚假 PASS。
- 杀掉或替换 Worker Session 不会使 Goal 消失或错误变成另一个业务状态。

### 12.3 复杂 Goal

- Tech Lead 可选择协作路径，现有计划、审批、Builder、Reviewer、结果与打回流程仍可用。
- 打回使用同一 Goal 的新 revision，旧证据不变。

### 12.4 文件派工

- Worker prompt 中包含完整任务、验收、上下文与产物路径。
- 在谐波记忆检索无命中的测试环境中，Worker 仍能仅凭显式派工内容完成职责。
- `pod_tasks` 删除或重建后可从任务文件与 receipts 恢复一致投影。

### 12.5 Desktop 一致性

- Lead 卡片、概览和详情显示同一 Goal 的同一状态与结果。
- 所有当前、排队和历史 Goal 均可到达；计数与列表一致。
- 旧 Goals 页面不再提供另一套真相源。
- 同一执行 Session 从任何入口打开都有一致的 Goal / revision / 角色身份。
- 快速 Goal 不显示无意义的完整流水线空阶段；协作 Goal 能展开完整证据。

## 13. 设计者留出的实现选择

以下不改变产品模型，可交给实现计划：

- 统一 Goal 读模型采用新聚合端点还是收敛现有端点。
- 快速 / 协作策略在现有 state 与执行文件中的具体字段名。
- 旧组件物理删除与路由重定向的实施顺序；产品语义上不再保留第二套页面。
- 工作项详情的具体组件拆分与响应式布局。
- 存量 Goal 归属迁移采用离线脚本、启动迁移或按需校准，但必须满足第 10 节的不静默错挂要求。
