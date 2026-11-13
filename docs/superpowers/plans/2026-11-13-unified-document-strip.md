# Unified Document Strip (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put file and browser tabs into one ordered strip in the right dock, with cross-type select/close/context-menu, while editor and browser keep their existing detailed state.

**Architecture:** A pure `document-tabs-model` defines stable tab ids, merge order, next-active and close-target rules. A module store keeps the merged entries and a one-shot close-request queue; `EditorDock` and `BrowserDock` sync their own tab views and consume close requests. `DocumentStage` renders the shared `DocumentTabs` and keeps both bodies mounted; `MafwShell` maps tab selection/close back to the focus stack.

**Tech Stack:** Electron + SolidJS + TypeScript, `node:test` + `@mafw/test-shim` (`--conditions=browser`), existing `@mafw/ui` v2 components.

**Spec:** `docs/superpowers/specs/2026-11-13-unified-document-strip-design.md`

## Global Constraints

- Desktop tests must run with `--conditions=browser` (the package script already does).
- No split view, no changes to webview sandbox/preload, no cross-restart document-list persistence.
- Editor drafts/dirty/conflict and browser webview lifecycle stay in their existing modules.
- `DocumentFrame` / `DocumentTabs` / `DocumentToolbar` are the only tab/toolbar primitives.
- Tab order = open order; no drag reorder in this phase.
- Every behavior change gets a test; every task ends with a commit.
- Do not touch `.superpowers/e6-worktree` (E6 is another line).

## Review Focus

1. **Focus ↔ tab sync:** selecting a mixed tab must set the correct file/web focus subject and active tab without reopening/reloading the document; closing the active tab must land on the adjacent tab, then the picker.
2. **Order stability:** syncing from editor and browser must not interleave or reorder the other kind; a new tab appends; a removed tab disappears; view updates (dirty/loading/title) do not move it.
3. **Root isolation:** the same relative path in two content roots must produce two distinct file tab ids; switching root must not leave stale file tabs from the old root.
4. **Body lifetime:** switching between file and web must not reset the editor model or reload webviews; both bodies stay mounted.
5. **Close routing:** close/close-other/close-right must target the clicked tab, not the active one; close requests are consumed exactly once by the owning body.

---

### Task 1: Pure document tab model + menu builder

**Files:**
- Create: `packages/desktop/src/renderer/mafw/documents/document-tabs-model.ts`
- Create: `packages/desktop/src/renderer/mafw/documents/document-tabs-model.test.ts`
- Create: `packages/desktop/src/renderer/mafw/context-menu/builders/document-tab.ts`
- Create: `packages/desktop/src/renderer/mafw/context-menu/builders/document-tab.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/context-menu/labels.ts`

**Interfaces:**
- Produces:
```ts
export type DocumentTabKind = "file" | "web"
export type DocumentTabEntry = { id: string; kind: DocumentTabKind; view: DocumentTabView }
export function fileDocumentTabId(root: string, rel: string): string
export function webDocumentTabId(tabId: string): string
export function mergeDocumentTabs(previous: DocumentTabEntry[], incoming: DocumentTabEntry[]): DocumentTabEntry[]
export function syncKindEntries(previous: DocumentTabEntry[], kind: DocumentTabKind, incoming: DocumentTabEntry[]): DocumentTabEntry[]
export function nextDocumentTabId(entries: DocumentTabEntry[], closingId: string, activeId: string | null): string | null
export function closeOtherTabIds(entries: DocumentTabEntry[], keepId: string): string[]
export function closeRightTabIds(entries: DocumentTabEntry[], keepId: string): string[]
export function documentTabViews(entries: DocumentTabEntry[], activeId: string | null): DocumentTabView[]
```
- `buildDocumentTabMenu(target: DocumentTabMenuTarget): MenuModel`; target `{ kind, title, copyValue, canCloseOthers, canCloseRight }`.

- [ ] **Step 1: Write the failing model test**

Create `document-tabs-model.test.ts` with tests:
- file ids include root (`fileDocumentTabId("C:/a","x.ts") !== fileDocumentTabId("C:/b","x.ts")`).
- `mergeDocumentTabs([fileA, webB], [fileAUpdated, webB])` keeps `[fileA, webB]` and updates `fileA.view`.
- incoming new entries append: `[fileA]` + `[webB, fileC]` → `[fileA, webB, fileC]`.
- removed entries disappear.
- `syncKindEntries` with web incoming keeps file positions: `[fileA, webB, fileC]` + web `[webD]` → `[fileA, webD, fileC]`.
- `nextDocumentTabId([a,b,c], b, b) === a`; closing `a` active → `b`; closing last → previous.
- `closeOtherTabIds([a,b,c], b) === [a,c]`; `closeRightTabIds([a,b,c], b) === [c]`.
- `documentTabViews` marks only active id.

- [ ] **Step 2: Run the test to verify it fails**

Run:
`cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/documents/document-tabs-model.test.ts`
Expected: FAIL / module not found.

- [ ] **Step 3: Implement the model**

- `fileDocumentTabId` = `file:${root}\u0000${rel}`; `webDocumentTabId` = `web:${tabId}`.
- `mergeDocumentTabs` keeps previous order for surviving ids, appends new incoming ids, uses incoming views.
- `syncKindEntries` merges only the requested kind while preserving the other kind's positions.
- `nextDocumentTabId` picks the left neighbor, then right neighbor, then null.
- `documentTabViews` clones views with `active: entry.id === activeId`.

- [ ] **Step 4: Write the failing menu test**

Create `builders/document-tab.test.ts`:
- file tab menu ids: `documentTab.close`, `documentTab.closeOthers`, `documentTab.closeRight`, `documentTab.copyPath`.
- web tab menu ids: same close trio + `documentTab.copyLink`, `documentTab.openExternal`.
- single tab disables close-others; rightmost disables close-right; empty `copyValue` disables copy.
- `validateMenu(m)` returns `[]`.

- [ ] **Step 5: Run the menu test to verify it fails**

Run the test file; expected FAIL because the builder/labels are missing.

- [ ] **Step 6: Implement the menu builder and labels**

Add `documentTab: { close, closeOthers, closeRight, copyPath, copyLink, openExternal }` to `labels.ts`.
`buildDocumentTabMenu` returns the items above, with disabled reasons for impossible actions. Keep it within the menu validator limits.

- [ ] **Step 7: Run both tests and commit**

Run both test files; expected PASS.
Commit:
```bash
git add packages/desktop/src/renderer/mafw/documents/document-tabs-model.ts \
  packages/desktop/src/renderer/mafw/documents/document-tabs-model.test.ts \
  packages/desktop/src/renderer/mafw/context-menu/builders/document-tab.ts \
  packages/desktop/src/renderer/mafw/context-menu/builders/document-tab.test.ts \
  packages/desktop/src/renderer/mafw/context-menu/labels.ts
git commit -m "feat(desktop): add unified document tab model"
```

---

### Task 2: Reactive document tab store + close bus

**Files:**
- Create: `packages/desktop/src/renderer/mafw/documents/document-tabs-store.ts`
- Create: `packages/desktop/src/renderer/mafw/documents/document-tabs-store.test.ts`

**Interfaces:**
- Consumes Task 1 model.
- Produces:
```ts
export function documentTabs(): DocumentTabEntry[]
export function activeDocumentTabId(): string | null
export function activeDocumentTabKind(): DocumentTabKind | null
export function syncFileTabs(root: string, views: DocumentTabView[]): void
export function syncWebTabs(views: DocumentTabView[]): void
export function activateDocumentTab(id: string): void
export function requestCloseDocumentTab(id: string): void
export function pendingCloseRequests(): readonly string[]
export function consumeCloseRequest(id: string): void
export function closeOtherDocumentTabs(id: string): void
export function closeDocumentTabsToRight(id: string): void
export function resetDocumentTabsForTests(): void
```

- [ ] **Step 1: Write the failing store test**

Tests:
- `syncFileTabs("C:/a", [file("a.ts")])` then `syncWebTabs([web("w1")])` yields file then web.
- a second `syncFileTabs` with an updated view changes dirty but not order.
- `syncFileTabs("C:/a", [])` removes only file entries, leaves web.
- two roots produce distinct file ids; syncing root B replaces root A's file entries.
- `activateDocumentTab` updates active id; unknown id is a no-op.
- `closeOtherDocumentTabs(keep)` enqueues all other ids; `closeDocumentTabsToRight(keep)` enqueues right-side ids; duplicate request is deduped.
- `consumeCloseRequest` removes exactly one request; `reset` clears entries/active/requests.

- [ ] **Step 2: Run the test to verify it fails**

Run the store test; expected FAIL / module not found.

- [ ] **Step 3: Implement the store**

Use `createSignal<DocumentTabEntry[]>` and `createSignal<readonly string[]>` for close requests. `syncFileTabs` maps views with `fileDocumentTabId(root, view.id)` and calls `syncKindEntries(state, "file", incoming)`. `syncWebTabs` maps `webDocumentTabId(view.id)`. Do not auto-change active on sync; `activateDocumentTab` is explicit. `requestCloseDocumentTab` dedupes.

- [ ] **Step 4: Run the store test and commit**

Expected PASS.
Commit with message `feat(desktop): add unified document tab store`.

---

### Task 3: DocumentStage + embedded editor/browser

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/DocumentStage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/BrowserDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/FocusStage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Create: `packages/desktop/tests/document-stage-wiring.test.ts`
- Modify: `packages/desktop/tests/document-frame-wiring.test.ts`

**Interfaces:**
- Consumes Task 1/2.
- `DocumentStageProps`:
```ts
{
  renderEditor: (activeRel: string | null) => JSX.Element
  renderBrowser: (activeTabId: string | null) => JSX.Element
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseMany: (ids: readonly string[]) => void
}
```
- `EditorDock` new props: `embedded?: boolean`, `activeRel?: string | null`.
- `BrowserDock` new props: `embedded?: boolean`, `activeTabId?: string | null`.
- `FocusStage` / `WorkbenchShell` new prop `renderDocument?: () => JSX.Element`.

- [ ] **Step 1: Write the failing wiring test**

`document-stage-wiring.test.ts` asserts:
- `DocumentStage` imports `DocumentTabs`, `documentTabs`, `documentTabViews`, `buildDocumentTabMenu`.
- It renders both `renderEditor` and `renderBrowser` inside wrappers with `mafw-document-stage-pane`.
- `FocusStage` has a `renderDocument` branch for `editor` and `browser` kinds.
- `WorkbenchShell` accepts/passes `renderDocument`.
- `EditorDock`/`BrowserDock` sources include `embedded` and sync calls (`syncFileTabs` / `syncWebTabs`) and close-request consumption.

- [ ] **Step 2: Run the test to verify it fails**

Expected FAIL.

- [ ] **Step 3: Implement `DocumentStage`**

Render:
```tsx
<div class="mafw-document-stage">
  <DocumentTabs
    items={documentTabViews(documentTabs(), activeDocumentTabId())}
    ariaLabel="打开的文档"
    onSelect={props.onSelect}
    onClose={props.onClose}
    onMiddleClick={props.onClose}
    onContextMenu={(id, event) => requestDocumentTabMenu(id, event)}
  />
  <div class="mafw-document-stage-body">
    <div class="mafw-document-stage-pane" style={{ display: activeKind === "file" ? "contents" : "none" }}>
      {props.renderEditor(activeFileRel())}
    </div>
    <div class="mafw-document-stage-pane" style={{ display: activeKind === "web" ? "contents" : "none" }}>
      {props.renderBrowser(activeWebTabId())}
    </div>
  </div>
</div>
```
The context menu uses `buildDocumentTabMenu` with `kind`, `copyValue` (path/url), `canCloseOthers`, `canCloseRight`; copy actions use `navigator.clipboard`, web external uses `window.api.browser.openExternal`; close actions call `onClose`/`onCloseMany`.

- [ ] **Step 4: Embed EditorDock/BrowserDock**

- `EditorDock`: add `embedded`, `activeRel`; if embedded, return `toolbar` + `body` without `DocumentFrame`/`DocumentTabs`; otherwise keep current full render. Add `createEffect(() => syncFileTabs(props.contentRoot ?? "", tabs()))`; add close-request effect that closes matching file ids; add `createEffect` to `activateRel(props.activeRel)` when it changes.
- `BrowserDock`: same with `syncWebTabs(browserDocumentTabs(tabs(), activeBrowserTabId()))`, close requests for `web:` ids, and `setActiveBrowserTab(props.activeTabId)` effect. Embedded render excludes `DocumentFrame`/`DocumentTabs`.
- Ensure inactive body toolbar is hidden with its wrapper.

- [ ] **Step 5: Wire FocusStage/WorkbenchShell**

- `FocusStage` adds `renderDocument?: () => JSX.Element`; for `kind() === "editor" || kind() === "browser"`, render `props.renderDocument?.() ?? <DockEmpty ... />`.
- `WorkbenchShell` adds and forwards `renderDocument`.

- [ ] **Step 6: Add CSS and run tests**

Add `.mafw-document-stage`, `.mafw-document-stage-body`, `.mafw-document-stage-pane` minimal flex/none rules.
Run `document-stage-wiring`, `document-frame-wiring`, and the existing `EditorDock`/`BrowserDock` tests.
Commit with message `feat(desktop): mount unified document stage`.

---

### Task 4: Shell routing, live smoke, docs

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Create/modify: `packages/desktop/tests/unified-document-wiring.test.ts`
- Create: `docs/releases/2026-11-13-unified-document-strip.md`
- Modify: `docs/architecture/desktop.md`

**Interfaces:**
- Consumes Task 2/3.
- `MafwShell` produces:
```ts
const focusDocumentTab = (id: string): void
const closeDocumentTab = (id: string): void
const closeDocumentTabs = (ids: readonly string[]): void
```
- `renderDocument` callback passed to `WorkbenchShell`.

- [ ] **Step 1: Write the failing shell wiring test**

Assert `MafwShell.tsx` contains:
- `focusDocumentTab` / `closeDocumentTab` / `closeDocumentTabs`;
- `renderDocument={` and `DocumentStage`;
- `renderEditor` / `renderBrowser`;
- `activateDocumentTab` / `requestCloseDocumentTab` / `nextDocumentTabId`;
- `EditorDock` receives `embedded` and `activeRel`;
- `BrowserDock` receives `embedded` and `activeTabId`.

- [ ] **Step 2: Run the test to verify it fails**

Expected FAIL.

- [ ] **Step 3: Implement shell routing**

- `focusDocumentTab(id)`: find entry; if file, set focus to `{kind:"file",root,rel}` using the entry id or view title; if web, set focus to `{kind:"web",url}`; call `activateDocumentTab(id)`. Do not call `requestBrowserNavigate` or `requestFocusOpen`.
- `closeDocumentTab(id)`: compute `next = nextDocumentTabId(documentTabs(), id, activeDocumentTabId())`; `requestCloseDocumentTab(id)`; if id was active, focus next or `showWorkbenchLanding()`.
- `closeDocumentTabs(ids)`: request all; if active was among them, focus the first surviving entry or landing.
- Add a focus sync effect: file focus → `activateDocumentTab(fileDocumentTabId(root, rel))`; web focus → find matching web entry by `view.title === url` (prefer active browser tab) and activate.
- Pass `renderDocument` to `WorkbenchShell` with `DocumentStage` and `EditorDock embedded activeRel` / `BrowserDock embedded activeTabId`.

- [ ] **Step 4: Run desktop full + tsgo + build**

Run:
- `npm run test:desktop` → expected all pass
- `node ../../node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p tsconfig.json` → rc=0
- `node ../../node_modules/electron-vite/bin/electron-vite.js build` → rc=0

- [ ] **Step 5: Live smoke**

With dev app + CDP:
1. Open a file from the left files tree → file tab appears.
2. Open a browser URL from the address bar → file and web tabs share one strip.
3. Switch tabs both directions → editor state persists; webview does not reload.
4. Close active / active-adjacent / close-others / close-right → next active correct; last close returns to picker.
5. Right-click file vs web tab → copy path/link and external open appear correctly.
6. No Vite error overlay.

- [ ] **Step 6: Docs + commit**

Write `docs/releases/2026-11-13-unified-document-strip.md` with commits, scope, tests, live smoke, deferred Phase 2.
Update `docs/architecture/desktop.md` DocumentFrame bullet: one strip, both bodies mounted, Phase 2 state migration deferred.
Commit with message `docs: record unified document strip`.

---

## Self-Review

- Spec coverage: mixed strip, select/close/context menu, body lifetime, root isolation, focus routing, no persistence/state migration — each maps to Tasks 1–4.
- Type consistency: `DocumentTabEntry`, `fileDocumentTabId` / `webDocumentTabId`, `syncFileTabs` / `syncWebTabs`, `activeDocumentTabId`, `nextDocumentTabId`, `buildDocumentTabMenu` are used consistently.
- Review Focus lines each have a test: focus↔tab sync (Task 4 wiring + smoke), order stability (Task 1/2), root isolation (Task 2), body lifetime (Task 3 wiring + smoke), close routing (Task 1/2/4).
- Deferred: detailed state migration, drag reorder, cross-restart doc list persistence, unified toolbar registration.
