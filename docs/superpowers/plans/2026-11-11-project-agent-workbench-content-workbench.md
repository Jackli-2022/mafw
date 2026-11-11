# Project Agent Workbench — Content Workbench (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the right workbench a project-content surface with an explicit Project vs Goal-revision scope, per-scope tree/editor/reading state, and a safe return path, without changing Chat or Goal continuity.

**Architecture:** Add a pure `ContentScope` model (project directory or Goal revision worktree), own it in `MafwShell`, and pass its root/key/label to the content workbench. Add per-scope state and a small content history in pure modules; `FilesDock` and `EditorDock` restore from them and write back. A Goal revision is entered only through an explicit result action; Chat role changes never mutate the content scope.

**Tech Stack:** Electron + SolidJS + `@mafw/ui/v2`; existing `window.api.fs` and `mafw-file://` file protocol; existing editor/draft/annotation modules; node --test + `@mafw/test-shim`; TypeScript.

**Spec:** `docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md` (§7 content opening, §7.4 return/state, §7.5 file scope, §7.6 direct edit)

## Global Constraints

- Plan B is desktop-only. Do not modify gateway, SDK, runtime contract, MCP, or database. Reuse `PodGoalResult.worktree.dir`, `pod.worktreeDiff`, `window.api.fs.*`, `editor-drafts`, and existing annotation anchors.
- The project main directory is the default content scope. A Goal revision worktree is an explicit scope, entered only through “查看本版文件 / 变更”. Chat role changes must never change the content root or scope.
- Content scope applies to files, editor, direct edits, inline diffs, annotations, and the terminal. Browser tabs remain URL-bound; execution/review surfaces keep their session-scoped evidence.
- Existing direct edit/save/diff/annotation behavior is preserved. Direct editing in project scope requires no Goal. Saving in a Goal scope writes inside that revision worktree.
- State restoration in this plan is in-session and keyed by content scope. App-restart persistence and cross-project last-scope restoration are out of scope.
- No new raw `<button>`, `<input>`, or bare `title`; use `@mafw/ui/v2` components, `TooltipV2` with `openDelay={300}`, and theme tokens.
- Plan A behavior must not regress: opening/discussing a Goal keeps the right Goal open; “返回项目 Lead” switches Chat only; terminal Goals never enter a live Tech Lead.
- Plan C (persistent review items / forced acceptance) and Plan A deferred minors are out of scope.

## Review Focus

1. **Chat role switch**: switching Lead ↔ Tech Lead ↔ Builder/Reviewer must not change the content root, file tree, open tabs, or terminal scope; only an explicit Goal-revision action or project switch may.
2. **Unavailable Goal worktree**: a missing/merged/legacy worktree must not become a content scope; the current scope and the open Goal stay, with a neutral error.
3. **Same relative path in two scopes**: project `src/a.ts` and Goal worktree `src/a.ts` must keep separate drafts, tabs, tree selection, and diff decorations; switching scopes must not overwrite a dirty draft.
4. **Late async results**: file-tree/root/editor loads started in the old scope must be discarded after a scope switch; expansion, selected file, open tabs, and reading position must restore for the new scope.
5. **Return path**: returning from a Goal revision file (or from a temporary file open) must preserve the Goal, the previous active file/tab, and the right workbench without closing it.

---

### Task 1: Content scope model

**Files:**
- Create: `packages/desktop/src/renderer/mafw/content-scope.ts`
- Test: `packages/desktop/src/renderer/mafw/content-scope.test.ts`

**Interfaces:**
- Consumes: absolute project and worktree directory strings.
- Produces:
  ```ts
  export type ProjectContentScope = { kind: "project"; projectDir: string }
  export type GoalContentScope = {
    kind: "goal"
    projectDir: string
    goalId: string
    revision: number
    worktreeDir: string
    title: string | null
  }
  export type ContentScope = ProjectContentScope | GoalContentScope

  export function projectContentScope(projectDir: string | null | undefined): ProjectContentScope | null
  export function goalContentScope(input: {
    projectDir: string | null | undefined
    goalId: string
    revision: number
    worktreeDir: string | null | undefined
    title?: string | null
  }): GoalContentScope | null
  export function isGoalContentScope(scope: ContentScope | null | undefined): scope is GoalContentScope
  export function contentScopeRoot(scope: ContentScope | null | undefined): string | null
  export function contentScopeKey(scope: ContentScope | null | undefined): string | null
  export function contentScopeLabel(scope: ContentScope | null | undefined): string
  export function sameContentScope(a: ContentScope | null | undefined, b: ContentScope | null | undefined): boolean
  export function scopeAfterProjectChange(scope: ContentScope | null, projectDir: string | null): ContentScope | null
  export function diffsForContentScope<T>(input: {
    contentRoot: string | null
    sessionDirectory: string | null
    diffs: readonly T[]
  }): T[]
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  contentScopeKey,
  contentScopeLabel,
  contentScopeRoot,
  diffsForContentScope,
  goalContentScope,
  projectContentScope,
  sameContentScope,
  scopeAfterProjectChange,
} from "./content-scope"

test("project scope is the default root and has a stable key", () => {
  const scope = projectContentScope("C:\\work\\app")
  assert.equal(scope?.kind, "project")
  assert.equal(contentScopeRoot(scope), "C:\\work\\app")
  assert.equal(contentScopeLabel(scope), "项目文件")
  assert.equal(contentScopeKey(scope), "project:c:/work/app")
})

test("goal scope requires a project-owned worktree and a positive revision", () => {
  const scope = goalContentScope({
    projectDir: "C:\\work\\app",
    goalId: "g1",
    revision: 2,
    worktreeDir: "C:\\work\\app-wt-goal-g1-r2",
    title: "Fix login",
  })
  assert.ok(scope)
  assert.equal(contentScopeRoot(scope), "C:\\work\\app-wt-goal-g1-r2")
  assert.match(contentScopeLabel(scope), /Fix login/)
  assert.match(contentScopeLabel(scope), /revision 2/)
  assert.doesNotMatch(contentScopeLabel(scope), /g1/)
  assert.equal(goalContentScope({
    projectDir: "C:\\work\\app",
    goalId: "g1",
    revision: 2,
    worktreeDir: "D:\\tmp\\wt",
  }), null)
  assert.equal(goalContentScope({
    projectDir: "C:\\work\\app",
    goalId: "g1",
    revision: 0,
    worktreeDir: "C:\\work\\app-wt-x",
  }), null)
  assert.equal(goalContentScope({
    projectDir: "C:\\work\\app",
    goalId: "g1",
    revision: 1,
    worktreeDir: "C:\\work\\app",
  }), null)
})

test("scope labels never expose an internal goal id when a title is missing", () => {
  const scope = goalContentScope({
    projectDir: "C:\\work\\app",
    goalId: "goal-2026",
    revision: 1,
    worktreeDir: "C:\\work\\app-wt-x",
  })
  assert.ok(scope)
  assert.equal(contentScopeLabel(scope), "Goal revision 1")
})

test("project changes keep a goal scope only inside the same project", () => {
  const scope = goalContentScope({
    projectDir: "C:\\work\\app",
    goalId: "g1",
    revision: 1,
    worktreeDir: "C:\\work\\app-wt-x",
  })
  assert.ok(scope)
  assert.equal(sameContentScope(scope, scopeAfterProjectChange(scope, "C:\\work\\app")), true)
  assert.equal(scopeAfterProjectChange(scope, "D:\\other")?.kind, "project")
  assert.equal(contentScopeKey(projectContentScope("D:\\other")), "project:d:/other")
})

test("inline diffs never cross the content scope", () => {
  const diffs = [{ file: "src/a.ts", patch: "+x" }]
  assert.deepEqual(diffsForContentScope({
    contentRoot: "C:\\work\\app",
    sessionDirectory: "C:\\work\\app",
    diffs,
  }), diffs)
  assert.deepEqual(diffsForContentScope({
    contentRoot: "C:\\work\\app",
    sessionDirectory: "C:\\work\\app-wt-goal-g1-r1",
    diffs,
  }), [])
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (workdir `packages/desktop`):
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/content-scope.test.ts
```
Expected: FAIL with `Cannot find module .../content-scope`.

- [ ] **Step 3: Implement `content-scope.ts`**

Normalize comparison paths with backslashes → forward slashes, remove trailing slashes, and lowercase. `projectContentScope` returns null for empty input. `goalContentScope` returns null unless `goalId` is non-empty, `revision > 0`, and the normalized worktree is a sibling `projectDir-wt-*` or a directory below `projectDir`; equality with `projectDir` is not a revision worktree. `contentScopeLabel` returns `项目文件`, `Goal revision N` when the title is empty, or `Goal · <title> · revision N`; never include `goalId`. `contentScopeKey` is `project:<normalized projectDir>` or `goal:<normalized projectDir>:<goalId>:r<revision>`. `scopeAfterProjectChange` compares project directories with the same normalized form. `diffsForContentScope` returns a copy of `diffs` only when `contentRoot` is non-null and its normalized form equals the normalized `sessionDirectory`; otherwise `[]`.

- [ ] **Step 4: Run the test to verify it passes**

Run the Step 2 command.
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/content-scope.ts packages/desktop/src/renderer/mafw/content-scope.test.ts
git commit -m "feat(desktop): add explicit content scope model"
```

---

### Task 2: Per-scope content state and return history

**Files:**
- Create: `packages/desktop/src/renderer/mafw/content-scope-state.ts`
- Create: `packages/desktop/src/renderer/mafw/content-history.ts`
- Test: `packages/desktop/src/renderer/mafw/content-scope-state.test.ts`
- Test: `packages/desktop/src/renderer/mafw/content-history.test.ts`

**Interfaces:**
- Consumes: scope keys from `contentScopeKey`; `ContentScope` from Task 1.
- Produces:
  ```ts
  export type ContentScopeState = {
    treeExpanded: string[]
    treeSelected: string | null
    openFiles: string[]
    activeFile: string | null
    readingPositions: Record<string, number>
  }
  export function emptyContentScopeState(): ContentScopeState
  export function contentScopeStateFor(scopeKey: string | null): ContentScopeState
  export function saveContentScopeState(scopeKey: string | null, state: ContentScopeState): void
  export function updateContentScopeState(
    scopeKey: string | null,
    update: (state: ContentScopeState) => ContentScopeState,
  ): ContentScopeState
  export function setTreeExpanded(state: ContentScopeState, rel: string, expanded: boolean): ContentScopeState
  export function toggleTreeExpanded(state: ContentScopeState, rel: string): ContentScopeState
  export function selectTreeFile(state: ContentScopeState, rel: string | null): ContentScopeState
  export function rememberOpenFile(state: ContentScopeState, rel: string): ContentScopeState
  export function rememberActiveFile(state: ContentScopeState, rel: string): ContentScopeState
  export function rememberReadingPosition(state: ContentScopeState, rel: string, scrollTop: number): ContentScopeState
  export function readingPositionFor(state: ContentScopeState, rel: string): number | null
  export function clearContentScopeStates(): void

  export type ContentHistoryEntry = {
    scope: ContentScope
    rel: string | null
    label: string
  }
  export const MAX_CONTENT_HISTORY = 20
  export function pushContentHistory(
    history: readonly ContentHistoryEntry[],
    entry: ContentHistoryEntry,
  ): ContentHistoryEntry[]
  export function popContentHistory(history: readonly ContentHistoryEntry[]): {
    entry: ContentHistoryEntry | null
    rest: ContentHistoryEntry[]
  }
  ```

- [ ] **Step 1: Write the failing state tests**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  clearContentScopeStates,
  contentScopeStateFor,
  emptyContentScopeState,
  readingPositionFor,
  rememberActiveFile,
  rememberOpenFile,
  rememberReadingPosition,
  saveContentScopeState,
  selectTreeFile,
  setTreeExpanded,
  toggleTreeExpanded,
  updateContentScopeState,
} from "./content-scope-state"

test("scope state is isolated by scope key", () => {
  clearContentScopeStates()
  updateContentScopeState("project:c:/a", (state) => rememberOpenFile(state, "src/a.ts"))
  assert.deepEqual(contentScopeStateFor("project:c:/a").openFiles, ["src/a.ts"])
  assert.deepEqual(contentScopeStateFor("project:d:/b").openFiles, [])
})

test("tree expand/toggle/select are pure and idempotent", () => {
  let state = setTreeExpanded(emptyContentScopeState(), "src", true)
  state = setTreeExpanded(state, "src", true)
  assert.deepEqual(state.treeExpanded, ["src"])
  state = toggleTreeExpanded(state, "src")
  assert.deepEqual(state.treeExpanded, [])
  state = selectTreeFile(state, "src/a.ts")
  assert.equal(state.treeSelected, "src/a.ts")
  state = selectTreeFile(state, null)
  assert.equal(state.treeSelected, null)
})

test("open files dedupe and active file is added when missing", () => {
  let state = rememberOpenFile(emptyContentScopeState(), "src/a.ts")
  state = rememberOpenFile(state, "src/a.ts")
  assert.deepEqual(state.openFiles, ["src/a.ts"])
  state = rememberActiveFile(state, "src/b.ts")
  assert.equal(state.activeFile, "src/b.ts")
  assert.deepEqual(state.openFiles, ["src/a.ts", "src/b.ts"])
})

test("reading position is clamped and nullable", () => {
  let state = rememberReadingPosition(emptyContentScopeState(), "src/a.ts", 120)
  assert.equal(readingPositionFor(state, "src/a.ts"), 120)
  state = rememberReadingPosition(state, "src/a.ts", -5)
  assert.equal(readingPositionFor(state, "src/a.ts"), 0)
  assert.equal(readingPositionFor(state, "src/missing.ts"), null)
})

test("saving null key is a no-op and returns empty", () => {
  clearContentScopeStates()
  saveContentScopeState(null, rememberOpenFile(emptyContentScopeState(), "a.ts"))
  assert.deepEqual(contentScopeStateFor(null).openFiles, [])
})
```

Note: `emptyForTest` must not clear the state between operations; use `emptyContentScopeState()` import instead. Change the test to import `emptyContentScopeState` and use it directly. Adjust during implementation if needed; the implementer must keep the assertions.

- [ ] **Step 2: Write the failing history tests**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  MAX_CONTENT_HISTORY,
  popContentHistory,
  pushContentHistory,
  type ContentHistoryEntry,
} from "./content-history"

const project = { kind: "project", projectDir: "C:\\work\\app" } as const

test("history pushes, pops and dedupes the same consecutive location", () => {
  const first = { scope: project, rel: "src/a.ts", label: "项目文件" }
  const second = { scope: project, rel: "src/b.ts", label: "项目文件" }
  let history = pushContentHistory([], first)
  history = pushContentHistory(history, first)
  assert.equal(history.length, 1)
  history = pushContentHistory(history, second)
  const popped = popContentHistory(history)
  assert.equal(popped.entry?.rel, "src/b.ts")
  assert.deepEqual(popped.rest, [first])
})

test("empty history pops to null and depth is capped", () => {
  assert.deepEqual(popContentHistory([]), { entry: null, rest: [] })
  let history: ContentHistoryEntry[] = []
  for (let i = 0; i < MAX_CONTENT_HISTORY + 5; i += 1) {
    history = pushContentHistory(history, { scope: project, rel: `f${i}.ts`, label: "项目文件" })
  }
  assert.equal(history.length, MAX_CONTENT_HISTORY)
  assert.equal(history[0].rel, "f5.ts")
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run (workdir `packages/desktop`):
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/content-scope-state.test.ts src/renderer/mafw/content-history.test.ts
```
Expected: FAIL with module-not-found for both modules.

- [ ] **Step 4: Implement the two pure modules**

Use a module-level `Map<string, ContentScopeState>` in `content-scope-state.ts`; `contentScopeStateFor(null)` returns `emptyContentScopeState()`, and `saveContentScopeState(null, ...)` is a no-op. `contentScopeStateFor` and `saveContentScopeState` copy arrays and the reading-positions record so callers cannot mutate the stored state. All update functions return new objects and arrays; never mutate the input. `rememberOpenFile` appends only when missing; `rememberActiveFile` appends when missing and sets `activeFile`. `readingPositions` stores `Math.max(0, Math.round(scrollTop))`. `clearContentScopeStates()` clears the map for tests.

In `content-history.ts`, keep the newest entry at the end. `pushContentHistory` drops the oldest entries beyond `MAX_CONTENT_HISTORY` and skips a push when the top entry has the same `scope` key and `rel` (use `contentScopeKey`/`sameContentScope` from Task 1). `popContentHistory` returns the last entry and the remaining array; empty returns `{ entry: null, rest: [] }`.

- [ ] **Step 5: Run both tests to verify they pass**

Run the Step 3 command. Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/content-scope-state.ts packages/desktop/src/renderer/mafw/content-scope-state.test.ts packages/desktop/src/renderer/mafw/content-history.ts packages/desktop/src/renderer/mafw/content-history.test.ts
git commit -m "feat(desktop): persist per-scope content state"
```

---

### Task 3: Shell-owned content scope and scope header

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/ContentScopeHeader.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/FilesDock.tsx` (prop rename only)
- Modify: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx` (prop rename only)
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/src/renderer/mafw/content-scope-wiring.test.ts`
- Update: `packages/desktop/tests/file-preview-ui.test.ts`
- Update: `packages/desktop/tests/workbench-shell-wiring.test.ts`

**Interfaces:**
- Consumes: `ContentScope`, `projectContentScope`, `goalContentScope`, `contentScopeRoot`, `contentScopeKey`, `contentScopeLabel`, `scopeAfterProjectChange`, `diffsForContentScope`.
- Produces:
  ```ts
  export function ContentScopeHeader(props: {
    label: string
    isGoalScope: boolean
    canGoBack: boolean
    onBack: () => void
    onReturnToProject: () => void
  }): JSX.Element
  ```
  `MafwShell` owns:
  ```ts
  const [contentScope, setContentScope] = createSignal<ContentScope | null>(projectContentScope(currentProject()))
  const contentRoot = createMemo(() => contentScopeRoot(contentScope()) ?? currentProject())
  const currentContentScopeKey = createMemo(() => contentScopeKey(contentScope()))
  const openGoalContent = (input: { goalId: string; revision: number; worktreeDir: string; title?: string | null }): void
  const returnToProjectContent = (): void
  ```
  `WorkbenchShell` and `WorkbenchCodeView` receive `contentRoot: string | null`, `contentScopeKey: string | null`, `contentScopeLabel: string`, `contentScopeIsGoal: boolean`, `canGoBack: boolean`, `onBack: () => void`, `onReturnToProjectContent: () => void`.
  Content-only props in `FilesDock`/`EditorDock` rename from `sessionDirectory` to `contentRoot`; `ChangesDock`/`ChatPane` keep `sessionDirectory` because they describe session evidence.

- [ ] **Step 1: Write the failing wiring test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8")
const shell = read("MafwShell.tsx")
const workbench = read("components/WorkbenchShell.tsx")
const header = read("components/ContentScopeHeader.tsx")
const css = read("mafw.css")

test("content workbench is rooted in an explicit scope, not the active session", () => {
  assert.match(shell, /const \[contentScope, setContentScope\] = createSignal<ContentScope \| null>/)
  assert.match(shell, /const contentRoot = createMemo\(\(\) =>/)
  assert.match(shell, /scopeAfterProjectChange/)
  assert.match(shell, /goalContentScope\(/)
  assert.match(shell, /diffsForContentScope/)
  assert.match(shell, /contentRoot=\{contentRoot\(\)\}/)
  assert.match(shell, /diffs=\{contentDiffEntries\(\)\}/)
  assert.doesNotMatch(shell, /const contentRoot = [^\n]*currentSessionID/)
})

test("the workbench always shows the current content scope", () => {
  assert.match(workbench, /ContentScopeHeader/)
  assert.match(workbench, /contentScopeLabel/)
  assert.match(workbench, /contentScopeIsGoal/)
  assert.match(workbench, /onReturnToProjectContent/)
  assert.match(header, /返回项目文件/)
  assert.match(header, /ButtonV2/)
  assert.doesNotMatch(header, /<button/)
  assert.doesNotMatch(header, /\stitle=/)
  assert.match(css, /\.mafw-content-scope\s*\{[^}]*var\(--/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (workdir `packages/desktop`):
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/content-scope-wiring.test.ts
```
Expected: FAIL because `ContentScopeHeader` and the shell scope state do not exist.

- [ ] **Step 3: Implement the shell scope and header**

In `MafwShell.tsx`:
- Import the Task 1 helpers in `MafwShell`. `ContentScopeHeader` is imported by `WorkbenchShell`, not the shell.
- Add `contentScope` near `benchRoot` (around line 2149) and a `createEffect` that calls `setContentScope((scope) => scopeAfterProjectChange(scope, currentProject()))`.
- Add `contentDiffEntries = createMemo(() => diffsForContentScope({ contentRoot: contentRoot(), sessionDirectory: store.session.find((s: any) => s.id === currentSessionID())?.directory ?? null, diffs: mergedSessionDiffs() }))`. Pass `diffs={contentDiffEntries()}` to `WorkbenchShell`; keep the review view using the existing session diffs.
- Add `openGoalContent` and `returnToProjectContent` after `openWorkbenchSurface` so they can call it:
  ```ts
  const openGoalContent = (input) => {
    const scope = goalContentScope({ projectDir: currentProject(), ...input })
    if (!scope) {
      showToastV2({ description: "无法打开该 Goal 版本的文件", variant: "error", duration: 3500 } as any)
      return
    }
    setContentScope(scope)
    openWorkbench("workbench")
    applyWorkbenchSurface("code")
  }
  const returnToProjectContent = () => setContentScope(projectContentScope(currentProject()))
  ```
- Pass `contentRoot={contentRoot()}` (not `benchRoot()`) and the scope props to `WorkbenchShell`; replace `requestOpenEditor(root, rel)` root with `contentRoot()` and use `root !== contentRoot()` for stale browser/token checks.
- Keep `benchRoot` for `ExecutionView` and `ChangesDock`; do not reroute those to content scope.

In `WorkbenchShell.tsx`:
- Add the content props and render `<ContentScopeHeader ... />` above `.mafw-rw-content` when `props.view === "workbench"`.
- Pass `contentRoot`/`contentScopeKey` to `WorkbenchCodeView`.

In `WorkbenchCodeView.tsx`:
- Replace `sessionDirectory` with `contentRoot`; pass `contentRoot` to `FilesDock`, `EditorDock`, and `directory={props.contentRoot}` to `TerminalSurface`.
- Add `scopeKey={props.contentScopeKey}` to `FilesDock`/`EditorDock` in Task 4/5; it can be an unused prop until then.

Create `ContentScopeHeader.tsx` with a section, label, and buttons; use `ButtonV2` and `Icon name="chevron-left"` for “返回”. Add token CSS for `.mafw-content-scope`, `.mafw-content-scope-label`, `.mafw-content-scope-actions`, and `.mafw-content-scope-return`.

- [ ] **Step 4: Update the two existing contracts**

- `packages/desktop/tests/file-preview-ui.test.ts:96`: change `const benchRoot = createMemo` to `const contentRoot = createMemo` because the content root is now the memo that guards preview reloads.
- `packages/desktop/tests/workbench-shell-wiring.test.ts`: assert `ContentScopeHeader`, `contentScopeLabel`, and `contentRoot` in the workbench shell/code view.

- [ ] **Step 5: Run the focused tests**

Run (workdir `packages/desktop`):
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/content-scope.test.ts src/renderer/mafw/content-scope-wiring.test.ts tests/file-preview-ui.test.ts tests/workbench-shell-wiring.test.ts
```
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx packages/desktop/src/renderer/mafw/components/FilesDock.tsx packages/desktop/src/renderer/mafw/components/EditorDock.tsx packages/desktop/src/renderer/mafw/components/ContentScopeHeader.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/content-scope-wiring.test.ts packages/desktop/tests/file-preview-ui.test.ts packages/desktop/tests/workbench-shell-wiring.test.ts
git commit -m "feat(desktop): root content workbench in explicit scope"
```

---

### Task 4: Restore the file tree per scope

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/FilesDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test: `packages/desktop/src/renderer/mafw/files-dock-scope.test.ts`

**Interfaces:**
- Consumes: `contentScopeStateFor`, `saveContentScopeState`, `setTreeExpanded`, `selectTreeFile` from Task 2.
- Produces: `FilesDock` props add `scopeKey: string | null`; selected row is exposed with `aria-current="true"` and `classList={{ "is-selected": ... }}`; expansion/selection are written back to the scope state.

- [ ] **Step 1: Write the failing source/contract test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const dock = readFileSync(join(import.meta.dirname, "components/FilesDock.tsx"), "utf8")
const css = readFileSync(join(import.meta.dirname, "mafw.css"), "utf8")

test("FilesDock restores and persists tree state per content scope", () => {
  assert.match(dock, /scopeKey/)
  assert.match(dock, /contentScopeStateFor\(/)
  assert.match(dock, /saveContentScopeState\(/)
  assert.match(dock, /treeExpanded/)
  assert.match(dock, /treeSelected/)
  assert.match(dock, /aria-current=/)
  assert.match(dock, /is-selected/)
  assert.match(dock, /loadToken/)
  assert.match(dock, /root !== props\.contentRoot/)
})

test("selected file rows use theme tokens", () => {
  assert.match(css, /\.mafw-file-tree-row\.is-selected\s*\{[^}]*var\(--/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (workdir `packages/desktop`):
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/files-dock-scope.test.ts
```
Expected: FAIL on the missing scope-state calls.

- [ ] **Step 3: Implement per-scope tree state**

- Add `scopeKey` to `FilesDock` props and a `selectedRel` signal.
- On `contentRoot`/`scopeKey` change: read `contentScopeStateFor(props.scopeKey)`, set `expanded` and `selectedRel`, reset the load token, load the root, and then load children for each saved expanded directory. Discard every result if the token or `props.contentRoot` changed.
- On expand/collapse: update the signal and persist via `saveContentScopeState(props.scopeKey, setTreeExpanded(contentScopeStateFor(props.scopeKey), row.rel, expandedNow))` (or a small `persistScope(update)` helper).
- On file activation: set `selectedRel`, save `selectTreeFile`, then call `props.onOpenFile(row.rel)`.
- Render `aria-current={selectedRel() === row.rel ? "true" : undefined}` and `classList={{ "is-selected": selectedRel() === row.rel }}`; keep the existing `role="button"` and keyboard behavior.
- Add the token-only selected-row CSS; do not change the existing directory-watch behavior or the `onDirChanged` path.

- [ ] **Step 4: Run the test to verify it passes**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Run the existing file-tree tests**

Run (workdir `packages/desktop`):
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/file-tree.test.ts src/renderer/mafw/file-tree-watch.test.ts tests/live-refresh-wiring.test.ts
```
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/FilesDock.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/src/renderer/mafw/files-dock-scope.test.ts
git commit -m "feat(desktop): restore file tree per content scope"
```

---

### Task 5: Restore editor tabs and reading position per scope

**Files:**
- Create: `packages/desktop/src/renderer/mafw/editor-model-store.ts`
- Test: `packages/desktop/src/renderer/mafw/editor-model-store.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/editor/cm-setup.ts`
- Modify: `packages/desktop/src/renderer/mafw/editor/monaco-setup.ts`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css` (if a selection/anchor style is needed)
- Modify: `packages/desktop/src/shared/annotation-types.ts` (optional `scopeKey`/`root` on annotation drafts)
- Test: `packages/desktop/src/renderer/mafw/editor-scope-wiring.test.ts`

**Interfaces:**
- Consumes: `EditorModel`, `createEditorModel`, `contentScopeStateFor`, `saveContentScopeState`, `rememberReadingPosition`, `readingPositionFor`.
- Produces:
  ```ts
  export function editorModelFor(root: string | null): EditorModel
  export function saveEditorModel(root: string | null, model: EditorModel): void
  export function clearEditorModels(): void
  ```
  `MountedEditor` gains:
  ```ts
  getScroll(): number
  setScroll(top: number): void
  ```
  Annotation draft payload gains optional `scopeKey?: string` and `root?: string`; the `Annotation` type gains the same optional fields.

- [ ] **Step 1: Write the failing editor model test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { createEditorModel, openFile } from "./editor-state"
import { clearEditorModels, editorModelFor, saveEditorModel } from "./editor-model-store"

test("editor models are isolated by root", () => {
  clearEditorModels()
  const model = openFile(createEditorModel(), "src/a.ts", "A")
  saveEditorModel("C:\\a", model)
  assert.deepEqual(editorModelFor("C:\\a").files.map((f) => f.rel), ["src/a.ts"])
  assert.deepEqual(editorModelFor("D:\\b").files, [])
})

test("saving a null root is a no-op", () => {
  clearEditorModels()
  saveEditorModel(null, openFile(createEditorModel(), "a.ts", "A"))
  assert.deepEqual(editorModelFor(null).files, [])
})
```

- [ ] **Step 2: Write the failing wiring test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8")
const editor = read("components/EditorDock.tsx")
const cm = read("editor/cm-setup.ts")
const monaco = read("editor/monaco-setup.ts")
const types = readFileSync(join(import.meta.dirname, "../../shared/annotation-types.ts"), "utf8")

test("EditorDock restores models and reading positions per scope", () => {
  assert.match(editor, /editorModelFor\(/)
  assert.match(editor, /saveEditorModel\(/)
  assert.match(editor, /rememberReadingPosition/)
  assert.match(editor, /readingPositionFor/)
  assert.match(editor, /getScroll\(\)/)
  assert.match(editor, /setScroll\(/)
  assert.match(editor, /mountToken/)
  assert.match(editor, /root !== props\.contentRoot/)
  assert.match(cm, /getScroll\(\): number/)
  assert.match(cm, /setScroll\(top: number\)/)
  assert.match(monaco, /getScrollTop\(\)/)
  assert.match(monaco, /setScrollTop\(/)
})

test("annotation drafts carry the content scope without changing the file path", () => {
  assert.match(types, /scopeKey\?: string/)
  assert.match(types, /root\?: string/)
  assert.match(editor, /scopeKey: props\.scopeKey \?\? undefined/)
  assert.match(editor, /root: props\.contentRoot \?\? undefined/)
})

test("project direct edits never require a Goal", () => {
  const save = editor.slice(editor.indexOf("async function saveActive"))
  assert.match(save.slice(0, 2000), /window\.api\.fs\.writeFile/)
  assert.doesNotMatch(save.slice(0, 2000), /pod\.|goal\./)
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (workdir `packages/desktop`):
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/editor-model-store.test.ts src/renderer/mafw/editor-scope-wiring.test.ts
```
Expected: FAIL because the model store and scroll methods do not exist.

- [ ] **Step 4: Implement the model store and editor wiring**

- Add `editor-model-store.ts` with a module `Map<string, EditorModel>`; `editorModelFor(null)` returns `createEditorModel()`, `saveEditorModel(null, ...)` is a no-op. Store a shallow copy so later caller mutations cannot corrupt the map.
- In `EditorDock`, replace the root effect’s `onRootChange(m, root)` reset with:
  - Save the previous root’s model and scroll before switching.
  - `setModel(editorModelFor(root))`.
  - Reset read notes/versions/source mode/selection; keep the existing watch teardown and `mountActive()`.
- Add a `createEffect` that saves `model()` into `saveEditorModel(model().root, model())` and writes `openFiles`/`activeFile` into `saveContentScopeState(props.scopeKey, ...)`.
- Save the active editor scroll with `rememberReadingPosition` before switching files, closing the active file, switching scope, and on cleanup.
- After `mountFor` installs an editor, call `setScroll(readingPositionFor(contentScopeStateFor(props.scopeKey), f.rel) ?? 0)`.
- Extend `MountedEditor` and both editor engines with `getScroll/setScroll` (CodeMirror: `view.scrollDOM.scrollTop`; Monaco: `editor.getScrollTop()`/`editor.setScrollTop()`).
- Add optional `scopeKey`/`root` to `Annotation` and to the `onAddAnnotation` payload types in `WorkbenchShell`, `WorkbenchCodeView`, and `MafwShell`; `annotation-store.addPending` already accepts `Omit<Annotation, "id" | "createdAt">`. Pass `scopeKey: props.scopeKey ?? undefined` and `root: props.contentRoot ?? undefined` from `EditorDock`. Keep the existing `rel` and anchors unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run the Step 3 command. Expected: PASS.

- [ ] **Step 6: Run the editor regression tests**

Run (workdir `packages/desktop`):
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/editor-state.test.ts src/renderer/mafw/editor-drafts.test.ts tests/file-preview-ui.test.ts tests/live-refresh-wiring.test.ts tests/annotation-send-wiring.test.ts tests/annotation-popover-ui.test.ts
```
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/editor-model-store.ts packages/desktop/src/renderer/mafw/editor-model-store.test.ts packages/desktop/src/renderer/mafw/components/EditorDock.tsx packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/editor/cm-setup.ts packages/desktop/src/renderer/mafw/editor/monaco-setup.ts packages/desktop/src/renderer/mafw/editor-scope-wiring.test.ts packages/desktop/src/shared/annotation-types.ts
git commit -m "feat(desktop): restore editor state and annotations per scope"
```

---

### Task 6: Content back and explicit return

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ContentScopeHeader.tsx`
- Test: `packages/desktop/src/renderer/mafw/content-history-wiring.test.ts`

**Interfaces:**
- Consumes: `ContentHistoryEntry`, `pushContentHistory`, `popContentHistory`, `contentScopeStateFor`, `contentScopeRoot`, `contentScopeLabel`.
- Produces: shell state `contentHistory`, `rememberContentLocation()`, and `backContent()`; `ContentScopeHeader` receives `canGoBack` and `onBack`.

- [ ] **Step 1: Write the failing wiring test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8")
const shell = read("MafwShell.tsx")
const header = read("components/ContentScopeHeader.tsx")

test("the shell remembers content locations before opening another one", () => {
  assert.match(shell, /contentHistory/)
  assert.match(shell, /pushContentHistory/)
  assert.match(shell, /popContentHistory/)
  assert.match(shell, /rememberContentLocation/)
  assert.match(shell, /backContent/)
  const onOpenFile = shell.slice(shell.indexOf("onOpenFile={"), shell.indexOf("onSendAnnotation={"))
  assert.match(onOpenFile, /rememberContentLocation\(\)/)
})

test("the scope header exposes a real back action", () => {
  assert.match(header, /canGoBack/)
  assert.match(header, /onBack/)
  assert.match(header, /返回/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (workdir `packages/desktop`):
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/content-history-wiring.test.ts
```
Expected: FAIL on missing history/back wiring.

- [ ] **Step 3: Implement history and back**

- Add `const [contentHistory, setContentHistory] = createSignal<ContentHistoryEntry[]>([])` in `MafwShell`.
- `rememberContentLocation()` reads the current scope and `contentScopeStateFor(currentContentScopeKey()).activeFile`, builds `{ scope, rel, label: contentScopeLabel(scope) }`, and pushes it.
- In the content `onOpenFile` callback, call `rememberContentLocation()` before opening an editor file. Browser opens have their own URL history and are not pushed into the content history. Do not push for tab switches inside `EditorDock`.
- `backContent()` pops the history; if an entry exists, set `contentScope` to `entry.scope`, open the workbench code surface, and if `entry.rel` is set, request the editor only when `contentScopeRoot(entry.scope)` is non-null: `requestOpenEditor(root, entry.rel)`. `backContent` must not push history.
- Make `returnToProjectContent` call `rememberContentLocation()` before setting the project scope, so the generic back action can return to the Goal revision. Keep it separate from the generic back action.
- Pass `canGoBack={contentHistory().length > 0}` and `onBack={backContent}` through `WorkbenchShell` to `ContentScopeHeader`.

- [ ] **Step 4: Run the test to verify it passes**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx packages/desktop/src/renderer/mafw/components/ContentScopeHeader.tsx packages/desktop/src/renderer/mafw/content-history-wiring.test.ts
git commit -m "feat(desktop): add content back and project return"
```

---

### Task 7: Enter a Goal revision explicitly from the result

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/PodResultView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/src/renderer/mafw/goal-content-entry.test.ts`

**Interfaces:**
- Consumes: `openGoalContent` from Task 3; `rememberContentLocation` from Task 6; `PodGoalResult.worktree`.
- Produces:
  ```ts
  type GoalWorktreeTarget = {
    goalId: string
    revision: number
    worktreeDir: string
    title?: string | null
  }
  ```
  Define and export `GoalWorktreeTarget` in `PodResultView.tsx`; `GoalDetailPanel` imports it. `PodResultView` `onOpenWorktree?: (target: Omit<GoalWorktreeTarget, "title">) => void`; `GoalDetailPanel`/`ProjectWorkView`/`MafwShell` pass `GoalWorktreeTarget`.

- [ ] **Step 1: Write the failing source-contract test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8")
const result = read("components/PodResultView.tsx")
const detail = read("components/GoalDetailPanel.tsx")
const shell = read("MafwShell.tsx")

test("the result offers an explicit Goal worktree entry", () => {
  assert.match(result, /查看本版文件/)
  assert.match(result, /onOpenWorktree/)
  assert.match(result, /worktree\?\.dir|worktree\.dir/)
  assert.match(result, /status !== "missing"/)
})

test("the Goal entry carries revision and title, and never auto-switches scope", () => {
  assert.match(detail, /onOpenWorktree/)
  assert.match(detail, /title: podGoal\(\)\?\.title/)
  assert.match(shell, /openGoalContent/)
  assert.match(shell, /onOpenGoalWorktree/)
  assert.match(shell, /rememberContentLocation\(\)/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (workdir `packages/desktop`):
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/goal-content-entry.test.ts
```
Expected: FAIL on the missing action/props.

- [ ] **Step 3: Implement the explicit entry**

- In `PodResultView`, add a “查看本版文件” `ButtonV2` near the “查看分支差异” action. Capture `const worktree = result()?.worktree` inside the `Show` callback; render only when `worktree?.dir` exists and `worktree.status !== "missing"`. Use `revision = result()?.revision ?? activeRevision() ?? 1`. Call `props.onOpenWorktree?.({ goalId: props.goalId, revision, worktreeDir: worktree.dir })`; do not use non-null assertions across the JSX.
- In `GoalDetailPanel`, forward the callback to `PodResultView`, adding `title: podGoal()?.title ?? null`.
- In `ProjectWorkView`, add `onOpenGoalWorktree?: (target) => void` and pass it to `GoalDetailPanel`.
- In `MafwShell`, implement `onOpenGoalWorktree={(target) => { rememberContentLocation(); openGoalContent(target) }}` and pass it to `ProjectWorkView`.
- If `goalContentScope` rejects the worktree, `openGoalContent` already shows a neutral toast and leaves the current scope unchanged. Do not close the Goal or switch Chat.

- [ ] **Step 4: Run the test to verify it passes**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Run the Plan A Goal regression tests**

Run (workdir `packages/desktop`):
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/goal-user-view.test.ts src/renderer/mafw/goal-chat-context.test.ts src/renderer/mafw/goal-workbench-wiring.test.ts tests/goal-detail-unified.test.ts
```
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/PodResultView.tsx packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx packages/desktop/src/renderer/mafw/components/ProjectWorkView.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/goal-content-entry.test.ts
git commit -m "feat(desktop): open goal revision content explicitly"
```

---

### Task 8: Document, verify and hand off

**Files:**
- Modify: `docs/architecture/desktop.md`
- Test: no new test file; run all gates.

- [ ] **Step 1: Document the current state**

Add a short “内容工作台 scope（2026-11-11 Plan B）” note to `docs/architecture/desktop.md`: project scope is the default; Goal revision is explicit; Chat role changes never change the root; tree/tabs/reading position/drafts are per-scope; the result action is “查看本版文件”; Plan C owns persistent review items.

- [ ] **Step 2: Run the focused suite**

Run (workdir `packages/desktop`):
```text
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/content-scope.test.ts src/renderer/mafw/content-scope-state.test.ts src/renderer/mafw/content-history.test.ts src/renderer/mafw/content-scope-wiring.test.ts src/renderer/mafw/files-dock-scope.test.ts src/renderer/mafw/editor-model-store.test.ts src/renderer/mafw/editor-scope-wiring.test.ts src/renderer/mafw/content-history-wiring.test.ts src/renderer/mafw/goal-content-entry.test.ts tests/workbench-shell-wiring.test.ts tests/file-preview-ui.test.ts tests/live-refresh-wiring.test.ts
```
Expected: PASS, 0 failures.

- [ ] **Step 3: Run the full desktop suite**

Run: `npm test` (workdir `packages/desktop`).
Expected: 0 failures; record the total pass count.

- [ ] **Step 4: Type check and build**

Run (workdir `packages/desktop`):
```text
npx tsgo --noEmit -p tsconfig.json
node ../../node_modules/electron-vite/bin/electron-vite.js build
```
Expected: rc=0 for both. Use the direct `electron-vite` entry because `npx electron-vite` can be hijacked by the Bun bin shim in this checkout.

- [ ] **Step 5: GUI smoke**

Start the dev app with a non-default debug port if 9222 is busy:
```powershell
$env:MAFW_DEBUG_PORT='9223'; node ../../node_modules/electron-vite/bin/electron-vite.js dev
```
Verify in the running app:
1. Open a Goal with a result worktree, click “查看本版文件”; header shows the Goal title and revision, tree root is the worktree, and Chat stays on Tech Lead.
2. Switch Chat to Lead and back; the content root, expanded tree, open tabs, and active file do not change.
3. Open `src/a.ts` in the Goal scope, dirty it, return to project files, open project `src/a.ts`; the two drafts do not mix. Return to the Goal scope; the draft and scroll position are restored.
4. Click “返回项目文件”; header shows 项目文件 and the tree returns to the project root. The right Goal stays open.
5. Open a file from the project tree, then click the content “返回”; the previous file/active tab is restored.
6. If the Goal worktree is missing, “查看本版文件” is absent or shows a neutral error and the current scope stays unchanged.

If no Goal with a worktree result is available, record the GUI smoke as deferred with that reason; do not claim it passed from source tests alone.

- [ ] **Step 6: Commit the docs**

```bash
git add docs/architecture/desktop.md
git commit -m "docs(desktop): record explicit content workbench scope"
```

---

## Self-review notes

- Spec §7.1/§7.2 are satisfied by keeping the existing result view and editor behavior, adding an explicit Goal revision entry, and making the default file-tree/editor path a reading surface; existing selection/annotation remains the modify affordance.
- Spec §7.3 is unchanged; content type dispatch stays in `fileOpenPlan`/`EditorDock`.
- Spec §7.4 is covered by per-scope tree/editor/reading state and the content history; the Goal stays mounted thanks to Plan A.
- Spec §7.5 is covered by `ContentScope`, the scope header, explicit Goal entry, and scope-guarded diffs/annotations/terminal.
- Spec §7.6 is preserved: project direct edits use `window.api.fs.writeFile` with no Goal lookup; the Task 5 test pins it.
- Plan C (persistent review items, forced acceptance) is intentionally out of scope.
- Project switch resets to the project content scope; restoring the last Goal revision scope per project and app-restart persistence are deferred. Per-scope tree/editor state is still restored when the same scope is reopened.
