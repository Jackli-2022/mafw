# Project Agent Workbench — Goal and Role Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让项目工作区以用户可理解的方式呈现 Goal 的方向、进度和结果，并让 Lead ↔ Tech Lead 的讨论切换不再关闭或丢失当前 Goal。

**Architecture:** 这是三份计划中的 Plan A，只改 desktop renderer。新增一个纯模型把 `PodGoal` 投影为「方向 / 进度 / 结果与变更 / 历史」，新增一个纯上下文模型判断何时进入 Tech Lead 以及何时显示「返回项目 Lead」。`MafwShell` 统一通过 `openGoalAndDiscuss` 进入 Goal；`GoalDetailPanel` 按用户面重排并把技术诊断收进默认折叠区。内容工作台、文件树和评审资源不在本计划内。

**Tech Stack:** Electron + SolidJS + `@mafw/ui/v2`；node --test + `@mafw/test-shim`；TypeScript；现有 `PodGoal` / `PodDetail` SDK DTO。

**Spec:** `docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md`

## Global Constraints

- Plan A 不修改 gateway、SDK、runtime contract、MCP 或数据库；需要后端支持的内容留给 Plan C。
- 禁止新增裸 `<button>`、`<input>` 或裸 `title`；一律使用 `@mafw/ui/v2` 组件，Tooltip 使用 `TooltipV2` 且 `openDelay={300}`。
- 用户可见文案不得出现 runtime session id、`goal-YYYY...` 内部 Goal ID、runtime 名或 capability flag。
- 人工验收、PASS 不自动合并、worktree revision 隔离、角色隐藏和现有 Pod 权限边界不改动。
- 浏览器测试必须带 `--conditions=browser`；否则 Solid effect 是 no-op，会出现假绿。
- Plan A 不新增硬编码色值；所有样式使用 `mafw.css` 现有主题 token。
- 每个任务先写失败测试、确认 RED、再实现 GREEN、最后提交；提交只包含该任务文件。
- 计划执行结束时必须汇报新增测试数、聚焦测试通过数、desktop 全量通过数、`tsgo` 与 `electron-vite build` 结果。

## Scope Boundaries

- 本计划保留现有右 dock 四个一级面和现有文件/内容查看器；内容工作台重排在 Plan B。
- 本计划不实现评审项持久化、意见状态、风险强制验收；这些在 Plan C。
- 本计划实现 Goal 的三类用户呈现、Chat 角色连续性、技术详情折叠和 Goal 列表的人类可读状态。
- 本计划中的「结果与变更」复用现有 `PodResultView` 和已存在的 diff / worktree 能力，不新增内容查看协议。

## File Structure

### Create

- `packages/desktop/src/renderer/mafw/goal-user-view.ts` — `PodGoal` 到用户可读 Goal 摘要的纯投影；所有文案、face、进度和下一动作的唯一来源。
- `packages/desktop/src/renderer/mafw/goal-user-view.test.ts` — 纯投影的状态矩阵与旧 gateway 降级测试。
- `packages/desktop/src/renderer/mafw/goal-chat-context.ts` — Goal 讨论进入规则、Tech Lead 会话语义与返回 Lead 可见性。
- `packages/desktop/src/renderer/mafw/goal-chat-context.test.ts` — 终态、非终态、错误会话和 Goal 切换测试。
- `packages/desktop/src/renderer/mafw/components/GoalUserHero.tsx` — Goal 详情顶部的人类可读状态、下一动作、进度和技术详情开关。
- `packages/desktop/src/renderer/mafw/goal-workbench-wiring.test.ts` — 源码契约测试：列表接线、详情 face 分区、不关闭右栏、返回 Lead 控件、CSS token。

### Modify

- `packages/desktop/src/renderer/mafw/components/WorkOverview.tsx` — Goal 列表改用用户摘要，不展示内部状态术语。
- `packages/desktop/src/renderer/mafw/components/WorkPriorityList.tsx` — 注意力卡片复用用户摘要的下一动作与状态。
- `packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx` — 三类用户面、结果优先、技术详情折叠、移除内部 ID 主视觉。
- `packages/desktop/src/renderer/mafw/MafwShell.tsx` — `openGoalAndDiscuss`、Chat 角色连续性、返回 Lead 接线。
- `packages/desktop/src/renderer/mafw/components/ChatPane.tsx` — Tech Lead Goal 会话的「返回项目 Lead」标题栏动作。
- `packages/desktop/src/renderer/mafw/mafw.css` — Goal 用户视图和返回控件的 token 样式。
- `docs/architecture/desktop.md` — 交付后更新现状段。

---

## Review Focus

1. **终态 Goal**：进入已结束 Goal 不得自动 ensure 或打开 live Tech Lead 会话；只能打开结果 / 历史，且不显示“返回 Lead”控件。测试在 Task 2 与 Task 5。
2. **旧 gateway 缺失 stage / bucket / progress**：Goal 摘要不得崩溃、不得伪造百分比；未知状态降级为进度面且不曝内部字段。测试在 Task 1。
3. **执行中的真人动作**：question / blocked / failing / plan approval 即使属于进度面也必须在首屏给出动作，不能被折叠进技术详情。测试在 Task 1 与 Task 4。
4. **进入 Goal 的连续性**：打开 Goal、与 Tech Lead 讨论、打回、打开 timeline 会话都不能调用关闭 Goal 详情的回调；右侧 Goal 必须保持。测试在 Task 5。
5. **跨 Goal 的旧会话**：当前打开的 Tech Lead 会话不属于选中 Goal 时不得显示“返回 Lead”，也不得把消息发到错误的 Goal 上下文。测试在 Task 2 与 Task 5。

---

### Task 1: User-facing Goal projection

**Files:**
- Create: `packages/desktop/src/renderer/mafw/goal-user-view.ts`
- Test: `packages/desktop/src/renderer/mafw/goal-user-view.test.ts`

**Interfaces:**
- Consumes: `PodGoal` from `@mafw/sdk`。
- Produces:
  ```ts
  export type GoalUserFace = "direction" | "progress" | "result" | "history"
  export type GoalUserSummary = {
    goalId: string
    face: GoalUserFace
    statusLabel: string
    ownerLabel: string
    nextActionLabel: string | null
    needsPerson: boolean
    progressText: string | null
    progressPercent: number | null
    revision: number
    resultReady: boolean
    ended: boolean
  }
  export function goalUserFace(goal: PodGoal): GoalUserFace
  export function summarizeGoalForUser(goal: PodGoal): GoalUserSummary
  ```
- Face mapping:
  - `endedAt` 非空 → `history`
  - `resultReady === true` 或 `bucket === "result_ready"` → `result`
  - stage kind `discussing | direction_review | planning | plan_approval` → `direction`
  - 其余（含旧 gateway 无 stage）→ `progress`
- Action mapping:
  - `open_direction_review → 裁定方向`，`open_plan_review → 审阅计划`，`open_question → 回答问题`，`open_result → 查看结果`
  - `stage.owner === "person"` 且 unknown action → `处理当前事项`
  - blocked 且 `lastError` 非空 → status `执行失败`、action `重试`；blocked 无错误 → `需要处理阻塞` / `处理阻塞`
  - 结束后无结果 → `已结束` / `查看历史`；结束后有结果 → `已结束` / `查看结果`
  - 健康 progress / planning / discussing 无强制动作时 `nextActionLabel = null`
- `ownerLabel` 非终态为 `Tech Lead`，终态为 `已结束`；内部角色（Builder/Reviewer）不出现在主标签。

- [ ] **Step 1: Write failing projection tests**

在 `goal-user-view.test.ts` 复用 `work-overview-model.test.ts` 的 `goal(input)` 构造器，补齐 `PodGoal` 必填字段。至少断言：

```ts
assert.equal(goalUserFace(goal({ goalId: "d", stage: { owner: "person", kind: "direction_review" } })), "direction")
assert.equal(goalUserFace(goal({ goalId: "p", stage: { owner: "team", kind: "working" } })), "progress")
assert.equal(goalUserFace(goal({ goalId: "r", bucket: "result_ready", resultReady: true })), "result")
assert.equal(goalUserFace(goal({ goalId: "h", endedAt: "2026-11-11T00:00:00.000Z" })), "history")

const approval = summarizeGoalForUser(goal({
  goalId: "p1",
  bucket: "needs_you",
  stage: { owner: "person", kind: "plan_approval", action: { type: "open_plan_review", goalId: "p1" } },
}))
assert.equal(approval.face, "direction")
assert.equal(approval.statusLabel, "计划待确认")
assert.equal(approval.nextActionLabel, "审阅计划")
assert.equal(approval.needsPerson, true)
assert.equal(approval.ownerLabel, "Tech Lead")

const working = summarizeGoalForUser(goal({
  goalId: "w1",
  progress: { total: 4, done: 2, inProgress: 1, review: 0, failed: 0, skipped: 0 },
}))
assert.equal(working.face, "progress")
assert.equal(working.progressText, "2/4 项任务")
assert.equal(working.progressPercent, 50)
assert.equal(working.nextActionLabel, null)

const unknown = summarizeGoalForUser({ ...goal({ goalId: "old" }), stage: undefined as any, bucket: undefined as any })
assert.equal(unknown.face, "progress")
assert.equal(unknown.progressPercent, null)
assert.equal(unknown.statusLabel, "正在推进")
```

还要覆盖 question、blocked+lastError、ended+resultReady、owner person + unknown action，并断言结果不含 `ses_`、`goal-2026`、`runtime`。

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/goal-user-view.test.ts` (workdir `packages/desktop`)
Expected: FAIL because `./goal-user-view` cannot be resolved.

- [ ] **Step 3: Implement the pure projection**

实现 `goalUserFace` 与 `summarizeGoalForUser`。文案只使用固定表；进度只从 `goal.progress` 计算为 `"<done>/<total> 项任务"` 与整数百分比，不展示 Builder/Reviewer 等执行角色，也不根据阶段伪造百分比。`needsPerson` 为 `!ended && (stage.owner === "person" || resultReady || lastError)` 的显式布尔，不根据 UI 文案反推。

- [ ] **Step 4: Run focused test and verify GREEN**

Run: same command as Step 2.
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/goal-user-view.ts packages/desktop/src/renderer/mafw/goal-user-view.test.ts
git commit -m "feat(desktop): project goals into user-facing summaries"
```

---

### Task 2: Goal discussion context helpers

**Files:**
- Create: `packages/desktop/src/renderer/mafw/goal-chat-context.ts`
- Test: `packages/desktop/src/renderer/mafw/goal-chat-context.test.ts`

**Interfaces:**
- Consumes: `PodDetail`, `PodGoal`, `PodSession` from `@mafw/sdk`.
- Produces:
  ```ts
  export function shouldOpenTechLeadForGoal(
    goal: Pick<PodGoal, "endedAt"> | null | undefined,
  ): boolean
  export function goalDiscussionTarget(
    detail: PodDetail | null,
    goalId: string,
  ): PodGoal | null
  export function techLeadSessionForGoal(input: {
    detail: PodDetail | null
    goalId: string | null
    activeSessionId: string | null
  }): boolean
  export function shouldShowReturnLead(input: {
    detail: PodDetail | null
    selectedGoalId: string | null
    activeSessionId: string | null
  }): boolean
  ```
- `shouldOpenTechLeadForGoal` 仅在 Goal 存在且未结束时返回 true。
- `goalDiscussionTarget` 只从传入 detail 查 Goal，不读取全局 store。
- `techLeadSessionForGoal` 仅当 active session 同时满足：属于当前 detail 的 `tech_lead` 成员、`goalId` 匹配、未结束、`node === "discussion"` 或 `scopeKind === "discussion"` 时返回 true。
- `shouldShowReturnLead` 仅在 `selectedGoalId` 非空、该 Goal 存在于 detail 且 `!goal.endedAt`、并且 `techLeadSessionForGoal(...)` 为 true 时返回 true。

- [ ] **Step 1: Write failing helper tests**

构造 `PodDetail` fixture，包含 lead / tech_lead 成员和三条会话：目标 Goal 的 live discussion、目标 Goal 的 live builder execute、另一 Goal 的 tech_lead discussion。断言：

```ts
assert.equal(shouldOpenTechLeadForGoal({ endedAt: null }), true)
assert.equal(shouldOpenTechLeadForGoal({ endedAt: "2026-11-11T00:00:00.000Z" }), false)
assert.equal(shouldOpenTechLeadForGoal(undefined), false)

assert.equal(techLeadSessionForGoal({ detail, goalId: "g1", activeSessionId: "s-tech" }), true)
assert.equal(techLeadSessionForGoal({ detail, goalId: "g1", activeSessionId: "s-builder" }), false)
assert.equal(techLeadSessionForGoal({ detail, goalId: "g2", activeSessionId: "s-tech" }), false)
assert.equal(shouldShowReturnLead({ detail, selectedGoalId: "g1", activeSessionId: "s-tech" }), true)
assert.equal(shouldShowReturnLead({ detail, selectedGoalId: null, activeSessionId: "s-tech" }), false)
```

同时断言 `goalDiscussionTarget(detail, "g1")?.goalId === "g1"` 和未知 Goal 返回 null。

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/goal-chat-context.test.ts` (workdir `packages/desktop`)
Expected: FAIL because module cannot be resolved.

- [ ] **Step 3: Implement helpers**

Tech Lead member 通过 `detail.members.find(member => member.role === "tech_lead")` 确定；仅接受该成员未结束的 discussion session。不要匹配 runtime 前缀、隐藏 session 标题或全局 kv。

- [ ] **Step 4: Run focused test and verify GREEN**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/goal-chat-context.ts packages/desktop/src/renderer/mafw/goal-chat-context.test.ts
git commit -m "feat(desktop): define goal discussion context rules"
```

---

### Task 3: Apply user summaries to Goal list and priority area

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/WorkOverview.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkPriorityList.tsx`
- Test: `packages/desktop/src/renderer/mafw/goal-workbench-wiring.test.ts` (create in this task, extend later)

**Interfaces:**
- Consumes: `summarizeGoalForUser` from `../goal-user-view`; existing `onOpenGoal`, filter props and `attentionTarget`.
- Produces: Goal rows and attention cards display `summary.statusLabel`, `summary.nextActionLabel`, and actual progress only. Internal Goal ID / default internal phase / verdict / loop remain out of the primary row.

- [ ] **Step 1: Write failing source-contract tests**

Create `goal-workbench-wiring.test.ts` reading both component sources with `readFileSync`. Assert:

```ts
expect(workOverviewSrc).toContain("summarizeGoalForUser")
expect(workOverviewSrc).toContain("summary.statusLabel")
expect(workOverviewSrc).toContain("summary.nextActionLabel")
expect(workOverviewSrc).not.toContain("goalModeLabel")
expect(prioritySrc).toContain("summarizeGoalForUser")
expect(prioritySrc).toContain("summary.nextActionLabel")
```

Also assert the existing focused actions remain: `props.onOpen(item.goal,` and `props.onOpenGoal(goal,`. The test intentionally does not require exact markup.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/goal-workbench-wiring.test.ts` (workdir `packages/desktop`)
Expected: FAIL because summaries are not wired.

- [ ] **Step 3: Implement list and priority projection**

`WorkOverview` 每行创建 `const summary = summarizeGoalForUser(goal)`；主标题仍为 Goal title，meta 使用 `summary.statusLabel`、`summary.nextActionLabel`、`summary.progressText`。保留「未查看」结果 chip 和现有过滤。移除主行的 `goalModeLabel` 与内部 phase chip。

`WorkPriorityList` 每个 item 也用同一 summary；按钮文案优先 `summary.nextActionLabel ?? item.label`，但点击仍走现有 `props.onOpen`。
每个 Row/Card 不使用 runtime/Goal internals。不要新增第二套空态。

- [ ] **Step 4: Run focused test and verify GREEN**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/WorkOverview.tsx packages/desktop/src/renderer/mafw/components/WorkPriorityList.tsx packages/desktop/src/renderer/mafw/goal-workbench-wiring.test.ts
git commit -m "feat(desktop): show goals through user-facing summaries"
```

---

### Task 4: Goal detail user faces and collapsed technical details

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/GoalUserHero.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx`
- Test: `packages/desktop/src/renderer/mafw/goal-workbench-wiring.test.ts` (extend)

**Interfaces:**
- Consumes: `GoalUserSummary`; current `GoalDetailPanel` `currentAction`, timeline, PodResultView, PodDirectionPanel, PodTaskBoard, GoalTimelineLane.
- Produces:
  ```ts
  export function GoalUserHero(props: {
    summary: GoalUserSummary
    actionLabel: string | null
    onAction?: () => void
    technicalOpen: boolean
    onToggleTechnical: () => void
  }): JSX.Element
  ```
- GoalDetailPanel behavior:
  - `goalSummary()` from loaded `podGoal()`; if unavailable, keep current timeline-only fallback without user face.
  - `technicalOpen` signal defaults false.
  - Header meta shows only `summary.statusLabel`, `summary.ownerLabel`, `revision`.
  - Internal `props.goalId`, phase, Loop, verdict, goalMode move inside `.mafw-goal-technical`.
  - Direction face: context source, questions, direction, plan task board; result and timeline hidden unless technical open.
  - Progress face: hero + progress/questions/current action; plan board, direction and result hidden unless technical open. `lastError` remains visible outside technical details when it requires person.
  - Result/history-with-result face: existing `PodResultView` appears immediately after hero/current action and before technical details; direction/plan hidden by default.
  - History without result: concise ended message; technical details can show timeline.
  - Technical details contains internal IDs/chips, timeline, and task board when not already primary.
  - Existing retry, cancel, plan review, probe and source full-text functionality must remain reachable.

- [ ] **Step 1: Add failing wiring assertions**

Extend `goal-workbench-wiring.test.ts`:

```ts
expect(goalDetailSrc).toContain("summarizeGoalForUser")
expect(goalDetailSrc).toContain("GoalUserHero")
expect(goalDetailSrc).toContain("technicalOpen")
expect(goalDetailSrc).toContain("mafw-goal-technical")
expect(goalDetailSrc).toContain("summary.statusLabel")
expect(goalDetailSrc).toContain("<PodResultView")
const headerBody = goalDetailSrc.slice(goalDetailSrc.indexOf("mafw-goal-head"), goalDetailSrc.indexOf("goalSummary()"))
expect(headerBody).not.toContain("props.goalId}</div>")
```

Add source assertions that `PodTaskBoard`, `GoalTimelineLane` remain in the file and result section comes before the technical section in the JSX.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/goal-workbench-wiring.test.ts` (workdir `packages/desktop`)
Expected: FAIL for missing hero, face and technical-details wiring.

- [ ] **Step 3: Implement `GoalUserHero`**

Presentational only. Render status/owner/revision + progress text/percent when present + optional action `ButtonV2` + `ButtonV2` with `aria-expanded` and `onToggleTechnical`. Do not fetch data and do not show internal IDs. Use existing theme token classes; CSS task follows.

- [ ] **Step 4: Reorder GoalDetailPanel and preserve all capabilities**

Use `goalUserFace` through `summarizeGoalForUser`. Keep existing fetch/loading/error effects untouched. Reposition existing sections; do not remove APIs or capability gates. Place internal metadata behind the technical toggle. Keep `props.onClose` only for the explicit Back control in this task; Task 5 removes accidental closes from discussion actions.

- [ ] **Step 5: Run focused test and verify GREEN**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 6: Run existing Goal timeline/contract tests**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/goal-timeline.test.ts src/renderer/mafw/pod-result-view-model.test.ts`
Expected: PASS; if a source-order assertion truly encodes the old ordering, update the assertion to the new user-first ordering while keeping its invariant.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/GoalUserHero.tsx packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx packages/desktop/src/renderer/mafw/goal-workbench-wiring.test.ts
git commit -m "feat(desktop): organize goal detail by user intent"
```

---

### Task 5: Preserve Chat and Goal context across role transitions

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Test: `packages/desktop/src/renderer/mafw/goal-workbench-wiring.test.ts` (extend)
- Test: `packages/desktop/src/renderer/mafw/goal-chat-context.test.ts`

**Interfaces:**
- Consumes: `shouldOpenTechLeadForGoal`, `goalDiscussionTarget`, `shouldShowReturnLead`.
- Produces:
  - `openGoalAndDiscuss(goalId: string, focus: GoalDetailFocus = "timeline"): Promise<void>` in MafwShell: open Goal detail first; resolve current Goal from `podStore.detail()`; if `shouldOpenTechLeadForGoal(goal)`, call existing `openTechLead(goalId)` and keep detail on error.
  - ChatPane new props:
    ```ts
    showReturnLead?: () => boolean
    onReturnLead?: () => void
    ```
  - ChatPane titlebar renders `ButtonV2` “返回项目 Lead” only when `props.showReturnLead?.()` is true.
  - MafwShell passes `showReturnLead={() => shouldShowReturnLead({ detail: podStore.detail(), selectedGoalId: podGoalId(), activeSessionId: activeSessionId() })}` and `onReturnLead={() => void openLeadEntry()}`.
  - GoalDetailPanel removes `props.onClose()` from `techLeadEntry.open`, reject flow and timeline session-open callback.

- [ ] **Step 1: Add failing source and behavior assertions**

Extend helper tests to cover terminal Goal:
```ts
assert.equal(shouldShowReturnLead({ detail, selectedGoalId: "g-ended", activeSessionId: "s-tech-ended" }), false)
```
Extend wiring tests by slicing named function bodies:
- `GoalDetailPanel` `techLeadEntry` body does not contain `props.onClose()`.
- `rejectGoal` body does not contain `props.onClose()`.
- timeline `onOpenSession` callback does not call `props.onClose()`.
- `MafwShell` contains `openGoalAndDiscuss`, uses `shouldOpenTechLeadForGoal`, and Goal open callbacks use `openGoalAndDiscuss`, not bare `openGoalDetail`.
- `ChatPane` contains `props.showReturnLead` and `props.onReturnLead` and text `返回项目 Lead`.
- ChatPane uses `ButtonV2`, not a raw button.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/goal-chat-context.test.ts src/renderer/mafw/goal-workbench-wiring.test.ts` (workdir `packages/desktop`)
Expected: FAIL for missing props/wiring and lingering closes.

- [ ] **Step 3: Implement `openGoalAndDiscuss` and route call sites**

Add the async function near `openGoalDetail`. It must:
1. call existing `openGoalDetail(goalId, focus)` synchronously so right work appears without waiting on runtime;
2. resolve goal from current Pod detail via `goalDiscussionTarget`;
3. only call `openTechLead` for non-ended Goals;
4. catch Tech Lead errors without closing right Goal, showing the existing toast path.

Route `ProjectWorkView.onOpenGoal`, `onGoalCreated`, handoff success and notification navigation through it. Keep `openGoalDetail` available for internal callers that must not change Chat role.

- [ ] **Step 4: Add return-to-Lead control**

Add optional props and titlebar ButtonV2 in ChatPane. `openLeadEntry` remains the existing Lead authority; do not manufacture a new Lead context. Returning Lead must not clear `podGoalId` or close the right Goal.

- [ ] **Step 5: Remove accidental Goal closes from Goal actions**

Remove only the `props.onClose()` calls in Tech Lead discussion, reject and timeline navigation. Keep explicit “返回全部 Goal” Back button and aside close. Rejection should leave the same Goal detail open on the new revision after refresh/request.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/goal-workbench-wiring.test.ts packages/desktop/src/renderer/mafw/goal-chat-context.test.ts
git commit -m "feat(desktop): keep goal context across chat role changes"
```

---

### Task 6: Token-based visual and accessibility contract

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/src/renderer/mafw/goal-workbench-wiring.test.ts` (extend)

**Interfaces:**
- Consumes: existing theme variables and ButtonV2 classes. No new color tokens.
- Produces CSS classes:
  - `.mafw-goal-user-hero`
  - `.mafw-goal-user-status`
  - `.mafw-goal-user-progress`
  - `.mafw-goal-user-next`
  - `.mafw-goal-technical`
  - `.mafw-return-lead`
- Component contract: no raw `<button>`/`<input>` in `GoalUserHero.tsx` or the modified ChatPane titlebar; TooltipV2 if a tooltip is added.

- [ ] **Step 1: Add failing CSS/accessibility tests**

Extend wiring test to read `mafw.css` and assert classes exist, each uses `var(--...)`, and the Goal/Chat JSX files do not contain `<button` or `<input`. Assert `.mafw-goal-technical` defaults hidden only through component mounting, not `display:none` on a mounted tree (the component uses `<Show>`/conditional render).

- [ ] **Step 2: Run focused test and verify RED**

Run: source test command. Expected: FAIL for missing classes/token contract.

- [ ] **Step 3: Implement styles**

Follow current project work/Goal section styles. Use existing surface/border/text/accent tokens. Support:
- status/owner/revision in one line;
- actual progress bar only when `progressPercent != null`;
- primary next action visible above details;
- technical details visually secondary, with accessible `aria-expanded` control;
- return Lead control fitting titlebar at narrow widths without adding a new responsive breakpoint unless required by existing CSS.

- [ ] **Step 4: Run focused test and verify GREEN**

Run: source test command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/goal-workbench-wiring.test.ts
git commit -m "style(desktop): finish goal user-view and return control"
```

---

### Task 7: Full verification, architecture note, and handoff

**Files:**
- Modify: `docs/architecture/desktop.md` (add current-state note for Plan A, not release history)
- Test: no new test file; run all gates.

- [ ] **Step 1: Run focused suite**

Run (workdir `packages/desktop`):
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/goal-user-view.test.ts src/renderer/mafw/goal-chat-context.test.ts src/renderer/mafw/goal-workbench-wiring.test.ts src/renderer/mafw/goal-timeline.test.ts
```
Expected: all focused tests pass, 0 failures; record新增用例数.

- [ ] **Step 2: Run full desktop suite**

Run: `npm test` (workdir `packages/desktop`)
Expected: 0 failures; record total pass count.

- [ ] **Step 3: Type check**

Run: `npx tsgo --noEmit -p tsconfig.json` (workdir `packages/desktop`)
Expected: rc=0, no diagnostics.

- [ ] **Step 4: Build**

Run: `npx electron-vite build` (workdir `packages/desktop`)
Expected: rc=0.

- [ ] **Step 5: Manual GUI smoke**

Use dev app and a real project with one nonterminal Goal and one ended Goal:
1. Open nonterminal Goal from Work list → Goal detail remains open and Chat switches to Tech Lead discussion.
2. Use Goal “与 Tech Lead 讨论” → right detail stays open.
3. Press “返回项目 Lead” → Chat returns to Lead, right Goal remains.
4. Open ended Goal → no live Tech Lead is ensured and no return control appears.
5. Progress Goal with no human action → only progress and technical-details toggle; open technical details → timeline/tasks available.
6. Goal with pending question/plan approval → action visible without opening technical details.
7. Reject result → still on Tech Lead Goal context with next revision/result refresh.

Record screenshots under `.mafw/qa/goal-workbench-*/` (not committed). If a step cannot run, report it explicitly rather than claiming smoke passed.

- [ ] **Step 6: Update architecture doc**

In `docs/architecture/desktop.md`, add a short current-state subsection under the Goal/workbench area explaining:
- Goal user faces direction/progress/result;
- Lead→TechLead transitions no longer close Goal;
- technical details default collapsed;
- content workbench and tracked review items remain future plans.

Do not append release history to AGENTS.md.

- [ ] **Step 7: Commit docs and report**

```bash
git add docs/architecture/desktop.md
git commit -m "docs(desktop): record goal user-view and role continuity"
```

Report commit hashes, new test count, focused pass count, full desktop pass count, type/build rc, and any unverified GUI or gateway combinations.
