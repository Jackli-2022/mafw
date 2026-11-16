# Project Pod 协作

> 迁移自根 `AGENTS.md`（2026-11-10），原文搬迁（未改写）；章节号沿用迁移前编号，
> 交叉引用以标题为准。后续变更记录写 `docs/releases/`，不再回填本文件。

## 现状：会话 runtime 归属（2026-11-10）

- **身份与租约分离**：Lead 的稳定身份是 `(project, role=lead)`；runtime session id 只是租约。
  kv `manager-session` 用 `byRuntime` 按 runtime 分槽（`LeadSessionRegistry.runtimeName` 必须是
  **live getter**，构造于 runtime 创建之前也不能快照），不能靠 `ses_` / `pi_` 前缀猜归属。
- **Pod 会话表按 runtime 归属**：`pod_member_sessions.runtime`（存量行启动时一次性回填
  `opencode`）。`PodSessionSupervisor` / `PodSessionLifecycle` / `PodTechLeadService` /
  `PodContextSelectionService` / `PodAccess` / `PodMessageDelivery` 只认当前 runtime 的
  租约、成员与推送目标。
- **单活跃租约**：仍每个作用域一条 active 行；`leaseScopedSession` 在同一事务结束其它 runtime
  的同作用域租约（旧行保留为历史）。`PodService.bindLead` 对其它 runtime 的 coordination 行
  只 `end`、不 snapshot/archive；切回原 runtime 时按旧 session id `reactivate`。
- **展示与回收**：`PodService.get` 隐藏其它 runtime 的 active session（ended 历史仍展示）；
  `reconcile` / `reconcileMemberStatus` / `snapshotSession` / `finalizeMissingSession` 均按当前
  runtime。
- **活探针**：`opencode` SDK `throwOnError=false` 下 404 返回 `{error,...}` 信封，adapter 归一为
  `undefined`；Lead 与 Pod 会话探活统一 `isLiveSessionInfo`（必须是带 `id` 且无 `error` 的会话
  记录）。

### Pod 协作 Goal Loop：Lead / Tech Lead / Builder / Reviewer（2026-11-03）

spec `docs/superpowers/specs/2026-11-02-pod-collaborative-goal-loop-design.md`，plan
`docs/superpowers/plans/2026-11-02-pod-collaborative-goal-loop.md`（Tasks 1-22，commits
`4c5275d6..332a319a` + Task 22 验证提交）。用户可见的协作循环：

```text
直接建 Goal（discussing）→ Lead→Tech Lead 讨论 →（按需）方向裁定 → plan（可含 Spike）
→ Plan + Goal Eval 人工批准（绑定 planHash/evalHash）→ Builder 实施
→ Reviewer 独立 rubric（逐任务 + 必需 Goal 条件）→ Lead 结果通知
→ 用户打回 → 同一 Goal 的 revision 2 继续讨论 …（append-only）
```

- **角色与隐藏会话**：Pod roster 固定 `lead / tech_lead / builder / reviewer`（`PodMemberRole`，
  `core/pod/pod-store.ts`）；`roleForNode()` 映射 plan→tech_lead / execute→builder / review→reviewer。
  Lead 取代 Manager：`manager-session` kv 槽位、`readManagerSlot`/`writeManagerSlot` 与
  `GET /api/manager/session` 保留读取兼容，但新写入的身份是 Lead（`projectLeadSessionMetadata()`
  → `role:'lead'`，`resolveIdentityAlias('manager')==='lead'`）。Lead 与 Tech Lead 的 runtime 会话
  一律隐藏（`core/session-visibility.ts`：`INTERNAL_SESSION_ROLES` 含 lead/tech-lead/tech_lead，
  agent `mafw-tech-lead` 也隐藏；旧 `manager`/`manager-archived` 行保持可见 = 兼容层，不再产生）。
- **直接讨论 Goal**：`PodTechLeadService.createGoal()`（`core/pod/pod-tech-lead-service.ts`）写
  goal-dir 布局的 `goal.md`/`request.json`（`discussion:true`、`autoStart:false`，**绝不发
  goal_created、绝不启动 NodeDriver**），建 `pod_goals` root + revision 1 `discussing`，经
  `PodSessionSupervisor` 取隐藏 Tech Lead 会话（作用域 `(podId, memberId, goalId, revision,
  'discussion')`，跨重启按 generation 重建），开场 prompt 必带 `[CONTEXT MANIFEST]`。
  `PodDirectionService`：真正有分歧才 `request` 建 `direction_review` 人类 attention；方向明确时
  `markClear` 直接记录决定并把 revision 推到 `planning`（不额外要一次确认）。
- **revision 模型**：`pod_goal_revisions`（`PodGoalRevisionStatus` discussing/direction_review/
  planning/plan_review/queued/implementing/reviewing/completed/aborted/discarded）append-only；
  root `pod_goals.active_revision` 是指针（legacy 缺列默认 1，`PodStore` 构造时
  `backfillLegacyRevisions()` 按 root status 映射 queued/completed/aborted/implementing）；
  终态行不可改写（`setGoalRevisionStatus` 返回 boolean，`isTerminalGoalRevisionStatus`）；
  `openNextRevision` 先归档 active state 到 `state/revisions/<goalId>/rev-<n>.json`，再建干净的
  N+1 state；打回优先级 `REJECT_REVISION_PRIORITY=10`；`nextGoalRevision` 让 legacy goal 从 2 起。
- **产物按 revision 隔离**：`nodeArtifactPaths(mafwDir, goalId, round, { revision })`（rev1 沿用
  legacy 根路径，rev≥2 全部在 `revisions/<goalId>/rev-N/`）；`goalEvalArtifactPath`（rev1
  `goals/<goalId>/goal-eval.json`，rev≥2 与 waves 同目录）。`PodContextSelectionService
  .renderForNode` 是 driver `contextBlock` 的唯一实现：阶段基线由代码强制（goal.md/request.json/
  direction.json/waves.json/goal-eval.json），Lead 只能追加可选与跨 Goal 引用（request
  `contextAllowlist`）；跨 Goal 未授权 400，敏感/路径逃逸/缺失一律 fail-closed（节点
  `context_invalid`）；清单持久化 `goals/<goalId>/manifests/rev-<n>-<stage>.md` + sha256，
  prompt 顺序 `[CONTEXT MANIFEST] → [POD HANDOFF] → 节点正文`。
- **Spike / 探针**：`core/goal/probe.ts`（ProbeRequest/Report 机器可读校验 + 脱敏）+ 
  `PodProbeService`（单 Pod 单 running、队列上限、revision 非终态、报告原子写
  `<mafw>/goals/<goalId>/probes/*.json` 并镜像 `pod_probes`）。driver 的 `GoalProbePort` 走真实
  `PodProbeService`（claimForGoal/report/complete/fail/requeue），探针在**隔离 workspace + Builder
  会话**执行；模式 A（默认两段式：need_probe → 报告 → 再 plan → 人工批准）与模式 B
  （`approvalMode:'full_chain'` + continuation rules，只有 manual 审阅门可整链批准；批准绑定
  packageHash，探针 refutes/未覆盖/计划改写 → 批准作废回 planning）。
- **Plan + Goal Eval**：`core/goal/plan-package.ts`（waves + goalEval 同一份 PlanPackage）；
  `planHash=computeWavesHash`、`evalHash=computeGoalEvalHash`、`packageHash=computePlanPackageHash`。
  `AWAIT_PLAN_APPROVAL` 是合法驻留门，`POST /api/goals/:id/plan-approval` 必须匹配当前 hash
  （不一致 `stale_plan` → 409 + 当前 hash）；任务板编辑计划（`PodTaskService.invalidatePlanApproval`）
  自动作废旧批准。Review 走 `core/goal/review-rubric.ts`：逐任务 pass/fail/skipped + 证据，且必须
  覆盖每条**必需 Goal 条件**；漏项/自相矛盾/证据空 → `verdict:'FAIL'` 进入 reviewFix/round 修复，绝不 PASS；
  只有 JSON 不可解析或结构非法才走 `artifact_invalid`。
- **结果与打回**：PASS 归档 → `PodGoalService.notifyResult()` 保持真实 verdict，只广播一次
  `pod.updated {kind:'result', goalId}`，不制造人工 attention；`rejectResult` 必须先读到真实结果
  证据（result 视图 > revision 行 > goal 根记录），再 `finishRevision(evidence)` +
  `openNextRevision(expectedRevision)`；旧 revision 行/state 快照/产物永不重写或反归档；新 revision
  从 `discussing` 开始并恢复 Tech Lead 会话，**立即发送带打回原话 + 上一轮 verdict 的开场 prompt**
  （`buildRejectOpeningPrompt`；失败写 `promptError` 非致命，会话仍保留），打回反馈以 `reject_feedback`
  方向输入 append-only 记录；桌面 Goal 详情对非终态 Goal 提供「上一轮讨论」快照入口（选
  `revision < activeRevision` 且 `endedAt + transcriptRef` 的 discussion 会话），旧讨论不会在界面上消失。
- **API / SDK / 桌面**：`POST/GET /api/pods/:podId/goals`（直接讨论 Goal / 列表）、
  `/goals/:goalId/tech-lead(/messages)`、`/direction-decision`、`/probes`、`/revisions`、
  `/result`、`/reject`；MCP `mafw_pod_goal_direction`（Tech Lead 方向）与
  `mafw_pod_goal_context`（仅 Lead 可改上下文）；SDK/preload `pod.*` 命名空间；桌面工作台
  「执行 › 鲸群」+ Tech Lead 页 + PlanReview（Plan/Goal Eval/探针证据/未验证假设）+ 结果/打回页。
  角色与阶段使用稳定词汇，业务身份不泄漏 runtimeSessionId。
- **迁移**：旧三成员 Pod 在 `PodService.ensure()` 补 `tech_lead` 成员（旧 lead/builder/reviewer id
  不动，manager 会话绑定为 Lead）；旧 goal 无 revision 行时由 `PodStore` 构造函数 bootstrap 到
  revision 1（root status 映射 queued/completed/aborted/implementing）；打回 legacy goal 从 revision 2
  起，rev1 waves/eval/review 与 state 快照逐字保留；ContextManifest 未授权跨 Goal 引用一律 400。
- **验证（Task 22）**：`gateway/tests/integration/pod-collaboration-loop.test.ts` —— 1 个端到端场景
  （direct Goal→Tech Lead→probe→plan/eval→批准→实施→review PASS→result→reject→revision 2，
  旧证据/产物不变）+ 2 个迁移场景（三成员 Pod/manager 槽位/legacy goal bootstrap；legacy goal
  打回不重写 rev1）。全量 gateway **4296/4296（558 suites）**、desktop **2371/2371**、SDK **187/187**；
  `tsc`（gateway，`npx tsc --noEmit -p tsconfig.json`）/`tsgo -p tsconfig.json`/
  `electron-vite build`/根 `npm run build` rc=0。状态：随 **v5.0.0** 发布（tag `v5.0.0`，release commit `49a63ca2`）。
- **GUI 冒烟修复（2026-11-03，post-v5.0.0）**：真实 Lead→Tech Lead 冒烟发现两处状态/UI 缺口并修复——① discussing Goal
  还没有执行 GoalState，`PodGoalView.stateMissing` 误判 person/blocked（`757cc25d`，pre-execution
  discussing/direction_review 不再 blocked）；② 点击「方向待裁定」时 `goals.timeline` 404 被当成整页失败，
  GoalDetail 无法渲染方向面板（`ca879fcb`，仅 missing GoalState 404 降级为 timeline unavailable）。
  冒烟已验证：Lead 直接建 Goal、聊天页入口、隐藏 Tech Lead 会话、`mafw-tech-lead` 专用发送与
  ContextManifest、方向裁定请求/attention、方向面板选项与原话持久化、进入 planning。
  未在 GUI 中走完：真实 Plan/Eval 批准、Spike、Reviewer PASS、结果通知与打回循环（由集成测试覆盖）。
  修复后 gateway **4305/4305（558 suites）**、desktop **2384/2384**、`tsc`/`tsgo -p`/`electron-vite build` rc=0；
  这两个修复**不在 v5.0.0 tag 内**。
- **Lead 单一展示面与 Session 生命周期（2026-11-03，post-v5.0.0）**：spec
  `docs/superpowers/specs/2026-11-03-lead-pod-single-surface-lifecycle-design.md`，plan
  `docs/superpowers/plans/2026-11-03-lead-pod-single-surface-lifecycle.md`。**该节取代前文关于
  LeftDock 固定 Lead 行、人工 new-topic、Tech Lead 跨 revision 连续性的旧描述**。
  - 左侧「工作」不再有 `ManagerCard`/`.mafw-manager-row`；历史 `manager`/`manager-archived`
    会话回到普通时间分组，永不作为当前 Lead。Lead 的项目级入口统一在鲸群；主内容区仍可
    展示 Lead 对话 tab。
  - 桌面 Lead UI 权威 = 当前 Pod 的 active `node='coordination'` session；`manager-session`
    kv 仅 gateway 内部恢复兼容，不再是 desktop fallback。`lead-session.ts` 只认 `lead`。
  - `POST /api/pods/:podId/lead/ensure`（SDK/preload `pod.ensureLead`）是唯一显式修复入口；
    GET/lookup/轮询保持只读。启动只为已有 Pod 或 in-flight Goal 的项目 ensure。
  - gateway `LeadSessionRegistry` 统一 active-runtime slot、Pod coordination、活性探测与
    canonical project key；替换旧 Lead 先 best-effort snapshot，再降为 `lead-archived`
    （普通历史可读，不是当前 Lead）。Goal snapshot 用同一 registry 反查，修复 byRuntime 读取。
  - Lead/Builder/Reviewer/Probe 都是内部 session：roles `builder/reviewer/probe` 与 agents
    `mafw-execute`/`mafw-review` 隐藏；Pod transcript 仍可读。旧 roster Lead `agentName:
    manager` 幂等升级为 `lead`。
  - Tech Lead 正式按 `Goal + revision` 隔离；同 revision plan 复用讨论 session。revision
    终态与 recovery 校准会 snapshot + retire 旧 discussion lease，不碰 N+1/旧证据。
  - Welcome「Lead 会话」进鲸群；「新建 Goal」开 Pod composer；无 Pod 显示空态且不自动
    创建。Welcome 内联 Goal 表单与旧 planReview 开关退役。
  - 用户人工 rotate 全退：桌面「新话题」、`/new-topic`、插件 `new-topic`、gateway 内置
    command 均已移除；`POST /api/manager/session/rotate` 与 SDK 仅保留内部兼容。
  - 本批**不含** `startGoalDirect` 绕过 Pod 单 active execution queue 的调度硬化，另批处理。
  - GUI 冒烟已验证：工作 rail 无固定 Lead/Manager 行；Pod Lead 无 live session 时仍可点击并
    经 ensure 恢复（`bindLead` 不再被历史同 id 的 ended 行提前短路）；恢复后打开
    `Lead L` tab、accent dot、Lead composer；PodDock 重复打开不新增 tab；Welcome「Lead 会话」
    进鲸群、「新建 Goal」打开 Pod composer；页面无「新话题」。冒烟与终审补出的缺口均
    RED→GREEN：`ensureLead` 跑 roster 迁移、ended coordination 重激活、Lead 行 `canOpen`。
    最终门禁：gateway **4353/4353（563 suites）**、desktop **2388/2388**、TUI **306（305 pass/1 skip）**、SDK **188/188**、
    plugin **30/30**、`tsc`/`tsgo -p`/root build/electron-vite build rc=0。桌面 reload 的
    layout 恢复因本地 gateway 在启动期多次健康超时未完成真机复核（自动化 layout 测试通过）。
  - **Deferred minors 收口（2026-11-03，commit `02a9a382`）**：final review 的 8 个 Minor 全部
    处理：`bindLead` 清理多余 active coordination 行（同 id 已 active 时也清理）；`current()`
    对 canonical-equivalent 多 key 选最新（不再返回 null）；`ensure` 按 canonical key 单飞；
    dead legacy slot archive 后用 `clearManagerSlot` 只摘当前 runtime 槽（不重复 archive）；
    内部 rotate 走 canonical key + `archiveLeadSession`（`lead-archived`，不再是
    `manager-archived`）；Pod lookup/ensure 对 worktree 目录（即使 worktree 自身已注册）优先
    映射到父项目 Pod（worktree 已有自有 Pod 时保留，防旧数据孤儿）；格式/文档残留清理
    （`builtin-handlers` 空格、Manager CSS 注释、TUI/AGENTS 文案）。新增 7 个回归用例；
    复跑全量门禁：gateway **4353/4353（563 suites）**、desktop **2388/2388**、
    TUI **306（305 pass/1 skip）**、SDK **188/188**、plugin **30/30**，
    `tsc`/`tsgo -p`/root build/electron-vite build rc=0。

#### Revision worktree 与人工验收（2026-11-09）

spec `docs/superpowers/specs/2026-11-09-pod-revision-worktree-design.md`，plan
`docs/superpowers/plans/2026-11-09-pod-revision-worktree.md`。Git 粒度 = **每个 Goal revision
一个 worktree/branch**，讨论、Plan、Builder、Reviewer 共用同一 checkout（Probe 仍用隔离临时
workspace，结束后销毁）。

- **路径/分支**：`<repoParent>/<repo>-wt-<safeGoalId>-r<N>` / `mafw/<safeGoalId>-r<N>`；
  `safePodGoalSlug` 只保留 `[A-Za-z0-9._-]`（`../x` 之类全部折叠）。revision 1 从项目当前
  HEAD 创建；revision N+1 从 revision N 的分支创建。元数据存 `pod_goal_worktrees`
  （`PodWorktreeService.ensure/get/commitPending/mergeForAcceptance/markAbandoned`）。
- **前置约束**：Pod 项目必须是 Git 仓库根目录（子目录 409，不自动安装依赖）；worktree 创建
  失败时节点直接失败（`worktree_unavailable`），**绝不静默回落主目录**。升级时已在途 Goal
  不 retrofit，只有新 revision/新 Goal 获得 checkout。
- **PASS 不合并**：Reviewer PASS 只收尾 revision；主项目保持原样。用户点一次「验收并合并到
  主分支」→ `POST /api/pods/:podId/goals/:goalId/accept`（body `{revision?, confirm:true}`）
  → `PodGoalService.acceptResult`。只接受**当前 active revision**、可信成功结果
  （`PASS` 或 quick `UNREVIEWED`，无 `failure`）、且 worktree 仍 `active`；重复验收幂等
  （已 merged 直接返回原 mergeCommit）。验收是**人类专属**：请求带 `actorSessionID` → 403，
  不提供 MCP 验收工具。
- **合并门**：主项目当前分支必须等于 worktree 创建时记录的 `baseBranch`，且无 tracked 改动；
  worktree 自身 HEAD 必须仍在 `mafw/<goal>-rN`（Agent 在 checkout 里切分支/脱离 HEAD → 409，
  绝不合并错误分支）；否则 409 且 worktree 保留。合并用 `git merge --no-ff --no-verify`
  （`commit.gpgsign=false`），冲突时 `git merge --abort`、主项目不变、worktree 保留。成功写
  status=merged + mergeCommit/mergedAt（空分支无新提交时 mergeCommit 为空串），移除 worktree
  但保留 branch。自动提交身份固定 `MAFW <mafw@localhost>`、`--no-verify`、排除 `.mafw`。
  删除 worktree 目录后 `ensure/ensureExisting` 先 `git worktree prune` 再重建（同一 row，
  不会 `missing but already registered` 卡死）。
- **验收/打回串行**：`PodGoalService` 按 `(podId, goalId)` 串行 accept/reject（进程内 Promise
  链）——并发点击最多一个成功，被拒绝的 revision 不会在合并竞态里落进主分支。
- **不 retrofit**：`workdirForRevision` 只走 `PodWorktreeService.ensureExisting`（无 row 返回
  null，节点沿用项目目录）；新 Goal（`PodTechLeadService.createGoal`）与新 revision（打回后）
  才显式 `ensure` 创建 checkout。旧在途 Goal 不会在升级后被切成两半。
- **打回**：打回前先 `commitPending` 保住未提交改动，再开下一 revision，旧 worktree 标
  `abandoned`（branch 保留可追溯）；已 merged 的 revision 不能打回（409）。
- **结果 DTO/UI**：`PodGoalResult.worktree -> {dir,branch,baseBranch,status,mergeCommit,mergedAt}`
  + `acceptance: 'pending' | 'accepted' | 'unavailable'`；`PodGoalView.accepted` +
  `lastError`（worktree_unavailable 等直接显示在 Goal 详情）。验收后 `result_ready` → `ended`。
  Goal Eval 的真实形状是 `goalResults: [{conditionId, result, evidence}]`（不是 `id`）。
  桌面结果页保留 verdict/assessment、版本历史、Goal acceptance、**Goal Eval 条件与逐条件
  判定（缺结果 = 未判定，绝不按通过）**、逐任务证据、Review feedback、产物、失败重提、打回
  输入；失败结果显示「失败 · 不可验收」，不出现验收入口；已验收后隐藏打回入口。
- **A2A artifact**：`PodA2AArtifactStore` 支持动态 roots resolver，**revision worktree 优先**，
  merged/abandoned/missing 行省略 worktree 根；同一 store 在合并/移除后自动回落到项目目录。
- **分支差异预览**：`GET /api/pods/:podId/goals/:goalId/worktree/diff?revision=N` 返回
  merge-base 三点 diff（最多 100 文件；base/branch 缺失 409，revision 无 row 404）。只读，
  不需要 worktree 目录（验收后分支仍可读）。桌面结果页「查看分支差异」只在 active/abandoned
  revision 显示（验收后隐藏），复用 `DiffReviewPanel` 的 `previewOnly` 模式，不提供回退按钮。
- **测试**：gateway `pod-worktree-path`/`pod-store`/`pod-worktree-service`/`pod-result-accept`/
  `pod-accept-route`/`pod-worktree-diff-route`/`pod-a2a-artifacts`/`pod-wiring`，desktop
  `pod-result-view-model`/`pod-result-diff-wiring`。
- **真机冒烟（2026-11-09，commit `8e363e86`）**：临时 Git 仓库 + 3 个真实 quick Goal（opencode-go
  deepseek-v4.1-flash）跑通——worktree 路径/分支、`acceptance=pending`、单次验收真实 mergeCommit、
  重复验收幂等、验收后打回 409、worktree 移除/分支保留、主项目文件与 clean 状态；桌面 dev（CDP 9222）
  结果页显示 worktree 卡 + Goal Eval 4 条「未判定」+ 单次验收按钮，点击后状态「已合并」、按钮消失、
  toast 与落库一致。冒烟驱动修复：非 `.mafw` 未提交改动阻塞验收（不强制删除有改动的 worktree）；
  `result_ready` 优先于归档→row 更新的瞬时窗口（bucket 不再闪到 ended）。`.mafw` 产物按 spec
  不进分支（验收为 no-op，worktree 仍移除）。

#### 评审项与风险强制验收（2026-11-11 Plan C）

spec `docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md` §9，plan
`docs/superpowers/plans/2026-11-11-project-agent-workbench-review-items.md`。

- **持久化**：`pod_goal_review_items`（Goal/revision、rel/行号/代码/评论、anchor_json、状态、
  回应、origin）+ `pod_goal_review_item_events`（created/responded/resolved/reopened/carried，
  append-only）+ `pod_goal_acceptances`（forced、未解决项快照、riskAcknowledged、mergeCommit）。
- **状态机**：`pending → responded → resolved`；`reopen` 把 responded/resolved 退回 pending。
  Tech Lead 只能通过 MCP `mafw_pod_review_respond` 标记 responded；resolve/reopen 与创建都是
  人类专属（带 `actorSessionID` 的 HTTP 请求 403）。已验收 revision 的评审项冻结，任何变更 409。
- **revision 延续**：打回开新 revision 时只克隆未解决项（新行、`origin_item_id`/`origin_revision`，
  状态重置 pending）；已解决项留在旧 revision，旧行永不改写；`expectedRevision` 已保证重放不重复克隆。
- **验收门**：`POST .../accept` 由服务端重新计算当前 revision 未解决项；有未解决项时普通验收 409，
  必须 `force:true` + `riskAcknowledged:true` 才合并。强制验收记录未解决项快照，但**不**把这些项
  标成已解决；PASS 仍不自动合并，验收仍是人类专属。
- **结果 DTO/UI**：`PodGoalResult.acceptanceRecord -> {forced, acceptedAt, unresolvedReviewItemIds}`；
  结果页评审区未解决优先，强制验收是内联风险确认面板；`PodGoalAcceptResult` 回传 forced 与快照。
- **测试**：gateway `pod-review-store`/`pod-review-service`/`pod-review-routes`/
  `pod-accept-review-gate`/`pod-revision-review-carry`/`pod-review-respond-tool`/`api-contract`；
  desktop `pod-review-model`/`pod-review-wiring`/`pod-result-review-wiring`/`review-item-input`/
  `use-send-message`/`preload-pod-review`。

#### Lead 当前话题 Handoff 与 Goal 状态投影（2026-11-10）

spec/plan：`docs/superpowers/specs/2026-11-10-lead-techlead-thread-handoff-design.md`、
`docs/superpowers/specs/2026-11-10-lead-techlead-p0-kernel-objects-design.md`、
`docs/superpowers/plans/2026-11-10-lead-techlead-p0-handoff.md`；交付记录
`docs/releases/2026-11-10-lead-techlead-p0.md`（merge `d50f4f18`）。

- **provenance**：`lead_topic` 只在 handoff 时写一行（不是通用话题表）；
  `GoalSourceRef` 增加 `topicId` / `messageRange`，snapshot 仍 ≤4000 字符，只取 user/assistant
  的 text，排除 tool/system/synthetic recall 与未完成 assistant 回合。
- **两阶段写入**：`LeadHandoffService.prepareForGoal()` 只读消息并在内存构建；Goal/revision
  落库成功后才 `commit()` 写 `<goalDir>/context/lead-handoff.md` 与 `lead_topic`。已有 Goal
  目录直接 409，失败/并发不覆盖赢家文件；intake 失败回滚 topic。
- **注入**：Tech Lead 开场 prompt 在 ContextManifest 之后追加 `<lead-handoff>` snapshot +
  全文路径；ContextManifest 把 `context/lead-handoff.md` 列为可选 ref。handoff 读历史失败
  fail-open，Goal 仍创建（`MAFW_LEAD_HANDOFF=0` 可关闭）。
- **入口与查询**：`mafw_create_goal` 支持 `handoff: 'current-topic' | 'none'`、`sourceRef`、
  `topicId`；`GET /api/goals/:id/source`（registry `goals.source`）返回 sourceRef + 全文；
  `mafw_lead_goal_status` 提供 Lead 的 Goal 状态投影（stage / progress / blockers /
  pendingAttention），不读 Tech Lead 原始 transcript。
- **安全**：`isSafeGoalDirId` 前置校验 + goalDir basename 守卫；验收仍是人类专属，未新增 MCP
  验收工具。

#### P1 工作集与缺页（2026-11-10）

spec `docs/superpowers/specs/2026-11-10-lead-techlead-p1-working-set-design.md`；plan
`docs/superpowers/plans/2026-11-10-lead-techlead-p1-working-set.md`。Lead 的上下文从「一条长
session」变为可换入换出的工作集，原始 transcript 永不删除。

- **数据**：`lead_topic` 增加 `summary` / `summary_hash` / `summary_updated_at` / `state`
  （resident/warm/cold/archived）/ `last_active_at` / `resident_tokens` / `resumed_from`；
  旧库 `ensureColumn` 回填 `state='warm'`、`last_active_at=created_at`。`topic_message_index`
  保存换出消息的可检索副本（`(topic_id, created_at)` 索引，`replaceTopic` 单事务重建）。
- **工作集**：`selectWorkingSet` 按 pinned → resident → warm（`warmTopicLimit`，默认 5）→ cold
  分类；resident 超 `maxResidentTokens` 时从最旧开始移入 `evicted`，至少保留 1 个。
  默认预算：resident 76800 / warm 5×300 / recall 2×1200。
- **上下文**：`GET /api/lead/context?sessionID=&query=` 返回 `goal-status` → `topic-index` →
  `recalled-topic` 块；goal-status 不裁，topic-index 超预算截断，recalled 超 `recallMaxTokens`
  整块丢弃。非 Lead session / 开关关闭返回空。宿主插件 `leadWorkingSetHook` 在
  `experimental.chat.messages.transform` 里以 **100ms** 预算拉取并注入 `synthetic:true` part，
  超时/非 200/空块一律 fail-open，不阻塞首 token。
- **缺页召回**：`recallTopics` 用 latin token + CJK bigram 命中 title(+0.6)/summary(+0.3)/
  index text(+0.1)；低于 `minScore`（默认 0.2）不注入，单次最多 2 个 topic。`buildRecalledBlock`
  输出带 `topicId`/`title` 的 `<recalled-topic>`，无 summary 时显式 `(no summary yet)`。
- **压缩**：`compactTopic` 确定性保留 decisions / open loops / 最近 user 原话，工具输出截断到
  8 行（错误行保留）；`POST /api/lead/compact` 只更新 summary/state/index 并广播
  `lead.compaction`，不删除原始消息。自动阈值触发（≥70% / ≥40 turns）与旧行后台回填留 P2；
  P1 为显式 compact + handoff 摘要。
- **恢复**：`LeadTopicResumeService` 串行化同 topic 并发；session 存活 → 直接切回并把其它
  resident 降为 warm；session 已死 → `LeadSessionRegistry.ensure` 建新 session，注入
  `<resumed-topic>`（summary + 最近 5 条 user 原话），插入 `resumed_from` 新行，旧行 warm、
  旧 transcript 只读。
- **UI**：Lead 会话标题栏「话题」按钮（仅 `isLead()`）打开 `TopicIndexPanel`，显示标题/状态/
  摘要并可恢复；不展示 session id。`MAFW_LEAD_WORKING_SET=0` 回退 P0（context 空、compact 503），
  topic list/get/resume 仍可用。



#### P2 调度、COW fork 与话题边界（2026-11-10）

spec `docs/superpowers/specs/2026-11-10-lead-techlead-p2-scheduler-design.md`；plan
`docs/superpowers/plans/2026-11-10-lead-techlead-p2-scheduler.md`。

- **Attention v2**：`deriveAttention(views)` 从结构化 stage 派生 person-first 列表（plan_approval 100 /
  direction_review 90 / decision 85 / failed 85 / answer 80 / review 70 / blocked 50），同一 goal+kind 用
  `coalesceKey` 合并；健康/进行中的 Goal 不进 person；`GET /api/attention` 的 count 即列表长度。
  （E9-2 起 reviews / draft decisions 是 route 层追加而非 `deriveAttention` 内联；
  见 `gateway.md` §「E9 交互补齐」。）
- **调度**：`planPromotions` 按 priority + enqueuedAt 排序，`capacity = maxConcurrent + 1`（人类槽
  仅在已有 active person Goal 时开启）；`PodGoalService.promote` 一次填满可用槽位，
  `startQueued` 只在新 Pod 无 activeGoalId 时写指针。`MAFW_POD_MAX_GOALS` 默认 1；
  `MAFW_LEAD_SCHEDULER=0` 强制单 active。`GET /api/scheduler/status` 只读诊断。
- **控制语义**：`POST /api/goals/:id/{pause,stop,retry}` 分别对应「暂停自动推进（不硬中断 turn）/
  撤销授权并 archive CANCELLED / 同一 revision 重试 latest run 或重新 start」；不新建 Goal/revision。
- **COW fork**：`lead_topic` 增加 `forked_from` / `forked_at` / `inherited_message_range`；
  `topic_fork` 记录 source/target/range/mode。`mafw_create_goal` 支持 `forkFromTopicId`；
  `LeadHandoffService.buildForkForGoal` 只写 `<forked-topic>` 引用 + summary + 最近 user 原话，
  源 transcript / summary 不变；`MAFW_LEAD_COW_FORK=0` 回退 P0 handoff。
- **话题边界**：`topic_boundary` + `detectBoundary`（explicit 0.9 / goal_closed 0.8 / idle 0.6 /
  semantic 0.4 / keyword 0.3）；active Goal 不 propose，阈值 0.7；`LeadBoundaryService`
  支持 accept/merge/undo，accept 才创建新 topic；宿主插件在 prompt hook 里异步 POST
  `/api/lead/boundaries/observe`（100ms fail-open）。`MAFW_LEAD_AUTO_BOUNDARY` 默认 `observe`
  （写 proposed 不广播），`on` 才发 `topic.boundary.proposed`，`off` 不写。
- **跨 topic 记忆**：Goal 终态调用 `TopicMemoryService.promoteForGoal`，只把 source topic summary
  写成 semantic memory（cueAnchors: topicId/goalId/projectDir），按 `topicId+summaryHash` 幂等。
- **UI**：桌面「需要你处理」attention-first 面板（健康状态不进主面）；Topic map 增加分叉与
  边界接受/合并/撤销操作。

#### P2 review fixes（2026-11-10）

- **统一准入**：`PodGoalService.canAdmitGoal` / `admitReadyGoal` 是唯一入口；`PodTechLeadService.createGoal`
  在槽位不足时保持 `queued`（Tech Lead 仍可讨论），direction 决定后的 `startPlanning` 也走准入，
  不再直接 `startGoalDirect`。
- **Attention 可达性（2026-11-16 修订）**：`review` 只由 `PASS/UNREVIEWED` 的
  `resultReady && !accepted` 派生（`open_result`）；终态 `FAIL/MAX_RETRIES/ERROR`（`!accepted`）
  派生 `failed`（`open_result`），同时进入 Pod detail attention 与 `/api/attention`，不再冒充
  “待验收”。归档同时写 `goal.failed` p1 / audience=lead 的 Pod event（`PodEventWake`
  只入 LeadOutbox，由同一 dispatcher 唤醒 Lead），并在
  `<mafwDir>/goals/<goalId>/context/tech-lead-failure.md` 留 Tech Lead handoff；下一次
  Tech Lead 会话的 ContextManifest 自动带上。`stateMissing` 且无错误的 blocked 不再冒充人类阻塞。
- **Pause / Resume**：`pause` 把 `phase/nextAction` 存进 `_resumePhase/_resumeNextAction` 后写 PAUSED；
  `POST /api/goals/:id/resume` 恢复并 `advance`。`retry` 只接受 active revision 内 failed/aborted/
  timed-out run，显式 runId 跨 revision 或成功 run 返回 409/404。
- **Fork 健壮性**：源 topic 必须属于同一 canonical project；新 topic 使用当前 Lead session 授权；
  fork 失败回退 P0 current-topic handoff；commit 后写 summary + index，topic detail / 记忆提升不为空。
- **Boundary**：accept 是真正 split（新 topic 从源尾消息开始，源 topic 转 `cold`，不复制 transcript /
  goal / summary）；accept 后 merge/undo 返回 409。observe 直接使用 `previousUserText` /
  `lastActiveAt` / `goalJustClosed`，同 topic+trigger 10 分钟内去重，阈值 0.5。
- **记忆**：`buildTopicMemory` 只提升 Decisions / Open loops，剔除 `User words` / `Tool output`。
- **桌面**：边界面板只渲染 `proposed`，accepted/merged/undone 作为历史不再可操作。
