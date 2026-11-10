# Goal 编排（NodeDriver / RSI）

> 迁移自根 `AGENTS.md`（2026-11-10），原文搬迁（未改写）；章节号沿用迁移前编号，
> 交叉引用以标题为准。后续变更记录写 `docs/releases/`，不再回填本文件。

### Goal 编排 RSI — Phase 1 观测层

**数据模型**（gateway.db）：
- `goal_outcomes`：每个 goal 归档时写一行（verdict、轮数、成本、thumbs、policy_version、failure_kind/signature）
- `goal_sessions`：goal 生命周期内所有 session 的追加映射（豁免 trajectory prune——保留期 `trajectory.retentionDays`，默认 365 天，0=永久）
- `evolution_proposals`：演化提议表（Phase 2 使用，Phase 1 仅建表）

**写入点：**
- 三个 session 创建节点（plan/execute/review）调用 `onSessionCreated` 追加 goal_sessions
- archiveGoal 成功后调用 `recordGoalOutcome` 聚合 trajectory + feedback 写入 outcome
- ABORT（HTTP + control file）调用 archiveGoal(verdict='CANCELLED')
- onGoalCreated 时 `policySnapshot` 写入 state.json

**查询：**
- `GET /api/orchestration/outcomes?policy=&verdict=&project=&limit=`

**组件注册表：**
- `gateway/src/orchestration/registry.ts` 声明可演化组件（Phase 1 只读）
- `gateway/src/orchestration/policy.ts` 读 `~/.mafw/orchestration/active.json` 回退 builtin-v1

### Goal 编排 P1：NodeDriver + 节点级 Trace（2026-10-08）

goal 编排从「装配完成未接线」正式启用：**langgraph 三件套（graph/checkpointer/interrupt/Command-resume）退役**，换为 state 文件 + 事件驱动的 `NodeDriver`（`gateway/src/core/goal/`）。spec `docs/superpowers/specs/2026-10-08-goal-orchestration-p1-design.md`；plan `docs/superpowers/plans/2026-10-08-goal-orchestration-p1.md`。

- **NodeDriver**（`driver.ts`）：每 goal 一个互斥状态机实例。`advance(goalId)` 读 state v3 → `routing.ts` 纯函数定下一节点（从 `graph.ts:4-15` 逐字移植）→ 建会话（`agent: 'mafw-'+node` 绑定身份）→ `void promptAsync`（**不 await**——pi 的 promptAsync 在 idle 会话阻塞到回合结束，pi-session.ts:117-120）→ 注册 per-session 完成监听 → `writeGoalState(nodeSession)`。完成由 `handleOpencodeEvent` 的 idle/error 分支分发（`goalDriver?.onSessionIdle/onSessionError`）。
- **双门完成判定**：`turn.completed` + 产物文件（`node-prompts.ts:nodeArtifactPaths`：waves.json / `receipts/{goalId}/loop-{N}-receipt.json`（per-loop 不再覆盖）/ `reviews/{goalId}-loop{N}.md`）存在且可解析；缺失/非法 → `failNode`（artifact_missing/artifact_invalid）→ archive_fail。
- **三节点身份**：`IdentityRegistry` 内置 `mafw-plan`（deny file-edit/shell/web）/ `mafw-execute`（全开）/ `mafw-review`（deny file-edit/web，allowlist 含 shell）——复用 v4.21.0 物化车道，替换旧 `/skill mafw-*` 裸文本。
- **W4 goal 级先验（2026-10-08）**：plan 节点 prompt 注入 L1 能力账本 + L2 失败谱（`capabilityPriorBlock`，`DriverDeps.capabilityPrior` → `NodePromptCtx.priorBlock`）——规划时看到同类任务历史 PASS 率/均轮数与反复失败模式，主动规避。闭环：L1/L2（Plan 2）产出 → W4 消费。
- **state v3**（`state-v3.ts`，NodeDriver 唯一写入方）：`round` 为规范名 + `loop` 双写别名（旧读方兼容）；新增 `nodeSession`/`nextNode`/`nextAction`。原子写（.tmp+rename）。
- **starter**（`index.ts:startGoal` + `starter.ts:resolveGoalDir`）：`goal_created` 事件 → 定位目标项目（hint > request 文件扫描 > 首项目）→ `ensureGoalState` → advance。`mafw_set_goal`/`mafw_create_goal` 接受 `projectDir`（已注册校验，MCP services 注入 `listProjects`），写入目标项目 `.mafw`（修目录错配）。
- **askUser state 驱动**：`executeAskUser` 写 `QuestionLedger` asked（修「asked 无写入点 → respond 恒 404」断链）+ state.pendingQuestion；`handleAnswer/handleCancel` 写 state.userResponse/nextNode → advance；respond 路由改调 driver（不再 Command-resume）。manager 可经 `mafw_list_pending_questions`/`mafw_answer_question` 自治代答。
- **Trace 数据层**：`goal_node_runs` 表（gateway.db：goal_id/loop/node/attempt/session_id/status/started_at/finished_at/outcome/error/tokens/cost；watchdog 重试 = 新行新 attempt 保留失败历史）；`goal_node` SSE 事件（扁平顶层广播：`{type,goalId,projectDir,loop,node,transition,at,durationMs?,verdict?,error?,attempt}`）；`phase_transition` payload 签名不变（milestone-push 零迁移）。
- **恢复/watchdog**（`recovery.ts` + `driver.examineStaleNode`）：启动 `recoverGoals` + 周期 `watchdogScan`（挂 startBackupPolling）。语义：**产物优先**（gateway 死亡期间完成的节点直接兑现）→ 会话探测（`session.get`，能力门 sessionStorageApi）→ abort + 重试 attempt+1（≥maxAttempts → archive_fail）。
- **API**：`GET /api/goals/:id/timeline`（node_runs ⋈ state 聚合，须挂 dashboard 兜底前）、`POST /api/goals/:id/nodes/:runId/retry`（execute 需 `confirm:true` destructive 门）；SDK `goals.timeline/retryNode`。
- **legacy 并存**：`core/skills/mafw-*/entry.ts` + 插件 `/goal` 命令链保留（`state_change` 唤醒走 driver.advance 幂等）；死代码标注 deprecated（`chat/graph-runner.ts`/`core/mcp/tools.ts`/`poll.ts`/`core/plugin.ts`，物理删除留后续 PR）。
- 测试：gateway 新增 14 文件 / 65 用例（routing/state-v3/node-runs/identities/node-prompts/driver/completion/askuser/starter/projectdir/recovery/timeline-route/retry-route/e2e）；全量 258 套件 1738 用例绿。

**P2 前端节点泳道图（2026-10-09，仅 Desktop）**：Goal 详情 `GoalDetailOverlay` 从「charter + 会话列表」升级为**节点级执行可视化**——泳道（行=plan/execute/review，列=loop）+ 点格子内联明细（起止/耗时/token/成本/verdict/错误/产物 chips/打开会话/重跑）。

- **纯逻辑** `packages/desktop/src/renderer/mafw/goal-timeline.ts`：`buildGoalLanes(nodes, maxRounds)`（行×列矩阵 + 每格 attempts 归并）、`cellTone`（review verdict 覆盖）、`formatDuration`、`cellSummary`、`artifactRef`（per-loop 相对路径引用）——单测
- **组件** `GoalTimelineLane.tsx`（props 驱动，泳道网格 + 内联展开）→ `GoalDetailOverlay.tsx` 接 `window.api.mafw.goals.timeline/retryNode`；会话下钻经 `onOpenSession(sessionId)`（节点 run 自带 sessionId）
- **实时**：dispatcher 顶层消费 `goal_node`/`goal_created`/`phase_transition` → `CoreDeps.onGoalEvent` → 模块单例 `goals-rev.ts` 的 `goalsRev` signal bump；GoalDetailOverlay/Dashboard 依赖该 signal 重拉，保留 15s 轮询兜底（`goal_node` 无 sessionID，必须在 sid 分发前消费，否则 missTrace 刷屏）
- **preload** `mafw-api.ts`/`mafw-types.ts` goals 段补 `timeline`/`retryNode`（SDK P1 已有方法 + `GoalTimeline` 类型）
- **产物**：桌面无 mafwDir，产物以相对路径 chips 展示、点击复制（OS 打开留后续）
- 测试：desktop `npm test`（node --test + test-shim）864 用例全绿（goal-timeline 10 + dispatcher 增量 2）；`electron-vite build` 成功。手工冒烟（真实 goal 观察泳道实时变化）留待 GUI 环境

### Goal 执行形态：Quick / Standard / Standing（2026-11-10）

spec `docs/superpowers/specs/2026-11-10-goal-shapes-quick-goals-design.md`；plan
`docs/superpowers/plans/2026-11-10-lead-techlead-p0-handoff.md`（Tasks 11–15）。Quick 不是第二套
执行路径：同一 Goal / revision / NodeDriver，只改变计划形状与审阅门。

- **存储**：`pod_goal_revisions.goal_mode`（`quick | standard | standing`，默认 `standard`，
  旧库 `ensureColumn` 补齐）；`PodGoalView.goalMode` 供列表/详情展示。模式按 revision 持久，
  打回后的新 revision 从默认值重新选择。
- **选择**：Tech Lead 在 `mafw_pod_goal_direction` 传 `goalMode`；未传 = `standard`。
  `standing` 暂返回 501；`requiresApproval: true`（高风险：merge / delete / schema / 安全 /
  保护分支）时 quick 返回 400；`planReview: 'manual'` 的 Goal 拒绝 quick。`MAFW_GOAL_MODES=0`
  关闭该参数（只允许 standard）。
- **计划约束**：quick 计划必须 `strategy:'quick'`、恰好一个 task、`probes` 为空；
  `plan-package.ts` 的 validator 拒绝多 task / 带探针的 quick，`node-prompts.ts` 在 plan prompt
  注入单 task 指令。quick 跳过独立 Reviewer，结果记为 `UNREVIEWED`；Goal Eval 可省略。
- **driver**：`DriverDeps.goalMode(goalId, revision)` 由组合根读取 revision 行，plan prompt 据此
  追加 quick directive；未配置时等价 standard。SDK view 增加 `goalMode`，桌面 Goal 详情显示
  Quick / Standard / Standing 徽标。
- **测试**：`pod-store-revisions` / `pod-view-revisions` / `pod-goal-direction` /
  `pod-tech-lead-service` / `plan-package` / `node-prompts` / `goal-modes-quick`（集成）。
