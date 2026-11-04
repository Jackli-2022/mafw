# Right-Primary Deferred Minors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix the nine deferred minors from the right-primary Agent workbench final review.

**Architecture:** Reuse the existing pure Pod/workbench models instead of adding parallel logic, gate `ProjectWorkView` by actual pane activity, snapshot and restore Focus state through a small pure module, tighten error/copy contracts, restore the visual-contract pins, and remove mojibake comments without changing styles.

**Tech Stack:** Electron + SolidJS renderer, node:test with `@mafw/test-shim`, existing `@mafw/sdk` types.

**Spec:** `docs/superpowers/specs/2026-11-04-agent-workbench-right-primary-design.md`

## Global Constraints

- Desktop renderer only; do not modify gateway, SDK, runtime contracts, or harmonic memory.
- Keep right-workbench Focus transient and non-persisted.
- Do not weaken existing tests to make new behavior pass.
- Preserve the main-process `Ctrl+Shift+M` Quick Entry accelerator; Focus remains `Ctrl+Alt+F`.
- All new behavior changes are test-first.
- No push, deploy, or release.

## Review Focus

- **Unread semantics:** own outbound Pod messages must not show the unread accent.
- **Inactive pane:** `ProjectWorkView` must not poll while the `工作` pane is inactive.
- **Composer remount:** closing and reopening the dock after canceling a composer request must not reopen the composer.
- **Focus restore:** exiting Focus must restore the detent/L1/L2 state captured on entry, even if the user navigated while focused.
- **Encoding:** `mafw.css` must contain no U+FFFD replacement characters.

---

### Task 1: Unify Pod recent-message projection

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pod-rail-face-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectResources.tsx`
- Test: `packages/desktop/src/renderer/mafw/pod-rail-face-model.test.ts`
- Test: `packages/desktop/tests/project-resources-work.test.ts`

**Interfaces:**
- Consumes existing `buildRecentMessages(detail, messages, selfMemberId, nowMs, limit)`.
- Removes `podRecentMessages` and its duplicate projection.

- [x] **Step 1: Write failing source/model contracts**
  - In `project-resources-work.test.ts`, require `buildRecentMessages(props.detail, props.messages, props.selfMemberId, Date.now(), 3)` and forbid `podRecentMessages` and `message.readAt === null`.
  - In `pod-rail-face-model.test.ts`, remove the `podRecentMessages` test and keep an assertion that `buildRecentMessages` marks own outbound messages as read.

- [x] **Step 2: Run focused tests to verify failure**
  - `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-rail-face-model.test.ts tests/project-resources-work.test.ts`

- [x] **Step 3: Implement**
  - Replace the ad hoc mapping in `ProjectResources` with `buildRecentMessages`.
  - Render `route`, `preview`, `time`, and `unread` from that model.
  - Delete `podRecentMessages` from the model.

- [x] **Step 4: Verify and commit**
  - Rerun focused tests, then commit `fix(desktop): reuse the pod recent-message projection`.

---

### Task 2: Gate ProjectWorkView activity and consume composer requests

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/tests/project-work-view.test.ts`

**Interfaces:**
- Adds `ProjectWorkViewProps.active: boolean`.
- Adds module-level consumed-request tracking so remounts do not replay an old request.

- [x] **Step 1: Write failing source contracts**
  - Require `active: boolean`.
  - Require the polling effect to return early when `!props.active`.
  - Require `lastConsumedComposerRequest` and only open the composer when the request number increases.

- [x] **Step 2: Run focused test to verify failure**
  - `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/project-work-view.test.ts`

- [x] **Step 3: Implement**
  - Gate initial load, refresh tick, and 15s interval on `props.active`.
  - Track the consumed composer request sequence in a module variable.
  - Pass `active={dockPresent() && workbenchView() === "work"}` from `MafwShell`.

- [x] **Step 4: Verify and commit**
  - Rerun focused test, then commit `fix(desktop): gate project work polling and composer requests`.

---

### Task 3: Snapshot Focus state and hide the resize handle

**Files:**
- Create: `packages/desktop/src/renderer/mafw/workbench-focus.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: Create `packages/desktop/src/renderer/mafw/workbench-focus.test.ts`
- Test: `packages/desktop/tests/design-contract.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type WorkbenchFocusSnapshot = {
    detent: WorkbenchDetent
    view: WorkbenchView
    surface: WorkbenchSurface
    executionSection: ExecutionSection
  }
  export function captureWorkbenchFocusSnapshot(current: WorkbenchFocusSnapshot): WorkbenchFocusSnapshot
  export function restoreWorkbenchFocusSnapshot(
    snapshot: WorkbenchFocusSnapshot | null,
    fallback: WorkbenchFocusSnapshot,
  ): WorkbenchFocusSnapshot
  ```

- [x] **Step 1: Write failing pure and source tests**
  - Pure test: capture copies all four fields; restore returns the snapshot when present and fallback when null.
  - Source test: `MafwShell` captures on entry, restores on exit, and gates the resize wrapper with Focus-active state.

- [x] **Step 2: Run focused tests to verify failure**
  - `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-focus.test.ts tests/design-contract.test.ts`

- [x] **Step 3: Implement**
  - Add the pure snapshot module.
  - In `MafwShell`, capture the current detent/view/surface/section before entering Focus and restore them on exit.
  - Define one `focusActive()` helper and use it for both body columns and the resize wrapper.

- [x] **Step 4: Verify and commit**
  - Rerun focused tests, then commit `fix(desktop): snapshot workbench focus state`.

---

### Task 4: Tighten errors, copy, and visual contracts

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectResources.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Test: `packages/desktop/tests/project-work-view.test.ts`
- Test: `packages/desktop/tests/project-resources-work.test.ts`
- Test: Create `packages/desktop/tests/right-primary-visual-contract.test.ts`

**Interfaces:**
- `friendlyWorkError` maps only explicit no-Pod errors.
- User-facing copy says work is in the right workbench, not the retired workspace.
- Restored visual pins cover WorkOverview, ProjectResources, GoalDetail, and their CSS.

- [x] **Step 1: Write failing contracts**
  - Forbid generic `/404/` mapping in `friendlyWorkError`.
  - Require the right-workbench copy in ProjectResources and the `/goals` command.
  - Pin status dots, group counts, chips, avatars, chevrons, Goal header/chips, and their CSS classes.

- [x] **Step 2: Run focused tests to verify failure**
  - `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/project-work-view.test.ts tests/project-resources-work.test.ts tests/right-primary-visual-contract.test.ts`

- [x] **Step 3: Implement**
  - Match only `pod not found` / `没有鲸群` / `no pod`.
  - Update stale copy.
  - Add the visual-contract assertions.

- [x] **Step 4: Verify and commit**
  - Rerun focused tests, then commit `fix(desktop): tighten right-workbench copy and visual contracts`.

---

### Task 5: Clean CSS encoding and verify

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: Create `packages/desktop/src/renderer/mafw/css-encoding.test.ts`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces a CSS file with no U+FFFD replacement characters.
- Produces a delivery addendum in `AGENTS.md` §5.27.

- [x] **Step 1: Write failing encoding test**
  - Assert `mafw.css` does not contain `\uFFFD`.

- [x] **Step 2: Run test to verify failure**
  - `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/css-encoding.test.ts`

- [x] **Step 3: Rewrite affected comments only**
  - Replace mojibake comment blocks with readable UTF-8 comments.
  - Do not change selectors or declarations.

- [x] **Step 4: Full verification**
  - `npm test`
  - `npx tsgo --noEmit -p tsconfig.json`
  - `npx electron-vite build`

- [x] **Step 5: Record delivery and commit**
  - Add the minor-fix addendum to `AGENTS.md`.
  - Commit `fix(desktop): clean right-primary css comments` plus the docs record.
