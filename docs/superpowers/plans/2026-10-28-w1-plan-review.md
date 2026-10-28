# W1 Plan 审阅工作流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** manual 模式的 goal 在 plan 完成后驻留待批，用户在 goal 泳道下钻查看计划（waves.json 渲染）、划选批注、批准或驳回并反馈。

**Architecture:** gateway 侧 `planReview` 配置进 state v3，driver 在 plan 成功后按模式决定「直接推进」或「parked 待批」，approve/reject 是 driver 的两个新入口 + HTTP 路由；desktop 侧新建 `PlanReviewOverlay`（GoalDetailOverlay 下钻浮层），复用批注引文锚体系，批注驳回专用。

**Tech Stack:** gateway (Node http routes, jest), desktop (SolidJS, bun:test), @mafw/sdk + preload。

**Spec:** `docs/superpowers/specs/2026-10-28-w1-plan-review-design.md`（8 项裁决已并入，含用户拍板：批注驳回专用、TUI descope）。

## Global Constraints

- `planReview` 缺省 `'auto'`；存量 goal 读侧兜底 `state.planReview ?? 'auto'`，零迁移。
- `nextAction==='AWAIT_PLAN_APPROVAL'` 是合法驻留态：advanceInner / examineStaleNode / 启动恢复都不得推进它；仅 approve/reject 可解锁。
- approve/reject 前置校验：`planApproval?.status==='pending'` 且非 `isTerminalState`；否则 409。
- ABORT 归档时置 `planApproval: null`。
- planFeedback 清除点 = completeNode plan 成功分支（`planFeedback: null`）。
- attempt 推导：同 (goalId, round, node) 既有行存在即 `max+1`（替代「仅 failed/timeout/aborted 才 +1」）。
- `planReview` 声明链：MCP `mafw_create_goal`/`mafw_set_goal` 参数（校验枚举）→ request.json → `ensureGoalState` init。
- 批注草稿不持久化（overlay 本地池）；批注只两条出路：驳回打包 / 复制文本。
- 桌面测试命令 `cd packages/desktop && npm test`；gateway `cd gateway && npx jest --silent`（或按仓库现状 npm test）。每 Task 收尾跑所属包全量。

## Review Focus

（spec 未明说、最可能咬人的输入类；测试钉在所属 Task）

1. **stray advance 越门**：legacy `state_change` 唤醒 / `handleComplete` 幂等重放 / `examineStaleNode` 的 `!ns → advance` 分支，都不得把 parked goal 推进 execute——Task 1 driver 测试钉。
2. **已取消 goal 被批准复活**：terminal 态调 approve → 409 且 state 不被覆写——Task 2 路由测试钉。
3. **驳回反馈泄漏进无关轮次**：review-FAIL 触发的下一轮 plan prompt 不得含上一轮 planFeedback（plan 成功时已清）——Task 2 prompt 测试钉。
4. **waves.json 缺失/损坏时打开计划面板**：GET plan 返回 `waves:null` 不 500；overlay 显示空态而非崩溃——Task 2 路由 + Task 3 视图模型测试钉。
5. **重复驳回幂等**：连点两次驳回/批准（第二次非 pending）→ 409，不产生第二个 replan——Task 2 路由测试钉。

---

### Task 1: gateway 状态机——state v3 字段 + routing 门 + driver park/approve/reject

**Files:**
- Modify: `gateway/src/core/goal/state-v3.ts`（GoalStateV3 三字段 + ensureGoalState init.planReview）
- Modify: `gateway/src/core/goal/routing.ts`（RouteState.planReviewGate + routeAfterPlan）
- Modify: `gateway/src/core/goal/driver.ts`（completeNode plan 分支 park、advanceInner 守卫、approvePlan/rejectPlan、executeNode attempt 修正、prompt ctx planFeedback、watchdog 跳过、plan 成功清 planFeedback）
- Test: `gateway/tests/unit/goal-routing.test.ts`（扩充）、`gateway/tests/unit/goal-driver-plan-review.test.ts`（新建）

**Interfaces:**
- Produces（Task 2/3 依赖）：
  - `GoalStateV3.planReview?: 'auto' | 'manual'`、`planApproval?: { status: 'pending' | 'approved' | 'rejected'; feedback?: string; decidedAt?: string; round: number }`、`planFeedback?: string`
  - `NodeDriver.approvePlan(goalId: string): Promise<boolean>` / `rejectPlan(goalId: string, feedback: string): Promise<boolean>`（false = 非 pending/终态/goal 未知）
  - `RouteState.planReviewGate?: boolean`；`routeAfterPlan` 在 gate 时返回 `'await_plan_approval'`
  - `GoalNodeName` 增 `'await_plan_approval'`（仅作路由返回值；advanceInner 对它 return——无对应节点执行）
  - `renderNodePrompt` ctx 增 `planFeedback?: string`（本 Task 只在 driver 传参处接好字段，渲染文本 Task 2 实现）

- [ ] **Step 1: routing 失败测试**

`goal-routing.test.ts` 新增：
- `routeAfterPlan({pendingQuestion:...})` → `'askUser'`（既有语义回归）
- gate=true 且无 pendingQuestion → `'await_plan_approval'`
- gate=false → `'execute'`
- pendingQuestion 优先于 gate → `'askUser'`

- [ ] **Step 2: 跑测试确认失败**（`routeAfterPlan` 无 gate 分支）

Run: `cd gateway && npx jest tests/unit/goal-routing.test.ts --silent`
Expected: 新用例 FAIL（返回 execute）

- [ ] **Step 3: 实现 routing**

`RouteState` 加 `planReviewGate?: boolean`；`routeAfterPlan`：pendingQuestion → askUser；`s.planReviewGate` → `'await_plan_approval'`；否则 execute。`GoalNodeName` 联合类型加 `'await_plan_approval'`。

- [ ] **Step 4: routing 测试转绿**

- [ ] **Step 5: driver 失败测试**（新建 `goal-driver-plan-review.test.ts`，模式照抄既有 driver 测试的 fake deps harness）

用例：
1. manual + plan ready 完成 → `nextAction==='AWAIT_PLAN_APPROVAL'`、`planApproval.status==='pending'`、`advance` 未建 execute 会话（client.create 只被调 1 次）
2. parked 时 `advance(goalId)` 直调 → 不建 execute 会话（stray advance 不越门）；`examineStaleNode` 同样 no-op
3. `approvePlan` → `nextAction==='NEXT_execute'` 且推进建 execute 会话；`planApproval.status==='approved'`
4. `rejectPlan('意见')` → `planFeedback==='意见'`、`nextNode==='plan'`、重跑 plan（第二次 plan 会话，同 round）
5. 非 pending 调 approve/reject → false，state 不变
6. 终态 goal 调 approve → false（isTerminalState 防线）
7. plan 成功后 `planFeedback === null`（清除点）
8. 同 (round,node) 上一行 succeeded 再执行 → attempt=2（推导修正）
9. auto goal plan 完成 → 直接 execute（回归：无 planApproval 写入）

- [ ] **Step 6: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-driver-plan-review.test.ts --silent`
Expected: FAIL（approvePlan 未定义等）

- [ ] **Step 7: 实现 driver + state v3**

- state-v3.ts：接口加三字段；`ensureGoalState` init 增 `planReview?: 'auto' | 'manual'`（写入初始 state）。
- driver.ts：
  - `advanceInner` 在 `isTerminalState` 检查后加 `if (state.nextAction === 'AWAIT_PLAN_APPROVAL') return;`
  - `completeNode` plan ready 分支组装 routing 输入时算 `planReviewGate = planReviewOf(state)==='manual'`；路由结果 `nextNode==='await_plan_approval'` 时写 `{ planApproval: { status:'pending', round }, nextAction: 'AWAIT_PLAN_APPROVAL', nextNode: 'execute', planFeedback: null }`、**不 advance**、emit `phase_transition(PLANNING_AWAIT_APPROVAL)`；其余路径照旧（plan 成功一律 `planFeedback: null`）。
  - `executeNode` attempt：`prevRun ? prevRun.attempt + 1 : 1`（去掉状态过滤）；prompt ctx 加 `planFeedback: state.planFeedback || undefined`。
  - 新方法 `approvePlan/rejectPlan`（见 Interfaces；reject 写 `planFeedback` + `planApproval rejected` + `nextNode:'plan'`、`nextAction:'RUNNING_plan'` 后 `advance`；approve 写 approved + `nextAction:'NEXT_execute'` 后 `advance`；都先查 found→pending→terminal）。
  - `examineStaleNode` 在 `isTerminalState` 检查后加同款 AWAIT 守卫。
- 读侧兜底 `planReviewOf`（driver 内局部函数即可）。

- [ ] **Step 8: driver 测试转绿**

Run: `cd gateway && npx jest tests/unit/goal-driver-plan-review.test.ts tests/unit/goal-routing.test.ts --silent`
Expected: PASS

- [ ] **Step 9: gateway 全量回归**

Run: `cd gateway && npm test -- --silent 2>&1 | tail -5`
Expected: 全绿（既有 driver/routing 用例零回归；若既有 driver 测试断言 completeNode 后直接 advance，按新分支补 auto 显式断言）

- [ ] **Step 10: Commit**

```bash
git add gateway/src/core/goal gateway/tests
git commit -m "feat(gateway): goal plan-review gate state machine (park/approve/reject)"
```

---

### Task 2: gateway 接线——prompt 注入 + milestone 白名单 + 声明链 + HTTP 路由 + SDK

**Files:**
- Modify: `gateway/src/core/goal/node-prompts.ts`（NodePromptCtx.planFeedback + plan prompt 段）
- Modify: `gateway/src/core/manager/milestone-push.ts`（MILESTONE_PHASES + `PLANNING_AWAIT_APPROVAL`）
- Modify: `gateway/src/index.ts`（startGoal 读 request.json planReview 传 ensureGoalState；ABORT 清 planApproval；注册新路由；driver 事件 emit 检查）
- Modify: `gateway/src/routes/goal-timeline.ts`（响应增 `planReview`/`planApproval` 字段——desktop 泳道徽标数据源）
- Create: `gateway/src/routes/goal-plan.ts`（GET plan + POST plan-approval）
- Modify: `gateway/src/mcp/tool-registry.ts`（create/set goal 接受 planReview，校验枚举，写 request.json）
- Modify: `packages/gateway-sdk/src/*.ts`（goals.plan/approvePlan/rejectPlan）+ `packages/desktop/src/preload/`（mafw-api/types）
- Test: `gateway/tests/unit/goal-plan-routes.test.ts`（新建）、`gateway/tests/unit/node-prompts.test.ts`（扩充）

**Interfaces:**
- Consumes: Task 1 的 driver 方法与 state 字段。
- Produces (Task 3 依赖)：
  - `GET /api/goals/:id/plan` → `{ planReview, planApproval, planFeedback, round, waves, wavePlanPath }`（waves 为解析后的 JSON object 或 null）
  - `POST /api/goals/:id/plan-approval` `{ approve: boolean, feedback?: string }` → 200 `{success:true}` / 400（reject 无 feedback）/ 404（未知 goal）/ 409（非 pending 或终态）
  - SDK：`goals.plan(goalId): Promise<GoalPlanInfo>`、`goals.approvePlan(goalId): Promise<void>`、`goals.rejectPlan(goalId, feedback): Promise<void>`
  - preload：`window.api.mafw.goals.plan/approvePlan/rejectPlan`

- [ ] **Step 1: 失败测试——node-prompts**

用例：`renderNodePrompt('plan', {...ctx, planFeedback: '删掉 wave 2'})` 输出含「上一版计划被驳回」与原文「删掉 wave 2」；无 planFeedback 时不含该段（回归）。

- [ ] **Step 2: 失败测试——路由**（fake deps harness，照抄 goal-node-retry 测试模式）

用例：
1. GET plan：state 有 waves 文件 → 返回解析 JSON + `planReview/planApproval`；文件缺失 → `waves:null` 且 200；未知 goal → 404
2. POST approve：pending → 200 且 `approvePlan` 被调一次；重复 approve → 409；终态 → 409
3. POST reject：feedback 非空 → 200；feedback 空白 → 400；非 pending → 409
4. ABORT 流程置 `planApproval:null`（对 archiveGoal CANCELLED 分支断言，或驱动层单测）

- [ ] **Step 3: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-plan-routes.test.ts tests/unit/node-prompts.test.ts --silent`
Expected: FAIL

- [ ] **Step 4: 实现接线**

- node-prompts：ctx 加 `planFeedback?: string`；plan 段加「上一版计划被驳回，用户意见：…（本轮计划必须消化）」。
- milestone-push：白名单加 `PLANNING_AWAIT_APPROVAL`。
- routes/goal-plan.ts：`handleGoalPlan(req,res,url,deps)`，deps = `{ readGoalState, wavePlanPathOf, driverApprove, driverReject, registerMafwDir }`（GET 走 `state.wavePlanPath` 读文件；路由注册在 dashboard 兜底之前——AGENTS 已知坑）。GET 也返回 `request 不存在时的 404`。
- index.ts：startGoal 的 ensureGoalState init 增 `planReview`（读 request.json，isPlanReview 校验）；ABORT/归档路径写 `planApproval:null`；注册 `handleGoalPlan`。
- MCP tool-registry：`mafw_create_goal`/`mafw_set_goal` zod/schema 加 `planReview`（enum auto|manual），落 request.json。
- SDK + preload 三方法。
- 检查 `phase_transition` emit 位置：parked 时 emit 的 phase 常量定义（`PLANNING_AWAIT_APPROVAL`）与 milestone-push 词汇一致。

- [ ] **Step 5: 路由 + prompts 测试转绿；gateway 全量回归**

Run: `cd gateway && npm test -- --silent 2>&1 | tail -5`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add gateway packages/gateway-sdk packages/desktop/src/preload
git commit -m "feat(gateway): plan-review wiring (prompt feedback, milestone, routes, SDK)"
```

---

### Task 3: desktop 计划渲染 + PlanReviewOverlay + 泳道入口

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/plan-render.ts`（纯函数）+ `plan-render.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/plan-review-model.ts`（视图模型纯函数）+ `.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/PlanReviewOverlay.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailOverlay.tsx`（最新 plan run 入口 + 待批准徽标）
- Modify: `packages/desktop/src/renderer/mafw/components/GoalTimelineLane.tsx`（plan 格子徽标/点击语义）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（overlay/徽标样式）

**Interfaces:**
- Consumes: Task 2 的 preload 三方法。
- Produces:
  - `renderPlanMarkdown(waves: unknown): string`（waves.json → markdown；`need_clarification` → 问题清单；非法输入 → 空串）
  - `planReviewViewModel(info: { planReview, planApproval, waves, terminal }）: { status: 'pending'|'approved'|'rejected'|'auto'; showActions: boolean; badge: string }`

- [ ] **Step 1: 失败测试——renderPlanMarkdown / 视图模型**

用例：ready waves（2 wave、tasks、riskNote）→ `## Wave w1：…` + 任务列表 + `> riskNote`；need_clarification → 死亡「待澄清」+ 问题列表；null/畸形 → 空串。视图模型：manual+pending → showActions true + 徽标「待批准」；approved →「已批准」无动作条；auto →「自动模式」只读；终态 → 无动作条 + 终态说明。

- [ ] **Step 2: 跑测试确认失败 → 实现两个纯模块 → 转绿**

- [ ] **Step 3: PlanReviewOverlay 组件 + 泳道接线**

- GoalDetailOverlay 增 `planGoal` signal；timeline 数据里最新 plan run（max loop、succeeded 或 pending）格子提供「查看计划」；manual+pending 徽标（`planApproval` 从 timeline 响应取，Task 2 已带）。
- overlay：load `goals.plan(goalId)` → view model → markdown 预览（复用 `@mafw/session-ui/markdown`，与文件预览同款 cacheKey 模式）→ 头部状态 + 动作条（批准/驳回输入框）→ Esc/点外关闭；操作后 toast + `goalsRev` 已有的重拉链路刷新。
- preload 方法接线（Task 2 已加）。

- [ ] **Step 4: desktop 全量回归 + typecheck + build**

Run: `cd packages/desktop && npm test`；`npx tsgo --noEmit`；`npx electron-vite build`
Expected: 全绿 + rc=0

- [ ] **Step 5: Commit**

```bash
git add packages/desktop
git commit -m "feat(desktop): plan review overlay with approve/reject (goal swimlane drill-down)"
```

---

### Task 4: overlay 批注（引文锚 + 驳回打包 + 复制文本）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/PlanReviewOverlay.tsx`（划选 → quote 锚 → AnnotationSheet → 草稿池）
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（锚点高亮/草稿条）
- Test: `packages/desktop/src/renderer/mafw/components/plan-review-model.test.ts`（buildRejectFeedback 扩充）

**Interfaces:**
- Consumes: `annotation-anchor.ts` quote 锚构建、`annotation-placement.ts` placeAnnotationBox、`AnnotationSheet` 组件（挂载 props 以 EditorDock 现用法为准）、Task 3 的 `planReviewViewModel`。
- Produces: `buildRejectFeedback(drafts: PlanAnnotationDraft[], freeText: string): string`（批注引文块 + 意见拼装；全空 → ''）；overlay 内 `PlanAnnotationDraft[]` 草稿池——驳回时经 `buildRejectFeedback` 进 `goals.rejectPlan`；非 pending 提供「复制批注文本」。

- [ ] **Step 1: 失败测试——buildRejectFeedback**

用例：空草稿+空文本 → ''（禁用驳回）；两条草稿 → 引文块（`> ` 前缀）+ 意见 + freeText 拼接顺序稳定；仅 freeText → 原样。

- [ ] **Step 2: 跑失败 → 实现 → 转绿**

- [ ] **Step 3: overlay 集成**

- 正文容器 `selectionchange/mouseup` → quote 锚（照 EditorDock md 预览模式，代码以现实现为准）→ AnnotationSheet（placeAnnotationBox 定位）→ Enter 攒草稿（Enter=草稿语义，直发不适用——批注驳回专用）。
- 草稿条：逐条引文摘要 + 删除；驳回时打包；「复制批注文本」按钮（剪贴板 + toast）。
- Esc 优先关 AnnotationSheet（capture 层次照 EditorDock）。

- [ ] **Step 4: desktop 全量 + tsgo + build**

- [ ] **Step 5: Commit**

```bash
git add packages/desktop
git commit -m "feat(desktop): plan annotations (quote anchors, reject packing, copy)"
```

---

### Task 5: 全量回归 + AGENTS.md + GUI 冒烟

- [ ] **Step 1: 三包全量**：gateway / desktop / session-ui / SDK 全绿 + tsgo rc=0 + electron-vite build rc=0。
- [ ] **Step 2: GUI 冒烟**（dev app + gateway 重启）：manual goal（经 MCP 创建 planReview:manual）→ plan 完成 parked → 泳道「待批准」徽标 → 打开计划 → 划选批注 → 驳回（反馈含引文）→ 重规划 → 批准 → execute 节点启动；auto goal 回归（无门）。
- [ ] **Step 3: AGENTS.md 记录**（字节级编辑，GBK/UTF-8 混合注意）+ roadmap ledger 更新 + Commit。
