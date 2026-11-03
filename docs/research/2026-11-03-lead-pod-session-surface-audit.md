# Lead / Manager / Pod 展示与 Session 归属调研

日期：2026-11-03  
范围：只读调研；未修改产品代码。  
方法：设计契约与测试、gateway 生命周期、desktop 展示面三路并行代码审查，并对当前 gateway/Pod 运行数据实读复核。调研子代理模型：`gateway/volcengine/deepseek-v4.1-flash`。

## 1. 结论摘要

用户提出的目标模型合理且与协作 Goal Loop 的主体设计一致：

- 一个项目一个逻辑 Lead、一个 Pod。
- Lead 是项目级常驻协调身份，用户不手动管理其 runtime session。
- Lead 的项目级入口放在鲸群 UI，不在普通「工作」会话栏重复出现。
- Tech Lead / Builder / Reviewer / Probe 是 Goal 级隐藏运行上下文；不同 Goal 使用不同 session，Tech Lead 当前实现进一步细化到 `Goal + revision`。
- 主内容区仍可展示 Lead/Tech Lead 对话，但普通工作 rail 不应把这些内部会话当成普通会话重复列出。

当前实现尚未完全满足该模型。最直接的问题不是单纯“显示了两个名字”，而是**旧 Manager fallback 与新 Pod Lead 并存，且当前项目的工作栏和鲸群实际指向两个不同的 runtime session**。

此外，调研发现若干超出 UI、但会影响同一目标模型的后端问题：Lead 真相源分裂、Pod 打开 Lead 时身份退化、worker session 可见性未统一、方向裁定后的启动绕过单 active execution 队列、旧 revision Tech Lead 租约未退休，以及设计文档与实现对 revision 连续性/固定 Lead 入口的矛盾。

## 2. 当前运行数据（实读）

项目：`C:\work\work-loop\opencode-plugin-mafw`  
Pod：`pod_d7ceb3025dbd`

### 2.1 两个不同的“Lead”入口

| 展示面 | 当前 session | 当前状态 | 来源 |
|---|---|---|---|
| 左侧「工作」固定 Lead 行 | `ses_f60d465aeffeb32518fD9eZ6vF` | 旧 `metadata.mafw.role='manager'`；在 Pod 中的 coordination 行已 ended | `session-tree` 从历史 manager 会话兜底，`ManagerCard` 展示为 Lead |
| 左侧/右侧「鲸群」Lead | `ses_e62c4d612ffeMEMsCQq7V3snek` | Pod 中 active `node='coordination'`，`goalId=null` | `pod_member_sessions` 的现行项目 Lead 绑定 |

同时：

- `GET /api/manager/session?projectDir=...` 返回 **404 `No manager session for project`**。
- 因此工作栏并非从 kv 获取现行 Lead，而是走了历史 manager fallback。
- Pod goals 与 attention 都为空，但 ManagerCard 显示「规划中」；其状态来自全局 `/api/goals`，不是 Pod。
- Pod `activeGoalId` 仍指向已清理的冒烟 Goal，`/api/goals` 也仍保留其内存项。这是上次手动清理 smoke 数据留下的运行态/DB 残留，不应与 Lead 架构问题混为一谈。

### 2.2 当前 roster

四个角色均存在：Lead / Tech Lead / Builder / Reviewer。  
旧 Pod 的 Lead `agentName` 仍为 `manager`；新 Pod 默认值已是 `lead`：

- 默认 roster：`gateway/src/core/pod/pod-service.ts:44-49`
- 只补缺失成员、不规范化旧值：`gateway/src/core/pod/pod-service.ts:311-327`

## 3. 目标归属模型

### 3.1 项目级

- `projectDir` 决定唯一 Pod；worktree 可映射回父项目 Pod。
- Lead 是逻辑项目身份，不应以 runtime session id 作为业务主键。
- Lead 的协调会话 `goalId=null`，不与任何 Goal 的技术上下文混合。
- 用户不需要创建、选择、切换或 rotate Lead session；崩溃恢复、compact、轮换属于系统生命周期。
- 普通工作 rail 只展示普通会话；Lead 通过鲸群进入。

### 3.2 Goal / revision 级

当前 Tech Lead session scope：

```text
(podId, techLeadMemberId, goalId, revision, kind='discussion')
```

实现：`gateway/src/core/pod/pod-session-supervisor.ts:77-107`、`pod-tech-lead-service.ts:384-399`。

- 同一 Goal revision 的讨论与 plan 复用同一个 Tech Lead session：`gateway/src/index.ts:1129-1142`。
- Builder execute、Reviewer review、Builder Probe 各自使用节点 session。
- 这些内部 session 应通过 Pod/Goal/Tech Lead 页面呈现，runtime id 不进入普通会话管理工作流。

### 3.3 设计文档需要裁决的一点

设计文档写的是“Tech Lead 同一 Goal 跨 revision 连续”，而代码按 revision 建不同 discussion session：

- spec：`docs/superpowers/specs/2026-11-02-pod-collaborative-goal-loop-design.md:337`
- code：`gateway/src/core/pod/pod-tech-lead-service.ts:384-399`

当前代码与用户“不同 Goal 可由不同 Tech Lead session 承载”的理解不冲突，但“同 Goal 打回后是否新开 revision session”需要明确写回契约。

## 4. Desktop 展示面盘点

### 4.1 工作栏 ManagerCard：应移除的重复入口

- 组件：`packages/desktop/src/renderer/mafw/components/ManagerCard.tsx`
- 挂载：`packages/desktop/src/renderer/mafw/components/LeftDock.tsx:429-438`
- 旧 manager 被提升为置顶行：`components/session-tree.ts:86-102`

它混合了三套数据：

1. Lead id：`manager-session` kv，缺失时回退历史 manager；
2. phase：全局 `goals.list()`，不是当前 Pod stage；
3. badge：全局 questions，不是 Pod attention。

因此会出现 Pod 空闲而工作栏“规划中”、kv 无现行 Lead 而工作栏仍显示旧 Manager 为 Lead 的情况。

### 4.2 鲸群已经有 Lead 入口，但打开后身份退化

入口：

- 左栏 Pod face：`components/PodRailFace.tsx:150-189`
- 右侧 Pod 团队 tab：`components/PodDock.tsx:430-461`
- session 选择：`pod-model.ts:146-158`

问题：`MafwShell.openPodSession` 只给 Tech Lead 附角色 metadata，Lead 走普通 `openSessionTab(sid,title)`：

- `packages/desktop/src/renderer/mafw/MafwShell.tsx:2000-2017`

后果：

- 左栏入口可能显示 `Chat N`，右侧入口显示 `Pod · Lead`，同一 session 标题不一致；
- `ChatPane.isLead()` 为 false，Lead agent 锁、专属行为失效；
- 已打开的 tab 不会被后续 `openSessionTab` 调用补齐 metadata：`MafwShell.tsx:393-415`。

**因此不能只删 ManagerCard；必须同批修复 Pod Lead 打开路径，否则唯一入口反而是功能降级入口。**

### 4.3 其他入口与展示面

- Welcome「Lead 会话 / 新建 Goal」：`WelcomeHome.tsx:156-186` → `MafwShell.tsx:417-462`
- SessionStrip 恢复已打开 Lead tab：`MafwShell.tsx:690-726`、`layout-persist.ts`
- Lead 主聊天页与 Tech Lead invite：`ChatPane.tsx:2079-2085`
- Dashboard 仍有用户可见 Manager 文案：`pages/Dashboard.tsx:98`
- `/new-topic` 仍调用 manager.rotate：`MafwShell.tsx:464-493`，与 spec“用户无 rotate 入口”存在契约冲突。

建议区分“入口”和“内容页”：Lead 对话仍可在主内容区 tab 展示，但入口统一归鲸群；普通工作 rail 不再放固定 Lead 行。Welcome 是否也改为打开鲸群，需要作为 UI 契约明确记录。

## 5. Gateway 生命周期与一致性问题

### 5.1 Lead 真相源分裂

当前同时存在：

- `kv_store('manager-session', projectDir).byRuntime[runtime]`
- `pod_member_sessions` 的 `node='coordination'` 绑定

当前项目已出现 kv 404 而 Pod coordination active 的分裂。`createManagerSession` 对现有 kv id 无 liveness probe，Pod reconcile 又跳过 coordination session：

- `gateway/src/index.ts:9407-9443`
- `gateway/src/core/pod/pod-service.ts:233-241`

需要一个明确的 LeadRegistry/协调生命周期权威，统一 kv 与 Pod binding、活性探测和重建，而不是让 UI 各自 fallback。

### 5.2 Goal snapshot 仍按旧 kv 形状读取

`manager-session` 已迁移到 `byRuntime`，但 recall 仍读 `value.sessionId`：

- `gateway/src/index.ts:7665-7677`
- 正确 slot reader：`core/manager/manager-session-runtime.ts:116-132`

结果：现行 Lead 的 `<goal-snapshot>` 注入会失效。该问题属于真实读取 bug，不是单纯命名兼容。

### 5.3 内部 worker 可见性未统一

隐藏名单覆盖 Lead/Tech Lead，但 Builder/Reviewer/Probe 创建时未统一登记 internal role：

- 隐藏口径：`gateway/src/core/session-visibility.ts:29-43`
- 节点 session 创建/绑定：`core/goal/driver.ts:450-467`、`core/pod/pod-service.ts:147-167`

这与“所有 Goal 级 session 都是隐藏运行上下文”的目标不完全一致。应统一注册/隐藏策略，而不是仅靠 UI 不主动展示。

### 5.4 单 active execution 可被方向裁定启动绕过

普通 goal_created 路径经过 `PodGoalService.enqueueGoal`，但 HTTP/MCP 方向裁定后的 `startPlanning` 直接调用 `startGoalDirect`：

- 调用点：`gateway/src/index.ts:4440,4938`
- 直接 advance：`gateway/src/index.ts:9030-9063`

该路径未检查另一 active execution、Pod paused/archived、budget/queue priority。新建 discussing Goal 也会直接覆盖 `pod.activeGoalId`：`pod-tech-lead-service.ts:223-241`。

因此“一个 Pod 一个 active execution”目前在启动边界上不是硬不变量。它与 UI 重复是不同层的问题，建议单独排期，不与展示修复混成一个无测试大改。

### 5.5 Tech Lead 旧 revision 租约未退休

`PodSessionSupervisor.retire()` 只有定义、无生产调用：

- `gateway/src/core/pod/pod-session-supervisor.ts:109-117`

revision 关闭后旧 discussion lease 仍可保持 active。需要定义退休、快照和恢复语义，避免历史 revision 累积活跃 runtime session。

### 5.6 其他兼容项

- `manager-session` kv/API 名称可继续作为内部兼容层，不等于保留两个项目级身份。
- `manager` identity alias → `lead` 是合理兼容。
- 旧 `manager`/`manager-archived` 历史会话保持可读与“不再把旧 manager 当作当前 Lead”应分开处理。
- `PodSessionScopeKind` 中 `project/implementation/review` 当前未实际使用；只有 `discussion` 走 supervisor，Lead/worker 仍走另一套生命周期。

## 6. 设计契约与测试冲突

1. 当前 plan Task 19 明确钉住左侧固定 Lead 入口：`docs/superpowers/plans/2026-11-02-pod-collaborative-goal-loop.md:1012-1023`。新决策“Lead 只从鲸群进入”需要更新 spec/plan/AGENTS，不能只改代码。
2. spec 不允许用户 rotate Lead，但桌面 `/new-topic` 仍存在。
3. spec 的 Tech Lead 跨 revision 连续性与代码 per-revision scope 不一致。
4. Reviewer PASS 后的“Lead 通知”当前实现是 `pod.updated {kind:'result'}` + 桌面通知，不是一条 Lead 聊天消息：`pod-goal-service.ts:442-483`。
5. 删除 ManagerCard 会影响以下测试：
   - `packages/desktop/tests/manager-row-wiring.test.ts`
   - `packages/desktop/tests/lead-entry-wiring.test.ts`（固定行相关用例）
   - `packages/desktop/tests/lead-coordinator-wiring.test.ts`（ManagerCard 相关用例）
   - `packages/desktop/tests/design-contract.test.ts`（manager-row CSS）
   - `components/rail-display.test.ts`（若删除 managerPhaseLabel）
6. 应新增：Pod 打开 Lead 的角色/标题/已有 tab metadata 升级回归，及“工作 rail 无固定 ManagerCard、鲸群仍有 Lead 入口”的契约测试。

## 7. 推荐分批边界

### 批次 A：展示归属修复（直接对应当前问题）

1. 从 LeftDock 删除 ManagerCard、其 props/CSS/旧测试。
2. 保留 Lead 主聊天页，但普通工作 rail 不再提供固定 Lead 入口。
3. 修复 `openPodSession`：Lead 使用统一标题 `Lead`、`manager=true`、`leadTabMetadata()`；已有 tab 可补齐角色。
4. 鲸群成为 Lead 的项目级入口；Welcome 入口是否改为打开鲸群在同批契约中明确。
5. 保留 `manager-session` 后端兼容 API，不做破坏性迁移。

### 批次 B：Lead 与内部 session 生命周期

1. 统一 Lead kv/Pod coordination 的权威与 liveness/rebuild。
2. 修复 goal snapshot 的 slot 读取。
3. Builder/Reviewer/Probe 统一内部 session 注册与隐藏。
4. 规范化旧 roster `agentName='manager'`。
5. 明确旧 revision Tech Lead session 的退休/快照策略。

### 批次 C：调度与契约硬化

1. 所有 planning/execution 启动统一经过 Pod queue/pause/budget gate。
2. 区分 current discussion Goal 与 active execution Goal，硬性保证单 active execution。
3. 更新 spec/plan/AGENTS：UI 唯一入口、revision session 连续性、rotate、结果通知语义。
4. 清理 smoke 遗留运行态（与架构修复分开，使用正式生命周期/API，不再手工跨层删除）。

## 8. 建议的验收标准

- 工作 rail 不再出现固定 Lead/Manager 行。
- 鲸群 Lead 行打开的是当前 coordination session，标题与角色均正确，不出现 `Chat N` 或 agent 解锁。
- 同一 Lead tab 重复从左右鲸群入口打开，不创建重复 tab、不丢 metadata。
- Tech Lead 仍按 Goal+revision 打开独立隐藏 session；不同 Goal 不共享上下文。
- Builder/Reviewer/Probe 不作为普通工作会话暴露。
- 所有 Lead 读取路径不再把历史 manager 当作当前 Lead；历史会话仍可读取。
- 若纳入批次 C：另一个 Goal 执行中，方向裁定不得绕过队列启动第二个 execution。
