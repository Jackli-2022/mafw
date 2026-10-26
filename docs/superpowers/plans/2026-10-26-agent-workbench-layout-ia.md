# Agent Workbench Layout IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the desktop right dock as a B/B1 agent workbench and make the left rail, ChatView, and right workbench share space predictably at every supported window width.

**Architecture:** Replace the 44px `SessionRail` + floating panels with a two-level right workbench: L1 `工作台 / 执行 / 审阅`, with `工作台` L2 `代码 / 浏览器`, `执行` L2 a fixed dropdown of five run-scoped sections, and a persistent terminal at the bottom. Drive the left dock mode by window width, raise the minimum window to 1088×720, and keep ChatView as a readable fixed-width column while the right workbench takes the remaining width.

**Tech Stack:** Electron 42, SolidJS, TypeScript, `@mafw/ui/v2`, Node test runner + `@mafw/test-shim`, `tsgo`, `electron-vite`.

**Spec:** `docs/superpowers/specs/2026-10-26-agent-workbench-layout-ia-design.md`

## Global Constraints

- Repo: work in `C:\work\work-loop\opencode-plugin-mafw`; do not touch unrelated uncommitted gateway/parallel-work files.
- This plan is **desktop-only**. No gateway/SDK/protocol/terminal-bridge/browser-session changes.
- B/B1 is fixed: L1 `工作台 / 执行 / 审阅`; L2 `代码 / 浏览器` and the execution dropdown `概览 / 待办 / 子代理 / 后台 / 轨迹`; **do not add responsive tabs or two-row execution navigation**.
- Remove the 44px `SessionRail` and its 420px floating panel entirely; do not leave a second icon rail.
- Keep `TerminalDock` mounted at the right-workbench bottom across every L1/L2 switch; collapse must not destroy xterm or scrollback.
- Keep ChatView detents **520 / 640 / 760**, default **640**; right workbench minimum **520**.
- Window minimum **1088×720**; default target **1600×1000**, adapted to the primary display work area.
- Left dock push threshold **1366 CSS px**; below it, left dock is an overlay. Never use `winMaximized` to decide left dock mode.
- Remove the automatic right-dock overlay at `<1200`; only the explicit right-dock toggle hides it.
- `便签` lives in the left dock `notes` face, reached from a left-rail bottom button. `用量` lives in `执行 › 概览`, not in navigation.
- No `执行` numeric badge in this batch: do not substitute global approval counts for per-session attention; overview may show known running/input-required state only.
- No new gateway queries, no fake global background queue, no fake running states.
- Use `ButtonV2`, `TooltipV2`, `DropdownMenu`, `Icon` and existing theme/motion tokens; no raw `<button>`/`<input>`; no emoji in workbench chrome.
- TDD: each task starts with a failing test, then implementation, targeted verification, and one commit. Do not batch commits across tasks.
- Existing behavior that must survive: per-turn diff, terminal persistence/directory scope, browser hardening, G1/G2 annotation pipeline, checkpoint overlay, task popover.

### Review Focus

These are the highest-risk inputs/conditions implied by the spec that no single component test fully covers; each has an owning test in the task noted.

1. **Exact width boundaries** (1088, 1365/1366) with a stored-open left dock must not cover or crush the core pair — Task 2/3 tests pin the pure decisions, Task 9 GUI smoke pins the rendered result.
2. **View switching must not unmount the terminal** — Task 5 test pins terminal placement; Task 9 smoke checks shell/scrollback.
3. **Legacy localStorage** (`mafw-right-dock-tab`, `mafw-workbench-tab`) must map to the correct B1 view rather than silently falling back — Task 1 tests every legacy value.
4. **Session switch atomicity** must not leave execution/terminal content from the previous session — Task 7 wiring test plus Task 9 two-session smoke.
5. **520px right workbench overflow** must not squeeze the editor or file tree; file tree becomes a drawer — Task 5/Task 8 tests and Task 9 narrow smoke.
6. **No right-dock auto overlay** must remain removed after cleanup — Task 8 tests assert no `mafw-dock-slot.overlay` path.

---

## File Map

**Create**

- `packages/desktop/src/renderer/mafw/workbench-views.ts` — B1 view/section state, defaults, legacy mapping, labels.
- `packages/desktop/src/renderer/mafw/workbench-views.test.ts`
- `packages/desktop/src/renderer/mafw/execution-summary.ts` — pure counts for execution overview.
- `packages/desktop/src/renderer/mafw/execution-summary.test.ts`
- `packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx` — files + editor/browser content, file-tree drawer state.
- `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx` — L1/L2 chrome, content routing, persistent terminal.
- `packages/desktop/src/renderer/mafw/components/ExecutionView.tsx` — overview + five execution sections.
- `packages/desktop/tests/workbench-shell-wiring.test.ts`
- `packages/desktop/tests/execution-view-wiring.test.ts`
- `packages/desktop/tests/right-workbench-integration.test.ts`
- `packages/desktop/tests/left-dock-width-wiring.test.ts`

**Modify**

- `packages/desktop/src/renderer/mafw/left-dock.ts` — width mode, notes face, startup restore.
- `packages/desktop/src/renderer/mafw/left-dock.test.ts`
- `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- `packages/desktop/src/renderer/mafw/components/LeftDock.tsx`
- `packages/desktop/src/renderer/mafw/components/IconRail.tsx`
- `packages/desktop/src/renderer/mafw/components/ChatPane.tsx` — remove `tasksPlacement` prop; TaskBar open uses `taskListOpen`.
- `packages/desktop/src/renderer/mafw/mafw.css`
- `packages/desktop/src/main/window-bounds.ts`
- `packages/desktop/src/main/window-bounds.test.ts`
- `packages/desktop/src/main/windows.ts`
- `packages/desktop/tests/design-contract.test.ts`
- `packages/desktop/tests/body-grid-columns-css.test.ts`
- `packages/desktop/tests/workbench-layout-css.test.ts`

**Delete**

- `packages/desktop/src/renderer/mafw/components/SessionRail.tsx`
- `packages/desktop/src/renderer/mafw/components/session-rail-model.ts`
- `packages/desktop/src/renderer/mafw/components/dock-tab.ts`
- `packages/desktop/src/renderer/mafw/components/Workbench.tsx`
- `packages/desktop/tests/dock-tab.test.ts`
- `packages/desktop/src/renderer/mafw/layout-breakpoints.ts`
- `packages/desktop/src/renderer/mafw/layout-breakpoints.test.ts`

---

### Task 1: Right-workbench view state and legacy migration

**Files:**
- Create: `packages/desktop/src/renderer/mafw/workbench-views.ts`
- Test: `packages/desktop/src/renderer/mafw/workbench-views.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type WorkbenchView = "workbench" | "execution" | "review"
  export type WorkbenchSurface = "code" | "browser"
  export type ExecutionSection = "overview" | "todos" | "subagents" | "background" | "trajectory"
  export type WorkbenchState = {
    view: WorkbenchView
    surface: WorkbenchSurface
    executionSection: ExecutionSection
  }
  export const DEFAULT_WORKBENCH_STATE: WorkbenchState
  export const WORKBENCH_VIEWS: readonly { id: WorkbenchView; label: string }[]
  export const WORKBENCH_SURFACES: readonly { id: WorkbenchSurface; label: string }[]
  export const EXECUTION_SECTIONS: readonly { id: ExecutionSection; label: string }[]
  export function normalizeWorkbenchView(v: string | null | undefined): WorkbenchView
  export function normalizeWorkbenchSurface(v: string | null | undefined): WorkbenchSurface
  export function normalizeExecutionSection(v: string | null | undefined): ExecutionSection
  export function executionSectionLabel(section: ExecutionSection): string
  export function workbenchStateFromStorage(read: (key: string) => string | null): WorkbenchState
  ```

- [ ] **Step 1: Write the failing state tests**

Add `workbench-views.test.ts` with these cases:

```ts
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_WORKBENCH_STATE, EXECUTION_SECTIONS,
  executionSectionLabel, normalizeExecutionSection,
  normalizeWorkbenchSurface, normalizeWorkbenchView,
  workbenchStateFromStorage,
} from "./workbench-views"

describe("workbench-views", () => {
  test("defaults and invalid values normalize to workbench/code/overview", () => {
    assert.deepEqual(DEFAULT_WORKBENCH_STATE, {
      view: "workbench", surface: "code", executionSection: "overview",
    })
    assert.equal(normalizeWorkbenchView("bogus"), "workbench")
    assert.equal(normalizeWorkbenchSurface("bogus"), "code")
    assert.equal(normalizeExecutionSection("bogus"), "overview")
  })

  test("B1 execution labels are exact and ordered", () => {
    assert.deepEqual(EXECUTION_SECTIONS.map((s) => s.label), ["概览", "待办", "子代理", "后台", "轨迹"])
    assert.equal(executionSectionLabel("background"), "后台")
  })

  test("legacy right-dock tabs map to B1 state", () => {
    const cases: Array<[string, string, string]> = [
      ["tasks", "execution", "todos"],
      ["trajectory", "execution", "trajectory"],
      ["subagents", "execution", "subagents"],
      ["background", "execution", "background"],
      ["changes", "review", "overview"],
      ["usage", "execution", "overview"],
      ["notes", "workbench", "overview"],
    ]
    for (const [legacy, view, executionSection] of cases) {
      const state = workbenchStateFromStorage((key) =>
        key === "mafw-right-dock-tab" ? legacy : null,
      )
      assert.equal(state.view, view, legacy)
      assert.equal(state.executionSection, executionSection, legacy)
    }
  })

  test("legacy editor/browser workbench tab maps to surface; new keys win", () => {
    const legacy = workbenchStateFromStorage((key) =>
      key === "mafw-workbench-tab" ? "browser" : null,
    )
    assert.equal(legacy.surface, "browser")
    const fresh = workbenchStateFromStorage((key) => {
      if (key === "mafw-workbench-view") return "review"
      if (key === "mafw-workbench-surface") return "code"
      if (key === "mafw-execution-section") return "subagents"
      if (key === "mafw-right-dock-tab") return "tasks"
      return null
    })
    assert.deepEqual(fresh, { view: "review", surface: "code", executionSection: "subagents" })
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `packages/desktop`:

```powershell
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/workbench-views.test.ts
```

Expected: FAIL because `workbench-views.ts` does not exist.

- [ ] **Step 3: Implement `workbench-views.ts`**

Use exact keys:

- `mafw-workbench-view`
- `mafw-workbench-surface`
- `mafw-execution-section`
- legacy `mafw-right-dock-tab`
- legacy `mafw-workbench-tab`

Precedence: new keys first; if no new keys, map the legacy tab; otherwise defaults. A legacy `notes` maps to default `workbench/code/overview` because notes moved left; do not create a notes view. Keep `surface` independent from `executionSection`. Do not remove storage keys in this module.

- [ ] **Step 4: Run the test and verify it passes**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/desktop/src/renderer/mafw/workbench-views.ts packages/desktop/src/renderer/mafw/workbench-views.test.ts
git commit -m "feat(desktop): add B1 workbench view state"
```

---

### Task 2: Width-driven left dock

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/left-dock.ts`
- Modify: `packages/desktop/src/renderer/mafw/left-dock.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/tests/left-dock-width-wiring.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const LEFT_DOCK_PUSH_MIN_WIDTH = 1366
  export function resolveMode(open: boolean, width: number): LeftDockMode
  export function restoreLeftDockOpen(stored: string | null, width: number): boolean
  ```

- [ ] **Step 1: Write the failing pure tests**

Update `left-dock.test.ts`:

```ts
test("resolveMode is width-driven, not maximized", () => {
  assert.equal(resolveMode(true, 1366), "push")
  assert.equal(resolveMode(true, 1365), "overlay")
  assert.equal(resolveMode(false, 1600), "closed")
})

test("stored open is not restored as overlay on launch", () => {
  assert.equal(restoreLeftDockOpen("1", 1088), false)
  assert.equal(restoreLeftDockOpen("1", 1365), false)
  assert.equal(restoreLeftDockOpen("1", 1366), true)
  assert.equal(restoreLeftDockOpen("0", 1600), false)
  assert.equal(restoreLeftDockOpen("bogus", 1600), false)
})
```

- [ ] **Step 2: Run tests and verify they fail**

```powershell
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/left-dock.test.ts
```

Expected: FAIL (new constant/functions/signature).

- [ ] **Step 3: Update `left-dock.ts`**

Replace `resolveMode(open, maximized)` with:

```ts
export function resolveMode(open: boolean, width: number): LeftDockMode {
  if (!open) return "closed"
  return width >= LEFT_DOCK_PUSH_MIN_WIDTH ? "push" : "overlay"
}

export function restoreLeftDockOpen(stored: string | null, width: number): boolean {
  return stored === "1" && width >= LEFT_DOCK_PUSH_MIN_WIDTH
}
```

Keep `clampLeftDockWidth` and width bounds unchanged.

- [ ] **Step 4: Wire width tracking in `MafwShell.tsx`**

- Add `const [viewportWidth, setViewportWidth] = createSignal(window.innerWidth)`.
- Initialize `leftDock.open` with `restoreLeftDockOpen(localStorage.getItem("mafw-left-dock-open"), window.innerWidth)`.
- Change `leftDockMode` to `resolveMode(leftDock().open, viewportWidth())`.
- In the existing resize effect, update both `setViewportWidth(window.innerWidth)` and the existing `setViewportNarrow(...)`.
- Leave `winMaximized` for the shell class/window controls; do not use it in `leftDockMode`.
- Do not auto-close an open dock when crossing below 1366; it becomes overlay.

Add `left-dock-width-wiring.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("MafwShell uses width for left dock mode", () => {
  const src = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(src, /resolveMode\(leftDock\(\)\.open,\s*viewportWidth\(\)\)/)
  assert.doesNotMatch(src, /resolveMode\(leftDock\(\)\.open,\s*winMaximized\(\)\)/)
  assert.match(src, /restoreLeftDockOpen\(/)
})
```

- [ ] **Step 5: Run tests and verify they pass**

Run both the pure test and the wiring test. Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add packages/desktop/src/renderer/mafw/left-dock.ts packages/desktop/src/renderer/mafw/left-dock.test.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/left-dock-width-wiring.test.ts
git commit -m "feat(desktop): make left dock width-driven"
```

---

### Task 3: Window minimum and adaptive default size

**Files:**
- Modify: `packages/desktop/src/main/window-bounds.ts`
- Modify: `packages/desktop/src/main/window-bounds.test.ts`
- Modify: `packages/desktop/src/main/windows.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MAIN_WINDOW_MIN_WIDTH = 1088
  export const MAIN_WINDOW_MIN_HEIGHT = 720
  export const MAIN_WINDOW_DEFAULT_WIDTH = 1600
  export const MAIN_WINDOW_DEFAULT_HEIGHT = 1000
  export const MAIN_WINDOW_WORKAREA_MARGIN = 80
  export function fitDefaultWindowSize(workArea: { width: number; height: number }): { width: number; height: number }
  ```

- [ ] **Step 1: Write the failing tests**

Update `window-bounds.test.ts`:

```ts
test("minimum window guarantees 46 + 520 + 520", () => {
  assert.equal(MAIN_WINDOW_MIN_WIDTH, 1088)
  assert.equal(MAIN_WINDOW_MIN_HEIGHT, 720)
  const opts = mainWindowOptions({ width: 400, height: 300 })
  assert.equal(opts.minWidth, 1088)
  assert.equal(opts.minHeight, 720)
  assert.equal(opts.width, 1088)
  assert.equal(opts.height, 720)
})

test("default window targets 1600x1000 but respects work area", () => {
  assert.deepEqual(fitDefaultWindowSize({ width: 3000, height: 2000 }), { width: 1600, height: 1000 })
  assert.deepEqual(fitDefaultWindowSize({ width: 1920, height: 1040 }), { width: 1600, height: 960 })
  assert.deepEqual(fitDefaultWindowSize({ width: 1366, height: 728 }), { width: 1286, height: 720 })
  assert.deepEqual(fitDefaultWindowSize({ width: 1024, height: 600 }), { width: 1088, height: 720 })
})
```

- [ ] **Step 2: Run test and verify it fails**

```powershell
node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/window-bounds.test.ts
```

- [ ] **Step 3: Implement constants and `fitDefaultWindowSize`**

```ts
export function fitDefaultWindowSize(workArea: { width: number; height: number }) {
  return {
    width: Math.max(MAIN_WINDOW_MIN_WIDTH, Math.min(MAIN_WINDOW_DEFAULT_WIDTH, workArea.width - MAIN_WINDOW_WORKAREA_MARGIN)),
    height: Math.max(MAIN_WINDOW_MIN_HEIGHT, Math.min(MAIN_WINDOW_DEFAULT_HEIGHT, workArea.height - MAIN_WINDOW_WORKAREA_MARGIN)),
  }
}
```

- [ ] **Step 4: Use it in `windows.ts`**

- Import `screen` from Electron.
- Import `fitDefaultWindowSize`, `MAIN_WINDOW_DEFAULT_*`, and min constants from `window-bounds`.
- In `createMainWindow`, compute `const preferred = fitDefaultWindowSize(screen.getPrimaryDisplay().workAreaSize)` and pass `defaultWidth: preferred.width, defaultHeight: preferred.height` to `windowState`.
- Do not override an existing valid saved size; `mainWindowOptions` still clamps restored sizes.

- [ ] **Step 5: Run tests and typecheck**

```powershell
node --import tsx --import ../../packages/test-shim/register.mjs --test src/main/window-bounds.test.ts
npx tsgo -b
```

Expected: PASS and exit 0.

- [ ] **Step 6: Commit**

```powershell
git add packages/desktop/src/main/window-bounds.ts packages/desktop/src/main/window-bounds.test.ts packages/desktop/src/main/windows.ts
git commit -m "feat(desktop): raise workbench window minimum"
```

---

### Task 4: Notes on the left, new-session entry cleanup

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/left-dock.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/IconRail.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/LeftDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/tests/left-dock-notes-wiring.test.ts`

**Interfaces:**
- `LeftDockFace = "sessions" | "search" | "notes"`
- `LeftDock` gains `onNewSession: () => void`.
- `IconRail` loses `onNewSession` and the top `new` item; gains bottom `notes` item calling `onToggleFace("notes")`.

- [ ] **Step 1: Write failing source-contract test**

```ts
test("notes opens as a left-dock face, not a right rail", () => {
  const rail = read("src/renderer/mafw/components/IconRail.tsx")
  const left = read("src/renderer/mafw/components/LeftDock.tsx")
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(rail, /"notes"/)
  assert.match(rail, /label:\s*"工作"/)
  assert.doesNotMatch(rail, /key:\s*"new"/)
  assert.match(left, /NotesDock/)
  assert.match(left, /face === "notes"/)
  assert.match(left, /onNewSession/)
  assert.match(shell, /onNewSession=\{/)
})
```

- [ ] **Step 2: Run and verify it fails**

```powershell
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/left-dock-notes-wiring.test.ts
```

- [ ] **Step 3: Implement**

- Extend `LeftDockFace` with `"notes"`.
- `IconRail`: rename the top session item label to `工作`; remove the top `new` item and its `onNewSession` prop; add a bottom item `notes` with `pencil-line`, label `便签`, active when `props.face === "notes"`.
- `LeftDock`: add `onNewSession` prop; add a small plus `ButtonV2` in the head (aria-label `新建会话`). Wrap current sessions/search UI in a `face !== "notes"` branch and add `<Show when={props.face === "notes"}><div class="mafw-left-dock-notes"><NotesDock /></div></Show>`.
- `MafwShell`: pass `onNewSession` to `LeftDock`; remove it from `IconRail`.
- CSS: `.mafw-left-dock-notes { flex: 1; min-height: 0; overflow-y: auto; }`.

- [ ] **Step 4: Run tests and typecheck**

```powershell
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/left-dock-notes-wiring.test.ts
npx tsgo -b
```

- [ ] **Step 5: Commit**

```powershell
git add packages/desktop/src/renderer/mafw/left-dock.ts packages/desktop/src/renderer/mafw/components/IconRail.tsx packages/desktop/src/renderer/mafw/components/LeftDock.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/left-dock-notes-wiring.test.ts
git commit -m "feat(desktop): move notes into the left dock"
```

---

### Task 5: Workbench shell and code/browser content

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx`
- Create: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Test: `packages/desktop/tests/workbench-shell-wiring.test.ts`

**Interfaces:**
- `WorkbenchCodeView` props:
  ```ts
  {
    surface: WorkbenchSurface
    sessionID: string | null
    sessionDirectory: string | null
    diffs: FileDiffEntry[]
    onOpenFile: (rel: string) => void
    onSendAnnotation?: (text: string) => void
    onAddAnnotation?: (a: { rel: string; startLine: number; endLine: number; code: string; comment: string }) => void
    onSendComment?: (sid: string, text: string) => void
  }
  ```
- `WorkbenchShell` props:
  ```ts
  {
    open: boolean
    view: WorkbenchView
    surface: WorkbenchSurface
    executionSection: ExecutionSection
    onView: (view: WorkbenchView) => void
    onSurface: (surface: WorkbenchSurface) => void
    onExecutionSection: (section: ExecutionSection) => void
    sessionID: string | null
    sessionDirectory: string | null
    diffs: FileDiffEntry[]
    terminalOpen: boolean
    onToggleTerminal: () => void
    onOpenFile: (rel: string) => void
    onSendAnnotation?: (text: string) => void
    onAddAnnotation?: (...) => void
    onSendComment?: (sid: string, text: string) => void
    executionView: JSX.Element
    reviewView: JSX.Element
  }
  ```
- `WorkbenchShell` class contract: `.mafw-rw-shell`, `.mafw-rw-l1`, `.mafw-rw-tab`, `.mafw-rw-l2`, `.mafw-rw-l2-tab`, `.mafw-rw-exec-trigger`, `.mafw-rw-content`, `.mafw-rw-pane`, `.mafw-rw-terminal`.
- `WorkbenchCodeView` class contract: `.mafw-rw-code`, `.mafw-rw-files`, `.mafw-rw-code-main`, `.mafw-rw-files-toggle`, `files-open`.

- [ ] **Step 1: Write the failing source-contract test**

```ts
test("right workbench owns L1/L2 and a persistent terminal", () => {
  const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  const code = read("src/renderer/mafw/components/WorkbenchCodeView.tsx")
  assert.match(shell, /WORKBENCH_VIEWS/)
  assert.match(shell, /EXECUTION_SECTIONS/)
  assert.match(shell, /DropdownMenu/)
  assert.match(shell, /TerminalDock/)
  assert.match(shell, /executionView/)
  assert.match(shell, /reviewView/)
  assert.match(shell, /role="tablist"/)
  assert.match(shell, /role="tab"/)
  assert.match(code, /FilesDock/)
  assert.match(code, /EditorDock/)
  assert.match(code, /BrowserDock/)
  assert.doesNotMatch(shell, /SessionRail/)
})
```

- [ ] **Step 2: Run and verify it fails**

```powershell
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/workbench-shell-wiring.test.ts
```

- [ ] **Step 3: Implement `WorkbenchCodeView.tsx`**

- Move the files/editor/browser body from `Workbench.tsx` without the old top tabs or terminal.
- Render `FilesDock` only in `surface === "code"`.
- Keep editor and browser mounted using `display: none`/`contents` so their state survives surface switches.
- Add a `filesOpen` signal, a `ButtonV2` with class `mafw-rw-files-toggle`, `aria-expanded={filesOpen()}`, and `classList={{ "files-open": filesOpen() }}` on `.mafw-rw-code`.
- File tree toggle is visible only under the 600px container query (CSS in Task 8).

- [ ] **Step 4: Implement `WorkbenchShell.tsx`**

- Render L1 from `WORKBENCH_VIEWS`, with exact labels `工作台 / 执行 / 审阅`; use `role="tablist"`, each button `role="tab"` and `aria-selected`.
- L2:
  - `workbench`: `代码 / 浏览器` from `WORKBENCH_SURFACES`.
  - `execution`: `DropdownMenu` trigger showing current label from `executionSectionLabel(section)` plus chevron; menu items from `EXECUTION_SECTIONS`; selecting calls `onExecutionSection`.
  - `review`: no L2 row.
- Render three content panes always mounted, hidden with `.is-active`:
  - workbench → `WorkbenchCodeView`
  - execution → `props.executionView`
  - review → `props.reviewView`
- Render `TerminalDock` outside the panes at `.mafw-rw-terminal`, with `active={props.open && props.terminalOpen}`; wrap in `.is-collapsed` when closed.
- Terminal toggle sits at L1 right with `Icon name="terminal"` and aria-pressed.
- No `SessionRail` import/reference.

- [ ] **Step 5: Run test and typecheck**

```powershell
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/workbench-shell-wiring.test.ts
npx tsgo -b
```

- [ ] **Step 6: Commit**

```powershell
git add packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/tests/workbench-shell-wiring.test.ts
git commit -m "feat(desktop): add B1 workbench shell"
```

---

### Task 6: Execution overview and five sections

**Files:**
- Create: `packages/desktop/src/renderer/mafw/execution-summary.ts`
- Create: `packages/desktop/src/renderer/mafw/execution-summary.test.ts`
- Create: `packages/desktop/src/renderer/mafw/components/ExecutionView.tsx`
- Test: `packages/desktop/tests/execution-view-wiring.test.ts`

**Interfaces:**
- `execution-summary.ts`:
  ```ts
  export type ExecutionSummary = {
    subagentRunning: number; subagentTotal: number;
    backgroundRunning: number; backgroundTotal: number;
    todoDone: number; todoTotal: number; waitingForInput: number;
  }
  export function summarizeExecution(input: {
    subagents: Array<{ status: string }>
    background: Array<{ status: string }>
    tasks: Array<{ status: string }>
  }): ExecutionSummary
  ```
- `ExecutionView` props:
  ```ts
  {
    section: ExecutionSection
    sessionID: string | null
    sessionDirectory: string | null
    todos: any[]
    hiddenTodos: any[]
    tokens: number
    started: number
    onClearHidden: () => void
    onClosePanel: () => void
    onOpenSubagent: (id: string) => void
    onOpenSection: (section: ExecutionSection) => void
    trajectoryLive: any[]
    trajectoryTurnLive: any | null
    usage: JSX.Element
  }
  ```

- [ ] **Step 1: Write failing summary tests**

```ts
test("summarizeExecution separates running, total, and input-required", () => {
  assert.deepEqual(summarizeExecution({
    subagents: [{ status: "running" }, { status: "running" }, { status: "completed" }],
    background: [{ status: "running" }, { status: "failed" }],
    tasks: [{ status: "completed" }, { status: "in_progress" }, { status: "input_required" }],
  }), {
    subagentRunning: 2, subagentTotal: 3,
    backgroundRunning: 1, backgroundTotal: 2,
    todoDone: 1, todoTotal: 3, waitingForInput: 1,
  })
})
```

- [ ] **Step 2: Run and verify it fails**

```powershell
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/execution-summary.test.ts
```

- [ ] **Step 3: Implement `execution-summary.ts`**

Count only the exact statuses above; no inferred blocked state.

- [ ] **Step 4: Write execution-view wiring test**

```ts
test("execution view reuses all existing panels and has no run controls", () => {
  const src = read("src/renderer/mafw/components/ExecutionView.tsx")
  assert.match(src, /TaskList/)
  assert.match(src, /SubagentDock/)
  assert.match(src, /BackgroundDock/)
  assert.match(src, /TrajectoryDock/)
  assert.match(src, /summarizeExecution/)
  assert.doesNotMatch(src, /resumeRun|suspendRun|discardRun/)
})
```

- [ ] **Step 5: Implement `ExecutionView.tsx`**

- Read `descendantRows(subagentRows(), sessionID)` and `rowsForSession(backgroundRows(), sessionID)`; filter `taskRows()` by `parentSessionID`.
- Overview: cards for subagents/background/todos using `summarizeExecution`; button rows call `onOpenSection`; a `用量与上下文` disclosure renders `props.usage` only when expanded; do not render run controls.
- Render all five sections mounted in hidden panes (`display: contents/none`) so scroll/expansion state survives:
  - `overview`
  - `todos` → `TaskList` with `placement="dock"`, `onClose={onClosePanel}`, `onPin={() => {}}`
  - `subagents` → `SubagentDock`
  - `background` → `BackgroundDock` with `sessionDirectory`
  - `trajectory` → `TrajectoryDock`
- No new gateway calls; use existing stores/props.

- [ ] **Step 6: Run tests and typecheck**

Run summary + wiring tests, expect PASS; run `npx tsgo -b`, expect 0.

- [ ] **Step 7: Commit**

```powershell
git add packages/desktop/src/renderer/mafw/execution-summary.ts packages/desktop/src/renderer/mafw/execution-summary.test.ts packages/desktop/src/renderer/mafw/components/ExecutionView.tsx packages/desktop/tests/execution-view-wiring.test.ts
git commit -m "feat(desktop): compose execution overview and sections"
```

---

### Task 7: Integrate the new right workbench and remove SessionRail

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/tests/design-contract.test.ts`
- Test: `packages/desktop/tests/right-workbench-integration.test.ts`
- Delete: `components/Workbench.tsx`, `components/SessionRail.tsx`, `components/session-rail-model.ts`, `components/dock-tab.ts`
- Delete: `tests/dock-tab.test.ts`

**Interfaces:**
- Consumes Task 1 `workbenchStateFromStorage`; Task 5 `WorkbenchShell`; Task 6 `ExecutionView`.
- MafwShell state: `workbenchView`, `workbenchSurface`, `executionSection`; no `rightDockTab`/`sessionRailOpen`.

- [ ] **Step 1: Write failing integration test**

```ts
test("MafwShell renders the B1 shell and no SessionRail", () => {
  const src = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(src, /WorkbenchShell/)
  assert.match(src, /ExecutionView/)
  assert.match(src, /workbenchStateFromStorage/)
  assert.doesNotMatch(src, /SessionRail/)
  assert.doesNotMatch(src, /rightDockTab/)
  assert.match(src, /openWorkbench\("execution",\s*"background"\)/)
  assert.match(src, /openWorkbench\("review"\)/)
})
```

- [ ] **Step 2: Run and verify it fails**

```powershell
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/right-workbench-integration.test.ts
```

- [ ] **Step 3: Replace MafwShell state and entry points**

- Remove `DockTab`, `normalizeDockTab`, `rightDockTab`, `sessionRailOpen`.
- Add:
  ```ts
  const bootView = workbenchStateFromStorage((k) => localStorage.getItem(k))
  const [workbenchView, setWorkbenchView] = createSignal(bootView.view)
  const [workbenchSurface, setWorkbenchSurface] = createSignal(bootView.surface)
  const [executionSection, setExecutionSection] = createSignal(bootView.executionSection)
  ```
  On boot, write the normalized values to the three new keys once (do not delete legacy keys in this task). Persist each under its new key on change.
- Add `openWorkbench(view, section?)` that sets the view (and section when given), opens the right dock, and persists.
- Change `applyRightDock(open)` to only open/close; remove tab handling and `mafw-right-dock-tab` writes.
- Replace `storedWbTab`/`workbenchTab` with `workbenchSurface`.
- Map:
  - `onOpenBackgroundDock={() => openWorkbench("execution", "background")}`
  - `onOpenDiffReview={() => openWorkbench("review")}`
- Update subagent/background reconciliation effects to use `workbenchView() === "execution"` + `executionSection()`.
- Keep `rightDockOpen`, `dockPresent`, `chatSplit`; remove `!viewportNarrow()` from `chatSplit`.
- Remove the `<1200` right overlay effect and the `overlay` class on `.mafw-dock-slot`; keep `viewportNarrow` temporarily for Task 8's task fallback cleanup.
- Remove `SessionRail` render and all seven panel `<div>` wrappers. Do not leave dead `mafw-right-dock-tab` reads.

- [ ] **Step 4: Render the new shell**

Replace `<Workbench .../> <SessionRail>...</SessionRail>` with:

```tsx
<WorkbenchShell
  open={dockPresent() && chatActive()}
  view={workbenchView()}
  surface={workbenchSurface()}
  executionSection={executionSection()}
  onView={...}
  onSurface={...}
  onExecutionSection={...}
  sessionID={currentSessionID() || null}
  sessionDirectory={benchRoot()}
  diffs={mergedSessionDiffs()}
  terminalOpen={workbenchTerminalOpen()}
  onToggleTerminal={toggleWorkbenchTerminal}
  onOpenFile={...}
  onSendAnnotation={...}
  onAddAnnotation={...}
  onSendComment={...}
  executionView={
    <ExecutionView
      section={executionSection()}
      sessionID={currentSessionID() || null}
      sessionDirectory={...}
      todos={todos[currentSessionID()] || []}
      hiddenTodos={hiddenTodos[currentSessionID()] || []}
      tokens={taskMetrics(currentSessionID()).tokens}
      started={taskMetrics(currentSessionID()).started}
      onClearHidden={() => clearHiddenTodos(currentSessionID())}
      onClosePanel={() => applyRightDock(false)}
      onOpenSubagent={(id) => void openSubagentSession(id)}
      onOpenSection={...}
      trajectoryLive={trajectoryLive()[currentSessionID()] || []}
      trajectoryTurnLive={trajectoryTurnLive()[currentSessionID()] || null}
      usage={<UsageDock ... />}
    />
  }
  reviewView={<ChangesDock ... />}
/>
```

Keep the existing callbacks/annotation payloads; only remount them under the new shell.

- [ ] **Step 5: Delete old files and update contracts**

- Delete `Workbench.tsx`, `SessionRail.tsx`, `session-rail-model.ts`, `dock-tab.ts`, `dock-tab.test.ts`.
- Update `design-contract.test.ts` to remove assertions on `.mafw-session-rail`, `.mafw-session-float`, old `Workbench` top tabs, and `rightDockTab`.
- Ensure no import of deleted files remains.

- [ ] **Step 6: Run integration test, typecheck, and targeted CSS contract**

```powershell
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/right-workbench-integration.test.ts
npx tsgo -b
```

Expected: PASS / 0. Full CSS verification follows in Task 8.

- [ ] **Step 7: Commit**

```powershell
git add -A packages/desktop/src/renderer/mafw packages/desktop/tests/design-contract.test.ts packages/desktop/tests/right-workbench-integration.test.ts
git commit -m "feat(desktop): replace session rail with B1 workbench"
```

Do not stage unrelated gateway/parallel-work files; use explicit paths if `git add -A` would touch them.

---

### Task 8: CSS, narrow file drawer, and legacy task-dock cleanup

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/tests/design-contract.test.ts`
- Modify: `packages/desktop/tests/body-grid-columns-css.test.ts`
- Modify: `packages/desktop/tests/workbench-layout-css.test.ts`
- Delete: `layout-breakpoints.ts`, `layout-breakpoints.test.ts`
- Test: `packages/desktop/tests/workbench-shell-css.test.ts`

**Interfaces:**
- CSS classes from Task 5; no `.mafw-session-rail`, `.mafw-session-float`, `.mafw-dock-slot.overlay`, or `.mafw-wb-*` left.
- `.mafw-rw-shell { container-type: inline-size; }`
- L1 38px / L2 32px; terminal 280px / max 45%.
- `@container (max-width: 599px)` hides `.mafw-rw-files` and shows `.mafw-rw-files-toggle`; `.files-open` reveals the drawer.

- [ ] **Step 1: Write failing CSS contract test**

```ts
test("B1 shell owns the right dock and narrow file drawer", () => {
  const css = read("src/renderer/mafw/mafw.css")
  assert.match(css, /\.mafw-rw-shell\s*\{[^}]*container-type:\s*inline-size/)
  assert.match(css, /\.mafw-rw-l1\s*\{[^}]*height:\s*38px/)
  assert.match(css, /\.mafw-rw-l2\s*\{[^}]*height:\s*32px/)
  assert.match(css, /@container \(max-width:\s*599px\)[\s\S]*?mafw-rw-files/)
  assert.doesNotMatch(css, /\.mafw-session-rail\s*\{/)
  assert.doesNotMatch(css, /\.mafw-dock-slot\.overlay/)
})
```

- [ ] **Step 2: Run and verify it fails**

```powershell
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/workbench-shell-css.test.ts
```

- [ ] **Step 3: Replace right-dock CSS**

- Add `.mafw-rw-*` styles for L1/L2, active tabs, dropdown, content panes, code view, overview, terminal, and file drawer.
- Remove `.mafw-session-rail`, `.mafw-session-float*`, and old `.mafw-wb-*` layout/tab styles that are no longer used; keep any editor/browser-internal styles.
- Remove `.mafw-dock-slot.overlay` and its mobile/overlay behavior.
- Keep `.mafw-dock-slot` as the third column container; no 44px rail.
- Keep `.mafw-wb-terminal` not used; terminal uses `.mafw-rw-terminal`.
- Add `@container (max-width: 599px)` rules for file tree drawer.

- [ ] **Step 4: Remove legacy task dock behavior**

- In `MafwShell.tsx`, remove `tasksPlacement`, `applyTasksPlacement`, the Ctrl+J dock branch, the legacy `<TaskList>` dock fallback, and `dockRef` if unused.
- Keep `taskListOpen` and TaskBar popover behavior.
- In `ChatPane.tsx`, remove the `tasksPlacement` prop and change TaskBar `open={props.taskListOpen}`.
- Remove `viewportNarrow`/`isNarrowViewport` from MafwShell and delete `layout-breakpoints.ts` + test. The width resize effect now updates `viewportWidth` only.
- Delete old design-contract assertions for overlay/tasks dock; update body-grid/workbench CSS tests to new classes.

- [ ] **Step 5: Run focused CSS/wiring tests and typecheck**

```powershell
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/workbench-shell-css.test.ts tests/body-grid-columns-css.test.ts tests/workbench-layout-css.test.ts
npx tsgo -b
```

Expected: PASS / 0.

- [ ] **Step 6: Commit**

```powershell
git add packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/tests/design-contract.test.ts packages/desktop/tests/body-grid-columns-css.test.ts packages/desktop/tests/workbench-layout-css.test.ts packages/desktop/tests/workbench-shell-css.test.ts
git rm packages/desktop/src/renderer/mafw/layout-breakpoints.ts packages/desktop/src/renderer/mafw/layout-breakpoints.test.ts
git commit -m "feat(desktop): finish B1 workbench styling"
```

---

### Task 9: Full verification, GUI smoke, delivery record

**Files:**
- Modify: `AGENTS.md`
- No product code changes unless verification finds a bug.

- [ ] **Step 1: Run the full gates**

From `packages/desktop`:

```powershell
npm test
npx tsgo -b
npx electron-vite build
```

Expected: all desktop tests pass; typecheck 0; build 0. Record exact test count for the final report.

- [ ] **Step 2: GUI smoke**

Launch the dev app and verify:

- Window 1600×1000: full three columns; ChatView 640; right workbench visible; terminal open.
- 1366: left dock push; ChatView and right workbench both visible; no clipping.
- 1088×720: left dock starts closed; ChatView + right workbench side by side; left dock opens only as overlay; no horizontal overflow.
- Switch L1 `工作台 / 执行 / 审阅`; switch `代码 / 浏览器`; open execution dropdown and each of five sections.
- Terminal persists across L1/L2 switches, collapse/expand, and session switches; cwd follows session.
- `改动` entry opens `审阅`; `后台` entry opens `执行 › 后台`; notes opens in left dock; usage opens from execution overview.
- Window maximize/restore does not change left-dock mode or dock width.
- Old localStorage migration: seed an old `mafw-right-dock-tab` value and reload; verify view/section mapping.

- [ ] **Step 3: Fix any failures**

If a test/smoke fails, fix it in the owning task's code, add a regression test if not covered, and re-run the full gates. Do not add a broad new feature here.

- [ ] **Step 4: Append the delivery record to `AGENTS.md`**

Use byte-level insertion, not a whole-file PowerShell rewrite (the file contains U+FFFD bytes). Record:

- spec and plan paths;
- commit range;
- desktop test count and pass/fail;
- `tsgo` and build results;
- GUI smoke checklist result;
- any remaining known issue.

- [ ] **Step 5: Commit the record**

```powershell
git add AGENTS.md
git commit -m "docs: delivery record for B1 workbench layout"
```

---

## Final verification checklist

- [ ] `npm test` all pass; exact count recorded.
- [ ] `npx tsgo -b` exit 0.
- [ ] `npx electron-vite build` exit 0.
- [ ] No `SessionRail`/`mafw-session-rail` references remain.
- [ ] No `mafw-dock-slot.overlay` behavior remains.
- [ ] Right workbench L1/L2 labels and B1 dropdown match the spec exactly.
- [ ] Terminal remains mounted across all L1/L2 switches.
- [ ] 1088/1366/1600 smoke passes.
- [ ] Delivery record committed.
