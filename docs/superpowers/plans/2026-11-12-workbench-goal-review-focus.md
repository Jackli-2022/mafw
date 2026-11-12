# Workbench Goal / Review Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Stage-first workbench from the file read path to the Goal and review path: Goal scope, Goal overview subject, change-set stage, review queue, instrument rail, and review-item focus.

**Architecture:** Reuse existing `GoalDetailPanel`, `ChangesDock`, `PodReviewItems`, and review models. `GoalDetailPanel` becomes the Goal overview stage; `ChangesDock` becomes the change-set stage; `PodReviewItems` mounts in a new instrument rail. The focus model from Plan 1 stays unchanged except for small helpers and an optional line anchor. Chat decision board, agent contract, execution-as-frame, and full decision records remain Plan 3.

**Tech Stack:** Electron 42, SolidJS, TypeScript, `@mafw/ui` v2, `node:test` + `@mafw/test-shim`, electron-vite.

**Spec:** `docs/superpowers/specs/2026-11-12-workbench-stage-first-design.md`
**Predecessor:** `docs/superpowers/plans/2026-11-12-workbench-stage-first-foundation.md`

## Global Constraints

- 一个仓库 = 一个世界；Goal 不跨世界。
- 人类专属验收、评审项状态权威、revision 隔离、PASS 不自动合并，不得退化。
- 评审项状态真相在 Goal；Chat / 工作台只是投影。Agent 不能自行 resolve。
- 桌面 UI 只用 `@mafw/ui` v2 组件；禁止新增裸 `<button>` / `<input>` / 裸 `title`。
- Tooltip `openDelay={300}`；颜色只用主题 token。
- 单文件测试必须带 `--conditions=browser`。
- 所有新持久化 fail-open；本 plan 不新增持久化，复用 `focus-persistence`。
- `project` / `goal` / `review` legacy panes 在迁移完成前不得删除；Goal 验收仍走现有 `acceptResult` 门禁。
- 本地 `main`，未 push。

## Review Focus

- **Goal 打开后框与台一致。** Frame 显示 Goal 标题 / revision；Goal overview 是 `GoalDetailPanel`，不是旧 context 的隐藏 pane。
- **评审项可追踪。** 队列来自 `pod.reviewItems`，resolve / reopen 只由人触发；刷新后状态不丢。
- **变更集不撒谎。** 没有 diff 时明确显示空态，不把别的 session 的 diff 冒充当前 revision。
- **返回路径。** 从 review item → change set → Goal overview → 项目，逐层恢复。
- **Legacy 不退化。** 旧 Goal 详情、review context、验收按钮在非 focus 路径仍可用。
- **窄窗。** Instrument rail 在窄容器下折叠或堆叠，不盖住框。

---

### Task 1: Goal / review focus helpers

**Files:**
- Create: `packages/desktop/src/renderer/mafw/focus/goal-focus.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/goal-focus.test.ts`

**Interfaces:**
- Consumes: `WorkbenchState`, `openSubject`, `Scope`, `Lens`.
- Produces:

```ts
export type GoalFocusInput = {
  projectDir: string
  goalId: string
  revision: number
  worktreeDir: string
  title?: string | null
}

export function goalFocusScope(input: GoalFocusInput): Scope
export function openGoalFocus(state: WorkbenchState, input: GoalFocusInput, lens?: Lens): WorkbenchState
export function openChangeSetFocus(state: WorkbenchState, input: GoalFocusInput, lens?: Lens): WorkbenchState
export function openReviewItemFocus(
  state: WorkbenchState,
  input: GoalFocusInput & { itemId: string; rel: string; line?: number },
  lens?: Lens,
): WorkbenchState
```

Behavior:
- Goal subject defaults to `orient`; change set defaults to `changes`; review item defaults to `decide`.
- All three use a goal scope with `worldId = projectDir`, `goalId`, `revision`, `worktreeDir`.
- Review item subject carries `anchor: { rel, line }`; `subjectKey` remains the item id.
- Same subject reopened replaces lens/place, does not push a duplicate.

- [ ] **Step 1: Write the failing test**

Tests:
- `goal focus uses a goal scope and orient lens`
- `change set focus uses changes lens`
- `review item focus carries the anchor and decide lens`
- `same review item focus replaces instead of pushing`

- [ ] **Step 2: Run it to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/goal-focus.test.ts
```

- [ ] **Step 3: Implement `goal-focus.ts`**

Pure functions only; use `openSubject` from `./focus-model`.

- [ ] **Step 4: Run it to verify it passes**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/focus/goal-focus.ts packages/desktop/src/renderer/mafw/focus/goal-focus.test.ts
git commit -m "feat(desktop): add goal focus helpers"
```

---

### Task 2: Goal focus integration and picker goals

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/focus/picker-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx` picker items
- Test: `packages/desktop/tests/goal-focus-wiring.test.ts`
- Test: `packages/desktop/src/renderer/mafw/focus/picker-model.test.ts`

**Interfaces:**
- Consumes: `openGoalFocus`, `goalFocusScope`; `PodGoal` from `podStore.detail()?.goals`.
- Produces:

```ts
export function buildGoalPickerItems(
  goals: readonly Pick<PodGoal, "goalId" | "title" | "activeRevision" | "revision">[],
  projectDir: string,
  worktreeDir: string,
): PickerItem[]
```

Behavior:
- `openGoalFocus(goalId, focus?)` in `MafwShell`:
  - Find the goal in `podStore.detail()?.goals`.
  - Resolve revision with `goalRevisionOf(goal) ?? 1`.
  - Resolve worktree from the goal result if available; fallback `projectDir`.
  - Set `podGoalId`, `goalDetailFocus`, and push the focus stack.
  - Do not call `applyWorkbenchContext("goal")` (it would clear focus).
- Project home `onOpenGoal` / `onGoalCreated` open the Goal focus; Chat handoff still uses `openGoalAndDiscuss`.
- Picker goal items use `subject: { kind: "goal", goalId }`, `scope` goal, `lens: "orient"`.
- `pickSubject` for a goal item calls `openGoalFocus`.

- [ ] **Step 1: Write the failing tests**

`goal-focus-wiring.test.ts` asserts:
- imports `openGoalFocus` / `goal-focus`
- MafwShell has `const openGoalFocus =`
- `setPodGoalId` and `setFocusState` in `openGoalFocus`
- does not call `applyWorkbenchContext("goal")` inside `openGoalFocus`
- project home `onOpenGoal` uses `openGoalFocus`
- `picker-model` test: goal items carry goal scope, goal subject, orient lens

- [ ] **Step 2: Run it to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/goal-focus-wiring.test.ts src/renderer/mafw/focus/picker-model.test.ts
```

- [ ] **Step 3: Implement**

Add `buildGoalPickerItems`; add goal items to `pickerItems` after file items and before commands (use `withCommandItems` with the combined list). `openGoalFocus` should set `podGoalId` and `goalDetailFocus` before `setFocusState`.

- [ ] **Step 4: Run tests**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/focus/picker-model.ts packages/desktop/src/renderer/mafw/focus/picker-model.test.ts packages/desktop/tests/goal-focus-wiring.test.ts
git commit -m "feat(desktop): open goals as focus subjects"
```

---

### Task 3: Change-set stage

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/ChangeSetStage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/FocusStage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Test: `packages/desktop/tests/change-set-stage-wiring.test.ts`

**Interfaces:**
- Consumes: `ChangesDock`, `FileDiffEntry`.
- Produces:

```ts
export function ChangeSetStage(props: {
  sessionID: string | null
  sessionDirectory: string | null
  diffs: FileDiffEntry[]
  onSendComment?: (sid: string, text: string) => void
  onAddAnnotation?: (a: {
    rel: string
    startLine: number
    endLine: number
    code: string
    comment: string
  }) => void
}): JSX.Element
```

Behavior:
- Renders `ChangesDock` with the current goal-scope diffs.
- Empty diffs show a clear empty state (`DockEmpty` text) instead of fake data.
- FocusStage `changeSet` branch uses `ChangeSetStage`; remove the `DockEmpty` fallback.
- WorkbenchShell passes `sessionDirectory` and `diffs`.

- [ ] **Step 1: Write the failing test**

`change-set-stage-wiring.test.ts` asserts:
- `ChangeSetStage` imports `ChangesDock`
- FocusStage imports `ChangeSetStage`
- changeSet branch renders `ChangeSetStage`
- no `变更集舞台待接入` fallback remains
- empty state text exists

- [ ] **Step 2: Run it to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/change-set-stage-wiring.test.ts
```

- [ ] **Step 3: Implement**

Add the component; replace the FocusStage fallback; pass props from WorkbenchShell. Keep the existing `ChangesDock` behavior and comments.

- [ ] **Step 4: Run test**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ChangeSetStage.tsx packages/desktop/src/renderer/mafw/components/FocusStage.tsx packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/tests/change-set-stage-wiring.test.ts
git commit -m "feat(desktop): add change set stage"
```

---

### Task 4: Instrument rail and Goal review queue

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/InstrumentRail.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/GoalReviewQueue.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/tests/instrument-rail-wiring.test.ts`
- Test: `packages/desktop/tests/goal-review-queue-wiring.test.ts`

**Interfaces:**
- Produces:

```ts
export function InstrumentRail(props: {
  title: string
  sections: readonly { id: string; label: string; content: JSX.Element }[]
  open: boolean
  onToggle: (open: boolean) => void
}): JSX.Element

export function GoalReviewQueue(props: {
  podId: string
  goalId: string
  revision: number
  accepted: boolean
  refreshKey?: () => unknown
  onFocusItem: (item: PodReviewItem) => void
  onResolved?: () => void
}): JSX.Element
```

Behavior:
- `GoalReviewQueue` fetches `window.api.mafw.pod.reviewItems(podId, goalId, { revision })`; fail-open keeps last list.
- Resolve / reopen call `window.api.mafw.pod.resolveReviewItem` / `reopenReviewItem`, then refresh.
- `PodReviewItems` renders the list; `onFocusItem` fires on item click.
- `InstrumentRail` is a right-side rail (like the existing editor instruments) with a header and collapsible sections.
- WorkbenchShell renders the rail in focus mode when the active lens is `review` or the focus is a Goal; the rail never covers the frame.
- CSS: `.mafw-instrument-rail`, `.mafw-instrument-section`, responsive stack under 900px.

- [ ] **Step 1: Write failing tests**

`instrument-rail-wiring.test.ts`:
- imports `InstrumentRail`, `GoalReviewQueue`, `PodReviewItems`
- rail renders sections / `aria-label`
- WorkbenchShell renders `InstrumentRail` in focus mode
- CSS uses tokens and does not cover the frame (`position: static`/normal flex)

`goal-review-queue-wiring.test.ts`:
- contains `reviewItems`, `resolveReviewItem`, `reopenReviewItem`
- calls `PodReviewItems`
- has fail-open catch

- [ ] **Step 2: Run them**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/instrument-rail-wiring.test.ts tests/goal-review-queue-wiring.test.ts
```

- [ ] **Step 3: Implement components and CSS**

Use `PodReviewItems` and `pod-review-model`; do not duplicate resolve rules. Use `ButtonV2` / `TooltipV2` for rail controls.

- [ ] **Step 4: Run tests**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/InstrumentRail.tsx packages/desktop/src/renderer/mafw/components/GoalReviewQueue.tsx packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/instrument-rail-wiring.test.ts packages/desktop/tests/goal-review-queue-wiring.test.ts
git commit -m "feat(desktop): add instrument rail and goal review queue"
```

---

### Task 5: Review item focus and anchor

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/FocusStage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Test: `packages/desktop/tests/review-focus-wiring.test.ts`

**Interfaces:**
- Extend the explicit open request:

```ts
type FocusOpenRequest = { root: string; rel: string; nonce: number; line?: number }
```

- `EditorDock` after opening a file calls `editor?.gotoLine(line)` when `line` is finite and the editor is mounted.
- `MafwShell.openReviewItemFocus(item)`:
  - Resolves the goal/worktree scope.
  - Pushes `openReviewItemFocus` with `{ rel: item.rel, line: item.startLine ?? undefined }`.
  - Calls `requestFocusOpen(worktreeDir, item.rel, line)`.
  - Frame anchor label `rel:Lx`.
- Back from the review item returns to the change set / review queue.

- [ ] **Step 1: Write failing tests**

`review-focus-wiring.test.ts` asserts:
- MafwShell imports `openReviewItemFocus`
- `requestFocusOpen` accepts a line
- `EditorDock` calls `gotoLine`
- `GoalReviewQueue` `onFocusItem` is wired
- frame anchor uses `rel:Lx`

- [ ] **Step 2: Run it**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/review-focus-wiring.test.ts
```

- [ ] **Step 3: Implement**

Keep the line optional; if the editor is not mounted yet, store the line and apply after mount in `openRel`. Do not block the file open on the line jump.

- [ ] **Step 4: Run test**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/EditorDock.tsx packages/desktop/src/renderer/mafw/components/FocusStage.tsx packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/tests/review-focus-wiring.test.ts
git commit -m "feat(desktop): focus review items with anchors"
```

---

### Task 6: Regression, gates and smoke

**Files:**
- Modify affected tests only; no new production files.

- [ ] **Step 1: Run the focused tests**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/goal-focus-wiring.test.ts tests/change-set-stage-wiring.test.ts tests/instrument-rail-wiring.test.ts tests/goal-review-queue-wiring.test.ts tests/review-focus-wiring.test.ts
```

- [ ] **Step 2: Run the full desktop suite**

```bash
npm test
```

Expected: all tests PASS; record counts.

- [ ] **Step 3: Typecheck and build**

```bash
npx tsgo --noEmit -p tsconfig.json
node ../../node_modules/electron-vite/bin/electron-vite.js build
```

- [ ] **Step 4: Real-app smoke**

1. Open a Goal from project home; frame shows Goal title / revision; Goal overview renders in the stage; no legacy context header.
2. Switch to `变更`; change set stage renders diffs or a clear empty state.
3. Switch to `审阅`; instrument rail shows the review queue; resolve / reopen updates the queue.
4. Click a review item; frame shows `rel:Lx`; the file opens; back returns to the change set / Goal overview.
5. Back to project; legacy Goal detail still opens and acceptance gates unchanged.
6. Narrow width; rail stacks/collapses and does not cover the frame.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/tests
git commit -m "test(desktop): cover goal and review focus"
```

---

## Self-review notes

- **Spec coverage:** This plan covers the design's §9.5 (instruments), Goal/review scope, change-set subject, and review-item focus. Chat decision board, agent/user contract, execution-as-frame, and full decision records remain Plan 3.
- **Type consistency:** `GoalFocusInput`, `openGoalFocus`, `openChangeSetFocus`, `openReviewItemFocus`, `FocusOpenRequest` are defined once and reused.
- **Deferred:** full worktree diff API; decision record persistence; execution status frame badge; Chat decision board. These are Plan 3 or gateway follow-ups.
