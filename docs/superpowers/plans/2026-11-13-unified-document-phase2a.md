# Unified Document Phase 2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the unified document strip reorderable by drag and persistent across restarts, including browser tabs, without moving editor/browser detailed state.

**Architecture:** The document store remains the order authority. A pure move helper reorders entries; a per-world persistence module stores id order/active; a global browser-tab persistence module restores URLs/titles/ids. `DocumentTabs` gets optional drag handlers; `DocumentStage` wires them to the store; `BrowserDock` restores once and persists on change; `MafwShell` configures the current world/storage.

**Tech Stack:** Electron + SolidJS + TypeScript, `node:test` + `@mafw/test-shim` (`--conditions=browser`), existing `DocumentTabs` primitives.

**Spec:** `docs/superpowers/specs/2026-11-13-unified-document-phase2-design.md`

## Global Constraints

- Do not migrate `EditorModel` / `BrowserTab` detailed state in this plan (that is 2C).
- Do not change webview sandbox/preload or split view.
- Tab order is the document store's order; body sync must not reorder it.
- Persist ids/order/active and browser URL/title only; never content, drafts, or webview state.
- Storage failures are fail-open; invalid entries are dropped.
- Tests run with `--conditions=browser`; hand-run single files need the same flag.
- Do not touch `.superpowers/e6-worktree`.

## Review Focus

1. **Order authority:** dragging A onto B reorders the unified strip and survives subsequent body syncs; closing/reopening does not resurrect moved positions.
2. **Cross-kind drag:** file ↔ web drag works; new tabs append; close-other/right keep Phase 1 semantics.
3. **Persistence isolation:** document order is per world; switching worlds doesn't leak or overwrite another world's order.
4. **Browser restore safety:** only http/https/mafw-file URLs restore; ids are stable and new tabs never collide; restore happens once.
5. **No false wipes:** browser restore must not persist an empty list before reading storage; document store must not persist before a world is configured.

---

### Task 1: Pure move helper

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/documents/document-tabs-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/documents/document-tabs-model.test.ts`

**Interfaces:**
```ts
export type DocumentDropPosition = "before" | "after"
export function moveDocumentTab(
  entries: readonly DocumentTabEntry[],
  fromId: string,
  toId: string,
  position: DocumentDropPosition,
): DocumentTabEntry[]
```

- [ ] **Step 1: Write failing tests**

Add:
- `[a,b,c]`, move `a` onto `c` `before` → `[b,a,c]`.
- `[a,b,c]`, move `a` onto `c` `after` → `[b,c,a]`.
- `[a,b,c]`, move `c` onto `a` `before` → `[c,a,b]`.
- `[a,b,c]`, move `c` onto `a` `after` → `[a,c,b]`.
- same id / missing id → same reference (no-op).
- cross-kind move (`file` + `web` entries) preserves entry objects.

- [ ] **Step 2: Run and verify failure**

```bash
cd packages/desktop
node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/documents/document-tabs-model.test.ts
```

- [ ] **Step 3: Implement**

Remove `fromId`; if `fromId === toId` return `entries`; if either missing return `entries`.
Find target in the remaining array; insert at `targetIndex + (position === "after" ? 1 : 0)`.
Return `entries` if the id order is unchanged.

- [ ] **Step 4: Run tests and commit**

Expected PASS. Commit `feat(desktop): add document tab move helper`.

---

### Task 2: Document list persistence

**Files:**
- Create: `packages/desktop/src/renderer/mafw/documents/document-list-persistence.ts`
- Create: `packages/desktop/src/renderer/mafw/documents/document-list-persistence.test.ts`

**Interfaces:**
```ts
export type DocumentListStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}
export type DocumentListSnapshot = {
  version: 1
  order: string[]
  activeId: string | null
}
export function configureDocumentListStorage(storage: DocumentListStorage | null): void
export function loadDocumentListSnapshot(worldId: string): DocumentListSnapshot
export function saveDocumentListSnapshot(worldId: string, snapshot: DocumentListSnapshot): void
export function flushDocumentListPersistence(): void
export function resetDocumentListPersistenceForTests(): void
export function documentListStorageKey(worldId: string): string
```

- key `mafw-document-list:v1:<worldId>`.
- Parse: drop non-string ids, dedupe, cap 100; invalid version → empty.
- Save: validate ids the same way; 300ms debounce per world; flush before world switches;
  storage failures ignored.
- `reset...ForTests` clears storage, pending timers, and restores default localStorage.

- [ ] **Step 1: Write failing tests**

Use a fake storage map. Cover roundtrip, world isolation, corrupt JSON, unknown version,
non-string/duplicate ids, 300ms flush behavior via `flushDocumentListPersistence`, and
`activeId` roundtrip.

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Implement following the existing `focus-persistence` pattern.**

- [ ] **Step 4: Run tests and commit**

Commit `feat(desktop): persist document tab order per world`.

---

### Task 3: Browser tab persistence + id reservation

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/browser-tabs.ts`
- Modify: `packages/desktop/src/renderer/mafw/browser-tabs.test.ts`
- Create: `packages/desktop/src/renderer/mafw/documents/browser-tabs-persistence.ts`
- Create: `packages/desktop/src/renderer/mafw/documents/browser-tabs-persistence.test.ts`

**Interfaces:**
```ts
export type PersistedBrowserTab = { id: string; url: string; title?: string }
export type BrowserTabsSnapshot = {
  version: 1
  activeId: string | null
  tabs: PersistedBrowserTab[]
}
export function configureBrowserTabsStorage(storage: DocumentListStorage | null): void
export function loadBrowserTabsSnapshot(): BrowserTabsSnapshot
export function saveBrowserTabsSnapshot(snapshot: BrowserTabsSnapshot): void
export function flushBrowserTabsPersistence(): void
export function resetBrowserTabsPersistenceForTests(): void
export function restoreBrowserTabsOnce(): number
```

- `restoreBrowserTabsOnce` opens each valid tab with its original id/title (skip ids already
  present), restores activeId, and marks restored. Returns restored count.
- Valid URL = `navigationDecision(url) === "allow"`; cap 12; dedupe ids.
- `openBrowserTab` with explicit `browser-tab-N` id must advance the module seq to N.
- Browser snapshot key `mafw-browser-tabs:v1`; 300ms debounce.

- [ ] **Step 1: Add failing `browser-tabs` test**

```ts
resetBrowserTabsForTests()
openBrowserTab("https://restored.example", { id: "browser-tab-7", newTab: true })
const next = openBrowserTab("https://next.example", { newTab: true })!
assert.notEqual(next.id, "browser-tab-1")
assert.equal(next.id, "browser-tab-8")
```

- [ ] **Step 2: Write failing persistence tests**

Protocol filtering (`javascript:`, `file:`, `data:` dropped; http/https/mafw-file kept),
dedupe, cap, id restore, active restore, restore-once semantics, seq collision.

- [ ] **Step 3: Implement browser id reservation and persistence module.**

- [ ] **Step 4: Run tests and commit**

Commit `feat(desktop): persist browser tabs across restarts`.

---

### Task 4: Store order authority + world configuration

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/documents/document-tabs-store.ts`
- Modify: `packages/desktop/src/renderer/mafw/documents/document-tabs-store.test.ts`

**Interfaces:**
```ts
export function configureDocumentListWorld(worldId: string): void
export function moveDocumentTab(fromId: string, toId: string, position: DocumentDropPosition): void
```

- Module vars: `worldId: string | null`, `savedOrder: string[]`, `hydratedActiveId: string | null`.
- `configureDocumentListWorld(worldId)`:
  - flush pending persistence for the previous world;
  - load snapshot;
  - set `savedOrder`; reorder current entries; set active if present and current active is null;
  - persist only after the world is set.
- `applyKind`:
  - `next = applySavedOrder(syncKindEntries(...))`;
  - no-op check unchanged;
  - prune savedOrder for ids present in previous but absent from next;
  - set entries; persist order/active.
- `moveDocumentTab` calls the pure helper, updates entries + savedOrder, persists.
- `activateDocumentTab` persists active.
- `resetDocumentTabsForTests` also clears world/savedOrder (but keeps storage config).

- [ ] **Step 1: Write failing store tests**

Cover:
- saved order `[web, fileA]` applied when file syncs first, then web;
- new id appends;
- closing prunes only removed ids;
- move reorders and writes snapshot (fake storage + flush);
- world switch loads a different order;
- no persistence before `configureDocumentListWorld`;
- not-yet-synced saved ids survive an early file sync.

- [ ] **Step 2: Run and verify failure.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run tests and commit**

Commit `feat(desktop): make document store the tab order authority`.

---

### Task 5: Drag-and-drop tab strip

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/document-frame.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/DocumentStage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Modify: `packages/desktop/tests/document-stage-wiring.test.ts`

**Interfaces:**
```ts
onReorder?: (fromId: string, toId: string, position: DocumentDropPosition) => void
```

- `DocumentTabs`:
  - `draggable={!!props.onReorder}`;
  - dragstart stores the id in a local signal and `dataTransfer`;
  - dragover computes before/after by `clientX` vs rect midpoint and sets a drop target;
  - drop calls `onReorder` and clears; dragend/dragleave clear.
- `DocumentStage` passes `moveDocumentTab`.
- CSS: `.is-dragging`, `.drop-before::before`, `.drop-after::after` using accent tokens.
- Do not enable drag in non-embedded EditorDock/BrowserDock.

- [ ] **Step 1: Write failing wiring tests**

Assert `DocumentTabs` contains `onReorder`, `draggable`, `onDragStart`, `onDragOver`, `onDrop`,
and `DocumentStage` passes `moveDocumentTab`; CSS has the three classes.

- [ ] **Step 2: Run and verify failure.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the document tests and commit**

Commit `feat(desktop): allow dragging document tabs`.

---

### Task 6: BrowserDock restore + persist

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/BrowserDock.tsx`
- Modify: `packages/desktop/tests/document-stage-wiring.test.ts`

- Add a restore effect **before** the persist effect:
  ```ts
  createEffect(() => { restoreBrowserTabsOnce() })
  createEffect(() => {
    saveBrowserTabsSnapshot({ version: 1, activeId: activeBrowserTabId(), tabs: tabs().map(...) })
  })
  ```
- Restore must run once per renderer; persist only after restore.
- Do not persist `loading` / `failed` / `canBack` / `canForward`.

- [ ] **Step 1: Write failing wiring tests**

Assert `restoreBrowserTabsOnce`, `saveBrowserTabsSnapshot`, and `activeBrowserTabId` usage.

- [ ] **Step 2: Implement and run targeted tests.**

- [ ] **Step 3: Commit** `feat(desktop): restore browser tabs on startup`.

---

### Task 7: MafwShell configuration

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/tests/unified-document-wiring.test.ts`

- In the existing storage bootstrap, configure document list + browser tab storage with
  `window.localStorage`.
- Add an effect:
  ```ts
  createEffect(() => configureDocumentListWorld(currentProject() ?? "unscoped"))
  ```
- Do not call it from render body directly.

- [ ] **Step 1: Write failing wiring assertions.**
- [ ] **Step 2: Implement and run targeted tests.**
- [ ] **Step 3: Commit** `feat(desktop): configure document persistence per world`.

---

### Task 8: Verification, smoke, docs

- [ ] `npm run test:desktop` → all pass.
- [ ] `node ../../node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p tsconfig.json` → rc=0.
- [ ] `node ../../node_modules/electron-vite/bin/electron-vite.js build` → rc=0.
- [ ] Live smoke on a fresh built app:
  1. Open a file + a web URL; drag the web tab before the file tab; verify order.
  2. Reload the renderer; verify the order and both tabs restore; webview reloads.
  3. Switch world/project; verify the other world keeps its own order.
  4. Close a tab; reload; verify it stays closed.
  5. No error overlay.
- [ ] Write `docs/releases/2026-11-13-unified-document-phase2a.md` with commits, tests, smoke.
- [ ] Update `docs/architecture/desktop.md` DocumentStage bullet with drag/persistence.
- [ ] Commit docs.

## Self-Review

- Spec coverage: drag, per-world order, browser restore, failure modes, no state migration.
- Type consistency: `DocumentDropPosition`, `DocumentListSnapshot`, `BrowserTabsSnapshot`,
  `configureDocumentListWorld`, `moveDocumentTab` names are used consistently.
- Each Review Focus has a test: order authority (Task 1/4/5), cross-kind (Task 1/4),
  persistence isolation (Task 2/4/7), restore safety (Task 3/6), no false wipes (Task 2/3/6/7).
