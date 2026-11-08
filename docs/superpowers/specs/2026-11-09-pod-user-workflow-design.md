# Pod 用户使用路径：双对话入口 + 工作优先级 + 右侧原地详情

日期：2026-11-09
状态：交互方向已经用户认可；本文是实施前的完整设计。

## 1. 意图与原因

Pod 的高频用户路径不是管理一套多 agent 组织，而是：

1. 和 **Lead** 讨论项目、交代工作；
2. 围绕某个 Goal 和 **Tech Lead** 讨论方案；
3. 查看该 Goal 下 Builder / Reviewer 的进度与最终结果。

当前桌面端把“联系人、内部协作日志、团队设置、Goal 目录、执行详情”平铺成同一套管理界面，导致高频动作被低频信息淹没。此次改版把用户路径重新收敛为：

> **左侧 Pod 管“和谁讨论”；右侧工作管“事情做得怎样”。**

## 2. 用户已拍板的决定

- 左侧 Pod 和右侧「工作」是本次要改的两个入口。
- 用户日常只会主动和 **Lead / Tech Lead** 对话。
- Builder / Reviewer 的价值体现在 Goal 的进度和结果里，不是需要用户直接联系的联系人。
- 右侧「工作」必须能打开**所有 Goal**，但首屏先呈现最重要的消息，再保留完整列表。
- 点击 Goal 后，详情在**右侧工作面板内部原地展开**；不要弹窗、遮罩或额外页面层级。
- 交互样稿已得到用户“可以”的确认：左侧双入口、右侧重要消息 + 全部 Goal、详情原地下钻并返回。

## 3. 目标

1. 左侧 Pod 首屏让 Lead / Tech Lead 两个入口一眼可见、一键可达。
2. 右侧工作首屏优先回答“现在需要我做什么 / 有什么新结果”。
3. 所有 Goal 仍然可见、可过滤、可打开；不以重要性排序牺牲完整性。
4. Goal 列表直接提供真实、可读的 worker 阶段与任务进度。
5. Goal 详情成为右侧工作的下钻状态；返回后保留原列表上下文。
6. 保留现有计划审阅、人工作答、方向裁定、任务编辑、结果打回、探针、重试和取消能力。

## 4. 非目标与反目标

### 非目标

- 不改变 Pod 后端角色模型、Goal 生命周期或 NodeDriver。
- 不改变 Lead / Tech Lead 的身份、会话归属和隐藏会话规则。
- 不重做移动端；移动端可复用词汇，但不属于本批交付。
- 不调整 Orcalore 品牌、主题 token 或右工作台其他主面。
- 不删除团队、邮箱、Pod 记忆、便签；只把它们从日常首屏降级到次级入口。

### 反目标（即使功能正确也算失败）

- 把 Builder / Reviewer 继续作为与 Lead 同等级的“待联系成员”展示。
- 在重要消息区重复展示同一个 Goal 的多条内部日志。
- 用编造的百分比、进度或结果摘要填充空白。
- 点击 Goal 后仍打开 `.mafw-goal-overlay` 或遮住对话区。
- 进入详情后丢失当前项目、右侧工作台或 Lead / Tech Lead 对话状态。
- 为了简化界面而删除人工批准、回答、结果打回等必要控制。

## 5. 当前实现与主要问题

- `LeftDock.tsx` 的 Pod face 当前渲染 `ProjectResources.tsx`：团队设置、邮箱、Pod 记忆、便签、四人班底与内部最近消息占据首屏。
- `pod-model.ts:memberFocus()` 的 Tech Lead 左侧入口会从 live 或第一个非终态 Goal 中自动选目标；新界面必须让 Goal 上下文可辨识，不能让它像随机跳转。
- `ProjectWorkView.tsx` + `WorkOverview.tsx` 当前是五桶 Goal 长列表；行主要展示 stage / revision / strategy 等工程元数据，没有 worker 进度。
- `WorkOverview` 的「全部历史」当前只触发重新加载，没有打开不同内容；本批应删除该误导动作或由真实历史过滤替代。
- `GoalDetailOverlay.tsx` 已聚合 timeline、revision、任务、问题、方向、探针和结果，是详情实现的主要复用来源；但 `MafwShell.tsx` 目前在根部用 `.mafw-goal-overlay` 弹出它。
- `work.overview` 当前返回 `PodGoal` 列表；已有 `stage`、`currentAssignment`、`resultReady` 等字段，但没有列表级任务计数或结果摘要。

## 6. 目标信息架构

### 6.1 左侧 Pod：双对话入口

首屏顺序固定为：

1. 标题「Pod」与当前项目语义；
2. **Lead** 主入口：项目协调、创建 Goal、整体进展；
3. **Tech Lead** 入口：方案讨论，并显示将打开哪个 Goal 的讨论；
4. 「需要你」摘要（仅数量大于 0 时出现），点击打开右侧工作并定位到最高优先级事项；
5. 「新建 Goal」；
6. 折叠的「团队、邮箱与共享记忆」。

规则：

- Lead 继续走现有 `openLeadEntry` / `ensureLead` 通路，可打开即恢复 coordination 会话。
- Tech Lead 继续走现有 `openTechLead` / ensureSession 通路，但必须显示当前目标 Goal；有 live discussion 时优先沿用，没有可用讨论时才选择非终态 Goal。
- **Lead / Tech Lead 都是普通会话**：入口只负责选中/确保对应 Pod session 并打开现有 ChatPane。必须复用普通 session 的 composer、消息发送、历史、SSE 流式、权限、模型/thinking 配置与排队能力；不得新建只读讨论面板、旁路发送 API 或第二套聊天状态。
- Builder / Reviewer 不在首屏作为联系人展示，也不显示“查看快照”这种低频动作。
- 「最近消息」不再展示内部 `Lead → Lead`、goal id、verdict 等日志；内部邮箱仍可在次级资源页查看。
- 左侧 Rail 的目的地词汇可从「资源」恢复为更贴近用户心智的「Pod」；是否同步改图标留给了实现者，不能影响现有 badge 与键盘行为。

### 6.2 右侧工作：重要消息 + 全部 Goal

默认是「工作概览」，顺序为：

1. 单一标题区「工作」+「新建 Goal」；删除重复的「项目工作 / 工作概览 / N 项工作」标题堆叠。
2. **现在需要关注**：
   - 人需要处理的计划批准、方向裁定、问题、阻塞；
   - 尚未查看的结果；
   - 每个条目提供唯一直接动作，例如「审阅计划」「回答问题」「裁定方向」「查看结果」。
3. **全部 Goal**：完整集合与过滤器「全部 / 进行中 / 结果 / 历史」。

重要消息规则：

- 从现有 `work.overview` / `pod_events` 投影，不新建另一套提醒真相。
- **只显示 Goal 当前 active revision 的重要事项**（用户已拍板）：旧 revision 的未读结果不再占据提醒区，也不为本批新增历史 revision 导航；旧结果证据与历史记录仍保留。
- 当前 `(goalId, revision)` 在重要区最多一张卡；有人工作答与未读结果同时存在时，人工作答优先，另一项可在详情中看到。
- 排序：需要人工处理的阻塞项优先，其后是当前 revision 的未查看结果。本批**不新增 `stageUpdatedAt`**：人工事项保持 overview 的稳定顺序，结果可按当前 revision 的 pod_event `createdAt` 排序；并列时以 goalId 稳定收尾，避免使用不能代表阶段更新时间的 `startedAt` 冒充“刚刚更新”。
- 重要区为空时不显示空框或“0 条提醒”，直接展示全部 Goal。
- 「全部 Goal」始终保留完整集合；过滤只改变列表，不改变总数口径。
- 结果是否已查看继续使用 `pod_events seen` + legacy `viewedResults` 双读，并沿用成功加载结果后再标记 seen 的行为。

Goal 行一等内容：

- Goal 标题；
- 人类可读阶段（例如“等待批准 / 实施中 / 待评审 / 新结果 / 已完成”）；
- 当前负责角色与真实任务进度（有数据时）；
- 未查看结果标记。

工程字段（phase、revision、Loop、verdict 原文、策略）不再占据行首；需要时进入详情次级信息。没有任务数据时只显示真实阶段，**不得显示 0/0 或伪造百分比**。

### 6.3 Goal 详情：右侧原地下钻

- `MafwShell` 仍持有当前 `goalId` 与 `focus`，但它是右侧工作的选择状态，不再驱动根部 overlay。
- 打开任意 Goal（列表、重要消息、通知、托盘导航、attention、创建成功）都统一执行：
  1. 打开右侧工作台「工作」；
  2. 设置选中 Goal；
  3. 右侧从概览原地切换为详情；
  4. 按 focus 定位计划、问题、方向或结果。
- 详情顶部提供「返回全部 Goal」；返回只清除选择，不卸载 Pod、聊天或工作台。
- 返回后保留原过滤器与列表滚动位置；实时刷新不得把用户踢回列表。
- 切项目时清除旧项目选择；同项目刷新或 remount 不应意外打开另一条 Goal。
- 右侧详情不设置 modal 焦点陷阱，不显示遮罩；Esc 不应像弹窗一样破坏工作状态。
- 本批只消除 **Goal 详情**弹窗。计划审阅等已有专注界面是否保留 overlay 由实现者按最小改动决定，但主路径绝不能先弹出旧 Goal 详情。

详情内容顺序：

1. 标题、可读阶段、「和 Tech Lead 讨论」；
2. 当前需要用户执行的动作（若有）；
3. Tech Lead → Builder → Reviewer 的角色阶段条；
4. 任务进度与验收状态；
5. 结果（有结果时按 `focus=result` 直接定位；已完成 Goal 默认让结果尽早可见）；
6. 计划与验收、产物、版本历史、详细时间线等次级内容。

现有 `GoalDetailOverlay` 的数据加载、协作操作与结果 seen 逻辑应优先抽成/复用为 inline panel，而不是另写一套 Goal 详情状态。

## 7. 数据与接口设计

优先使用现有 API；为满足列表进度，可做**向后兼容的 additive 扩展**：

- 在 `PodGoal` / `PodGoalView` 增加可选进度投影，或在工作响应中增加按 goalId 索引的可选投影。
- 进度来源是现有 `pod_tasks` / 当前 revision 的计划任务，不从文本推断。
- 可包含：任务总数、完成数、进行中数、待审数、失败数；当前角色优先使用 `stage.role` / `currentAssignment.role`。
- 缺数据时字段为 `null/undefined`，客户端降级为阶段文字。
- 若列表展示结果摘要，只能来自现有真实结果证据（如 review feedback / receipt），不调用 LLM 生成；结果摘要可以留到详情，不能为填满列表而增加昂贵读取。
- 所有新响应字段必须同步 SDK 类型、契约产物与兼容测试；旧 gateway 缺字段时桌面仍可用。

具体字段放在 Goal 行还是独立 map、进度聚合发生在 service 还是 route，留给实现者根据现有 `PodGoalService.views()` / `PodStore` 接缝决定。

## 8. 组件与状态接缝

建议的最小改动路径（实现者可调整命名，但不能改变行为）：

- `ProjectResources.tsx`：改为双联系人 + 次级资源入口；复用 `pod-rail-face-model.ts` 的纯函数模式。
- `ProjectWorkView.tsx`：持有/接收选中 Goal，切换 `WorkOverview` 与 inline Goal detail。
- `WorkOverview.tsx`：拆出重要消息区与完整列表；过滤、计数、已读状态来自同一 overview。
- `GoalDetailOverlay.tsx`：抽取或改造为可复用的 `GoalDetailPanel`；移除 overlay 外壳由外层负责。
- `MafwShell.tsx`：`openGoalDetail` 统一打开右工作；删除根部 `GoalDetailOverlay` 挂载；保留通知/deep-link 的 goalId + focus 语义。
- `WorkbenchShell.tsx` 不需要增加新 L1 tab；详情仍是「工作」内部状态。

实现不得把 runtime 名或 runtime capability 重新引入业务 UI；继续走现有 SDK / preload / Experience 边界。

## 9. 可访问性与响应式

- 联系人、重要消息和 Goal 行均可键盘打开，有可见 focus。
- 「返回全部 Goal」是明确的按钮，不依赖 Esc。
- 详情切换后焦点到详情标题或返回按钮；返回后焦点回到原 Goal 行。
- 右侧宽度不足时，详情在自身面板滚动，不能把聊天列或发送按钮挤没。
- 在 1088 / 1366 / 1600 宽度检查；Focus 模式下也保持同一 inline 语义。
- 减少动态效果设置下不使用列表↔详情滑动动画。

## 10. 测试与验收（TDD）

### 纯逻辑先行

1. 重要消息投影：人工事项优先、当前 revision 未读结果其次、同 goal+revision 去重、旧 revision 提醒排除、全部 Goal 不丢项；无阶段时间戳时保持确定性顺序。
2. 过滤与计数：全部 / 进行中 / 结果 / 历史；计数与可见数组一致。
3. Goal 进度：完成/进行/待审/失败计数；无数据显示未知而非 0/0。
4. 联系人模型：首屏只有 Lead / Tech Lead，资源仍可达。
5. 详情选择：open / back / focus / 切项目 / 同 Goal 刷新 / 通知与 deep-link。

### 接线与契约

- 断言 Goal 详情渲染在右侧「工作」子树内，根部不再存在旧 `.mafw-goal-overlay`。
- `openGoalDetail` 的所有入口统一走右工作；创建成功、结果通知、attention 不得回到旧弹窗。
- 若扩展 overview 响应，SDK 类型、OpenAPI/契约与旧 gateway 降级均有测试。
- 现有结果 seen、计划批准、问题回答、方向、打回等套件不得靠删除用例变绿。

### 真机 GUI 验收

- 左 Pod 打开后首先看到 Lead / Tech Lead；两个对话入口均可达。
- 右工作先看到重要消息，下面能看到全部 Goal。
- 点击 Goal → 右侧原地详情；聊天和 Pod 保持；无遮罩。
- 返回后过滤器、滚动位置和焦点恢复。
- 从结果通知 / 托盘导航进入同一 inline 详情并正确定位结果。
- 计划批准、问题回答、结果查看与打回至少各走一条真实路径。
- 1088 / 1366 / 1600 与 Focus 模式无溢出、无发送区遮挡。

## 11. 交付边界

- 本批是桌面交互与必要读模型增强，不是 Pod 领域重写。
- 默认不改 gateway 行为语义；若只凭现有字段就能满足列表，允许不加接口字段。
- 不将样稿中的演示进度、消息或结果写进生产。
- 实施完成后按仓库惯例报告新增测试数、全量通过数、构建与真机验收结果。
