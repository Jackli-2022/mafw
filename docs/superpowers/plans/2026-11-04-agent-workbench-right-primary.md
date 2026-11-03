# 右主 Agent 工作台与舒适对话列 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the right dock the always-available Agent workbench (`工作 / 工作台 / 执行 / 审阅`), retire the full-page workspace, default chat to a comfortable 760px reading column, and make chat typography explicitly 16px.

**Architecture:** Keep the existing absolute-px chat budget and residual workbench column. Add a `work` L1 workbench view backed by a new `ProjectWorkView`, decouple dock visibility from `activeTab === "chat"`, add transient Focus mode, and move project entries away from the retired `WorkspaceHome`. The change is Desktop-only; gateway, SDK, runtime contracts, Goal domain semantics, and harmonic memory are untouched.

**Tech Stack:** Electron + SolidJS desktop renderer, `@mafw/ui/v2`, `@mafw/session-ui`, existing `work.overview` preload/SDK path, node:test with `@mafw/test-shim`.

**Spec:** `docs/superpowers/specs/2026-11-04-agent-workbench-right-primary-design.md`

## Global Constraints

- Desktop package only: do not modify `gateway/`, `packages/gateway-sdk/`, runtime contracts, Goal domain files, or harmonic memory.
- Exact sizing values: chat detents `520 / 640 / 760`, default and double-click `760`, `WORKBENCH_MIN_WIDTH = 720`, `PUSH_PAIR_BUDGET = 1490`, default window `1720×1000`, hard minimum `1088×720`.
- Chat typography: scoped tokens `--mafw-chat-reading: 16px` and `--mafw-chat-composer: 16px`; global `@mafw/ui` `--font-size-base` remains `14px`.
- Right workbench manual hide stays user-controlled and persisted; no automatic hiding on project/page routes. Config may cover it but must not destroy its state.
- Focus mode is transient: no persistence key, resets on project switch/restart, and restores the prior chat detent / L1 / L2 state.
- Existing persisted detents and workbench views must survive; only missing/invalid values use the new defaults.
- Use existing `@mafw/ui/v2` components; no new `<button>`/`<input>`, no `@ts-nocheck`, no second palette.
- Do not push, deploy, or release. Local commits only.
- Focused desktop tests must run with browser conditions:
  `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test <files>`
  from `packages/desktop`.

## Review Focus

- **Stored user preferences:** a user who saved detent `640` or view `execution` must keep it after upgrade; only missing/invalid values become `760` / `work`. Pinned by Task 1 and Task 3.
- **Plugin surfaces:** default view `work` must not strand `plugin:<package>:<panel>` surfaces; selecting any L2/plugin surface still switches to `workbench`. Pinned by Task 3.
- **Config/global pages:** Memory / Approvals / Triage / Automation must leave the right dock visible and mounted; Config may hide it visually but must not unmount or reset it. Pinned by Task 5.
- **Focus restore:** Focus must not persist and must restore the exact chat detent / view / surface on exit; project switch must clear it. Pinned by Task 6.
- **Approvals visibility:** retiring the workspace destination must not lose the pending-approvals badge or Approvals route. Pinned by Task 7.
- **Legacy `goals` route/deep links:** `workspace` / `goals` deep links and Triage's "open goals" must land on chat + right `工作`, never on a removed page. Pinned by Task 8.
- **Empty Pod attention:** the left Pod face must not render a "需要你 0" block; attention appears only when count > 0. Pinned by Task 9.
- **Minimum window:** 1088 must remain usable (chat ≈320, workbench ≈720) with no horizontal overflow; 1366 is the comfort baseline, not the Electron hard minimum. Pinned by Task 1 and Task 10.

---

### Task 1: Retune absolute sizing and window defaults

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/workbench-detents.ts`
- Modify: `packages/desktop/src/renderer/mafw/left-dock.ts`
- Modify: `packages/desktop/src/main/window-bounds.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx` (resize tooltip copy only)
- Test: `packages/desktop/src/renderer/mafw/workbench-detents.test.ts`
- Test: `packages/desktop/src/renderer/mafw/left-dock.test.ts`
- Test: `packages/desktop/src/main/window-bounds.test.ts`

**Interfaces:**
- Consumes: existing `chatPxForDetent(detent, availableWidth)`, `leftDockPushBudget(dockWidth)`, `fitDefaultWindowSize(workArea)`.
- Produces:
  - `WORKBENCH_DEFAULT_DETENT: 760`
  - `WORKBENCH_MIN_WIDTH: 720`
  - `PUSH_PAIR_BUDGET: 1490`
  - `MAIN_WINDOW_DEFAULT_WIDTH = 1720`, `MAIN_WINDOW_DEFAULT_HEIGHT = 1000`, `MAIN_WINDOW_MIN_WIDTH = 1088`
  - `leftDockPushBudget(264) === 1800`

- [ ] **Step 1: Write the failing sizing tests**

Update the three test files to pin the new contract. Add/adjust assertions equivalent to:

```ts
assert.equal(WORKBENCH_DEFAULT_DETENT, 760)
assert.equal(WORKBENCH_MIN_WIDTH, 720)
assert.equal(chatPxForDetent(760, 1554), 760)   // 1600 window, no pushed dock
assert.equal(chatPxForDetent(760, 1320), 600)   // 1366 window, no pushed dock
assert.equal(chatPxForDetent(760, 1042), 320)   // 1088 hard-min fallback
assert.equal(normalizeDetent("640"), 640)       // stored preference survives
assert.equal(normalizeDetent(null), 760)

assert.equal(leftDockPushBudget(264), 1800)
assert.equal(resolveMode(true, 1799, 264), "overlay")
assert.equal(resolveMode(true, 1800, 264), "push")

assert.equal(MAIN_WINDOW_MIN_WIDTH, 1088)
assert.deepEqual(fitDefaultWindowSize({ width: 1920, height: 1080 }), { width: 1720, height: 1000 })
assert.deepEqual(fitDefaultWindowSize({ width: 1366, height: 768 }), { width: 1286, height: 720 })
assert.deepEqual(fitDefaultWindowSize({ width: 1024, height: 768 }), { width: 1088, height: 720 })
```

Also change the resize-handle copy contract to expect `双击回默认档 760`.

- [ ] **Step 2: Run focused tests to verify they fail**

Run from `packages/desktop`:

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-detents.test.ts src/renderer/mafw/left-dock.test.ts src/main/window-bounds.test.ts
```

Expected: failures on the new `760`, `720`, `1800`, and `1720` expectations; existing `640` default assertions fail until updated.

- [ ] **Step 3: Implement the constants and comments**

In `workbench-detents.ts`:
- Set `WORKBENCH_DEFAULT_DETENT = 760`.
- Set `WORKBENCH_MIN_WIDTH = 720`.
- Update the header comment to rev3 and cite `docs/research/2026-11-04-chat-detent-default-760.md` plus this spec.
- Do not change `WORKBENCH_DETENTS`, `CHAT_PX_FLOOR`, or `CHAT_PX_CEIL`.

In `left-dock.ts`:
- Set `PUSH_PAIR_BUDGET = 1490`.
- Change the comment from “保默认档 640+640” to “保 760 chat + 730 workbench 的宽屏推挤预算”.
- Update `effectiveLeftDockWidth`'s legacy `RIGHT_WORKBENCH_MIN_WIDTH` from 520 to 720 (defensive path only).

In `window-bounds.ts`:
- Set `MAIN_WINDOW_DEFAULT_WIDTH = 1720`.
- Keep `MAIN_WINDOW_MIN_WIDTH = 1088`.
- Update the header comment: 1088 is the hard fallback; 1366 is the design baseline.

In `MafwShell.tsx`, update the resize tooltip string from 640 to 760.

- [ ] **Step 4: Run focused tests to verify they pass**

Repeat the Step 2 command. Expected: all three files pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/workbench-detents.ts packages/desktop/src/renderer/mafw/left-dock.ts packages/desktop/src/main/window-bounds.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/workbench-detents.test.ts packages/desktop/src/renderer/mafw/left-dock.test.ts packages/desktop/src/main/window-bounds.test.ts
git commit -m "feat(desktop): default chat to 760 and reserve a 720px workbench"
```

---

### Task 2: Make 16px chat typography explicit and upgrade the composer

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: Create `packages/desktop/src/renderer/mafw/chat-typography-css.test.ts`

**Interfaces:**
- Consumes: existing scoped user-message and markdown overrides in `mafw.css`.
- Produces chat-scoped CSS custom properties:
  - `--mafw-chat-reading: 16px`
  - `--mafw-chat-composer: 16px`
- Producer selector contract:
  - user message text and assistant markdown use `var(--mafw-chat-reading, 16px)`
  - composer textarea uses `var(--mafw-chat-composer, 16px)` and `max-height: 220px`

- [ ] **Step 1: Write the failing CSS contract test**

Create `chat-typography-css.test.ts` with tests equivalent to:

```ts
const css = readFileSync(new URL("./mafw.css", import.meta.url), "utf8")
const theme = readFileSync(new URL("../../../ui/src/styles/theme.css", import.meta.url), "utf8")

test("chat reading and composer typography use explicit 16px tokens", () => {
  assert.match(css, /\.mafw-chat\s*\{[^}]*--mafw-chat-reading:\s*16px/)
  assert.match(css, /\.mafw-chat\s*\{[^}]*--mafw-chat-composer:\s*16px/)
  assert.match(css, /font-size:\s*var\(--mafw-chat-reading,\s*16px\)/)
  assert.match(css, /\.mafw-composer[^{]*\.mafw-input[^{]*\[data-slot="textarea-v2-textarea"\][^{]*\{[^}]*font-size:\s*var\(--mafw-chat-composer,\s*16px\)/)
  assert.match(css, /\.mafw-composer[^{]*\.mafw-input[^{]*\[data-slot="textarea-v2-textarea"\][^{]*\{[^}]*max-height:\s*220px/)
})

test("the global UI base font remains 14px", () => {
  assert.match(theme, /--font-size-base:\s*14px/)
  assert.doesNotMatch(css, /\.mafw-shell,\s*body\s*\{[^}]*--mafw-chat-reading/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/chat-typography-css.test.ts
```

Expected: FAIL because the tokens do not exist and the composer is still `14px / 200px`.

- [ ] **Step 3: Implement the scoped tokens**

In the `.mafw-chat` block (near the existing chat container rules), add:

```css
--mafw-chat-reading: 16px;
--mafw-chat-composer: 16px;
```

Change:
- user-message text `font-size: 16px` → `font-size: var(--mafw-chat-reading, 16px)`
- assistant markdown `font-size: 16px` → `font-size: var(--mafw-chat-reading, 16px)`
- composer textarea `font-size: 14px` → `font-size: var(--mafw-chat-composer, 16px)`
- composer textarea `max-height: 200px` → `max-height: 220px`

Do not add these tokens to the merged theme blocks and do not modify `packages/ui/src/styles/theme.css`.

- [ ] **Step 4: Run focused tests and the existing CSS contracts**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/chat-typography-css.test.ts src/renderer/mafw/theme-merge-css.test.ts src/renderer/mafw/composer-toolbar-css.test.ts
```

Expected: all pass, including the theme key-parity and dangling-variable scans.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/chat-typography-css.test.ts
git commit -m "feat(desktop): scope chat typography to explicit 16px tokens"
```

---

### Task 3: Add the `work` L1 workbench view

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/workbench-views.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/src/renderer/mafw/workbench-views.test.ts`
- Test: `packages/desktop/tests/workbench-shell-wiring.test.ts`

**Interfaces:**
- Consumes: existing `WorkbenchState`, `normalizeWorkbenchView`, `applyWorkbenchSurface`, plugin surface normalization.
- Produces:
  - `type WorkbenchView = "work" | "workbench" | "execution" | "review"`
  - `WORKBENCH_VIEWS` order `["work", "workbench", "execution", "review"]`
  - `DEFAULT_WORKBENCH_STATE.view = "work"`
  - `normalizeWorkbenchView` fallback `"work"`
  - `WorkbenchShellProps.workView: JSX.Element`

- [ ] **Step 1: Write the failing model tests**

In `workbench-views.test.ts`, add/adjust:

```ts
assert.deepEqual(WORKBENCH_VIEWS.map((v) => v.id), ["work", "workbench", "execution", "review"])
assert.equal(DEFAULT_WORKBENCH_STATE.view, "work")
assert.equal(normalizeWorkbenchView(null), "work")
assert.equal(normalizeWorkbenchView("bogus"), "work")
assert.equal(normalizeWorkbenchView("execution"), "execution")
assert.equal(nextWorkbenchView("work", "ArrowRight"), "workbench")
assert.equal(nextWorkbenchView("review", "ArrowLeft"), "execution")
```

In `workbench-shell-wiring.test.ts`, add a source-contract assertion that `WorkbenchShell` accepts a `workView` prop and renders a pane whose active class is keyed to `props.view === "work"`.

- [ ] **Step 2: Run focused tests to verify they fail**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-views.test.ts tests/workbench-shell-wiring.test.ts
```

Expected: FAIL on `work` type/order/default and missing `workView` prop.

- [ ] **Step 3: Implement the view model and shell pane**

In `workbench-views.ts`:
- Extend `WorkbenchView` with `"work"`.
- Insert `{ id: "work", label: "工作" }` first in `WORKBENCH_VIEWS`.
- Set `DEFAULT_WORKBENCH_STATE.view = "work"`.
- Change `normalizeWorkbenchView` fallback to `"work"`.
- Leave `normalizeWorkbenchSurface`, plugin ids, `normalizeExecutionSection`, and legacy migration otherwise unchanged.

In `WorkbenchShell.tsx`:
- Add `workView: JSX.Element` to props.
- Add the `work` icon branch in the L1 icon mapping (use `layout-grid`).
- Treat `work` like `review` for the L2 strip (no L2).
- Add a `.mafw-rw-pane` for `work` with `classList={{ "is-active": props.view === "work" }}` and render `props.workView`.

In `MafwShell.tsx`:
- Pass a temporary placeholder `workView={<div class="mafw-empty">项目工作</div>}` (Task 4 replaces it).
- Keep `applyWorkbenchSurface` forcing view `"workbench"` so plugin surfaces remain reachable.
- Keep `terminalSurfaceHotkeyAction` forcing `workbench`.

- [ ] **Step 4: Run focused tests to verify they pass**

Repeat Step 2 command. Expected: both files pass and persisted `workbench` / `execution` / `review` values still normalize unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/workbench-views.ts packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/workbench-views.test.ts packages/desktop/tests/workbench-shell-wiring.test.ts
git commit -m "feat(desktop): add the work view to the right workbench"
```

---

### Task 4: Build `ProjectWorkView` and wire it into the right workbench

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: Create `packages/desktop/tests/project-work-view.test.ts`

**Interfaces:**
- Consumes:
  - `WorkOverview` from `components/WorkOverview.tsx`
  - `PodGoalComposer` from `components/PodGoalComposer.tsx`
  - `window.api.mafw.work.overview(projectDir)`
  - `window.api.mafw.pod.ensure(projectDir)` and `pod.createGoal(...)`
- Produces:
  ```ts
  export function ProjectWorkView(props: {
    projectDir: string | null
    refreshTick: () => number
    composerRequest?: number
    onOpenGoal: (goal: PodGoal, focus?: GoalDetailFocus) => void
    onGoalCreated?: (goalId: string) => void
  }): JSX.Element
  ```
- `MafwShell` produces `refreshTick={() => Math.max(goalsRev(), podStore.revision())}` and replaces the Task 3 placeholder.

- [ ] **Step 1: Write the failing source-contract test**

Create `project-work-view.test.ts` with assertions equivalent to:

```ts
const view = read("../src/renderer/mafw/components/ProjectWorkView.tsx")
const shell = read("../src/renderer/mafw/MafwShell.tsx")

test("ProjectWorkView owns the project work overview and Goal composer", () => {
  assert.match(view, /import \{ WorkOverview \} from "\.\/WorkOverview"/)
  assert.match(view, /import \{ PodGoalComposer \} from "\.\/PodGoalComposer"/)
  assert.match(view, /window\.api\.mafw\.work\.overview\(/)
  assert.match(view, /window\.api\.mafw\.pod\.ensure\(/)
  assert.match(view, /window\.api\.mafw\.pod\.createGoal\(/)
  assert.match(view, /refreshTick:/)
  assert.match(view, /composerRequest\?\? 0/)
  assert.doesNotMatch(view, /WorkspaceHome/)
})

test("the shell mounts ProjectWorkView in the work L1 pane", () => {
  assert.match(shell, /import \{ ProjectWorkView \} from "\.\/components\/ProjectWorkView"/)
  assert.match(shell, /workView=\{<ProjectWorkView/)
  assert.match(shell, /refreshTick=\{\(\) => Math\.max\(goalsRev\(\), podStore\.revision\(\)\)\}/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/project-work-view.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `ProjectWorkView`**

Move the reusable logic from `WorkspaceHome.tsx` into the new component:
- Signals: `overview`, `loading`, `error`, `composerOpen`, `creating`.
- `load()` calls `work.overview(props.projectDir)` and maps the no-Pod error to the existing friendly copy.
- `createEffect` reloads on `props.projectDir` and `props.refreshTick()`, plus a 15-second interval.
- `createEffect` opens the composer when `props.composerRequest ?? 0` increases, mirroring the old `WorkspaceHome` behavior.
- `createGoal()` uses explicit `pod.ensure` then `pod.createGoal`, refreshes, and calls `props.onGoalCreated`.
- Render:
  - compact header `项目工作` + `新建 Goal` button
  - `PodGoalComposer` when open
  - `<WorkOverview overview loading error onOpenGoal onOpenAll={refresh} />`
- Do not render the Lead card or free-discussion list.

In `MafwShell.tsx`, replace the placeholder with:

```tsx
workView={
  <ProjectWorkView
    projectDir={currentProject()}
    refreshTick={() => Math.max(goalsRev(), podStore.revision())}
    composerRequest={goalComposerRequest()}
    onOpenGoal={(goal, focus) => openGoalDetail(goal.goalId, focus)}
    onGoalCreated={(goalId) => openGoalDetail(goalId)}
  />
}
```

- [ ] **Step 4: Run focused tests to verify they pass**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/project-work-view.test.ts tests/workbench-shell-wiring.test.ts src/renderer/mafw/workspace-model.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/project-work-view.test.ts
git commit -m "feat(desktop): host project work in the right workbench"
```

---

### Task 5: Make the right workbench independent of the chat route

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/workbench-layout.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/src/renderer/mafw/workbench-layout.test.ts`
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Consumes: existing `workbenchColumns`, `workbenchShellHidden`, `chatSplit`, `dockPresent`.
- Produces:
  ```ts
  export type WorkbenchContentMode = "project" | "config"
  export function workbenchSplit(input: { content: WorkbenchContentMode; open: boolean }): boolean
  export function workbenchShellHidden(input: { content: WorkbenchContentMode; open: boolean }): boolean
  ```
  - `workbenchSplit` is true for `project` + open, false for `config` or closed.
  - `workbenchShellHidden` is true only for `config` or closed.

- [ ] **Step 1: Write the failing layout tests**

In `workbench-layout.test.ts`, replace the old `workbenchShellHidden(chatActive)` cases with:

```ts
assert.equal(workbenchSplit({ content: "project", open: true }), true)
assert.equal(workbenchSplit({ content: "project", open: false }), false)
assert.equal(workbenchSplit({ content: "config", open: true }), false)

assert.equal(workbenchShellHidden({ content: "project", open: true }), false)
assert.equal(workbenchShellHidden({ content: "project", open: false }), true)
assert.equal(workbenchShellHidden({ content: "config", open: true }), true)
```

In `design-contract.test.ts`, add a source assertion that `MafwShell` no longer contains `chatActive() && rightDockOpen()` and that the topstrip dock toggle is not gated on `chatActive()`.

- [ ] **Step 2: Run focused tests to verify they fail**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-layout.test.ts tests/design-contract.test.ts
```

Expected: FAIL on the new function signatures and shell contract.

- [ ] **Step 3: Implement route-independent visibility**

In `workbench-layout.ts`:
- Add `WorkbenchContentMode`, `workbenchSplit`, and the new `workbenchShellHidden` overload.
- Keep `workbenchColumns` unchanged for this task.
- Delete the old boolean-only `workbenchShellHidden(chatActive)` export.

In `MafwShell.tsx`:
- Compute `const workbenchContent = () => showConfig() ? "config" : "project"`.
- Replace `chatSplit = chatActive() && rightDockOpen()` with `workbenchSplit({ content: workbenchContent(), open: rightDockOpen() })`.
- Replace `workbenchShellHidden(chatActive())` with `workbenchShellHidden({ content: workbenchContent(), open: rightDockOpen() })`.
- Show the topstrip right-dock toggle whenever `!showConfig()`, not only when `chatActive()`.
- Keep `dockPresent` driven by `rightDockOpen()` so Config does not unmount the shell while the user's dock preference remains open.

- [ ] **Step 4: Run focused tests and shell contracts**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-layout.test.ts tests/design-contract.test.ts tests/workbench-shell-wiring.test.ts
```

Expected: all pass; Memory / Approvals / Triage / Automation now keep the right dock visible.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/workbench-layout.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/workbench-layout.test.ts packages/desktop/tests/design-contract.test.ts
git commit -m "feat(desktop): keep the right workbench available across project routes"
```

---

### Task 6: Add transient Focus mode

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/workbench-layout.ts`
- Modify: `packages/desktop/src/renderer/mafw/keybindings.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/src/renderer/mafw/workbench-layout.test.ts`
- Test: `packages/desktop/src/renderer/mafw/keybindings.test.ts`
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Produces:
  - `workbenchColumns(input: { leftPx: number; chatPx: number; split: boolean; focus: boolean }): string`
  - keybinding action `"toggle-workbench-focus"` with default `"ctrl+shift+m"`
  - `WorkbenchShellProps.focus?: boolean` and `onToggleFocus?: () => void`

- [ ] **Step 1: Write the failing tests**

Add to `workbench-layout.test.ts`:

```ts
assert.equal(
  workbenchColumns({ leftPx: 46, chatPx: 760, split: true, focus: true }),
  "46px 0px minmax(0, 1fr)",
)
assert.equal(
  workbenchColumns({ leftPx: 46, chatPx: 760, split: true, focus: false }),
  "46px 760px minmax(0, 1fr)",
)
```

Add to `keybindings.test.ts`:

```ts
assert.equal(DEFAULT_KEYBINDINGS["toggle-workbench-focus"], "ctrl+shift+m")
assert.equal(KEYBINDING_LABELS["toggle-workbench-focus"], "切换工作台全宽")
```

Add a design-contract source assertion that `WorkbenchShell` renders a focus toggle button and `MafwShell` calls `keybindingFor("toggle-workbench-focus")`.

- [ ] **Step 2: Run focused tests to verify they fail**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-layout.test.ts src/renderer/mafw/keybindings.test.ts tests/design-contract.test.ts
```

Expected: FAIL on focus columns, keybinding, and button contract.

- [ ] **Step 3: Implement Focus mode**

In `workbench-layout.ts`, extend `workbenchColumns` with `focus`. When true, return `${leftPx}px 0px minmax(0, 1fr)`.

In `keybindings.ts`, add:
- action `"toggle-workbench-focus"`
- label `切换工作台全宽`
- default `"ctrl+shift+m"`

In `WorkbenchShell.tsx`:
- Add `focus` / `onToggleFocus` props.
- Render a header `ButtonV2` (ghost, small, icon `layout-right-full`) with `aria-label={focus ? "退出工作台全宽" : "工作台全宽"}`.
- Keep the button in the L1 header's right-side action area.

In `MafwShell.tsx`:
- Add `const [workbenchFocus, setWorkbenchFocus] = createSignal(false)`.
- Do not persist it.
- Reset it to false in the project-switch effect.
- Keyboard effect calls `keybindingFor("toggle-workbench-focus")` and toggles the signal.
- Pass `focus={workbenchFocus()}` and `onToggleFocus={() => setWorkbenchFocus((v) => !v)}` to `WorkbenchShell`.
- Pass `focus: workbenchFocus()` into `workbenchColumns`.
- Keep ChatPane mounted; only the grid chat column becomes `0px`. `.mafw-main` already has `min-width: 0` and `overflow: hidden`, so no extra CSS is needed for the zero-width column.

- [ ] **Step 4: Run focused tests to verify they pass**

Repeat Step 2 command. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/workbench-layout.ts packages/desktop/src/renderer/mafw/keybindings.ts packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/workbench-layout.test.ts packages/desktop/src/renderer/mafw/keybindings.test.ts packages/desktop/tests/design-contract.test.ts
git commit -m "feat(desktop): add transient full-width workbench focus"
```

---

### Task 7: Re-point the left rail and quick entries to the right workbench

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/IconRail.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WelcomeHome.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/tests/icon-rail-wiring.test.ts`
- Test: `packages/desktop/tests/icon-rail-pod-wiring.test.ts`
- Test: `packages/desktop/tests/workspace-shell-wiring.test.ts`

**Interfaces:**
- Produces:
  - `IconRail` destination `{ key: "approvals", icon: "checklist", label: "审批", badge: props.approvals }`
  - `IconRailProps.onApprovals: () => void` and `approvalsActive: boolean`
  - `WelcomeHomeProps.onOpenWork: () => void`
  - `MafwShell.openProjectWork(): void` = close Config/left overlay if needed, set chat route, open right dock, and select `work`

- [ ] **Step 1: Write the failing entry tests**

Update the rail tests to expect the order:

```ts
["new", "sessions", "search", "pod", "notes", "approvals", "config"]
```

and to assert:
- the approvals item carries `badge: props.approvals`
- no rail item has label `工作空间`
- `WelcomeHome` calls `props.onOpenWork()` instead of `props.onNavigate("goals")`
- the command palette item for project work calls `openProjectWork`

- [ ] **Step 2: Run focused tests to verify they fail**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/icon-rail-wiring.test.ts tests/icon-rail-pod-wiring.test.ts tests/workspace-shell-wiring.test.ts
```

Expected: FAIL on the new rail order/props and Welcome action.

- [ ] **Step 3: Implement the entries**

In `IconRail.tsx`:
- Remove the `workspace` meta item.
- Add the `approvals` item with the pending badge.
- Replace `onDashboard` / `dashboardActive` props with `onApprovals` / `approvalsActive`.

In `WelcomeHome.tsx`:
- Replace the `工作空间` button with `项目工作` bound to `props.onOpenWork()`.
- Remove `"goals"` from the `onNavigate` union.
- Keep the `新建 Goal` button; it will call the existing composer request, now redirected by the shell.

In `MafwShell.tsx`:
- Add:
  ```ts
  function openProjectWork() {
    closeLeftDockIfOverlay()
    setShowConfig(false)
    setActiveTab("chat")
    setRightDockOpen(true)
    openWorkbench("work")
  }
  ```
- Pass it to Welcome as `onOpenWork`.
- Point the rail approvals item to `setActiveTab("approvals")`.
- Point the command palette's project-work item to `openProjectWork`.
- Point Triage's `onOpenGoals` to `openProjectWork`.
- Change `openNewGoalComposer()` to call `openProjectWork()` and bump the composer request.

Do not remove the `goals` NavTab yet; Task 8 handles route retirement.

- [ ] **Step 4: Run focused tests to verify they pass**

Repeat Step 2 command. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/IconRail.tsx packages/desktop/src/renderer/mafw/components/WelcomeHome.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/icon-rail-wiring.test.ts packages/desktop/tests/icon-rail-pod-wiring.test.ts packages/desktop/tests/workspace-shell-wiring.test.ts
git commit -m "feat(desktop): route project entries to the right workbench"
```

---

### Task 8: Retire `WorkspaceHome` and the `goals` page route

**Files:**
- Delete: `packages/desktop/src/renderer/mafw/components/WorkspaceHome.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/nav-tab.ts`
- Modify: `packages/desktop/src/renderer/mafw/page-links.ts`
- Modify: `packages/desktop/src/renderer/mafw/deep-link.ts`
- Test: Rewrite `packages/desktop/tests/workspace-shell-wiring.test.ts`
- Test: `packages/desktop/tests/dead-code.test.ts`
- Test: `packages/desktop/tests/lead-entry-wiring.test.ts`
- Test: `packages/desktop/src/renderer/mafw/page-links.test.ts`
- Test: Delete `packages/desktop/tests/workspace-polish-style.test.ts`

**Interfaces:**
- Produces:
  - `NAV_TABS` without `goals`
  - `KNOWN_TABS` / deep-link handling that maps legacy `workspace` and `goals` to `openProjectWork()`
  - no import or route branch for `WorkspaceHome`

- [ ] **Step 1: Rewrite the failing retirement tests**

Update `workspace-shell-wiring.test.ts` to assert:
- `MafwShell` does not import `WorkspaceHome`
- no branch checks `activeTab() === "goals"` to render a page
- legacy `goals` active-tab values are redirected by an effect to `openProjectWork()`
- `nav-tab.ts` no longer exposes a `goals` tab
- `deep-link.ts` maps `workspace` to the project-work action instead of `goals`

Update `dead-code.test.ts` so the New Goal composer contract points at `ProjectWorkView.tsx`, not `WorkspaceHome.tsx`.

Delete `workspace-polish-style.test.ts` because its subject component is removed; move any still-relevant `WorkOverview` visual assertions into `project-work-view.test.ts` if they do not duplicate existing tests.

- [ ] **Step 2: Run focused tests to verify they fail**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/workspace-shell-wiring.test.ts tests/dead-code.test.ts tests/lead-entry-wiring.test.ts src/renderer/mafw/page-links.test.ts src/renderer/mafw/deep-link.test.ts
```

Expected: FAIL while `WorkspaceHome`, the `goals` tab, and old deep-link mapping still exist.

- [ ] **Step 3: Retire the page and preserve compatibility**

In `MafwShell.tsx`:
- Remove the `WorkspaceHome` import and `activeTab === "goals"` page branch.
- Add a redirect effect:
  ```ts
  createEffect(() => {
    if (activeTab() === "goals") openProjectWork()
  })
  ```
- Keep `openProjectWork()` as the single compatibility target for old palette/deep-link/Triage callers.

In `nav-tab.ts`:
- Keep `"goals"` in the `NavTab` union as a legacy internal route value so old callers and deep links still typecheck.
- Remove `goals` from `NAV_TABS`, which removes it from public page links and resource menus.

In `page-links.ts` and `deep-link.ts`:
- Remove `goals` from public page links.
- Map legacy `workspace` to the same project-work path as `goals`.

Delete `WorkspaceHome.tsx`.

Do not clean `.mafw-workspace*` CSS in this task. Record any now-unused workspace-only selectors as known CSS debt in the delivery note; shared `.mafw-work-*` rules must remain because `WorkOverview` uses them.

- [ ] **Step 4: Run focused tests and source scans**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/workspace-shell-wiring.test.ts tests/dead-code.test.ts tests/lead-entry-wiring.test.ts src/renderer/mafw/page-links.test.ts src/renderer/mafw/deep-link.test.ts tests/project-work-view.test.ts
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pages/context-menu-wiring.test.ts
```

Expected: all pass and no test reads the deleted `WorkspaceHome.tsx`.

- [ ] **Step 5: Commit**

```bash
git add -A packages/desktop/src/renderer/mafw packages/desktop/tests
git commit -m "feat(desktop): retire the full-page project workspace"
```

---

### Task 9: Make the left Pod face an attention and team surface

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectResources.tsx`
- Modify: `packages/desktop/src/renderer/mafw/pod-rail-face-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: Create `packages/desktop/tests/project-resources-work.test.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-rail-face-model.test.ts`

**Interfaces:**
- Produces in `pod-rail-face-model.ts`:
  ```ts
  export function podAttentionRow(count: number): { label: string; visible: boolean }
  export function podRecentMessages(messages: PodMessage[], limit = 3): PodMessage[]
  ```
  `podRecentMessages` returns the last `limit` entries in the existing array order (the Pod store already supplies newest-last messages).
- Produces `ProjectResourcesProps` additions:
  ```ts
  attention: number
  onOpenWork: () => void
  ```
- Reuses the existing `messages: PodMessage[]` prop for the recent-message preview.

- [ ] **Step 1: Write the failing model and source tests**

In `pod-rail-face-model.test.ts`:

```ts
assert.deepEqual(podAttentionRow(0), { label: "需要你", visible: false })
assert.deepEqual(podAttentionRow(2), { label: "需要你 2", visible: true })
assert.equal(podRecentMessages(longFixture, 3).length, 3)
```

In `project-resources-work.test.ts`, assert:
- `ProjectResources` renders the attention row only through `visible`
- clicking it calls `props.onOpenWork`
- it renders at most three recent messages
- it no longer renders the `mafw-resources-goal` active-Goal shortcut
- `MafwShell` passes `attention` and `onOpenWork`; recent messages already arrive through the existing `messages` prop

- [ ] **Step 2: Run focused tests to verify they fail**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-rail-face-model.test.ts tests/project-resources-work.test.ts
```

Expected: FAIL on missing model helpers and props.

- [ ] **Step 3: Implement the left-face changes**

In `pod-rail-face-model.ts`, add the two pure helpers. Keep them independent of Pod store internals.

In `ProjectResources.tsx`:
- Add an attention row above 团队与设置, visible only when `attention > 0`.
- Bind it to `props.onOpenWork`.
- Add a compact `最近消息` section using `podRecentMessages(props.messages, 3)`, with unread accent; clicking a message opens the existing team/inbox panel via `onOpenPanel("team", "inbox")`.
- Remove the active-Goal shortcut row; the right `工作` face is the only Goal list entry.
- Keep team, mailbox, Pod memory, and notes rows.

In `MafwShell.tsx`, pass:
- `attention={podBadgeCount()}`
- `onOpenWork={openProjectWork}`

Recent messages continue to flow through the existing `messages` prop already consumed by `ProjectResources`.

- [ ] **Step 4: Run focused tests to verify they pass**

```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-rail-face-model.test.ts tests/project-resources-work.test.ts tests/icon-rail-pod-wiring.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ProjectResources.tsx packages/desktop/src/renderer/mafw/pod-rail-face-model.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/pod-rail-face-model.test.ts packages/desktop/tests/project-resources-work.test.ts
git commit -m "feat(desktop): surface pod attention and recent messages in the left rail"
```

---

### Task 10: Full verification, GUI smoke, and delivery record

**Files:**
- Modify: `AGENTS.md`
- Test: full desktop suite and build gates

**Interfaces:**
- Consumes all Tasks 1–9.
- Produces a delivery record with commit hash, new test count, and full pass count.

- [ ] **Step 1: Run the full desktop suite**

From `packages/desktop`:

```bash
npm test
```

Expected: all tests pass. Record exact pass/fail counts.

- [ ] **Step 2: Run typecheck and build**

```bash
npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
```

Expected: both exit 0.

- [ ] **Step 3: Run the real GUI smoke**

Start the repo gateway and desktop dev app, then verify:

1. 1600 window: chat actual width 760, right `工作` visible, no left-dock push.
2. 1366 window: chat automatically ≈600, right workbench ≈720, no horizontal overflow.
3. 1088 window: hard-min fallback remains usable; right workbench ≈720.
4. 1800 window with left dock open: dock pushes, chat remains 760, workbench ≈730.
5. Memory / Approvals / Triage / Automation routes keep the right dock visible.
6. Config hides the dock visually, but reopening restores the previous L1/L2 state.
7. Focus (`Ctrl+Shift+M`) makes the workbench full-width; exit restores chat detent and surface; reload/project switch clears Focus.
8. `新建 Goal` opens the composer inside right `工作`; creating or canceling does not create a Pod unless submission is explicit.
9. Legacy `workspace` / `goals` deep link lands on chat + right `工作`.
10. Left Pod attention >0 opens right `工作`; attention 0 renders no empty block.
11. Chat reading text and composer compute to 16px; Config/navigation/tool metadata remain unchanged.
12. Existing stored detent 640 survives reload; clearing the key yields 760.

Use screenshots for at least 1088 / 1366 / 1600 / 1800 and attach paths in the delivery record.

- [ ] **Step 4: Fix any regressions found by the gates**

If a gate fails, fix it in the owning task's files and rerun the focused test plus the full suite. Do not weaken a test to make a gate pass.

- [ ] **Step 5: Record delivery in `AGENTS.md`**

Add a dated bullet under the Desktop section with:
- feature summary
- commit hash
- new test count
- full desktop pass count
- `tsgo` and `electron-vite build` rc values
- GUI smoke evidence paths
- known boundaries (manual hide preserved; Focus transient; no push/deploy/release)

- [ ] **Step 6: Commit the delivery record**

```bash
git add AGENTS.md
git commit -m "docs: record right-primary agent workbench delivery"
```

---

## Post-plan notes for executors

- If implementation reveals a spec contradiction, stop that task, update the spec first, and then continue. Do not silently diverge.
- `applyWorkbenchSurface` must keep forcing view `workbench`; this is the plugin-surface safety invariant.
- Do not add a per-project workbench-view key in this batch.
- Do not change `--msg-col-width`, `.mafw-session-turn-container` padding, or the global UI base font.
- The old `pod` execution section may remain as a hidden compatibility resource; do not expose it as a fifth L1 tab.
