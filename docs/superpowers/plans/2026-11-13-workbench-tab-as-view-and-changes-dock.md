# 工作台 tab-as-view 与左栏改动面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除右 dock 的 LensBar，把改动与审阅变成左栏常驻的「改动」面，并让 diff 成为统一文档条里的一等 tab。

**Architecture:** 左栏新增 `changes` face，面内按 `session / goal / project` 三种上下文展示待审、版本变更、会话改动；点击条目在右工作台打开 `diff` tab。文档条新增 `diff` kind 与瞬态 `DiffDocument` store；diff 复用 `DiffReviewPanel` 的展示/回退/评论能力。镜条、阅读/修改意图、`changeSet` / `evidence` / `InstrumentRail` 在替换路径就绪后删除。

**Tech Stack:** Electron + SolidJS + TypeScript、`@mafw/ui` v2、`@mafw/sdk`、Node `--test` + `@mafw/test-shim`、`tsgo`、`electron-vite`。

**Spec:** `docs/superpowers/specs/2026-11-13-workbench-tab-as-view-and-changes-dock-design.md`

## Global Constraints

- 不改 gateway / SDK 契约；只消费现有 `sessions.diff`、`pod.worktreeDiff`、`pod.reviewItems`、`work.overview`。
- 所有 UI 只用 `@mafw/ui` v2 组件与主题 token；禁止裸 `<button>` / `<input>` / 裸 `title`。
- 验收（接受 / 打回）是 human-only，只留在 Goal 结果页；左栏不出现验收动作，也不新增 MCP/Agent 路径。
- 评审项状态权威在 gateway；左栏只投影，不本地改状态。
- 缺失 / 失效数据给中性文案；不出现 runtime 名或 capability flag 名。
- desktop 测试必须带 `--conditions=browser`；单文件命令在 `packages/desktop` 下执行。
- 不 push / merge / release；每个 task 独立 commit。
- 现有 desktop 全量基线：**3765 pass / 727 suites**；本计划新增测试单独计数。

## Review Focus

- **上下文不可用**：无项目 / 无活动讨论 / Goal 无 worktree 时，左面必须显示可理解空态，选择器禁用，不崩溃。
- **Goal diff 失效**：`worktreeDiff` 404 / 409 / 503 时不打开 diff tab，左面给「这一版没有可预览的分支」。
- **会话 diff 变旧**：agent 继续改文件时，已打开的会话 diff tab 必须更新并清空勾选，绝不用旧行号回退。
- **diff tab 生命周期**：关闭 active diff tab 落到邻居；重启后不残留 `diff:` tab，也不出现空 stage。
- **human-only 边界**：accepted Goal 的评审项不再显示解决/重开；左栏任何位置都不出现验收按钮。

---

### Task 1: Changes context + 左栏 `changes` face plumbing

**Files:**
- Create: `packages/desktop/src/renderer/mafw/changes/changes-context.ts`
- Create: `packages/desktop/src/renderer/mafw/changes/changes-context.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/left-dock.ts`
- Modify: `packages/desktop/src/renderer/mafw/left-dock.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/IconRail.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/LeftDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Create: `packages/desktop/tests/changes-face-wiring.test.ts`

**Interfaces:**
- Consumes: `Scope`, `FileDiffEntry`, `buildChangeTree`
- Produces:
```ts
export type ChangesMode = "session" | "goal" | "project"
export type GoalRef = {
  podId: string
  goalId: string
  revision: number
  title: string
  worktreeDir: string | null
}
export type ChangesContext =
  | { kind: "session"; sessionID: string; goal: GoalRef | null }
  | { kind: "goal"; goal: GoalRef }
  | { kind: "project" }
export type ChangesContextInput = {
  mode: ChangesMode
  projectDir: string | null
  activeSession: { id: string; title: string } | null
  sessionGoal: GoalRef | null
  currentGoal: GoalRef | null
}
export function resolveChangesContext(input: ChangesContextInput): ChangesContext | null
export function changesContextKey(context: ChangesContext | null): string
```
- `LeftDockFace` adds `"changes"`; `LeftDock` gets `renderChanges?: () => JSX.Element`; `IconRail` gets `changesBadge?: number` / `changesDot?: boolean`.

- [ ] **Step 1: Write the failing context tests**

Create `changes-context.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveChangesContext, changesContextKey, type GoalRef } from "./changes-context"

const goal: GoalRef = { podId: "p1", goalId: "g1", revision: 2, title: "修复登录", worktreeDir: "C:/wt" }

test("session mode returns the active discussion and its goal", () => {
  const context = resolveChangesContext({
    mode: "session",
    projectDir: "C:/repo",
    activeSession: { id: "s1", title: "修复登录" },
    sessionGoal: goal,
    currentGoal: null,
  })
  assert.deepEqual(context, { kind: "session", sessionID: "s1", goal })
  assert.equal(changesContextKey(context), "session:s1:g1:2")
})

test("goal mode returns the current goal; missing goal is null", () => {
  assert.deepEqual(resolveChangesContext({
    mode: "goal", projectDir: "C:/repo", activeSession: null, sessionGoal: null, currentGoal: goal,
  }), { kind: "goal", goal })
  assert.equal(resolveChangesContext({
    mode: "goal", projectDir: "C:/repo", activeSession: null, sessionGoal: null, currentGoal: null,
  }), null)
})

test("project mode is available without a session or goal", () => {
  assert.deepEqual(resolveChangesContext({
    mode: "project", projectDir: "C:/repo", activeSession: null, sessionGoal: null, currentGoal: null,
  }), { kind: "project" })
})

test("no project means no context in every mode", () => {
  for (const mode of ["session", "goal", "project"] as const) {
    assert.equal(resolveChangesContext({
      mode, projectDir: null, activeSession: { id: "s1", title: "x" }, sessionGoal: goal, currentGoal: goal,
    }), null)
  }
})

test("session mode without an active discussion is null", () => {
  assert.equal(resolveChangesContext({
    mode: "session", projectDir: "C:/repo", activeSession: null, sessionGoal: null, currentGoal: goal,
  }), null)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/changes/changes-context.test.ts`
Expected: FAIL — `Cannot find module './changes-context'`.

- [ ] **Step 3: Implement the resolver and left-dock plumbing**

Create `changes-context.ts` with the types above. `resolveChangesContext` switches on `mode`; return `null` when `projectDir` is falsy or the selected mode has no source. `changesContextKey` returns `session:<id>:<goalId>:<revision>`, `goal:<goalId>:<revision>`, or `project`.

Modify `left-dock.ts`:
```ts
export type LeftDockFace = "files" | "sessions" | "search" | "notes" | "changes"
```
`normalizeLeftDockFace` accepts `"changes"`; `pod` / unknown still falls back to `"sessions"`.

Modify `IconRail.tsx` props:
```ts
changesBadge?: number
changesDot?: boolean
```
Add after `files`:
```ts
{ key: "changes", icon: "review", label: props.face === "changes" ? "收起改动" : "改动",
  onClick: () => props.onToggleFace("changes"), active: props.face === "changes",
  badge: props.changesBadge, dot: !!props.changesDot, dotLabel: "有改动" }
```
Extend `RailItem` with `dot?: boolean` and `dotLabel?: string`; render a dot using the existing `.mafw-icon-rail-result-dot` visual, and append `（${item.dotLabel ?? "有新结果"}）` to `aria-label` when `dot` is set. Do not reuse `resultDot`, whose aria text is specifically “有新结果”.

Modify `LeftDock.tsx`:
```ts
renderChanges?: () => JSX.Element
```
Render before the sessions block:
```tsx
<Show when={props.face === "changes"}>
  <div class="mafw-left-dock-changes">{props.renderChanges?.()}</div>
</Show>
```
Change the sessions block condition to `props.face !== "notes" && props.face !== "files" && props.face !== "changes"`.

Create `components/ChangesFace.tsx` with a session-only first cut:
```tsx
export type ChangesFaceProps = {
  mode: ChangesMode
  onMode: (mode: ChangesMode) => void
  availableModes?: readonly ChangesMode[]
  context: ChangesContext | null
  sessionDiffs: readonly FileDiffEntry[]
  onOpenFile: (rel: string) => void
}
```
Render three mode chips (buttons call `onMode`, `disabled={!availableModes?.includes(mode)}`; wrap disabled chips in `TooltipV2` explaining “没有可用的讨论 / Goal”, not a bare `title`), and for `context.kind === "session"` render `buildChangeTree(sessionDiffs)` rows with status letter + `+ / −`; clicking a file calls `onOpenFile(rel)`. Goal / project modes show `DockEmpty` text for now.

Wire `MafwShell`:
```tsx
<LeftDock
  ...
  renderChanges={() => (
    <ChangesFace
      mode="session"
      onMode={() => {}}
      availableModes={(["session", "goal", "project"] as const).filter((mode) => !!resolveChangesContext({ mode, projectDir: currentProject(), activeSession: activeSessionId() ? { id: activeSessionId()!, title: "" } : null, sessionGoal: null, currentGoal: null }))}
      context={resolveChangesContext({ mode: "session", projectDir: currentProject(), activeSession: activeSessionId() ? { id: activeSessionId()!, title: "" } : null, sessionGoal: null, currentGoal: null })}
      sessionDiffs={contentDiffEntries()}
      onOpenFile={(rel) => { const root = contentRoot(); if (root) openFileInScope(rel, root, focusScopeFromContent(contentScope()), undefined, { persist: true }) }}
    />
  )}
/>
```
Also pass `changesBadge` / `changesDot` as `undefined` / `false` for now.

Add CSS for `.mafw-left-dock-changes`, `.mafw-changes-face`, `.mafw-changes-mode`, `.mafw-changes-section`, reusing `.mafw-change-*` tokens.

- [ ] **Step 4: Add wiring assertions**

Create `tests/changes-face-wiring.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("left dock exposes a changes face", () => {
  const dock = read("src/renderer/mafw/left-dock.ts")
  assert.match(dock, /"changes"/)
  const rail = read("src/renderer/mafw/components/IconRail.tsx")
  assert.match(rail, /key: "changes"/)
  assert.match(rail, /changesBadge/)
  const left = read("src/renderer/mafw/components/LeftDock.tsx")
  assert.match(left, /renderChanges/)
})

test("changes face reuses the change tree and has a mode selector", () => {
  const face = read("src/renderer/mafw/components/ChangesFace.tsx")
  assert.match(face, /buildChangeTree/)
  assert.match(face, /resolveChangesContext|ChangesContext/)
})
```

- [ ] **Step 5: Run tests and commit**

Run:
```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/changes/changes-context.test.ts src/renderer/mafw/left-dock.test.ts
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/changes-face-wiring.test.ts
```
Expected: PASS.

```bash
git add packages/desktop/src/renderer/mafw/changes packages/desktop/src/renderer/mafw/left-dock.ts packages/desktop/src/renderer/mafw/left-dock.test.ts packages/desktop/src/renderer/mafw/components/IconRail.tsx packages/desktop/src/renderer/mafw/components/LeftDock.tsx packages/desktop/src/renderer/mafw/components/ChangesFace.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/changes-face-wiring.test.ts
git commit -m "feat(desktop): add left changes face for session diffs"
```

---

### Task 2: Diff document store + unified tab sync

**Files:**
- Create: `packages/desktop/src/renderer/mafw/documents/diff-documents.ts`
- Create: `packages/desktop/src/renderer/mafw/documents/diff-documents.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/documents/document-tabs-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/documents/document-tabs-store.ts`
- Modify: `packages/desktop/src/renderer/mafw/documents/document-tabs-store.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/documents/document-toolbar-registry.ts`
- Modify: `packages/desktop/src/renderer/mafw/documents/document-toolbar-registry.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/document-frame-model.ts`

**Interfaces:**
- Produces:
```ts
export type DiffSource =
  | { kind: "session"; sessionID: string }
  | { kind: "goal"; podId: string; goalId: string; revision: number }
export type DiffDocument = {
  id: string
  source: DiffSource
  root: string
  scope: Scope
  rel: string
  patch: string
  additions: number
  deletions: number
  status?: string
  anchorLine?: number
  reviewItemId?: string
  title: string
}
export type OpenDiffInput = Omit<DiffDocument, "id" | "title"> & { title?: string }
export function diffSourceKey(source: DiffSource): string
export function diffDocumentId(source: DiffSource, rel: string): string
export function openDiffDocument(input: OpenDiffInput): DiffDocument
export function diffDocuments(): DiffDocument[]
export function activeDiffDocumentId(): string | null
export function activeDiffDocument(): DiffDocument | null
export function setActiveDiffDocument(id: string): void
export function updateDiffDocument(id: string, patch: Partial<Pick<DiffDocument, "patch" | "additions" | "deletions" | "anchorLine" | "reviewItemId">>): void
export function closeDiffDocument(id: string): void
export function clearDiffDocuments(): void
export function resetDiffDocumentsForTests(): void
```
- `document-tabs-store` adds `requestDocumentActivation(id: string): void` so a newly opened diff can become active once its entry exists without live patch updates stealing focus.
- `DocumentTabKind` adds `"diff"`; the diff id is owned by `diff-documents.ts` (`diff:<sourceKey>:<rel>`) so the model layer does not import the store.
- `DocumentTabIcon` adds `"review"`.

- [ ] **Step 1: Write the failing store tests**

Create `diff-documents.test.ts`:

```ts
import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import {
  activeDiffDocumentId, closeDiffDocument, diffDocuments, openDiffDocument,
  resetDiffDocumentsForTests, setActiveDiffDocument, updateDiffDocument,
} from "./diff-documents"

const base = {
  source: { kind: "session" as const, sessionID: "s1" },
  root: "C:/repo",
  scope: { kind: "world" as const, worldId: "C:/repo" },
  rel: "src/a.ts",
  patch: "@@ -1 +1 @@\n-a\n+b",
  additions: 1,
  deletions: 1,
}

beforeEach(() => resetDiffDocumentsForTests())

test("opening the same source+rel updates instead of duplicating", () => {
  const first = openDiffDocument(base)
  const second = openDiffDocument({ ...base, patch: "@@ -1 +1 @@\n-a\n+c", additions: 1, deletions: 1 })
  assert.equal(diffDocuments().length, 1)
  assert.equal(first.id, second.id)
  assert.match(second.patch, /\+c/)
  assert.equal(activeDiffDocumentId(), second.id)
})

test("closing the active diff falls back to the left neighbor", () => {
  const a = openDiffDocument(base)
  const b = openDiffDocument({ ...base, rel: "src/b.ts" })
  setActiveDiffDocument(b.id)
  closeDiffDocument(b.id)
  assert.equal(activeDiffDocumentId(), a.id)
})

test("update only changes the requested fields", () => {
  const doc = openDiffDocument(base)
  updateDiffDocument(doc.id, { anchorLine: 12 })
  assert.equal(diffDocuments()[0]!.anchorLine, 12)
  assert.equal(diffDocuments()[0]!.patch, base.patch)
})
```

Add to the store test:

```ts
test("a live diff update does not steal the active file tab", () => {
  syncFileTabs("C:/repo", [view("a.ts")])
  const fileId = documentTabs()[0]!.id
  activateDocumentTab(fileId)
  const doc = openDiffDocument({ ...base, rel: "src/a.ts" })
  activateDocumentTab(fileId)
  updateDiffDocument(doc.id, { patch: "@@ -1 +1 @@\n-a\n+c" })
  assert.equal(activeDocumentTabId(), fileId)
})
```

Add to `document-tabs-store.test.ts`:

```ts
test("diff documents become active diff tabs and are not persisted", () => {
  const storage = fakeStorage()
  configureDocumentListStorage(storage)
  configureDocumentListWorld("C:/repo")
  const doc = openDiffDocument({ ...base, rel: "src/a.ts" })
  requestDocumentActivation(doc.id)
  assert.deepEqual(documentTabs().map((entry) => entry.kind), ["diff"])
  assert.equal(documentTabs()[0]!.id, doc.id)
  assert.equal(activeDocumentTabId(), doc.id)
  flushDocumentListPersistence()
  const saved = JSON.parse(storage.map.get(documentListStorageKey("C:/repo"))!)
  assert.deepEqual(saved.order, [])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/documents/diff-documents.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store and tab sync**

Implement `diff-documents.ts` with `createSignal` arrays and the functions above. `diffSourceKey` returns `session:<sid>` or `goal:<podId>:<goalId>:<rev>`. `diffDocumentId` joins with `:`. `openDiffDocument` upserts by id; a new doc appends and becomes active; an existing doc updates patch/stats/anchor and becomes active.

Modify `document-tabs-model.ts`:
```ts
export type DocumentTabKind = "file" | "web" | "diff"
```
`diffDocumentId` lives in `diff-documents.ts`; do not import it into `document-tabs-model.ts` (avoids a `document-tabs-model → document-frame-model → diff-documents` cycle).

Modify `document-toolbar-registry.ts`:
```ts
const empty = (): Record<DocumentTabKind, DocumentToolbarProvider | null> => ({
  file: null,
  web: null,
  diff: null,
})
```
Add a registry test that `registerDocumentToolbar("diff", provider)` returns the provider.

Modify `document-frame-model.ts`:
```ts
export type DocumentTabIcon = "file" | "globe" | "review"
export function diffDocumentTabs(docs: readonly DiffDocument[], activeId: string | null): DocumentTabView[] {
  return docs.map((doc) => ({
    id: doc.id, label: doc.rel.split(/[\\/]/).pop() ?? doc.rel, title: `${doc.rel} · 改动`,
    icon: "review", active: doc.id === activeId,
  }))
}
```

Modify `document-tabs-store.ts`:
```ts
function syncDiffDocuments(): void {
  const incoming = diffDocuments().map((doc) => ({
    id: doc.id, kind: "diff" as const, view: { ...diffDocumentTabs([doc], null)[0]!, active: false },
  }))
  applyKind("diff", incoming)
}

export function requestDocumentActivation(id: string): void {
  desiredActiveId = id
  if (entries().some((entry) => entry.id === id)) setActiveId(id)
}
```
Change `applyKind`'s desired-active check to apply whenever the desired entry exists (not only when `activeId()` is null):
```ts
if (desiredActiveId && next.some((entry) => entry.id === desiredActiveId)) {
  setActiveId(desiredActiveId)
  desiredActiveId = null
}
```
`activateDocumentTab` already clears `desiredActiveId`, so a user click wins. `openDiffTab` in MafwShell calls `requestDocumentActivation(doc.id)` instead of relying on the sync effect. Add to the `createRoot` effects. In `persistOrder`, filter `entry.kind !== "diff"`; in `configureDocumentListWorld`, filter `savedOrder.filter((id) => !id.startsWith("diff:"))` and clear `desiredActiveId` if it starts with `diff:`. Add a close-request effect:
```ts
createEffect(() => {
  for (const id of pendingCloseRequests()) {
    if (!id.startsWith("diff:")) continue
    consumeCloseRequest(id)
    closeDiffDocument(id)
  }
})
```

- [ ] **Step 4: Run tests and commit**

Run:
```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/documents/diff-documents.test.ts src/renderer/mafw/documents/document-tabs-store.test.ts
```
Expected: PASS.

```bash
git add packages/desktop/src/renderer/mafw/documents packages/desktop/src/renderer/mafw/document-frame-model.ts
git commit -m "feat(desktop): add transient diff documents to the unified tab strip"
```

---

### Task 3: Diff tab view + focus integration

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/DiffDocumentView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/DiffReviewPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/diff-hunks.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/diff-hunks.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/DocumentStage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/FocusStage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/focus/stage-dispatch.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/focus-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/focus-model.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/focus-persistence.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/focus-persistence.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Create: `packages/desktop/tests/diff-tab-wiring.test.ts`

**Interfaces:**
- `SubjectRef` adds `{ kind: "diff"; source: "session" | "goal"; id: string; rel: string; line?: number }`.
- `stageKindFor(diff) = "diff"`.
- `DiffDocumentView` props:
```ts
export type DiffDocumentViewProps = {
  doc: DiffDocument
  onOpenFile: (doc: DiffDocument) => void
  onSendComment?: (sessionID: string, text: string) => void
  onAddAnnotation?: (a: { rel: string; startLine: number; endLine: number; code: string; comment: string }) => void
}
```
- `DiffReviewPanel` adds `chrome?: "panel" | "tab"` and `hint?: string | null`.

- [ ] **Step 1: Write the failing focus tests**

Add to `focus-model.test.ts`:

```ts
test("diff subjects have a stable identity and default to interact", () => {
  const subject: SubjectRef = { kind: "diff", source: "session", id: "diff:session:s1:src/a.ts", rel: "src/a.ts" }
  assert.equal(subjectKey(subject), "diff:session:diff:session:s1:src/a.ts:src/a.ts")
  assert.equal(lensesFor(subject).length, 0)
})
```

Add to `stage-dispatch.test.ts`:

```ts
test("diff subjects dispatch to the diff stage", () => {
  const focus: Focus = { scope: worldScope, subject: { kind: "diff", source: "session", id: "d1", rel: "src/a.ts" }, lens: "interact", place: {} }
  assert.equal(stageKindFor(focus), "diff")
})
```

Add to `diff-hunks.test.ts`:

```ts
test("diff patch signature changes when a hunk changes", () => {
  assert.equal(diffPatchSignature([{ file: "a.ts", patch: "@@ -1 +1 @@\n-a\n+b" }]),
    diffPatchSignature([{ file: "a.ts", patch: "@@ -1 +1 @@\n-a\n+b" }]))
  assert.notEqual(diffPatchSignature([{ file: "a.ts", patch: "@@ -1 +1 @@\n-a\n+b" }]),
    diffPatchSignature([{ file: "a.ts", patch: "@@ -1 +1 @@\n-a\n+c" }]))
})
```

Add to `focus-persistence.test.ts`:

```ts
test("diff focuses are transient and never round-trip", () => {
  const io = fakeStorage()
  resetFocusPersistence()
  configureFocusStorage(io)
  let state = openSubject(createWorkbenchState("w1"), worldScope, file)
  state = { ...state, stack: [...state.stack, { scope: worldScope, subject: { kind: "diff", source: "session", id: "d1", rel: "src/a.ts" }, lens: "interact", place: {} }] }
  saveFocusState(state)
  flushFocusPersistence("w1")
  resetFocusPersistence()
  configureFocusStorage(io)
  const loaded = loadFocusState("w1")
  assert.deepEqual(loaded?.stack.map((focus) => focus.subject.kind), ["file"])
})
```

Create `tests/diff-tab-wiring.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("document stage renders a diff pane and diff toolbar", () => {
  const stage = read("src/renderer/mafw/components/DocumentStage.tsx")
  assert.match(stage, /DiffDocumentView/)
  assert.match(stage, /activeKind\(\) === "diff"/)
  const view = read("src/renderer/mafw/components/DiffDocumentView.tsx")
  assert.match(view, /registerDocumentToolbar\("diff"/)
  assert.match(view, /DiffReviewPanel/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/focus-model.test.ts`
Expected: FAIL — diff subject not handled.

- [ ] **Step 3: Implement the view and focus routing**

- `stage-dispatch.ts`: add `| "diff"` to `StageKind`; return `"diff"` for `subject.kind === "diff"` **before** the lens applicability check.
- `focus-model.ts`: add the diff subject to `SubjectRef`; `subjectKey` returns `diff:<source>:<id>:<rel>`; `lensesFor(diff)` returns `[]`; `defaultLensFor(diff)` returns `"interact"`.
- `FocusStage.tsx`: `isDocument()` includes `"diff"`; pass `onOpenDiffFile` through to `DocumentStage`.
- `DocumentStage.tsx`: add a third pane:
```tsx
<div class="mafw-document-stage-pane" style={{ display: activeKind() === "diff" ? "contents" : "none" }}>
  <Show when={activeDiffDocument()}>
    {(doc) => <DiffDocumentView doc={doc()} onOpenFile={props.onOpenDiffFile} ... />}
  </Show>
</div>
```
- `DiffDocumentView.tsx`:
  - session source: `<DiffReviewPanel chrome="tab" sessionID={doc.source.sessionID} diffs={[doc]} initialFile={doc.rel} allowSessionFallback={false} onSendComment={...} onAddAnnotation={...} />`
  - goal source: `<DiffReviewPanel chrome="tab" previewOnly sessionID="" diffs={[doc]} allowSessionFallback={false} hint="此版本相对基线的差异" />`
  - `onMount` registers `registerDocumentToolbar("diff", ...)`: leading `打开文件` (calls `onOpenFile(doc)`), trailing `复制路径`; center shows `doc.rel`.
- `diff-hunks.ts`: add `diffPatchSignature(files: readonly { file?: string; patch?: string }[]): string` (join `file + "\u0000" + patch + "\u0000"`), so tests can pin the “patch changed” condition.
- `DiffReviewPanel.tsx`: when `chrome === "tab"`, hide its own header/hint; `hint` prop overrides/suppresses the default hint. Add a `createEffect` keyed on `diffPatchSignature(files())` that clears `selected` when it changes, so a live session diff never reverts with stale hunk indices.
- `ChangesFace.tsx`: add `onOpenSessionDiff?: (file: FileDiffEntry) => void` to props. Session tree rows call it when the file has a patch; otherwise keep `onOpenFile`. `MafwShell` passes `openDiffTab` with `source: { kind: "session", sessionID: currentSessionID()! }`, `root: contentRoot()!`, `scope: focusScopeFromContent(contentScope())`, and the file's patch/stats.
- `focus-persistence.ts`: diff subjects are transient; strip `subject.kind === "diff"` from `saveFocusState` / `persistNow` (or reject in `isSubject` and filter before writing). Add a round-trip test: a stack with `[file, diff]` loads as `[file]` after flush.
- `MafwShell.tsx`:
```ts
const openDiffTab = (input: OpenDiffInput) => {
  const doc = openDiffDocument(input)
  revealWorkbench()
  const next = selectFocus(seedWorldRoot(focusState(), input.scope), input.scope,
    { kind: "diff", source: input.source.kind, id: doc.id, rel: doc.rel, line: input.anchorLine }, "interact")
  setFocusState(next); syncStageToFocus(next); requestDocumentActivation(doc.id)
}
```
`focusDocumentTab` handles `entry.kind === "diff"`: find the doc, `selectFocus` with the diff subject, `activateDocumentTab`. `frameView` subject label for diff: `` `${subject.rel} · 改动` ``.
Pass `onOpenDiffFile={(doc) => openFileInScope(doc.rel, doc.root, doc.scope, doc.anchorLine, { persist: true })}`.

- [ ] **Step 4: Run tests and commit**

Run:
```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/focus-model.test.ts
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/diff-tab-wiring.test.ts
```
Expected: PASS.

```bash
git add packages/desktop/src/renderer/mafw/components/DiffDocumentView.tsx packages/desktop/src/renderer/mafw/components/DiffReviewPanel.tsx packages/desktop/src/renderer/mafw/components/DocumentStage.tsx packages/desktop/src/renderer/mafw/components/FocusStage.tsx packages/desktop/src/renderer/mafw/focus/stage-dispatch.ts packages/desktop/src/renderer/mafw/focus/focus-model.ts packages/desktop/src/renderer/mafw/focus/focus-model.test.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/diff-tab-wiring.test.ts
git commit -m "feat(desktop): render diff documents as first-class tabs"
```

---

### Task 4: Session deep link to the changes face

**Files:**
- Create: `packages/desktop/src/renderer/mafw/changes/changes-request.ts`
- Create: `packages/desktop/src/renderer/mafw/changes/changes-request.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChangesFace.tsx`
- Create: `packages/desktop/tests/changes-deeplink-wiring.test.ts`

**Interfaces:**
- Produces:
```ts
export type ChangesRequest = {
  seq: number
  context: ChangesContext
  section?: "review" | "changes"
  rel?: string
  line?: number
}
export function nextChangesRequest(
  previous: ChangesRequest | null,
  input: Omit<ChangesRequest, "seq">,
): ChangesRequest
```

- [ ] **Step 1: Write the failing request test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { nextChangesRequest } from "./changes-request"

test("each request gets a strictly increasing seq", () => {
  const a = nextChangesRequest(null, { context: { kind: "project" }, section: "changes" })
  const b = nextChangesRequest(a, { context: { kind: "project" }, section: "review" })
  assert.equal(a.seq, 1)
  assert.equal(b.seq, 2)
  assert.equal(b.section, "review")
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/changes/changes-request.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the deep link**

- `changes-request.ts`: `nextChangesRequest` returns `{ ...input, seq: (previous?.seq ?? 0) + 1 }`.
- `MafwShell.tsx`:
  - Add `const [changesMode, setChangesMode] = createSignal<ChangesMode>("session")`, `const [changesRequest, setChangesRequest] = createSignal<ChangesRequest | null>(null)`.
  - `openChangesFace(input)`:
```ts
const openChangesFace = (input: { context: ChangesContext; section?: "review" | "changes"; rel?: string; line?: number }) => {
  revealWorkbench()
  openLeftDockFace("changes")
  setChangesRequest((prev) => nextChangesRequest(prev, input))
}
```
  - Replace `ChatPane onOpenDiffReview={() => openProjectChangeSetFocus("review")}` with `onOpenDiffReview={() => openChangesFace({ context: sessionChangesContext(), section: "changes" })}`.
  - `sessionGoalRef(): GoalRef | null` resolves `goalSessionIdentity(podStore.detail(), currentSessionID())` to the matching `PodGoal`; `worktreeDir` is `null` until Task 5's `resolveGoalDir` runs.
  - `sessionChangesContext()` returns `{ kind: "session", sessionID: currentSessionID()!, goal: sessionGoalRef() }`.
- `ChangesFace.tsx`: accept `request?: ChangesRequest | null`; `createEffect(on(() => props.request?.seq, ...))` sets the mode to `request.context.kind` and scrolls to the requested section (`ref` on the section header). If `request.rel` is set, call `onOpenFile(request.rel)` after the mode switch? For v1, only section scroll + mode switch.
- Wiring test asserts `openChangesFace` / `nextChangesRequest` / `onOpenDiffReview`.

- [ ] **Step 4: Run tests and commit**

Run:
```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/changes/changes-request.test.ts
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/changes-deeplink-wiring.test.ts
```
Expected: PASS.

```bash
git add packages/desktop/src/renderer/mafw/changes/changes-request.ts packages/desktop/src/renderer/mafw/changes/changes-request.test.ts packages/desktop/src/renderer/mafw/components/ChangesFace.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/changes-deeplink-wiring.test.ts
git commit -m "feat(desktop): deep-link discussion changes into the left dock"
```

---

### Task 5: Goal revision changes in the left face

**Files:**
- Create: `packages/desktop/src/renderer/mafw/changes/goal-changes.ts`
- Create: `packages/desktop/src/renderer/mafw/changes/goal-changes.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChangesFace.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Create: `packages/desktop/tests/goal-changes-wiring.test.ts`

**Interfaces:**
- Produces:
```ts
export function toFileDiffEntries(files: readonly PodWorktreeDiffFile[]): FileDiffEntry[]
export function changeTotals(files: readonly FileDiffEntry[]): { files: number; additions: number; deletions: number }
export function goalDiffErrorText(status: number | null): string
export type GoalPin = { displayed: GoalRef | null; newerRevision: number | null }
export function pinGoalRevision(previous: GoalRef | null, incoming: GoalRef | null): GoalPin
```
- `ChangesFaceProps` adds:
```ts
resolveGoalDir?: (goal: GoalRef) => Promise<string | null>
onOpenDiff?: (input: OpenDiffInput) => void
```

- [ ] **Step 1: Write the failing normalizer test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { toFileDiffEntries, changeTotals, goalDiffErrorText, pinGoalRevision } from "./goal-changes"
import type { GoalRef } from "./changes-context"

const goal: GoalRef = { podId: "p1", goalId: "g1", revision: 2, title: "修复登录", worktreeDir: "C:/wt" }

test("maps worktree diff files and totals", () => {
  const files = toFileDiffEntries([
    { file: "src/a.ts", patch: "@@", additions: 3, deletions: 1, status: "modified" },
  ])
  assert.deepEqual(files[0], { file: "src/a.ts", patch: "@@", additions: 3, deletions: 1, status: "modified" })
  assert.deepEqual(changeTotals(files), { files: 1, additions: 3, deletions: 1 })
})

test("goal diff failures get neutral copy, never runtime names", () => {
  assert.match(goalDiffErrorText(404), /没有可预览的分支/)
  assert.match(goalDiffErrorText(409), /不可读/)
  assert.match(goalDiffErrorText(503), /不支持/)
  assert.doesNotMatch(goalDiffErrorText(503), /capability|runtime/i)
})

test("a newer revision is announced instead of replacing the pinned goal", () => {
  const pinned = pinGoalRevision(goal, { ...goal, revision: 3 })
  assert.equal(pinned.displayed?.revision, 2)
  assert.equal(pinned.newerRevision, 3)
  assert.equal(pinGoalRevision(pinned.displayed, { ...goal, goalId: "g2" }).displayed?.goalId, "g2")
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/changes/goal-changes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the goal section**

- `goal-changes.ts`: `toFileDiffEntries` maps `PodWorktreeDiffFile[]` to `FileDiffEntry[]` (same fields); `changeTotals` sums; `goalDiffErrorText(404)` → `这一版没有可预览的分支`, `409` → `分支差异不可读`, `503` → `当前 gateway 不支持分支差异预览`, else `变更集加载失败`. `pinGoalRevision(previous, incoming)` keeps `previous` when the same goal advances to a newer revision and reports `newerRevision`; a different goal replaces it.
- `ChangesFace.tsx`: hold `displayedGoal` signal; on `context.kind === "goal"` changes run `pinGoalRevision`; when `newerRevision` is non-null render `DockBanner` `有新版本 rev N · 切换` whose action sets `displayedGoal` to the incoming goal.
- When `context.kind === "goal"`, fetch:
```ts
window.api.mafw.pod.worktreeDiff(goal.podId, goal.goalId, goal.revision)
```
on `goal.podId/goalId/revision` changes. Render loading / error / empty / tree. On file click:
```ts
const root = goal.worktreeDir ?? await props.resolveGoalDir?.(goal)
if (!root) return // show "这一版的分支不可用"
props.onOpenDiff?.({
  source: { kind: "goal", podId: goal.podId, goalId: goal.goalId, revision: goal.revision },
  root, scope: { kind: "goal", worldId: props.projectDir!, goalId: goal.goalId, revision: goal.revision, worktreeDir: root },
  rel: file.file ?? "", patch: file.patch ?? "", additions: file.additions ?? 0, deletions: file.deletions ?? 0, status: file.status,
})
```
- `MafwShell.tsx`: compute `currentGoalRef()`:
  - `podGoalId()` → find goal in `podStore.detail()?.goals`; revision `activeRevision ?? revision ?? 1`.
  - fallback `activeFocus()?.scope.kind === "goal"` → same.
  - fallback active session goal via `goalSessionIdentity`.
  - `worktreeDir` from `resolveGoalWorktreeDir` cached in a signal map (or null; `ChangesFace` resolves lazily).
  - Pass `onOpenDiff={openDiffTab}` and `resolveGoalDir={(goal) => resolveGoalWorktreeDir(goal.podId, goal.goalId, currentProject()!)}`.
- Wiring test asserts `ChangesFace` calls `worktreeDiff` and `MafwShell` passes `onOpenDiff`.

- [ ] **Step 4: Run tests and commit**

Run:
```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/changes/goal-changes.test.ts
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/goal-changes-wiring.test.ts
```
Expected: PASS.

```bash
git add packages/desktop/src/renderer/mafw/changes packages/desktop/src/renderer/mafw/components/ChangesFace.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/goal-changes-wiring.test.ts
git commit -m "feat(desktop): show goal revision changes in the left dock"
```

---

### Task 6: Review items in the left face + Goal deep links + badge

**Files:**
- Create: `packages/desktop/src/renderer/mafw/changes/review-queue.ts`
- Create: `packages/desktop/src/renderer/mafw/changes/review-queue.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChangesFace.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/PodResultView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Create: `packages/desktop/tests/review-face-wiring.test.ts`

**Interfaces:**
- Produces:
```ts
export function countReviewAttention(
  items: readonly AttentionItem[],
  goalId?: string | null,
): number
export function reviewActionsVisible(accepted: boolean): boolean
```
- `PodResultView` adds `onOpenChanges?: (input: { section: "changes" | "review"; rel?: string; line?: number }) => void`.
- `ChangesFaceProps` adds `accepted?: boolean` and `onReviewChanged?: () => void`. `accepted` comes from the current Goal (`podStore.detail()?.goals.find(...)?.accepted === true`) and hides 解决/重开 actions.

- [ ] **Step 1: Write the failing badge test**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { countReviewAttention } from "./review-queue"

test("counts unresolved review attention, optionally scoped to one goal", () => {
  const items = [
    { id: "a", goalId: "g1", kind: "review_item" },
    { id: "b", goalId: "g1", kind: "review_item" },
    { id: "c", goalId: "g2", kind: "review_item" },
    { id: "d", goalId: "g1", kind: "question" },
  ] as any
  assert.equal(countReviewAttention(items), 3)
  assert.equal(countReviewAttention(items, "g1"), 2)
})

test("accepted goals never expose resolve/reopen actions", () => {
  assert.equal(reviewActionsVisible(false), true)
  assert.equal(reviewActionsVisible(true), false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/changes/review-queue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement review section + links + badge**

- `review-queue.ts`: count `kind === "review_item"` (dedupe by `id`), optional `goalId` filter.
- `ChangesFace.tsx`: when context has a goal, fetch `pod.reviewItems(goal.podId, goal.goalId, { revision: goal.revision })`; render compact rows with status, `rel:Lx`, comment snippet; expand shows comment / Tech Lead response / `确认解决` / `重新打开`; actions call `resolveReviewItem` / `reopenReviewItem`, then refresh and `props.onReviewChanged?.()`. If `props.accepted`, hide both actions. Clicking `rel:Lx` opens the matching diff tab if the file is in the current change set, otherwise opens a file tab at `line`.
- `ChangesFace.tsx` project mode: add props `goals: readonly PodGoal[]`, `sessions: readonly { id: string; title: string }[]`, `reviewCountForGoal?: (goalId: string) => number`, `onOpenGoal: (goalId: string) => void`, `onOpenSession: (sessionID: string) => void`. Render a Goal list (title, `rev N`, status, 待审 count) and a discussion list; clicking navigates. Do **not** fetch all diffs/review items.
- `PodResultView.tsx`: add a `改动面板` button near `查看本版变更` (`onOpenChanges?.({ section: "changes" })`), and a `在改动面板查看` button above `PodReviewItems` (`onOpenChanges?.({ section: "review" })`). Do not remove the existing inline review items or acceptance buttons.
- `GoalDetailPanel.tsx`: pass `onOpenChanges` through to `PodResultView`.
- `MafwShell.tsx`:
  - `activeGoalId()` = `currentGoalRef()?.goalId ?? null`.
  - `activeGoalAccepted()` = `!!podStore.detail()?.goals.find((goal) => goal.goalId === activeGoalId())?.accepted`.
  - `changesBadge` = `countReviewAttention(decisionStore.items(), activeGoalId())` for goal context, else `countReviewAttention(decisionStore.items())` for project, else 0.
  - `changesDot` = current session has diffs and no badge.
  - pass `accepted={activeGoalAccepted()}` to `ChangesFace`.
  - pass `goals={podStore.detail()?.goals ?? []}`, `sessions={sessions().map((s) => ({ id: s.id, title: s.title ?? "未命名" }))}`, `reviewCountForGoal={(goalId) => countReviewAttention(decisionStore.items(), goalId)}`, `onOpenGoal={(goalId) => openGoalFocus(goalId, "timeline")}`, `onOpenSession={(sid) => openSessionTab(sid)}`.
  - `openChangesFace` from `PodResultView` with `{ context: currentGoalRef() ? { kind:"goal", goal: currentGoalRef()! } : sessionChangesContext(), section }`.
- Wiring test asserts `PodResultView` has `onOpenChanges`, `ChangesFace` calls `reviewItems`, and `MafwShell` passes `changesBadge`.

- [ ] **Step 4: Run tests and commit**

Run:
```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/changes/review-queue.test.ts
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/review-face-wiring.test.ts
```
Expected: PASS.

```bash
git add packages/desktop/src/renderer/mafw/changes packages/desktop/src/renderer/mafw/components/ChangesFace.tsx packages/desktop/src/renderer/mafw/components/PodResultView.tsx packages/desktop/src/renderer/mafw/components/GoalDetailPanel.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/review-face-wiring.test.ts
git commit -m "feat(desktop): surface goal review items in the left dock"
```

---

### Task 7: Remove LensBar and 阅读/修改 intent

**Files:**
- Delete: `packages/desktop/src/renderer/mafw/components/LensBar.tsx`
- Delete: `packages/desktop/tests/lens-bar-wiring.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/FocusStage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/DocumentStage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/content-intent.ts`
- Modify: `packages/desktop/src/renderer/mafw/content-intent.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Modify: `packages/desktop/tests/design-contract.test.ts`
- Modify: `packages/desktop/tests/content-intent-wiring.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/content-scope-focus.test.ts`
- Modify: `packages/desktop/tests/focus-shell-wiring.test.ts`
- Create: `packages/desktop/tests/preview-promotion.test.ts`

**Interfaces:**
- `openModeForTab({ persist?: boolean }): "preview" | "persistent"`; no `intent`.
- `EditorDock` no longer accepts `intent` / `onIntent`.
- `FocusStage` / `DocumentStage` no longer accept `intent`.

- [ ] **Step 1: Write the failing wiring tests**

`preview-promotion.test.ts`:

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("editor promotes a preview tab on first user edit", () => {
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(editor, /promotePreview/)
  assert.match(editor, /onDocChanged/)
  assert.doesNotMatch(editor, /props\.intent/)
})

test("workbench no longer renders the lens bar", () => {
  const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  assert.doesNotMatch(shell, /LensBar/)
  assert.doesNotMatch(shell, /lenses=/)
})
```

Update `content-intent.test.ts`:
```ts
assert.equal(openModeForTab({}), "preview")
assert.equal(openModeForTab({ persist: true }), "persistent")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/preview-promotion.test.ts`
Expected: FAIL — `LensBar` still present / `props.intent` still present.

- [ ] **Step 3: Remove the bar and intent**

- Delete `LensBar.tsx`; remove `LensBar` import, `lenses` prop, and `<LensBar>` from `WorkbenchShell.tsx`; remove `lenses` from `WorkbenchShellProps`; remove the `.mafw-lens-bar` CSS block from `mafw.css`; delete `lens-bar-wiring.test.ts`.
- `MafwShell.tsx`: remove `focusLenses`, `focusLensForIntent`, `applyFocusLens`; remove `lenses={...}` and `onFocusLens` props. Simplify `openFileInScope` to drop the `intent` parameter and the `nextLens` computation; callers pass only `line` + `{ persist }`. Keep `Focus.lens` for Task 8.
- `FocusStage.tsx` / `DocumentStage.tsx`: remove `intent` prop and its pass-through.
- `EditorDock.tsx`: remove `intent` / `onIntent`; in `onDocChanged`, if the active file is a preview, `setModel((m) => promotePreview(m, f.rel))` before marking dirty. Remove the `intent === "editing"` effect.
- `content-intent.ts`: `openModeForTab` only reads `persist`; delete `ContentIntent` type if no callers remain (keep a deprecated alias only if needed for compile).
- Update tests that assert `activeFocus()?.lens === "edit"` or `applyFocusLens("review")`; replace with behavior assertions (no lens bar, diff tabs, left face).
- `design-contract.test.ts`: remove/update the `LensBar` expectation.

- [ ] **Step 4: Run tests and commit**

Run:
```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/preview-promotion.test.ts src/renderer/mafw/content-intent.test.ts
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/content-intent-wiring.test.ts src/renderer/mafw/content-scope-focus.test.ts tests/focus-shell-wiring.test.ts
```
Expected: PASS.

```bash
git add -A packages/desktop/src/renderer/mafw/components packages/desktop/src/renderer/mafw/content-intent.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests
git commit -m "refactor(desktop): remove the lens bar and reading/editing intent"
```

---

### Task 8: Remove the Lens model and persistence field

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/focus/focus-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/focus-model.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/focus-persistence.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/focus-persistence.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/picker-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/picker-model.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/stage-dispatch.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/goal-focus.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/goal-focus.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/legacy-migration.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/tests/focus-stack-wiring.test.ts`
- Modify: `packages/desktop/tests/goal-focus-wiring.test.ts`

**Interfaces:**
- `Focus = { scope: Scope; subject: SubjectRef; place: Place }`
- `openSubject(state, scope, subject)` / `selectFocus(state, scope, subject)` no lens parameter.
- `focus-persistence` accepts old snapshots with `lens` and ignores it; drops old `changeSet` / `reviewItem` / `evidence` subjects.

- [ ] **Step 1: Write the failing persistence test**

Add to `focus-persistence.test.ts`:

```ts
test("old snapshots with lens still load; lens is ignored", () => {
  const io = fakeStorage()
  io.data.set("mafw-focus:v1:w1", JSON.stringify({
    v: 1,
    stack: [{ scope: worldScope, subject: file, lens: "edit", place: {} }],
    kept: [],
  }))
  resetFocusPersistence()
  configureFocusStorage(io)
  const loaded = loadFocusState("w1")
  assert.equal(loaded?.stack[0]?.subject.kind, "file")
  assert.equal("lens" in (loaded?.stack[0] ?? {}), false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/focus-persistence.test.ts`
Expected: FAIL — `lens` still required / parsed.

- [ ] **Step 3: Remove the lens model**

- `focus-model.ts`: delete `Lens`, `lensesFor`, `defaultLensFor`, `isLensApplicable`, `replaceLens`; remove `lens` from `Focus`; update `openSubject` / `selectFocus` signatures and stack updates.
- `focus-persistence.ts`: stop validating/serializing `lens`; accept old snapshots leniently; drop subjects not in the target set.
- `picker-model.ts`: remove `lens` from `PickerItem` and all builders.
- `stage-dispatch.ts`: remove lens applicability checks; dispatch by subject.
- `goal-focus.ts`: remove lens arguments/defaults; keep goal / file / diff builders.
- `MafwShell.tsx`: remove `replaceLens` import/usage, `"interact"` / `"read"` lens arguments, and any `.lens` reads.
- Update tests: remove lens matrix assertions; assert subject keys and stack behavior instead.

- [ ] **Step 4: Run tests and commit**

Run:
```bash
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/focus-model.test.ts src/renderer/mafw/focus/focus-persistence.test.ts src/renderer/mafw/focus/picker-model.test.ts src/renderer/mafw/focus/goal-focus.test.ts src/renderer/mafw/focus/legacy-migration.test.ts
```
Expected: PASS.

```bash
git add packages/desktop/src/renderer/mafw/focus packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/focus-stack-wiring.test.ts packages/desktop/tests/goal-focus-wiring.test.ts
git commit -m "refactor(desktop): remove the focus lens model"
```

---

### Task 9: Delete changeSet / evidence / InstrumentRail dead code + docs

**Files:**
- Delete: `packages/desktop/src/renderer/mafw/components/InstrumentRail.tsx`
- Delete: `packages/desktop/src/renderer/mafw/components/ChangeSetStage.tsx`
- Delete: `packages/desktop/src/renderer/mafw/components/GoalChangeSetStage.tsx`
- Delete: `packages/desktop/src/renderer/mafw/components/ChangesDock.tsx`
- Delete: `packages/desktop/src/renderer/mafw/components/GoalReviewQueue.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/focus/stage-dispatch.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/focus-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/persistence` tests as needed
- Delete: `packages/desktop/tests/change-set-stage-wiring.test.ts`
- Delete: `packages/desktop/tests/goal-review-queue-wiring.test.ts`
- Delete: `packages/desktop/tests/instrument-rail-wiring.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/context-menu-wiring.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/workbench-review-fixes.test.ts`
- Modify: `packages/desktop/tests/focus-stage-wiring.test.ts`
- Modify: `packages/desktop/tests/design-contract.test.ts`
- Modify: `docs/architecture/desktop.md`
- Create: `docs/releases/2026-11-13-workbench-tabs-and-changes-face.md`

**Interfaces:**
- Remove `changeSet` / `reviewItem` / `evidence` from `SubjectRef`; remove their `subjectKey` / `stageKindFor` / `stageActionFor` branches.
- Remove `openProjectChangeSetFocus`, `openChangeSetFromFocus`, `openReviewAnchorToFocus`, `openReviewItemToFocus`, `instrumentRail` memo, `openReviewFromChat` review-lens branch, `GoalReviewQueue` import.
- `WorkbenchShell` removes `instrumentRail` prop, `.mafw-focus-rail-slot`, and `renderChangeSet` prop.
- `FocusStage` removes the `changeSet` Match and `renderChangeSet` prop.
- `MafwShell` removes the `renderChangeSet` JSX and `GoalChangeSetStage` / `ChangeSetStage` imports.
- Remove `.mafw-instrument-*` CSS and any `.mafw-change-set`-only CSS that becomes dead.

- [ ] **Step 1: Write the failing architecture/wiring test**

Add to `tests/diff-tab-wiring.test.ts`:

```ts
test("the lens and instrument rail chrome are gone", () => {
  const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  assert.doesNotMatch(shell, /InstrumentRail/)
  const focus = read("src/renderer/mafw/focus/focus-model.ts")
  assert.doesNotMatch(focus, /Lens/)
  assert.doesNotMatch(focus, /changeSet/)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test tests/diff-tab-wiring.test.ts`
Expected: FAIL — old symbols still present.

- [ ] **Step 3: Delete dead code and update docs**

- Remove the five components (`InstrumentRail`, `ChangeSetStage`, `GoalChangeSetStage`, `ChangesDock`, `GoalReviewQueue`); remove all callers/imports. Keep `change-tree.ts` (used by `ChangesFace`) and `DiffReviewPanel` (used by diff tabs and `PodResultView`).
- Remove `changeSet` / `reviewItem` / `evidence` from `SubjectRef`, `subjectKey`, `stageKindFor`, `stageActionFor`, and persistence validation.
- Replace remaining `openProjectChangeSetFocus` / `onOpenReview` callers with `openChangesFace` or file/diff tab opens.
- Remove `instrumentRail` from `WorkbenchShellProps`, `FocusStage` callers, and `MafwShell` memo.
- Delete the three wiring tests that assert the removed components; update `focus-stage-wiring.test.ts` (no `changeSet` Match), `design-contract.test.ts`, `context-menu-wiring.test.ts` (drop `ChangesDock.tsx` from its panel list), and `workbench-review-fixes.test.ts` (drop the `ChangesDock` / changeSet assertions).
- Update `docs/architecture/desktop.md`: document the left changes face, diff tabs, no lens bar; mark the stage-first lens section as superseded.
- Add release note with commits, tests, and boundaries (no gateway changes, acceptance unchanged, diff tabs ephemeral).

- [ ] **Step 4: Run full gates**

Run:
```bash
npm run test:desktop
npx tsgo --noEmit -p packages/desktop/tsconfig.json
cd packages/desktop && npx electron-vite build
```
Expected: all tests pass; `tsgo` rc=0; build rc=0.

- [ ] **Step 5: Commit**

```bash
git add -A packages/desktop docs/architecture/desktop.md docs/releases/2026-11-13-workbench-tabs-and-changes-face.md
git commit -m "refactor(desktop): retire lens, changeSet, and instrument rail chrome"
```

---

## Self-Review

- **Spec coverage:** §5 left rail/face → Tasks 1/6; §6 context/face → Tasks 1/4/5/6; §7 diff tab → Tasks 2/3; §8 deep links → Tasks 4/6; §9 lens/intent removal → Tasks 7/8/9; §10 data → Tasks 5/6; §11 slices → task order; §12 tests → each task + Task 9 full gates.
- **Review Focus:** unavailable context (Task 1), goal diff failure (Task 5), stale session diff (Task 3 notes + Task 2 update path), diff tab lifecycle (Task 2/3), human-only boundary (Task 6).
- **Type consistency:** `DiffDocument` / `OpenDiffInput` defined in Task 2 and consumed by Tasks 3/5; `ChangesContext` defined in Task 1 and consumed by Tasks 4/5/6; `ChangesRequest` defined in Task 4.
- **Proportion:** the plan carries interfaces and tests; implementation bodies are left to the engineer except where the spec pins behavior.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-13-workbench-tab-as-view-and-changes-dock.md`. Please review the plan. Which execution approach would you prefer?

- **Subagent-driven** — a fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.
- **Native** — I implement every task myself in this session, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end.

For this plan I recommend **Subagent-driven**, because the tasks touch shared focus/document/left-dock interfaces and a wrong root/scope or diff-tab lifecycle bug is expensive to catch late. Does the plan capture what you want, and which approach should we use?
