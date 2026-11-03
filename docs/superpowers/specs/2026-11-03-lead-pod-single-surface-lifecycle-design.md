# Lead 单一展示面与项目/Goal Session 生命周期设计

日期：2026-11-03  
状态：待用户批准  
前置调研：`docs/research/2026-11-03-lead-pod-session-surface-audit.md`

## 1. 背景与问题

目标模型是：一个项目一个逻辑 Lead、一个 Pod；Lead 从鲸群进入；不同 Goal 的 Tech Lead 和 worker 使用各自隐藏的 session。

当前实现存在两套未完全收敛的机制：

1. 桌面工作 rail 的 `ManagerCard` 会从历史 `role:manager` 会话回退出“当前 Lead”，并从全局 `/api/goals` 显示阶段。
2. 新 Pod 通过 `pod_member_sessions.node='coordination'` 绑定另一个 Lead。
3. `manager-session` kv 与 Pod coordination binding 可能分裂；当前项目已实读到 kv 404、Pod 却有 active Lead，同时工作栏还显示旧 Manager。
4. 鲸群打开 Lead 时没有补齐 Lead metadata，导致标题和 ChatPane 身份退化。
5. Builder/Reviewer/Probe 的隐藏规则不统一；Tech Lead 旧 revision 的 active lease 没有退休路径。
6. 文档同时存在“左侧固定 Lead 入口”“用户不能 rotate Lead”“Tech Lead 跨 revision 连续”等互相或与现实不一致的表述。

这不是简单改名可以解决的问题，需要同时收敛展示归属与生命周期权威。

## 2. 目标

1. 一个项目只有一个当前逻辑 Lead；同一时刻只有 active runtime 的一个 Lead 运行载体参与协调。
2. 左侧「工作」只列普通会话，不再提供固定 Lead/Manager 入口，也不把历史 Manager 提升为当前 Lead。
3. 鲸群成为项目 Lead 的统一入口；Lead 对话仍可在主内容区 tab 展示。
4. Lead 从鲸群打开后，标题、角色、agent 锁和 Tech Lead invite 与既有 Lead 行为一致。
5. Lead 的 kv、Pod binding、runtime session 活性由同一生命周期服务收敛，可恢复且不复制身份。
6. Tech Lead 继续按 `Goal + revision` 隔离；同 revision 的 plan 复用讨论 session；旧 revision lease 可退休且证据保留。
7. Builder/Reviewer/Probe 都作为内部 session 隐藏，普通工作 rail 不暴露其运行管理。
8. 保留历史 Manager 会话的可读性，但它们永不参与“当前 Lead”解析。
9. 保持 harmonic memory 行为与存储格式兼容，不改变 Goal/revision/round/attempt 语义。

## 3. 非目标

1. 本批不重写 Pod 调度队列，不处理 `startGoalDirect` 绕过单 active execution 的问题；该事项进入独立后续设计。
2. 不删除或改名公开 wire API：`manager-session`、`manager.rotate`、SDK namespace 暂时保留为内部兼容面。
3. 不物理删除历史 Manager、旧 Tech Lead 或旧 revision 的证据/产物。
4. 不把 Tech Lead 改回“同 Goal 跨 revision 共用一个 session”；当前 `Goal + revision` 隔离在本批被明确为正式契约。
5. 不引入多项目共享 Lead、多 Pod 共享 worker 或跨 Goal 默认上下文共享。
6. 不清理与本次架构无关的旧 smoke Goal；运行数据清理由正式生命周期/API 另行执行。

## 4. 核心词汇与不变量

### 4.1 Lead 与 Lead session 不是同一个概念

- **Lead**：稳定的项目级逻辑身份。
- **Lead session**：某个 runtime 中承载该身份的、可恢复/可替换的运行上下文。
- `runtimeSessionId` 只用于接线，不能成为 UI 或 Goal ownership 主键。
- `byRuntime` 中其他 runtime 的休眠 slot 不是额外 Lead；只有 active runtime 的 slot 可参与当前解析。

### 4.2 当前 Lead 的合法来源

只允许两种证据参与当前 Lead 解析：

1. active runtime 的 `manager-session` slot；
2. 当前项目 Pod 的 active `coordination` binding，且仅用于 kv 缺失/死亡时的恢复接管。

以下来源**永远不合法**：

- 历史会话列表中的 `role:manager` 或 `manager-archived`；
- 最近更新、标题包含 Manager/Lead 的普通会话；
- 非 active runtime 的休眠 slot；
- 已 ended 的 Pod coordination 行。

### 4.3 Goal 级 session

- Tech Lead：`(podId, memberId, goalId, revision, discussion)`。
- 同 revision 的 plan 复用该 discussion session。
- Builder execute、Reviewer review、Builder Probe：各节点独立 session，并绑定到对应 Goal/revision。
- 所有上述 session 都是内部实现，不在普通工作 rail 暴露。

## 5. Lead 生命周期统一

### 5.1 单一生命周期服务

新增一个 gateway 内部 Lead 生命周期服务（建议 `core/manager/lead-session-registry.ts`），收敛现有 `ensureManagerSession`、Pod Lead binding、manager-session 读取和按 session 反查。

对外保持现有 API 形状，内部提供三类操作：

- `current(projectDir)`：只读当前 active-runtime Lead；不创建会话。
- `ensure(projectDir)`：幂等确保一个可用 Lead，并同步 kv 与 Pod binding。
- `findBySessionId(sessionID)`：仅供 recall 等内部读取，按 active-runtime slot 正确识别 Lead。

服务复用 `readManagerSlot/writeManagerSlot`，不得再直接假设 kv value 是 `{sessionId}`。

触发边界明确如下：

- `GET /api/manager/session` 与 Pod lookup 保持只读，轮询绝不创建或替换 Lead。
- 新增显式 `POST /api/pods/:podId/lead/ensure`：用户从鲸群点击 Lead 时先 ensure，再刷新 Pod detail 并打开 coordination session。
- gateway 启动只为**已经存在 Pod**（或已有 in-flight Goal）的项目执行 ensure；不再为所有 registered project 预先创建无入口的 Lead。
- 显式创建/确保 Pod、既有 Goal recovery 也调用同一 ensure。Pod-less 项目从 Welcome 点击 Lead 只进入鲸群空态，由用户显式创建 Pod，不静默建 Pod/Lead。
- worktree 继续遵循父项目 Pod 的只读/归属规则，不在 worktree 另建 Lead。

桌面 UI 不再自行合并 kv 与历史会话：**当前 Pod 的 active coordination binding 是 Lead id 的唯一 UI 权威**。kv 是 gateway 的兼容与恢复证据，不是第二个前端真相源。SessionStrip 恢复必须等当前项目 Pod lookup 有结论；结论未回前保留 Lead tab，不得因 manager-session 404 或 Pod 尚在加载而 prune。

### 5.2 ensure/reconcile 规则

按以下顺序处理：

1. **kv live**：active-runtime slot 存在且 session 活性探测通过 → 采用它，重新登记 `role:'lead'`，并幂等绑定 Pod。
2. **kv missing/dead，Pod live**：当前 Pod active coordination session 活性探测通过 → 接管它，把其 id 写回 active-runtime slot，再重新绑定。
3. **两者都不可用**：创建一个新 Lead session，写入 slot、登记内部角色并绑定 Pod。
4. **kv 与 Pod 指向不同 live session**：kv live 优先；Pod 旧 coordination 行 ended，但旧 transcript/证据不删除。
5. 每次恢复只影响当前项目和 active runtime；其他 runtime slots 原样保留。

跨 runtime 创建与 DB 更新无法成为一个事务，因此所有步骤必须可重入：下一次 ensure 能从 kv 或 Pod 任意一侧的中间状态恢复。不得因为一次绑定失败再创建第二个 Lead。

项目键统一经过 `canonicalProjectDir`。读取时允许按 canonical project 找到旧 raw-key slot；写入只写 canonical key。存量 key 迁移必须保守：

- 只有一个 legacy variant 含 active-runtime live slot 时，可接管到 canonical key。
- 多个 variant 都声称 live 时，canonical exact key 优先；没有 exact key 时不得静默任选：有 Pod live 则接管 Pod，否则保持原行并显式报冲突，绝不新建第二个 Lead。
- worktree-keyed slot 不自动并入父项目，避免把另一工作上下文误认为项目 Lead。
- 旧 raw key 和其他 runtime slots 不物理删除；迁移/接管幂等。

### 5.3 活性与隐藏

- 活性探测复用 runtime session 读取；传输错误按 fail-open 处理，明确不存在才重建。
- 当前 Lead 使用 `projectLeadSessionMetadata()` 和内部角色 `lead`，在普通 session list 隐藏。
- Pod reconcile 不再完全跳过 coordination：它调用同一 Lead 生命周期服务做幂等校准，但不自行发明另一套恢复规则。
- `GET /api/manager/session` 保持响应 DTO 不变，改为经过统一读取逻辑。
- Goal snapshot 的 session 反查改为 `readManagerSlot`/统一服务；active-runtime slot 命中才注入，修复当前 `byRuntime` 读取失效。
- Lead 被替换/旧 coordination 被 ended 前，先 best-effort 写 transcript snapshot，使旧 Lead 可从 Pod 历史读取。
- 替换后的旧 Lead 解除当前 internal-role 绑定，并将 metadata 降为 `lead-archived`；该角色作为普通历史会话可见，但永远不参与当前 Lead 解析。这样即使 snapshot 失败，也不会把旧 Lead 证据困在隐藏 session 中。

### 5.4 历史 Manager 与 rotate

- 历史 `manager`/`manager-archived` 会话仍按普通历史会话可读，但不作为当前 Lead fallback。
- 桌面移除 Lead 的「新话题」/`/new-topic` 人工 rotate 入口；用户不管理 Lead session。
- 同步退役 `mafw_new_topic` 与内置 `new-topic` 用户命令注册；不能留一条 agent/命令侧的人工 rotate 旁路。
- 内部 compact/recovery 可复用替换能力；既有 HTTP/SDK API 暂保留并标为内部兼容，不在本批做 wire 破坏。
- 旧 `manager-archived`/`lead-archived` 是否可见不再影响当前 Lead 解析；本批不批量改写历史 manager metadata。

## 6. 展示归属

### 6.1 左侧工作 rail

- 删除 `ManagerCard` 及其 LeftDock 接线、props、CSS 和专属轮询。
- `session-tree` 不再提取一个 manager/Lead 置顶节点；历史 Manager 会话回到普通时间分组，避免删除卡片后最新旧 Manager 被静默吞掉。
- 当前 Lead 因内部隐藏规则本就不应出现在该列表；不得新增其他 fallback。
- ManagerCard 原有的全局 Goal phase/question badge 不搬迁。Pod 状态由 Pod stage/attention 展示，原 Dashboard/Approvals 入口继续存在。

### 6.2 鲸群作为统一 Lead 入口

- 左栏 Pod face 与右侧 Pod 团队 tab 继续复用同一 coordination session。
- `openPodSession` 增加 Lead 分支：统一标题 `Lead`，传入 `manager=true` 与 `leadTabMetadata()`。
- `openSessionTab` 在 tab 已存在且调用方提供角色/metadata 时必须补齐或更新它们，不能只改标题。
- 从左右鲸群入口重复打开同一 Lead，只激活同一 tab，不创建副本，不出现 `Chat N`、`Pod · Lead` 或 agent 解锁。
- SessionStrip 可保留已经打开的 Lead 对话 tab；它是内容展示，不是另一个 Lead 身份或普通会话入口。
- Lead chat 中创建 Goal、Tech Lead invite 与 Goal+revision 对话路径保持不变。

### 6.3 Welcome 与其他文案

- Welcome 的「Lead 会话」改为打开当前项目鲸群入口；没有 Pod 时落在鲸群空态，由用户显式创建，不自动建 Pod/Lead。
- Welcome 删除内联 Goal 输入框与旧 `planReview` 开关；「新建 Goal」直接打开 Pod Goal composer，不做跨组件草稿搬运。Pod composer 自带的计划批准选项继续作为唯一入口，Lead chat 内通过自然语言创建 Goal 的路径仍保留。
- Dashboard 的用户可见 `Manager` 文案改为 `Lead`。
- spec/plan/AGENTS 中“左侧固定 Lead 入口”的旧契约同步改写为“鲸群统一 Lead 入口”。

## 7. Goal 级内部 session 生命周期

### 7.1 Builder / Reviewer / Probe 隐藏

- 节点 session 创建时按节点登记内部角色：`builder`、`reviewer`、`probe`。
- 这些角色加入统一隐藏口径。
- 为防 internal-session kv TTL 剪枝后复活，`mafw-execute`、`mafw-review` 作为确定性内部 agent 补充隐藏依据；不隐藏通用 `build`/`plan` agent。
- Pod/Goal 时间线和 transcript 仍按现有 Pod binding 读取，不因普通列表隐藏而丢失证据。

### 7.2 Tech Lead revision 退休

- revision 进入 `completed / aborted / discarded` 任终态时，对**该 revision** 的 discussion scope 执行退休；不得误伤下一 revision。
- 除未来 transition 外，启动/recovery 后增加一次存量校准：凡 `revision !== root.activeRevision` 或所属 revision 已终态的 active discussion lease 都退休。校准必须在 Goal recovery 之后、节点恢复推进之前执行，避免误伤在飞 plan。
- 退休前以 best-effort 保存 transcript snapshot；旧 revision 文件、状态快照、waves/eval/review 证据保持 append-only。
- 退休表示 active lease 结束，本批不强制物理删除 runtime session，也不允许旧 lease 再被当作当前 revision 的讨论入口或 Pod member 的最新打开目标。
- 打回时顺序保持：先收尾旧 revision 并退休其 lease，再打开 N+1；新 revision 获取独立 session/generation。
- plan 复用只查当前 revision 的 active lease，ended lease 永不复用。

### 7.3 旧 roster 规范化

- `PodService.ensureMembers` 幂等把既有 Lead 的 `agentName:'manager'` 升级为 `'lead'`。
- 不改变 member id、session binding、Pod id 或历史行；新 Pod 默认值不变。

## 8. 兼容与失败策略

1. `manager-session` kv/API/SDK 名称保留，用户展示只使用 Lead。
2. 活性探测传输错误不销毁现有 Lead；明确 dead 才替换。
3. snapshot 失败不阻断 revision 退休，但记录 warning，且不删除 runtime 证据。
4. Pod binding 失败可由下一次 ensure/reconcile 恢复，不重复创建 session。
5. 不回填或改写 harmonic memory；Goal snapshot 只修复 active Lead 识别。
6. 不在本批修改 Pod queue/active execution 语义，避免与生命周期恢复相互掩盖。

## 9. TDD 与验证

### 9.1 Gateway 先写失败测试

- kv live + Pod 空：复用 kv session 并绑定。
- kv missing + Pod live：接管 Pod session，不新建第二个 Lead；只有显式 ensure 触发修复，GET/lookup 轮询无副作用。
- kv dead + Pod live：接管 Pod；kv dead + Pod dead：只创建一个替代 session。
- kv/Pod 不同 live：kv 获胜，旧 coordination ended、旧 Lead 归档且 transcript 可读。
- 非 active runtime slot、历史 manager、worktree-keyed slot 均不参与当前项目 Lead 解析；raw-key 冲突不静默任选。
- Pod-less registered project 启动时不预建 Lead；已有 Pod 才执行启动 ensure。
- Goal snapshot 在 `byRuntime` 形状下仍能识别 active Lead。
- 旧 roster `manager→lead` 迁移幂等。
- Builder/Reviewer/Probe 在普通列表隐藏，Pod binding/transcript 仍可读取。
- revision N 退休只结束 N 的 discussion lease；N+1 session 独立，旧产物不变；存量非 active/终态 revision lease 也在 recovery 校准中退休。
- `mafw_new_topic`/内置 new-topic 注册移除后，内部 recovery 仍可替换 Lead，旧 Lead 归档可读。

### 9.2 Desktop 先写失败测试

- 工作 rail 无 ManagerCard；历史 Manager 仍在普通时间分组。
- 左右鲸群打开 Lead 均为同一 tab、标题 `Lead`、角色 `lead`；打开前先显式 ensure，普通 refresh 不触发 ensure。
- 已存在无角色 tab 会被补齐 metadata，agent 锁和 invite 正常。
- Welcome 两个入口分别到鲸群/Pod composer；无 Pod 时不自动创建；旧内联 Goal 表单与 planReview 开关不再渲染。
- Lead 不出现人工 rotate 入口。
- Lead tab restore 只等待/采用 Pod coordination，不再读取历史 manager fallback；Pod 未定论时不 prune，明确无 Lead 后才按普通规则处理。
- 更新/删除旧 ManagerCard 固定行契约测试。

### 9.3 集成与真实 UI

- 用当前“kv 缺失 + Pod active”形态验证恢复后只有一个 Lead。
- 验证两个不同 Goal、同 Goal 两个 revision 的 Tech Lead session 不混用。
- GUI 检查：工作 rail 无固定行；鲸群打开 Lead；标题/agent 锁/invite；普通列表无 Builder/Reviewer/Probe。
- 重载 desktop 与重启 gateway 后重复上述检查，确保不是内存态假修复。
- 全量 gateway、desktop、SDK、typecheck 与 build 按仓库门禁执行；交付报告新增测试数和全量通过数。

## 10. 完成定义

1. 当前项目不再出现“工作栏旧 Manager + 鲸群新 Lead”双入口/双当前身份。
2. Lead 的唯一项目级入口是鲸群；其主聊天页身份完整。
3. Lead kv/Pod/runtime 三种状态可从任意一种合法中间态幂等恢复。
4. Goal 级 session 全部隐藏，Tech Lead revision 边界与退休语义明确。
5. 历史 Manager 和 revision 证据仍可读，未被批量删除或改写。
6. 设计、计划、AGENTS 与测试使用同一契约。
