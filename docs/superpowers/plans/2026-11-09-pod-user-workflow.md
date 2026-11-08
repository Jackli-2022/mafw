# Pod 用户工作流 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让左侧 Pod 成为 Lead / Tech Lead 的普通会话入口，让右侧「工作」先呈现当前版本的重要事项与真实 worker 进度，并在面板内部原地下钻 Goal 详情。

**Architecture:** Gateway 只在现有 `PodGoalService.views()` 上增加可选的 plan-task 进度投影；桌面新增纯函数处理重要事项、过滤与进度文案。`ProjectWorkView` 继续拥有工作数据，但把「概览」和 `GoalDetailPanel` 作为同一个右侧面板的两种状态；`WorkOverview` 保持挂载以保留滚动与过滤。Lead / Tech Lead 仍通过 `openPodSession` 打开普通 ChatPane，不增加任何聊天通道。

**Tech Stack:** TypeScript, SolidJS, gateway Jest, Node `--test` + `tsx` + `@mafw/test-shim`, Electron desktop, `@mafw/sdk`。

**Spec:** `docs/superpowers/specs/2026-11-09-pod-user-workflow-design.md`

## Target Logic Architecture

```text
MafwShell
  selectedGoalId + goalDetailFocus + rightDock/workbench view
  ├─ LeftDock
  │   └─ ProjectResources
  │       ├─ onOpenLead    -> openLeadEntry() -> podStore.ensureLead() -> openSessionTab()
  │       └─ onOpenTechLead(goalId) -> openTechLead() -> podStore.techLead() -> openSessionTab()
  │              (both reuse the normal ChatPane/composer/SSE/history)
  │
  └─ WorkbenchShell
      └─ view="work"
          └─ ProjectWorkView
              ├─ WorkPriorityList   (current-revision attention + unseen results)
              ├─ WorkOverview       (all Goals; stays mounted while detail is open)
              └─ GoalDetailPanel    (inline; replaces the old root overlay)
                    ├─ existing PodTaskBoard / PodResultView / direction / questions / probes
                    └─ timeline + plan review entry

Gateway
  GET /api/projects/:projectId/work
    -> PodGoalService.views(podId)
       -> store.listTasks(podId) -> summarizePodGoalProgress()
       -> buildPodGoalView(row, description, queueReason, progress)
```

## Global Constraints

- 左侧只主动展示 **Lead / Tech Lead**；Builder / Reviewer 只出现在 Goal 进度、团队资源或 Goal 详情中。
- Lead / Tech Lead 必须打开**普通 Pod session**，复用 ChatPane、composer、消息发送、历史、SSE、权限与排队；不得新增简化聊天或旁路发送 API。
- 重要事项只显示每个 Goal 的**当前 active revision**；旧 revision 未读结果不得进入重要区。
- 无真实任务数据时进度显示阶段文字，绝不显示 `0/0` 或伪造百分比。
- Goal 详情必须渲染在右侧工作面板内；不得出现 `.mafw-goal-overlay`、遮罩或新的根级详情挂载。
- 全部 Goal 永不截断；过滤只影响可见列表，计数与可见数组同源。
- 保留现有计划审阅、回答、方向、任务编辑、结果打回、探针、重试、取消与结果 seen 双读。
- 新 UI 使用 `ButtonV2` / `TextInputV2` 等既有 v2 组件；不新增裸 `<button>` / `<input>` 或主题色。
- 桌面单测手动运行时必须带 `--conditions=browser`。
- 不修改移动端、Pod 生命周期、NodeDriver 或 runtime 名称语义。
- 所有 additive 字段必须兼容旧 gateway：缺失时桌面降级而不是报错。

## Review Focus

1. **旧 revision 的未读结果**：Goal 被打回进入新 revision 后，旧结果卡绝不能冒充当前结果，也不能在打开当前结果时把旧 revision 标记为 seen。由 Task 2 的当前 revision 过滤测试覆盖。
2. **真实进度为空或部分缺字段**：旧 gateway、非计划任务、无 tasks 的 Goal 都必须显示阶段文字，绝不出现 `0/0`、`100%` 或空进度条。由 Task 2 的降级测试覆盖。
3. **通知/深层链接打开详情**：右 dock 关闭、当前不在「工作」或刚创建 Goal 时，Goal 仍必须在右侧 inline 打开，不得回到旧弹窗。由 Task 5 的入口接线测试与 Task 7 GUI 验收覆盖。
4. **返回上下文**：从详情返回后，过滤、滚动位置与键盘焦点必须恢复；SSE 刷新不能把用户踢回列表或切到别的 Goal。由 Task 5 的保持挂载/焦点契约测试与 Task 7 GUI 验收覆盖。
5. **普通会话复用**：Lead / Tech Lead 入口必须落到现有 `openPodSession` / `openTechLead`，消息仍由 ChatPane composer 发送；不得出现单独 textarea 或 `promptAsync` 旁路。由 Task 4 的接线测试覆盖。

---

### Task 1: Gateway plan-task progress projection

**Files:**
- Create: `gateway/src/core/pod/pod-goal-progress.ts`
- Create: `gateway/tests/unit/pod/pod-goal-progress.test.ts`
- Modify: `gateway/src/core/pod/pod-view.ts:76-108` (`PodGoalView`)
- Modify: `gateway/src/core/pod/pod-view.ts:152-210` (`buildPodGoalView`)
- Modify: `gateway/src/core/pod/pod-goal-service.ts:396-405` (`views`)
- Modify: `gateway/tests/unit/pod/pod-view.test.ts`
- Modify: `gateway/tests/unit/routes/pod-work.test.ts` fixture
- Modify: any `PodGoalView` fixtures surfaced by `rg "PodGoalView" gateway/tests` with `progress: null`
- Modify: `packages/gateway-sdk/src/types.ts:1175-1197`

**Interfaces:**
- Consumes: `PodStore.listTasks(podId, goalId?)` rows with `kind` and `status`.
- Produces:
  - `PodGoalProgress { total: number; done: number; inProgress: number; review: number; failed: number; skipped: number }`
  - `summarizePodGoalProgress(tasks: readonly { kind: string; status: string }[]): PodGoalProgress | null`
  - Gateway `PodGoalView.progress?: PodGoalProgress | null` (the view always emits it, optional only keeps older fixtures/consumers source-compatible)
  - SDK `PodGoal.progress?: PodGoalProgress | null`

- [ ] **Step 1: Write the failing pure-progress tests**

Create `gateway/tests/unit/pod/pod-goal-progress.test.ts` with these cases:

```ts
import { summarizePodGoalProgress } from '../../../src/core/pod/pod-goal-progress';

describe('summarizePodGoalProgress', () => {
  test('counts plan tasks only and leaves pending implicit', () => {
    expect(summarizePodGoalProgress([
      { kind: 'plan', status: 'done' },
      { kind: 'plan', status: 'done' },
      { kind: 'plan', status: 'in_progress' },
      { kind: 'plan', status: 'blocked' },
      { kind: 'plan', status: 'review' },
      { kind: 'plan', status: 'failed' },
      { kind: 'plan', status: 'skipped' },
      { kind: 'plan', status: 'pending' },
      { kind: 'note', status: 'done' },
    ])).toEqual({ total: 8, done: 2, inProgress: 2, review: 1, failed: 1, skipped: 1 });
  });

  test('returns null when there are no plan tasks', () => {
    expect(summarizePodGoalProgress([])).toBeNull();
    expect(summarizePodGoalProgress([{ kind: 'note', status: 'done' }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/pod/pod-goal-progress.test.ts --runInBand`
Expected: FAIL because `pod-goal-progress` does not exist.

- [ ] **Step 3: Implement the pure projection**

Create `gateway/src/core/pod/pod-goal-progress.ts` with the `PodGoalProgress` interface and `summarizePodGoalProgress` signature above. Treat `in_progress` and `blocked` as `inProgress`; `done`, `review`, `failed`, `skipped` map one-to-one; all other plan statuses contribute only to `total`.

- [ ] **Step 4: Run the pure test to verify it passes**

Run: `npx jest tests/unit/pod/pod-goal-progress.test.ts --runInBand`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the failing view/service tests**

Add to `pod-view.test.ts`:

```ts
test('carries real progress and explicit null without inventing counts', () => {
  const progress = { total: 5, done: 3, inProgress: 1, review: 0, failed: 1, skipped: 0 };
  expect(buildPodGoalView(row, desc, undefined, progress).progress).toEqual(progress);
  expect(buildPodGoalView(row, desc, undefined, null).progress).toBeNull();
});
```

Add a `views()` wiring test in `pod-goal-service.test.ts` using the existing service fixture: provide two plan tasks for one goal plus one note, and assert `service.views('pod_1')[0].progress` is `{ total: 2, done: 1, inProgress: 1, review: 0, failed: 0, skipped: 0 }`.

Update `gateway/tests/unit/routes/pod-work.test.ts` `goal()` fixture with `progress: null`.

- [ ] **Step 6: Run the new view/service tests to verify they fail**

Run: `npx jest tests/unit/pod/pod-goal-progress.test.ts tests/unit/pod/pod-view.test.ts tests/unit/pod/pod-goal-service.test.ts tests/unit/routes/pod-work.test.ts --runInBand`
Expected: FAIL because `buildPodGoalView` accepts no progress and `views()` does not pass tasks.

- [ ] **Step 7: Implement the view and service wiring**

- Add `progress: PodGoalProgress | null` to gateway `PodGoalView`.
- Add an optional fourth parameter to `buildPodGoalView(..., progress: PodGoalProgress | null = null)` and copy it verbatim.
- In `PodGoalService.views(podId)`, load `this.deps.store.listTasks(podId)` once, group plan tasks by `goalId`, and pass `summarizePodGoalProgress(tasksForGoal)` into each view.
- Add `PodGoalProgress` and optional `progress` to SDK `PodGoal`; gateway and SDK shapes must match.

- [ ] **Step 8: Run the focused tests to verify they pass**

Run: `npx jest tests/unit/pod/pod-goal-progress.test.ts tests/unit/pod/pod-view.test.ts tests/unit/pod/pod-goal-service.test.ts tests/unit/routes/pod-work.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: rc=0.

```bash
git add gateway/src/core/pod/pod-goal-progress.ts gateway/src/core/pod/pod-view.ts gateway/src/core/pod/pod-goal-service.ts gateway/tests/unit/pod/pod-goal-progress.test.ts gateway/tests/unit/pod/pod-view.test.ts gateway/tests/unit/pod/pod-goal-service.test.ts gateway/tests/unit/routes/pod-work.test.ts packages/gateway-sdk/src/types.ts
git commit -m "feat(pod): project real goal task progress"
```

---

### Task 2: Desktop work priority and filter model

**Files:**
- Create: `packages/desktop/src/renderer/mafw/work-overview-model.ts`
- Create: `packages/desktop/src/renderer/mafw/work-overview-model.test.ts`

**Interfaces:**
- Consumes: `PodGoal`, `PodGoalStageActionType` from `@mafw/sdk`; `PodEventItem` from `./pod-events`.
- Produces:

```ts
export type WorkFilter = "all" | "active" | "results" | "history"

export const WORK_FILTERS: readonly { id: WorkFilter; label: string }[]
export function workFilterOf(goal: PodGoal): Exclude<WorkFilter, "all">
export function filterWorkGoals(goals: readonly PodGoal[], filter: WorkFilter): PodGoal[]
export function workFilterCounts(goals: readonly PodGoal[]): Record<WorkFilter, number>

export type WorkPriorityItem =
  | { kind: "attention"; key: string; goal: PodGoal; actionType: PodGoalStageActionType | null; label: string }
  | { kind: "result"; key: string; goal: PodGoal; createdAt: string | null }

export function buildWorkPriority(input: {
  goals: readonly PodGoal[]
  events: readonly PodEventItem[]
  isResultViewed: (goal: PodGoal) => boolean
}): WorkPriorityItem[]

export function goalProgressText(goal: PodGoal): string | null
export function goalProgressPercent(goal: PodGoal): number | null
```

- [ ] **Step 1: Write the failing model tests**

Create `work-overview-model.test.ts` using small Goal fixtures with `bucket`, `activeRevision`, `revision`, `stage`, `currentAssignment`, and `progress`. Include:

```ts
test("important items use only the current revision", () => {
  const goal = fixture({ goalId: "g1", bucket: "result_ready", activeRevision: 2, revision: 2 })
  const events = [
    event({ goalId: "g1", revision: 1, kind: "goal.result", severity: "p1", state: "unread" }),
    event({ goalId: "g1", revision: 2, kind: "goal.result", severity: "p1", state: "unread", createdAt: "2026-11-09T01:00:00.000Z" }),
  ]
  const items = buildWorkPriority({ goals: [goal], events, isResultViewed: () => false })
  expect(items).toEqual([{ kind: "result", key: "g1:r2:result", goal, createdAt: "2026-11-09T01:00:00.000Z" }])
})

test("attention wins over an unseen result for the same goal", () => {
  const goal = fixture({ goalId: "g1", bucket: "needs_you", stage: { owner: "person", kind: "plan_approval", action: { type: "open_plan_review", goalId: "g1" } } })
  expect(buildWorkPriority({ goals: [goal], events: [], isResultViewed: () => false }))
    .toMatchObject([{ kind: "attention", label: "审阅计划" }])
})

test("filters and counts share one projection", () => {
  const goals = [
    fixture({ goalId: "a", bucket: "needs_you" }),
    fixture({ goalId: "q", bucket: "queued" }),
    fixture({ goalId: "w", bucket: "in_progress" }),
    fixture({ goalId: "r", bucket: "result_ready" }),
    fixture({ goalId: "e", bucket: "ended" }),
  ]
  expect(filterWorkGoals(goals, "active").map((g) => g.goalId)).toEqual(["a", "q", "w"])
  expect(workFilterCounts(goals)).toEqual({ all: 5, active: 3, results: 1, history: 1 })
})

test("progress text and percent never fabricate data", () => {
  expect(goalProgressText(fixture({ progress: null }))).toBeNull()
  expect(goalProgressPercent(fixture({ progress: null }))).toBeNull()
  const goal = fixture({
    currentAssignment: { assignmentId: "a1", role: "builder", taskIds: [], attempt: 1 },
    progress: { total: 4, done: 2, inProgress: 1, review: 0, failed: 0, skipped: 0 },
  })
  expect(goalProgressText(goal)).toBe("Builder 2/4")
  expect(goalProgressPercent(goal)).toBe(50)
})
```

Also assert unseen result ordering is newest first, and a viewed current result is absent.

- [ ] **Step 2: Run the model tests to verify they fail**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/work-overview-model.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the pure model**

- Map `result_ready` to `results`, `ended` to `history`, everything else to `active`.
- Build attention items only from goals whose `stage.owner === "person"` or `bucket === "needs_you"`.
- Label action types: `open_plan_review` → `审阅计划`, `open_question` → `回答问题`, `open_direction_review` → `裁定方向`, `open_goal` / fallback → `打开工作`.
- Build result items only for `bucket === "result_ready"`, current revision (`goal.revision ?? goal.activeRevision ?? 1`), and `!isResultViewed(goal)`.
- Dedupe by `(goalId, currentRevision)`, attention before result.
- Keep attention in input order; sort results by matching current-revision `goal.result` event `createdAt` descending, ties by `goalId`.
- `goalProgressText` returns `null` unless `progress.total > 0`; use role label `Builder` / `Reviewer` from `currentAssignment` when present, otherwise `任务`.
- `goalProgressPercent` returns `null` without data, otherwise rounded `done / total * 100`.

- [ ] **Step 4: Run the model tests to verify they pass**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/work-overview-model.test.ts`
Expected: PASS, all model tests.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/work-overview-model.ts packages/desktop/src/renderer/mafw/work-overview-model.test.ts
git commit -m "feat(desktop): model pod work priority and filters"
```

---

### Task 3: Right-work priority area and full Goal list

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/WorkPriorityList.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkOverview.tsx`
- Modify: `packages/desktop/tests/project-work-view.test.ts`
- Create: `packages/desktop/tests/work-overview-ui.test.ts`

**Interfaces:**
- Consumes: Task 2 `buildWorkPriority`, `filterWorkGoals`, `workFilterCounts`, `WORK_FILTERS`, `goalProgressText`; Task 1 `PodGoal.progress`.
- Produces:
  - `WorkPriorityList` props `{ items: WorkPriorityItem[]; onOpen: (goal: PodGoal, focus: GoalDetailFocus) => void }`.
  - `WorkOverview` props gain `{ filter: WorkFilter; onFilter: (filter: WorkFilter) => void }`; `onOpenAll` removed.

- [ ] **Step 1: Write the failing UI contract tests**

Update `project-work-view.test.ts` to assert:
- `ProjectWorkView` imports `WorkPriorityList`, `buildWorkPriority`, `WORK_FILTERS`, `workFilterCounts`, `filterWorkGoals`, `goalProgressText`.
- It creates one `overviewGoals` projection and uses it for both count and priority.
- It keeps `active` polling and composer request behavior unchanged.

Create `work-overview-ui.test.ts` reading component sources and asserting:
- `WorkPriorityList` renders `现在需要关注` only when `items.length > 0` and each card has one action label.
- `WorkOverview` renders `全部 Goal`, maps all four filters, and uses `data-goal-id={goal.goalId}`.
- `WorkOverview` no longer contains `工作概览`, `全部历史`, `goalChips`, `rev ${`, or `onOpenAll`.
- The row renders `podStageLabel(goal.stage)`, `goalProgressText(goal)`, and only shows `未查看` for `result_ready`.

- [ ] **Step 2: Run the UI tests to verify they fail**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/project-work-view.test.ts tests/work-overview-ui.test.ts`
Expected: FAIL on the new imports/copy assertions.

- [ ] **Step 3: Implement the priority list**

`WorkPriorityList.tsx` renders an ordered list of existing `ButtonV2` cards:

- attention card: amber surface, attention label, Goal title, stage label, direct action button text = item label;
- result card: mint surface, `新结果`, Goal title, `结果尚未查看`, action `查看结果`;
- clicking calls `onOpen(item.goal, attentionTarget(item.actionType ? { type: item.actionType } : undefined))`;
- no empty wrapper when `items.length === 0`.

- [ ] **Step 4: Refactor ProjectWorkView and WorkOverview**

- `ProjectWorkView` adds `const [filter, setFilter]`.
- Flatten all Goal buckets in canonical order once with a memo.
- Build priority with `podEvents.items()` and the same `isViewed` function currently passed to `WorkOverview`; do not mark events seen here.
- Render `WorkPriorityList`, then `WorkOverview` with filter props.
- `ProjectWorkView` head becomes a single `工作` title + real hint + `新建 Goal`; remove `项目工作` / `工作概览` duplicate titles.
- `WorkOverview` renders `全部 Goal` + count and `WORK_FILTERS` buttons; list = `filterWorkGoals(goals, filter)`.
- Remove `goalChips`; row shows stage, progress text, optional unviewed chip, and result row keeps the existing viewed logic.
- Keep composer, polling, retry, error states, and `onOpenGoal` behavior.

- [ ] **Step 5: Run the focused tests to verify they pass**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/project-work-view.test.ts tests/work-overview-ui.test.ts src/renderer/mafw/work-overview-model.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/WorkPriorityList.tsx packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx packages/desktop/src/renderer/mafw/components/WorkOverview.tsx packages/desktop/tests/project-work-view.test.ts packages/desktop/tests/work-overview-ui.test.ts
git commit -m "feat(desktop): prioritize pod work before the full goal list"
```

---

### Task 4: Left Pod becomes two ordinary-session launchers

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pod-contact-model.ts`
- Create: `packages/desktop/src/renderer/mafw/pod-contact-model.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectResources.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/LeftDock.tsx:64-80,391-409`
- Modify: `packages/desktop/src/renderer/mafw/components/IconRail.tsx:60-66`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:2710-2730`
- Modify: `packages/desktop/tests/project-resources-work.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/sessionstrip-brand.test.ts` or the existing IconRail label/glyph contract test if it pins 「资源」

**Interfaces:**
- Consumes: `PodDetail`, `memberFocus()`.
- Produces:

```ts
export interface PodContactRow {
  role: "lead" | "tech_lead"
  memberId: string
  displayName: string
  description: string
  focusText: string | null
  goalId: string | null
  canOpen: boolean
}

export function buildPodContacts(detail: PodDetail | null): PodContactRow[]
```

- `ProjectResources` / `LeftDock` new callbacks: `onOpenLead: () => void`, `onOpenTechLead: (goalId: string) => void`.

- [ ] **Step 1: Write the failing contact model tests**

Create `pod-contact-model.test.ts`:

```ts
test("returns only Lead and Tech Lead in fixed order", () => {
  const rows = buildPodContacts(detailWithFourMembers())
  expect(rows.map((row) => row.role)).toEqual(["lead", "tech_lead"])
})

test("lead is always openable and tech lead carries the current goal", () => {
  const [lead, tech] = buildPodContacts(detailWithFourMembers())
  expect(lead.canOpen).toBe(true)
  expect(tech.goalId).toBe("goal-active")
  expect(tech.focusText).toContain("修复语音回声")
})

test("no active goal leaves tech lead visible but not openable", () => {
  const [, tech] = buildPodContacts(detailWithoutActiveGoal())
  expect(tech.canOpen).toBe(false)
  expect(tech.focusText).toBeNull()
})
```

- [ ] **Step 2: Run the contact tests to verify they fail**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-contact-model.test.ts`
Expected: FAIL because the model does not exist.

- [ ] **Step 3: Implement contacts using existing memberFocus**

- Find Lead / Tech Lead members from `detail.members`.
- Lead uses `memberFocus()` target; it is openable even with an empty session id because the shell ensures the coordination session.
- Tech Lead uses `memberFocus(detail, id)`; openable only when `target.kind === "techlead"` or a live session target exists.
- For `techlead`, expose `goalId` from `target.goalId`; never expose a runtime session id in copy.

- [ ] **Step 4: Run the contact tests to verify they pass**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-contact-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing left-Pod wiring tests**

Rewrite `project-resources-work.test.ts` to assert:
- ProjectResources imports and renders `buildPodContacts`.
- First screen contains `Lead`, `Tech Lead`, `新建 Goal`, and only renders `需要你` when count > 0.
- No `最近消息`, `buildRecentMessages`, default `Builder` / `Reviewer` roster, or `memberFocus` loop.
- `onOpenLead` is called by Lead and `onOpenTechLead(goalId)` by Tech Lead.
- The resources toggle reveals `团队`, `邮箱`, `Pod 记忆`, `便签`.
- LeftDock wires `onOpenLead` / `onOpenTechLead`; MafwShell maps them to `openLeadEntry()` and `openTechLead(goalId)`.
- ProjectResources contains no `promptAsync`, `textarea`, or direct send API.
- IconRail labels the destination `Pod` / `收起 Pod` (not `资源`), keeps the existing badge wiring.
- ProjectResources title is `Pod`, subtitle explains Lead / Tech Lead discussion, and the resource section no longer calls itself the primary screen.

- [ ] **Step 6: Run the wiring tests to verify they fail**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/project-resources-work.test.ts`
Expected: FAIL on new props/removed sections.

- [ ] **Step 7: Implement the left Pod**

- Replace `ProjectResources` body with two contact cards from `buildPodContacts`.
- Lead card calls `props.onOpenLead()`.
- Tech Lead card calls `props.onOpenTechLead(row.goalId)`; disabled with `待命` when no target.
- Keep attention row -> `onOpenWork`, New Goal -> `onCreate`, empty/loading/error/worktree states.
- Add a local `moreOpen` signal + `ButtonV2` toggle for `团队、邮箱与共享记忆`; reuse existing resource rows there. Do not render recent messages or roster.
- Remove unused `podMessages`, `podSelfMemberId`, and `podSessionTitleOf` from ProjectResources/LeftDock/MafwShell wiring.
- Shell callbacks:
  - `onPodOpenLead={() => { void openLeadEntry() }}`
  - `onPodOpenTechLead={(goalId) => { void openTechLead(goalId) }}`
- Both ultimately use `openSessionTab` through existing `openLeadEntry` / `openTechLead`; do not add a new chat renderer or send path.

- [ ] **Step 8: Run the focused tests to verify they pass**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-contact-model.test.ts tests/project-resources-work.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pod-contact-model.ts packages/desktop/src/renderer/mafw/pod-contact-model.test.ts packages/desktop/src/renderer/mafw/components/ProjectResources.tsx packages/desktop/src/renderer/mafw/components/LeftDock.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/project-resources-work.test.ts
git commit -m "feat(desktop): make pod a lead and tech-lead launcher"
```

---

### Task 5: Inline Goal detail in the right work panel

**Files:**
- Rename: `packages/desktop/src/renderer/mafw/components/GoalDetailOverlay.tsx` -> `GoalDetailPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:211-218,2964-2972,3044-3058`
- Modify: `packages/desktop/tests/goal-detail-unified.test.ts`
- Create: `packages/desktop/tests/goal-detail-inline.test.ts`
- Modify: `packages/desktop/tests/project-work-view.test.ts`

**Interfaces:**
- Consumes: existing Goal APIs and collaboration operations unchanged.
- Produces:
  - `export function GoalDetailPanel(props: { goalId: string; projectDir?: string|null; podId?: string|null; focus?: GoalDetailFocus|null; onClose: () => void; onOpenSession: (sid: string) => void })`.
  - `ProjectWorkView` new props `{ selectedGoalId?: string|null; detailFocus?: GoalDetailFocus|null; podId?: string|null; onCloseGoal: () => void; onOpenSession: (sid:string) => void }`.

- [ ] **Step 1: Write the failing inline-detail tests**

Create `goal-detail-inline.test.ts` asserting:
- `GoalDetailOverlay.tsx` no longer exists.
- `GoalDetailPanel` root has `.mafw-goal-inline`, a `返回全部 Goal` button, and no `.mafw-goal-overlay` / outside-click close.
- `ProjectWorkView` imports `GoalDetailPanel`, renders it under `.mafw-project-work`, and keeps `WorkOverview` mounted with a hidden wrapper while selected.
- `MafwShell` no longer imports/renders `GoalDetailOverlay`; `openGoalDetail()` calls `openProjectWork()` before setting selection.
- `ProjectWorkView` receives `selectedGoalId={podGoalId()}`, `detailFocus={goalDetailFocus()}`, `onCloseGoal={() => setPodGoalId(null)}`, and an ordinary `openPodSession` callback.
- The result notification/deep-link path still funnels through `openGoalDetail(goalId, "result")`.
- Switching projects clears the selected Goal before the new project's overview renders.

Update `goal-detail-unified.test.ts` paths/copy from `GoalDetailOverlay` to `GoalDetailPanel`; keep all existing behavior assertions (result, questions, plan editing, tech lead entry).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/goal-detail-inline.test.ts tests/goal-detail-unified.test.ts tests/project-work-view.test.ts`
Expected: FAIL because the old overlay is still mounted at shell root.

- [ ] **Step 3: Convert the component to an inline panel**

- `git mv` the file to `GoalDetailPanel.tsx`.
- Rename export to `GoalDetailPanel`.
- Replace the `<div class="mafw-goal-overlay" onClick=...><div class="mafw-goal-panel">` wrapper with one `<section class="mafw-goal-panel mafw-goal-inline" role="region" aria-label={...}>`.
- Replace the close icon header control with a visible `ButtonV2` text `返回全部 Goal`; keep internal plan overlay state.
- Keep all existing loads/effects/refs/actions unchanged.
- On `goalId` change, reset local panel state as before via keyed mounting at the parent.
- After mount/focus target resolution, `queueMicrotask` focus the inline panel heading; do not add a focus trap.

- [ ] **Step 4: Render detail inside ProjectWorkView**

- Wrap the existing overview content in `<div hidden={!!props.selectedGoalId} class="mafw-project-work-overview">` so scroll/filter state survives.
- Render `<Show when={props.selectedGoalId} keyed>` -> `GoalDetailPanel` with props.
- When selection changes to non-null, focus the panel after mount; when it becomes null, focus `[data-goal-id="<lastGoalId>"]`.
- Keep `WorkPriorityList` and overview polling mounted while detail is open.
- Do not render the Goal composer while detail is open, but preserve its open state for return.

- [ ] **Step 5: Rewire shell selection**

- `openGoalDetail(goalId, focus)`:
  1. `openProjectWork()`
  2. `setGoalDetailFocus(focus)`
  3. `setPodGoalId(goalId)`
- Remove the root `Show when={podGoalId()}` + `GoalDetailOverlay` block.
- Pass existing podId resolution, `currentProject()`, `selectedGoalId`, focus, close callback, and `onOpenSession={(sid) => { void openPodSession(sid) }}` into `ProjectWorkView`.
- In `handleSelectProject`, clear `podGoalId` before loading the target project; add a source contract assertion for this ordering.
- Ensure creation success, result navigation, attention, notifications and deep links all keep using `openGoalDetail` rather than opening sessions directly.

- [ ] **Step 6: Run focused tests to verify they pass**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/goal-detail-inline.test.ts tests/goal-detail-unified.test.ts tests/project-work-view.test.ts tests/work-overview-ui.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx packages/desktop/src/renderer/mafw/components/GoalDetailOverlay.tsx packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/goal-detail-inline.test.ts packages/desktop/tests/goal-detail-unified.test.ts packages/desktop/tests/project-work-view.test.ts
git commit -m "feat(desktop): open goal detail inside the work panel"
```

---

### Task 6: Visual and responsive contract for the new Pod / Work surfaces

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Create: `packages/desktop/tests/pod-user-workflow-css.test.ts`
- Modify: `packages/desktop/tests/pod-rail-face-css.test.ts` if selectors moved
- Modify: `packages/desktop/tests/design-contract.test.ts` if work-face copy/classes are pinned there

**Interfaces:**
- Consumes: classes from Tasks 3-5.
- Produces: no new design tokens; reuse existing surface, border, text, accent and spacing tokens.

- [ ] **Step 1: Write the failing CSS contract tests**

Create `pod-user-workflow-css.test.ts` asserting:
- `.mafw-project-work-overview[hidden]` declares `display: none`.
- `.mafw-goal-inline` overrides old panel width/max-height/padding/border and is not `position: fixed`.
- no Goal-detail selector uses `.mafw-goal-overlay`; the remaining overlay styles are allowed only because `PlanReviewOverlay` still uses them in this batch (assert by source usage, not by global deletion).
- priority cards, contact cards, filter buttons and Goal rows have focus-visible styles.
- inline detail is a single scroll surface and does not create a second page-level scroll.
- at the workbench narrow widths, the panel uses available width and does not overlap the composer/chat columns.
- transitions only use existing duration/easing tokens; reduced-motion removes nonessential transitions.

- [ ] **Step 2: Run the CSS test to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-user-workflow-css.test.ts`
Expected: FAIL on missing selectors.

- [ ] **Step 3: Implement the styles**

- Keep the shared `.mafw-goal-overlay` rules because `PlanReviewOverlay` still uses them in this batch; add a comment marking the remaining consumer. Do not attach Goal detail to them.
- Add `.mafw-goal-inline` overrides so the panel uses full right-panel width, `max-height: none`, `overflow: visible`, no border/background of its own beyond the parent panel.
- Add compact contact cards for Lead / Tech Lead, with Lead carrying the single accent/left rail; disabled Tech Lead stays legible, not grey mush.
- Add priority card variants (attention amber / result mint), all-Goal header/filter row, and Goal rows with stage + progress + unviewed.
- Add focus-visible for contacts, priority actions, filter buttons, and Goal rows.
- Keep text sizes consistent with current workbench density; no new font family or colors.
- At narrow widths the right work panel remains usable and the chat composer must stay visible.

- [ ] **Step 4: Run the CSS and existing design-contract tests**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/pod-user-workflow-css.test.ts tests/pod-rail-face-css.test.ts tests/workbench-shell-css.test.ts tests/design-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/pod-user-workflow-css.test.ts packages/desktop/tests/pod-rail-face-css.test.ts packages/desktop/tests/design-contract.test.ts
git commit -m "style(desktop): polish pod contacts and inline work detail"
```

---

### Task 7: Full gates and real GUI acceptance

**Files:**
- No product files expected; fix only regressions surfaced here.

- [ ] **Step 1: Run gateway typecheck and full suite**

Run in `gateway`:
- `npx tsc --noEmit -p tsconfig.json`
- `npm test -- --runInBand --forceExit`

Expected: typecheck rc=0; all suites/tests pass. Record actual counts.

- [ ] **Step 2: Run desktop, SDK, TUI, and root build gates**

Run in `packages/desktop`:
- `npm test`
- `npx tsgo --noEmit -p tsconfig.json`
- `npx electron-vite build`

Run in `packages/gateway-sdk`: `npm test`
Run in `packages/tui`: `npm test`
Run at repo root: `npm run build`

Expected: all rc=0 except the known TUI skip.

- [ ] **Step 3: Restart the dev app and verify the two ordinary sessions**

Restart the desktop dev app so TSX changes load. Then:

1. Click left Pod: first screen shows Lead and Tech Lead, not a four-person roster or recent internal messages.
2. Click Lead: opens the normal Lead session tab and ChatPane.
3. Type and send one short message through the normal composer; verify it appears and the turn runs.
4. Click Tech Lead: opens the normal Goal-scoped Tech Lead session tab; send one short message through the same composer.
5. Verify there is no custom chat surface and no direct send bypass.

- [ ] **Step 4: Verify right-work overview and filters**

1. Open right work: important area appears first; with no important items it is absent.
2. Confirm all Goals are present and filter buttons change the visible list; counts match.
3. Confirm `result_ready` rows show `未查看` only while unviewed.
4. Confirm rows with task data show real `Builder 3/5` style progress; rows without data show only stage text.
5. Confirm old revision unseen events never create a priority card.

- [ ] **Step 5: Verify inline detail and navigation**

1. Click a Goal row: detail replaces the list **inside** the right panel; no backdrop or modal.
2. Left Pod and current chat remain visible and interactive.
3. Check result focus from a result notification/deep link still opens the same inline detail and marks seen only after the result loads.
4. Click `返回全部 Goal`: prior filter, scroll position and focus return.
5. While detail is open, allow a `pod.updated`/timer refresh to occur; the user stays on the same Goal.
6. Check plan review, question answer, direction, result reject and task edit paths still work.

- [ ] **Step 6: Check widths and Focus**

At 1088 / 1366 / 1600 and workbench Focus mode:
- no horizontal overflow in left Pod, right work, or inline detail;
- composer/send button remain reachable;
- focus-visible works on contacts, filters, Goal rows, back button;
- reduced-motion preference removes nonessential transitions.

- [ ] **Step 7: Final diff and commit fixes**

Run: `git status --short` and `git diff --check`
Expected: only intended files; no generated junk or unrelated parallel work.

If gates required fixes, commit them with focused messages. Report:
- new tests count;
- full suite counts for gateway/desktop/SDK/TUI;
- typecheck/build results;
- GUI paths exercised and any honest limitations.
