# Project Workspace and Adaptive Goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Desktop 的 Session / Pod / Goal 三个分裂管理面重构为「Lead 项目对话 + 工作概览 + 统一 Goal 详情」，同时让所有执行请求都由 Lead 创建 Goal、Tech Lead 选择快速或协作路径，并以文件和显式 prompt 完成派工。

**Architecture:** 先建立 `(canonicalProjectDir, goalId)` 的规范身份和服务端 Goal 读模型，再扩展 NodeDriver 支持快速路径与不可变 Assignment 派工文件，最后让 Desktop 只消费这套读模型并逐步退役旧页面。Goal 状态归 Goal 文件与 state 所有；`pod_tasks`、Session 绑定表和 runtime Session 分别是投影、索引与执行证据。

**Tech Stack:** TypeScript、Node.js、Jest、better-sqlite3、SolidJS、Electron、`@mafw/sdk`、现有 NodeDriver / Pod services。

**Spec:** `docs/superpowers/specs/2026-11-03-project-workspace-adaptive-goal-design.md`

## Global Constraints

- 所有明确执行请求，无论大小，都由 Lead 创建 Goal；Lead 不决定技术拆解，Tech Lead 在 Goal + revision 内选择 `quick` 或 `collaborative`。
- 新 Goal 的规范身份是 `(canonicalProjectDir, goalId)`；禁止 `projects[0]`、最新一条或当前 Desktop 项目成为隐式归属。
- 自由 Session 默认只是新话题讨论；只有显式「交给 Lead 执行」才创建 Goal，并保存来源指针与不可变快照。
- 快速路径是 `plan（Tech Lead 策略与最小计划）→ execute（一个 Worker）→ archive_unreviewed`；不伪造 `goal-eval.json`、Reviewer 或 `PASS`。
- 快速完成必须由 Lead 通知一次，进入结果而非「需要你」；用户可打回给 Tech Lead，同一 Goal 开启下一 revision。
- `planReview: manual` 和既有工具审批策略是硬门，快速路径不得绕过。
- `waves.json`、receipts 与 Assignment 文件是工作真相源；`pod_tasks` 是可重建投影；每次派工必须显式携带任务、验收、上下文和产物路径。
- 谐波记忆的检索、写入、consolidation、decay、sticky、pinned 与 goal reward 逻辑不改；`UNREVIEWED` 不触发 PASS 奖励。
- 保留所有旧 revision、prompt、receipt、review、probe 与 transcript；不重写旧证据。
- 不实现跨项目 Inbox、外部 Trigger / Eval / Mandate、IM / GitHub 监听、per-Goal pause 或进程 PID 重构。
- Desktop renderer 只能通过 `src/preload` 暴露的 `window.api` 访问 gateway；不在组件中直接 fetch。
- 每个任务先写失败测试，再最小实现，再跑聚焦与回归测试，再单独提交；不 push、不部署，除非用户另行批准。

## Review Focus

1. **两个项目存在相同 goalId**：详情和迁移必须要求项目消歧，不能打开或写入第一个 / 最新项目。由 Task 1 的 `ambiguous` 测试与 Task 10 的迁移跳过测试钉住。
2. **用户要求先看方案或快速计划包含多任务 / probe**：必须仍走人工计划门或拒绝非法快速计划。由 Task 5 的 schema 测试与 Task 6 的 driver 测试钉住。
3. **无 Reviewer 的快速完成**：必须有结果通知和证据，但不产生 PASS、人类 attention 或记忆奖励；打回必须找到 Tech Lead。由 Task 8、9 的单元与集成测试钉住。
4. **来源讨论被删除或内部会话尝试 handoff**：Goal 仍持有来源快照，内部 / Worker 会话不能冒充自由讨论发起。由 Task 2、11、12 的测试钉住。
5. **Worker 重试或派工内容变化**：重试保留同一 Assignment 并新增 attempt，内容变化生成新 Assignment，旧 prompt 永不覆盖。由 Task 7 的文件测试钉住。

---

### Task 1: 规范 Goal 身份与无歧义解析

**Files:**
- Create: `gateway/src/core/goal/goal-identity.ts`
- Modify: `gateway/src/core/goal/starter.ts`
- Modify: `gateway/src/index.ts`（`findGoalStatePath` / `findGoalRequestDir` / `findGoalMafwDir`）
- Test: `gateway/tests/unit/goal/goal-identity.test.ts`
- Test: `gateway/tests/unit/goal-starter.test.ts`
- Test: `gateway/tests/unit/goal-set-goal-projectdir.test.ts`

**Interfaces:**
- Consumes: 现有 registered project 目录与 Goal 文件布局。
- Produces:

```ts
export interface GoalRef { projectDir: string; goalId: string }
export type GoalResolution =
  | { ok: true; ref: GoalRef; mafwDir: string }
  | { ok: false; reason: 'not_found' | 'ambiguous'; candidates: string[] }
export function resolveGoalRef(
  projects: readonly string[], goalId: string, opts?: { projectDir?: string },
): GoalResolution
```

- [ ] **Step 1: Write the failing tests**
  - `resolves a goal inside its explicit canonical project`
  - `returns ambiguous when two registered projects contain the same goalId`
  - `does not fall back to the first project when no request belongs to it`
  - 断言返回 `candidates`，且顺序按 canonical path 确定。
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/goal/goal-identity.test.ts tests/unit/goal-starter.test.ts --runInBand --forceExit`
Expected: FAIL，`goal-identity` 模块不存在且旧 starter 仍有首项目回落。

- [ ] **Step 3: Implement canonical resolution**
  - 用 `canonicalProjectDir()` 归一项目；显式 `projectDir` 只收窄候选，不覆盖事实文件。
  - `starter.ts` 与 `index.ts` 的 Goal 查找统一调用 `resolveGoalRef()`；无候选返回 `not_found`，多候选返回 `ambiguous`。
- [ ] **Step 4: Run focused regressions**

Run: `cd gateway; npx jest tests/unit/goal/goal-identity.test.ts tests/unit/goal-starter.test.ts tests/unit/goal-set-goal-projectdir.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/goal-identity.ts gateway/src/core/goal/starter.ts gateway/src/index.ts gateway/tests/unit/goal/goal-identity.test.ts gateway/tests/unit/goal-starter.test.ts gateway/tests/unit/goal-set-goal-projectdir.test.ts
git commit -m "fix(goal): resolve canonical project identity without fallback"
```

### Task 2: Lead intake、来源快照与自由讨论 handoff 后端

**Files:**
- Modify: `gateway/src/core/goal/goal-intake.ts`
- Modify: `gateway/src/core/pod/pod-tech-lead-service.ts`
- Modify: `gateway/src/routes/pods.ts`
- Modify: `gateway/src/routes/pod-collaboration.ts`
- Modify: `gateway/src/mcp/handlers/create-goal.ts`
- Modify: `gateway/src/mcp/handlers/manager-set-goal.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/routes/pod-handlers.ts`
- Test: `gateway/tests/unit/goal/goal-intake.test.ts`
- Test: `gateway/tests/unit/pod/pod-goals-create.test.ts`
- Test: `gateway/tests/unit/routes/pods.test.ts`
- Test: `gateway/tests/unit/mcp/create-goal.test.ts`
- Test: `gateway/tests/unit/mcp/create-goal-direct.test.ts`

**Interfaces:**
- Consumes: Task 1 的项目归属解析。
- Produces:

```ts
export interface GoalSourceRef {
  sessionID?: string
  messageID?: string
  snapshot: string
  capturedAt: string
}
export interface GoalIntakeInput { /* existing fields */ sourceRef?: GoalSourceRef }
```

- 新路由：`POST /api/pods/:podId/goals/handoff`，body 为 `{ title, objective, sourceRef, planReview? }`；服务端 ensure 当前 Lead，以 Lead 身份调用现有 Tech Lead Goal intake。
- [ ] **Step 1: Write the failing tests**
  - intake 将 `sourceRef` 持久化到 `request.json`，snapshot 上限 4000 字符。
  - handoff 创建者为 Lead，来源 Session 不被修改。
  - 自由 Session 不能直接以非 Lead actor 调 Pod Goal 创建。
  - 当前所有新执行入口汇入 Lead + 项目 Pod；不再创建 Pod-less Goal。
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/goal/goal-intake.test.ts tests/unit/pod/pod-goals-create.test.ts tests/unit/routes/pods.test.ts tests/unit/mcp/create-goal.test.ts tests/unit/mcp/create-goal-direct.test.ts tests/unit/mcp/manager-set-goal-techlead.test.ts --runInBand --forceExit`
Expected: FAIL，缺少 `sourceRef` 与 handoff 路由。

- [ ] **Step 3: Implement source persistence and Lead handoff**
  - 只保存来源指针与快照；来源读取失败不阻塞已有 Lead 对话中的普通 Goal 创建。
  - 在 route catalog 注册 `pods.goals.handoff` 并挂 handler；不要手改生成的 `gateway-paths.json`。
- [ ] **Step 4: Run tests and regenerate contracts**

Run: `cd gateway; npx jest tests/unit/goal/goal-intake.test.ts tests/unit/pod/pod-goals-create.test.ts tests/unit/routes/pods.test.ts tests/unit/mcp/create-goal.test.ts tests/unit/mcp/create-goal-direct.test.ts tests/unit/mcp/manager-set-goal-techlead.test.ts tests/unit/api-contract.test.ts --runInBand --forceExit; npm run emit:openapi`
Expected: 测试 PASS，contract 生成成功。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/goal-intake.ts gateway/src/core/pod/pod-tech-lead-service.ts gateway/src/routes gateway/src/mcp/handlers gateway/tests/unit
git commit -m "feat(goal): add Lead handoff with immutable source snapshots"
```

### Task 3: 统一 Goal 外层状态与读模型

**Files:**
- Create: `gateway/src/core/pod/pod-work-stage.ts`
- Modify: `gateway/src/core/pod/pod-view.ts`
- Modify: `gateway/src/core/pod/pod-goal-service.ts`
- Modify: `gateway/src/index.ts`（`describePodGoal`）
- Test: `gateway/tests/unit/pod/pod-work-stage.test.ts`
- Test: `gateway/tests/unit/pod/pod-view.test.ts`
- Test: `gateway/tests/unit/pod/pod-view-revisions.test.ts`

**Interfaces:**
- Produces:

```ts
export type PodWorkBucket = 'needs_you' | 'queued' | 'in_progress' | 'result_ready' | 'ended'
export function projectPodWorkBucket(input: {
  stage: PodGoalStage
  status: PodGoalStatus
  resultReady: boolean
}): PodWorkBucket
```

- `PodGoalView` 增加 `sourceRef: GoalSourceRef | null`、`strategy: 'quick' | 'collaborative' | null`、`assessment: 'reviewed' | 'unreviewed' | null`、`bucket: PodWorkBucket`、`currentAssignment: { assignmentId: string; role: 'builder' | 'reviewer'; taskIds: string[]; attempt: number } | null`。
- [ ] **Step 1: Write the failing tests**
  - 表驱动覆盖全部现有 `PodGoalStageKind`。
  - `result_notified` 映射 `result_ready`，不得映射 `needs_you`。
  - 终态映射 `ended`；缺 state 的 discussing Goal 不进入 `ended`。
  - view 原样携带 source / strategy / assessment，旧 Goal 缺字段时为 `null`；未写 Assignment 的 legacy Goal `currentAssignment=null`。
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/pod/pod-work-stage.test.ts tests/unit/pod/pod-view.test.ts --runInBand --forceExit`
Expected: FAIL，模块与字段不存在。

- [ ] **Step 3: Implement additive read-model fields**
  - 保留现有内部 stage 词汇供执行详情使用；外层 bucket 是唯一列表状态。
  - `describePodGoal` 读取已持久化 request/source 与 state 策略，不从当前 UI 项目猜测。
- [ ] **Step 4: Run Pod read-model regressions**

Run: `cd gateway; npx jest tests/unit/pod/pod-work-stage.test.ts tests/unit/pod/pod-stage.test.ts tests/unit/pod/pod-stage-revisions.test.ts tests/unit/pod/pod-view.test.ts tests/unit/pod/pod-view-revisions.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-work-stage.ts gateway/src/core/pod/pod-view.ts gateway/src/core/pod/pod-goal-service.ts gateway/src/index.ts gateway/tests/unit/pod
git commit -m "feat(pod): add canonical Goal work buckets and source projection"
```

### Task 4: 项目工作概览 API、SDK 与 preload

**Files:**
- Create: `gateway/src/routes/pod-work.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/routes/pod-handlers.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Test: `gateway/tests/unit/routes/pod-work.test.ts`
- Test: `packages/gateway-sdk/src/client.test.ts`
- Test: `packages/gateway-sdk/src/contract.test.ts`
- Test: `packages/desktop/tests/pod-preload-wiring.test.ts`

**Interfaces:**
- Consumes: Task 2 handoff、Task 3 `PodGoalView`。
- Produces:

```ts
export interface PodWorkOverview {
  projectDir: string
  podId: string
  groups: Record<PodWorkBucket, PodGoal[]>
  counts: Record<PodWorkBucket, number>
  total: number
}
// GET /api/projects/:projectId/work
// SDK: work.overview(projectID), pod.handoffGoal(podId, input)
```

- [ ] **Step 1: Write the failing tests**
  - 每组 `counts[key] === groups[key].length`，`total` 等于全部 Goal 数。
  - 200 个历史 Goal 不截断；无 Pod 返回 404，不做 ensure。
  - SDK / preload 暴露 `work.overview` 与 `pod.handoffGoal`；PodGoal 对齐 sourceRef / strategy / assessment / bucket / currentAssignment，并补齐既有 revision 字段。
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/routes/pod-work.test.ts --runInBand --forceExit`
Expected: FAIL，路由不存在。

- [ ] **Step 3: Implement overview and client contracts**
  - gateway 从同一 `PodGoalView[]` 构造 groups 与 counts，SDK 对应 `PodGoal[]`；不做 `.slice(0, 3)`。
  - 注册 `work.overview`，重新生成 OpenAPI；补齐 SDK 现有 `PodGoal` / `PodGoalResult` 漂移字段。
- [ ] **Step 4: Run route and client gates**

Run: `cd gateway; npx jest tests/unit/routes/pod-work.test.ts tests/unit/api-contract.test.ts --runInBand --forceExit; npm run emit:openapi`
Run: `cd packages/gateway-sdk; npm test`
Run: `cd packages/desktop; node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-preload-wiring.test.ts`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes gateway/tests/unit/routes/pod-work.test.ts packages/gateway-sdk packages/desktop/src/preload packages/desktop/tests/pod-preload-wiring.test.ts
git commit -m "feat(work): expose complete project overview through SDK"
```

### Task 5: 执行策略、state 与计划 schema

**Files:**
- Modify: `gateway/src/core/goal/plan-package.ts`
- Modify: `gateway/src/core/goal/state-v3.ts`
- Modify: `gateway/src/core/goal/routing.ts`
- Modify: `gateway/src/core/goal/node-names.ts`
- Modify: `gateway/src/core/goal/node-prompts.ts`
- Test: `gateway/tests/unit/goal-routing.test.ts`
- Test: `gateway/tests/unit/goal-state-v3.test.ts`
- Test: `gateway/tests/unit/goal/goal-plan-schema.test.ts`
- Test: `gateway/tests/unit/goal/plan-package-strategy.test.ts`

**Interfaces:**
- Produces:

```ts
export type PlanStrategy = 'quick' | 'collaborative'
// GoalStateV3: strategy?, assessment?: 'reviewed'|'unreviewed', quickRepairCount?, currentAssignmentId?
// GoalNodeName includes 'archive_unreviewed'; ExecutableGoalNode unchanged.
```

- [ ] **Step 1: Write the failing tests**
  - 缺 strategy 的旧计划与路由行为逐字不变。
  - `after_execute + quick → archive_unreviewed`，collaborative / 缺省仍进 review。
  - quick 计划可无 goalEval；旧 collaborative 计划仍必须有 goalEval。
  - 新 state 字段可 round-trip，fresh revision 不继承 strategy / assessment / quickRepairCount / currentAssignmentId。
  - 不含 strategy 的旧 PlanPackage hash 保持不变。
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/goal-routing.test.ts tests/unit/goal-state-v3.test.ts tests/unit/goal/goal-plan-schema.test.ts tests/unit/goal/plan-package-strategy.test.ts --runInBand --forceExit`
Expected: FAIL，策略字段和 archive 目标不存在。

- [ ] **Step 3: Implement additive strategy contracts**
  - `PlanPackage.strategy` 仅在存在时进入 package hash；不改 waves hash。
  - quick schema 是独立分支；`need_probe` 与完整链审批仍属 collaborative。
- [ ] **Step 4: Run focused tests**

Run: 同 Step 2。
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal gateway/tests/unit/goal-routing.test.ts gateway/tests/unit/goal-state-v3.test.ts gateway/tests/unit/goal
git commit -m "feat(goal): add quick and collaborative execution strategies"
```

### Task 6: Tech Lead 快速计划与单 Worker 路由

**Files:**
- Modify: `gateway/src/core/goal/driver.ts`
- Modify: `gateway/src/core/goal/node-prompts.ts`
- Test: `gateway/tests/unit/goal-driver-completion.test.ts`
- Test: `gateway/tests/unit/goal/plan-package-driver.test.ts`
- Test: `gateway/tests/unit/goal/driver-revisions.test.ts`

**Interfaces:**
- Consumes: Task 5 `PlanStrategy`、schema 与 route target。
- Produces: quick 计划完成后 `state.strategy === 'quick'`，下一节点为 execute；不写 `goal-eval.json`。
- [ ] **Step 1: Write the failing tests**
  - Tech Lead 提交 `strategy:'quick'` 且一个 task 时进入 execute。
  - `planReview:'manual'` 强制 collaborative 并保留 `AWAIT_PLAN_APPROVAL`。
  - quick + `need_probe`、quick + 多 task 分别返回 `artifact_invalid`。
  - 旧计划缺 strategy 时行为不变。
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/goal-driver-completion.test.ts tests/unit/goal/plan-package-driver.test.ts --runInBand --forceExit`
Expected: FAIL，driver 仍强制旧三节点与 goal eval。

- [ ] **Step 3: Implement quick plan completion**
  - 由 driver 根据 Tech Lead 结构化提交写最小 waves 与策略；不给 Tech Lead 新文件写权限。
  - 只有 quick 且非 manual 才跳过计划批准和 review；人工审批策略不参与绕过。
- [ ] **Step 4: Run driver regressions**

Run: `cd gateway; npx jest tests/unit/goal-driver-completion.test.ts tests/unit/goal/plan-package-driver.test.ts tests/unit/goal/driver-revisions.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/driver.ts gateway/src/core/goal/node-prompts.ts gateway/tests/unit/goal-driver-completion.test.ts gateway/tests/unit/goal/plan-package-driver.test.ts gateway/tests/unit/goal/driver-revisions.test.ts
git commit -m "feat(goal): route Tech Lead quick plans to one Worker"
```

### Task 7: Assignment 文件与不可变显式派工

**Files:**
- Create: `gateway/src/core/goal/assignment.ts`
- Modify: `gateway/src/core/goal/driver.ts`
- Modify: `gateway/src/core/goal/node-prompts.ts`
- Modify: `gateway/src/index.ts`（`describePodGoal` 的当前 Assignment 投影）
- Test: `gateway/tests/unit/goal/assignment-files.test.ts`
- Test: `gateway/tests/unit/goal-driver-quick-path.test.ts`

**Interfaces:**
- Produces:

```ts
export interface GoalAssignment {
  version: 1
  assignmentId: string
  goalId: string
  revision: number
  role: 'builder' | 'reviewer'
  strategy: PlanStrategy
  taskIds: string[]
  acceptance: Record<string, string[]>
  contextRefs: string[]
  artifacts: { receipt?: string; review?: string }
  instructions: string
  attempts: Array<{ attempt: number; sessionId: string; startedAt: string; nodeRunId?: number }>
  createdAt: string
}
export function createGoalAssignment(input: {
  goalId: string
  revision: number
  role: 'builder' | 'reviewer'
  strategy: PlanStrategy
  taskIds: string[]
  acceptance: Record<string, string[]>
  contextRefs: string[]
  artifacts: { receipt?: string; review?: string }
  instructions: string
  sessionId: string
  startedAt: string
  nodeRunId?: number
}): GoalAssignment
export function retryGoalAssignment(
  previous: GoalAssignment,
  next: { sessionId: string; startedAt: string; nodeRunId?: number },
): GoalAssignment
export function renderGoalAssignmentBlock(assignment: GoalAssignment): string
export function writeGoalAssignment(input: {
  mafwDir: string
  assignment: GoalAssignment
  fullPrompt: string
}): { jsonPath: string; promptPath: string }
```

- 文件位于当前 revision 的 `assignments/`；prompt 文件按 `assignmentId + attempt` 命名。
- [ ] **Step 1: Write the failing tests**
  - 相同任务重试保留 assignmentId、attempt +1、旧 prompt 不变。
  - 改动任务 / acceptance / instructions 产生新 assignmentId。
  - 路径穿越与非法 goalId 被拒绝；JSON 原子写，prompt 不覆盖。
  - Worker prompt 顺序为 `[CONTEXT MANIFEST] → [POD HANDOFF] → Assignment → 原任务正文`，包含 taskId、验收、上下文和 receipt 路径。
  - state 记录 `currentAssignmentId`，Goal 读模型能投影对应当前 revision 的 Assignment 摘要与最新 attempt。
  - 关闭记忆命中时，Assignment block 仍包含完成工作所需的全部输入。
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/goal/assignment-files.test.ts tests/unit/goal-driver-quick-path.test.ts --runInBand --forceExit`
Expected: FAIL，Assignment 模块与 prompt block 不存在。

- [ ] **Step 3: Implement file-backed dispatch**
  - 在 `promptAsync` 前持久化 Assignment 和完整 prompt 快照，并写入 `state.currentAssignmentId`。
  - `describePodGoal` 按当前 revision + assignmentId 读取摘要；缺失文件返回数据错误，不猜测其他 revision。
  - quick 派工写入失败 fail-closed；collaborative 旧 Goal 暂以 warning 降级，避免破坏 legacy。
  - 不把 Assignment 加入既有 ContextManifest 的阶段必需基线。
- [ ] **Step 4: Run file and driver tests**

Run: 同 Step 2。
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/assignment.ts gateway/src/core/goal/driver.ts gateway/src/core/goal/node-prompts.ts gateway/src/index.ts gateway/tests/unit/goal/assignment-files.test.ts gateway/tests/unit/goal-driver-quick-path.test.ts
git commit -m "feat(goal): persist immutable assignments and explicit Worker dispatch"
```

### Task 8: 快速完成、结果通知与诚实 verdict

**Files:**
- Modify: `gateway/src/core/goal/driver.ts`
- Modify: `gateway/src/orchestration/outcome-recorder.ts`
- Modify: `gateway/src/core/pod/pod-result.ts`
- Modify: `gateway/src/core/pod/pod-view.ts`
- Modify: `gateway/src/core/pod/pod-task-service.ts`
- Modify: `gateway/src/index.ts`（`archiveGoal` / `finishPodGoal`）
- Modify: `packages/gateway-sdk/src/types.ts`（`PodGoalResult.assessment/reviewed`）
- Test: `gateway/tests/unit/goal-driver-quick-path.test.ts`
- Test: `gateway/tests/unit/goal-outcomes.test.ts`
- Test: `gateway/tests/unit/pod/pod-result.test.ts`
- Test: `gateway/tests/unit/pod/pod-goal-service.test.ts`
- Test: `gateway/tests/unit/pod/pod-task-service.test.ts`

**Interfaces:**
- Consumes: quick execute 与 Assignment receipt。
- Produces: outcome-only `verdict:'UNREVIEWED'`；`GoalStateV3.assessment='unreviewed'`；Pod Goal 的业务 `verdict` 保持 `null`；`PodGoalResult.reviewed=false`、`assessment='unreviewed'`。
- [ ] **Step 1: Write the failing tests**
  - 完整 receipt → archive_unreviewed、结果可读、Lead 通知一次、任务投影 done。
  - 无独立 review 时不写 PASS、不进入 attention、不触发 goal reward。
  - receipt 缺 task / 证据时回 Tech Lead 修复一次；再次失败走既有失败路径。
  - failed receipt 不得成为 completed。
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest tests/unit/goal-driver-quick-path.test.ts tests/unit/goal-outcomes.test.ts tests/unit/pod/pod-result.test.ts tests/unit/pod/pod-goal-service.test.ts --runInBand --forceExit`
Expected: FAIL，快速 archive 与 UNREVIEWED 结果语义不存在。

- [ ] **Step 3: Implement honest quick completion**
  - 机械校验 receipt 覆盖与证据；`archive_unreviewed` 设置 `nextAction:'COMPLETED'`。
  - 通知和任务成功收口接受 PASS 或 UNREVIEWED；goal reward 仍只接受 PASS。
  - `PodGoalResult` 与 SDK DTO 增加「已完成 · 未独立评审」所需字段，不合成 review verdict。
- [ ] **Step 4: Run focused regressions**

Run: `cd gateway; npx jest tests/unit/goal-driver-quick-path.test.ts tests/unit/goal-outcomes.test.ts tests/unit/pod/pod-result.test.ts tests/unit/pod/pod-result-route.test.ts tests/unit/pod/pod-goal-service.test.ts tests/unit/pod/pod-task-service.test.ts --runInBand --forceExit`
Run: `cd packages/gateway-sdk; npm test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/driver.ts gateway/src/orchestration/outcome-recorder.ts gateway/src/core/pod gateway/src/index.ts gateway/tests/unit packages/gateway-sdk/src/types.ts
git commit -m "feat(goal): complete quick work with honest unreviewed results"
```

### Task 9: 快速结果打回给 Tech Lead 的完整闭环

**Files:**
- Modify: `gateway/src/core/pod/pod-goal-service.ts`
- Modify: `gateway/src/core/pod/pod-goal-revision-service.ts`
- Modify: `gateway/src/core/goal/state-v3.ts`（仅在测试证明需要时）
- Test: `gateway/tests/unit/pod/pod-result-reject.test.ts`
- Test: `gateway/tests/integration/pod-quick-path.test.ts`

**Interfaces:**
- Consumes: 现有 `POST /api/pods/:podId/goals/:goalId/reject` 与 Tech Lead revision session supervisor。
- Produces: quick 结果可打回；同一 Goal revision N+1 `discussing`，恢复该 revision 的 Tech Lead，旧 revision 文件不变。
- [ ] **Step 1: Write the failing integration test**
  - create → quick plan → execute → archive UNREVIEWED → result readable。
  - reject 携带用户原话 → revision 2 discussing + Tech Lead session。
  - revision 1 state / receipt / Assignment prompt 的 hash 不变；重复 reject 不重复开 revision。
- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway; npx jest tests/integration/pod-quick-path.test.ts tests/unit/pod/pod-result-reject.test.ts --runInBand --forceExit`
Expected: FAIL 或暴露 quick verdict/evidence 不被旧 reject 接受。

- [ ] **Step 3: Implement minimal reject compatibility**
  - 复用真实结果证据与 revision append-only 流程；不新加 Lead 修复节点。
  - 新 revision 不继承旧 strategy / assessment / repair 计数，让 Tech Lead 重新决定。
- [ ] **Step 4: Run revision and collaboration regressions**

Run: `cd gateway; npx jest tests/integration/pod-quick-path.test.ts tests/integration/pod-collaboration-loop.test.ts tests/unit/pod/pod-result-reject.test.ts tests/unit/goal/driver-revisions.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod gateway/src/core/goal/state-v3.ts gateway/tests/unit/pod/pod-result-reject.test.ts gateway/tests/integration/pod-quick-path.test.ts
git commit -m "feat(goal): reopen quick results to Tech Lead on rejection"
```

### Task 10: 存量 Goal 的可证明归属迁移

**Files:**
- Create: `gateway/src/core/pod/pod-goal-backfill.ts`
- Create: `gateway/scripts/backfill-pod-goals.ts`
- Test: `gateway/tests/unit/pod/pod-goal-backfill.test.ts`

**Interfaces:**
- Consumes: Task 1 `resolveGoalRef`、注册项目与既有 Goal 文件。
- Produces:

```ts
export interface PodGoalBackfillReport {
  eligible: GoalRef[]
  skipped: Array<{ goalId: string; reason: 'ambiguous' | 'unprovable' | 'already_present' }>
}
export function planPodGoalBackfill(projects: readonly string[]): PodGoalBackfillReport
```

- CLI 默认 dry-run，只有显式 `--apply` 才写入。
- [ ] **Step 1: Write the failing tests**
  - 可证明归属的终态与讨论 Goal 都进入 eligible。
  - 同 id 多项目、request 缺少可证明 projectDir、已有 state 与 request 目录冲突均 skipped，不写 DB。
  - 已存在行幂等；绝不使用第一个注册项目。
- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway; npx jest tests/unit/pod/pod-goal-backfill.test.ts --runInBand --forceExit`
Expected: FAIL，模块不存在。

- [ ] **Step 3: Implement dry-run planner and apply adapter**
  - request.json 内明确的 projectDir 必须匹配当前注册项目；若存在 state，其项目证据也必须一致。尚无 state 的 discussion / direction Goal 可凭已验证 request 归属；无法证明时写入报告。
  - apply 复用 Pod Goal store 的幂等写入，不重写旧 Goal 文件。
- [ ] **Step 4: Verify without mutating real data**

Run: `cd gateway; npx jest tests/unit/pod/pod-goal-backfill.test.ts --runInBand --forceExit; npx ts-node scripts/backfill-pod-goals.ts`
Expected: 测试 PASS；真实环境只输出 dry-run 报告，不执行 `--apply`。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-goal-backfill.ts gateway/scripts/backfill-pod-goals.ts gateway/tests/unit/pod/pod-goal-backfill.test.ts
git commit -m "feat(pod): add provable-only historical Goal backfill"
```

### Task 11: Desktop 工作空间与 handoff 纯模型

**Files:**
- Create: `packages/desktop/src/renderer/mafw/workspace-model.ts`
- Create: `packages/desktop/src/renderer/mafw/lead-handoff.ts`
- Create: `packages/desktop/src/renderer/mafw/goal-session-title.ts`
- Test: `packages/desktop/src/renderer/mafw/workspace-model.test.ts`
- Test: `packages/desktop/src/renderer/mafw/lead-handoff.test.ts`
- Test: `packages/desktop/src/renderer/mafw/goal-session-title.test.ts`

**Interfaces:**
- Consumes: Task 4 `PodWorkOverview`、Pod Session route。
- Produces:

```ts
export function workspaceSections(overview: PodWorkOverview): Array<{
  bucket: PodWorkBucket
  goals: PodGoal[]
  count: number
}>
export function buildLeadHandoff(input: {
  sessionTitle: string
  sourceText: string
  sessionID: string
  messageID?: string
  role?: string
}): { title: string; objective: string; sourceRef: GoalSourceRef } | null
export function goalSessionTabTitle(input: {
  goalTitle: string
  revision: number
  role: 'tech_lead' | 'builder' | 'reviewer'
}): string
```

- [ ] **Step 1: Write the failing tests**
  - 每个 section 的 count 等于 goals.length；200 条历史不截断。
  - handoff 拒绝 Lead / Tech Lead / Builder / Reviewer / 内部角色；长来源截断到后端上限内。
  - 同一 Goal / revision / role 的标题确定且不同 Goal 不混淆。
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/desktop; node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workspace-model.test.ts src/renderer/mafw/lead-handoff.test.ts src/renderer/mafw/goal-session-title.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: Implement pure models**
  - 不在这些模块引入 Solid 或 `window.api`；所有展示计数从同一个数组派生。
- [ ] **Step 4: Run pure-model tests**

Run: 同 Step 2。
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/workspace-model.ts packages/desktop/src/renderer/mafw/lead-handoff.ts packages/desktop/src/renderer/mafw/goal-session-title.ts packages/desktop/src/renderer/mafw/*.test.ts
git commit -m "feat(desktop): add workspace, handoff, and Goal session models"
```

### Task 12: 项目 WorkspaceHome 与自由讨论交给 Lead

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/WorkspaceHome.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/WorkOverview.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WelcomeHome.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/nav-tab.ts`
- Test: `packages/desktop/tests/workspace-shell-wiring.test.ts`
- Test: `packages/desktop/tests/lead-entry-wiring.test.ts`

**Interfaces:**
- Consumes: `window.api.mafw.work.overview()`、`pod.ensureLead()`、`pod.handoffGoal()`、Task 11 纯模型。
- Produces: 项目工作空间；现有 `activeTab==='goals'` 作为兼容路由 id 渲染 WorkspaceHome，不再渲染 Dashboard Goals。
- [ ] **Step 1: Write the failing wiring tests**
  - WorkspaceHome 包含 Lead 项目对话入口、工作概览、新话题与全部历史。
  - Welcome 不再调用 `goals.list()`；旧 Goals 入口进入 WorkspaceHome。
  - 自由讨论动作调用 handoffGoal，不删除或修改来源 Session。
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/desktop; node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/workspace-shell-wiring.test.ts tests/lead-entry-wiring.test.ts`
Expected: FAIL，WorkspaceHome 不存在。

- [ ] **Step 3: Implement workspace and handoff wiring**
  - 中间区域可打开 Lead 或自由讨论，右侧概览始终使用同一 work overview。
  - handoff 成功后打开同一 Goal 详情；失败显示可见错误，不伪造成功。
  - 无 Pod 时先走只读 lookup，handoff / Lead ensure 才允许创建或修复。
- [ ] **Step 4: Run desktop focused tests and typecheck**

Run: `cd packages/desktop; node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/workspace-shell-wiring.test.ts tests/lead-entry-wiring.test.ts; npx tsgo --noEmit -p tsconfig.json`
Expected: PASS，rc=0。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw packages/desktop/tests/workspace-shell-wiring.test.ts packages/desktop/tests/lead-entry-wiring.test.ts
git commit -m "feat(desktop): add project workspace and free discussion handoff"
```

### Task 13: 统一 Goal 详情与全部人工行动

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailOverlay.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/PodResultView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodResultPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodTaskBoard.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pod-model.ts`
- Test: `packages/desktop/tests/goal-detail-unified.test.ts`
- Test: `packages/desktop/tests/pod-result-revision-wiring.test.ts`
- Test: `packages/desktop/tests/pod-collab-ui-wiring.test.ts`

**Interfaces:**
- Consumes: 统一 bucket / stage、plan approval、direction、question、result、reject 与 revision API。
- Produces: 一个 Goal 详情实现，包含当前行动、计划/任务、改动、结果、打回与次级执行时间线。
- [ ] **Step 1: Write the failing tests**
  - 结果正文迁入详情；`PodResultPanel` 仅保留兼容薄壳。
  - 「打回给 Tech Lead」在 quick 与 collaborative 结果都可到达。
  - attention 的 plan / question / direction / result action 不再都打开同一个无动作时间线。
  - quick Goal 不渲染空 Reviewer 泳道；历史 revision 与证据仍可展开。
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/desktop; node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/goal-detail-unified.test.ts tests/pod-result-revision-wiring.test.ts tests/pod-collab-ui-wiring.test.ts`
Expected: FAIL，详情缺少统一结果与动作。

- [ ] **Step 3: Implement unified detail**
  - 结果与打回使用既有 Pod API；提问使用既有 Goal question reply，不新增另一套状态。
  - 任务板按 goalId 过滤；删除全局 active-Goal 任务板依赖。
  - 终态取消统一确认；无权限或运行中不显示必然失败的编辑动作。
- [ ] **Step 4: Run focused tests and typecheck**

Run: 同 Step 2，追加 `npx tsgo --noEmit -p tsconfig.json`。
Expected: PASS，rc=0。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw packages/desktop/tests/goal-detail-unified.test.ts packages/desktop/tests/pod-result-revision-wiring.test.ts packages/desktop/tests/pod-collab-ui-wiring.test.ts
git commit -m "feat(desktop): unify Goal details, results, and human actions"
```

### Task 14: Goal 感知的 Session 身份与已结束 transcript

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pod-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/GoalTimelineLane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/SessionStrip.tsx`
- Test: `packages/desktop/src/renderer/mafw/session-tab-identity.test.ts`
- Test: `packages/desktop/tests/pod-panel-wiring.test.ts`

**Interfaces:**
- Consumes: Task 11 `goalSessionTabTitle()` 与现有 Pod transcript route。
- Produces: 同一 Assignment Session 从成员、时间线、通知或历史打开时具有同一 Goal / revision / 角色标题；已结束 Session 打开 transcript。
- [ ] **Step 1: Write the failing tests**
  - Builder / Reviewer 不再回退为 `Chat N` 或「会话中 · 会话中」。
  - 已结束 Session 不走 live open；同 id 重复打开复用 tab。
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/desktop; node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/session-tab-identity.test.ts tests/pod-panel-wiring.test.ts`
Expected: FAIL，非 Lead 路由仍缺 Goal 标题。

- [ ] **Step 3: Implement one session-opening path**
  - 所有 Goal 会话入口汇入同一 resolver；不在各组件分别拼标题。
- [ ] **Step 4: Run identity regressions**

Run: 同 Step 2。
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw packages/desktop/tests/pod-panel-wiring.test.ts
git commit -m "fix(desktop): give Goal Sessions one stable identity"
```

### Task 15: 退役重复页面并迁移团队资源与 deep link

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/ProjectResources.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/IconRail.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/LeftDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ExecutionView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/NotesDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/rail-display.ts`（左栏「工作」改为「讨论」）
- Modify: `packages/desktop/src/renderer/mafw/workbench-views.ts`
- Modify: `packages/desktop/src/renderer/mafw/deep-link.ts`
- Modify: `packages/desktop/src/renderer/mafw/page-links.ts`
- Delete after references are gone: `packages/desktop/src/renderer/mafw/pages/Dashboard.tsx`
- Delete after references are gone: `packages/desktop/src/renderer/mafw/components/PodRailFace.tsx`
- Test: `packages/desktop/tests/dead-code.test.ts`
- Test: `packages/desktop/src/renderer/mafw/deep-link.test.ts`
- Test: `packages/desktop/src/renderer/mafw/workbench-views.test.ts`
- Test: `packages/desktop/tests/icon-rail-pod-wiring.test.ts`
- Test: `packages/desktop/tests/execution-view-wiring.test.ts`

**Interfaces:**
- Consumes: Task 12 工作空间、Task 13 详情、Task 14 会话 resolver。
- Produces: 团队 / 邮箱 / Pod 记忆 / notes 的唯一项目资源入口；旧 Goals 与鲸群导航都进入新工作空间或资源页。
- [ ] **Step 1: Write the failing contract tests**
  - 旧 `mafw://tab/goals` 解析到工作空间；persisted `executionSection='pod'` 一次性迁到团队资源。
  - 不再挂载 Dashboard 或 PodRailFace；不存在第二个 Goal 列表。
  - 团队邮箱、手工 notes 与 Pod 记忆仍可从项目资源打开。
- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/desktop; node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/dead-code.test.ts src/renderer/mafw/deep-link.test.ts src/renderer/mafw/workbench-views.test.ts tests/icon-rail-pod-wiring.test.ts tests/execution-view-wiring.test.ts`
Expected: FAIL，旧入口仍存在。

- [ ] **Step 3: Retire surfaces in dependency order**
  - 先迁移资源入口与 deep link，再删除无引用组件；不删除仍有调用方的 API。
  - 更新所有字符串 wiring 契约，使测试钉住新结构而不是保留旧结构。
- [ ] **Step 4: Run full Desktop tests**

Run: `cd packages/desktop; npm test; npx tsgo --noEmit -p tsconfig.json; npx electron-vite build`
Expected: 全量 PASS，typecheck/build rc=0。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop
git commit -m "refactor(desktop): retire duplicate Goal and Pod surfaces"
```

### Task 16: 全量验证、真机冒烟与交付记录

**Files:**
- Modify: `AGENTS.md`（仅追加本批最终实现与实测记录）
- Modify: `docs/superpowers/specs/2026-11-03-project-workspace-adaptive-goal-design.md`（仅在实现有经批准的偏差时记录）
- Test: `gateway/tests/integration/pod-quick-path.test.ts`
- Test: `gateway/tests/integration/pod-collaboration-loop.test.ts`

**Interfaces:**
- Consumes: Tasks 1–15 的全部产出。
- Produces: 可复核的测试计数、构建结果、GUI 证据与 commit 记录；不做未获批准的 push / deploy / release。
- [ ] **Step 1: Run contract and integration gates**

Run: `cd gateway; npm test -- --forceExit; npx tsc --noEmit -p tsconfig.json; npm run emit:openapi`
Run: `cd packages/gateway-sdk; npm test; npm run typecheck`
Run: `cd packages/tui; npm test`
Run: `cd packages/desktop; npm test; npx tsgo --noEmit -p tsconfig.json; npx electron-vite build`
Run: repo root `npx jest tests/plugin-v2.test.ts --runInBand --forceExit; npm run build`
Expected: 所有命令 rc=0；记录实际新增测试数与全量通过数，不引用旧计数。

- [ ] **Step 2: 执行真机 GUI 冒烟**
  - 自由话题 → 交给 Lead → Goal 出现；删除话题后 Goal 仍在，取消 Goal 后话题仍在。
  - 小 debug 走 quick：一个 Worker、完成通知、无 PASS、无「需要你」、结果可打回给 Tech Lead。
  - 复杂 Goal 走 collaborative：计划批准、执行、review、结果与 revision 打回可用。
  - 同一 Goal 在对话卡片、概览、详情中的 title / bucket / revision / result 一致；计数等于列表；全部历史可达。
  - 同一 Worker 从时间线、成员和通知打开均为同一标题；已结束会话打开 transcript。
  - 旧 Goals、鲸群入口与 deep link 落到新页面；1088 / 1366 / 1600 宽度无阻断。
  - gateway 重启后 Goal 与结果保持；runtime Session 替换不改变 Goal 业务状态。
- [ ] **Step 3: 复核 spec 与变更边界**
  - 对照 spec §12 逐项打勾；任何未实测 GUI 项明确写「未验证」，不得声称通过。
  - `git diff --check`、`git status --short`；确认不触碰无关未跟踪文档与谐波记忆实现。
- [ ] **Step 4: 更新交付记录并提交**
  - AGENTS 记录本批新增测试数、各包全量通过数、GUI 实测范围和最终 commit。
  - 保存一条指向 spec / plan 的记忆指针，不复述全文。

```bash
git add AGENTS.md docs/superpowers/specs/2026-11-03-project-workspace-adaptive-goal-design.md
git commit -m "docs: record project workspace adaptive Goal delivery"
```

---

## Implementation Order and Safety

- Tasks 1–4 建立身份与读模型；Tasks 5–9 完成快速执行；Task 10 只提供 dry-run 迁移工具；Tasks 11–15 改 Desktop。
- Task 15 不得提前：只有工作空间、统一详情、结果打回和资源入口都可用后，才能退役旧页面。
- 现有 `/api/goals` 可暂时保留给 TUI / legacy 客户端，但 Desktop 不再把它当 Goal 真相源；物理删除属于另一次破坏性发布。
- 如果执行时必须偏离本计划，先更新设计或计划并让用户确认影响；不要静默改变 Goal 归属、审批或结果语义。
