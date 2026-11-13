# Unified Document Phase 2B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move toolbar rendering out of embedded editor/browser bodies into the document layer. Bodies register their toolbar slots; `DocumentStage` renders exactly one toolbar for the active document.

**Architecture:** A module registry maps `DocumentTabKind` → a provider that returns `DocumentToolbarSlots` (`ariaLabel` + optional `leading` / `center` / `trailing` render functions). `EditorDock` and `BrowserDock` register in `onMount` and unregister on cleanup; their embedded branch returns only the body. `DocumentStage` selects the active kind's provider and renders a single `DocumentToolbar`.

**Tech Stack:** Electron + SolidJS + TypeScript, `node:test` + `@mafw/test-shim` (`--conditions=browser`).

**Spec:** `docs/superpowers/specs/2026-11-13-unified-document-phase2-design.md` §2B

## Global Constraints

- Do not change webview sandbox/preload, split view, or editor/browser state ownership (2C).
- Toolbar actions remain owned by the body (save, preview, back/forward, address, pick, external).
- `DocumentStage` renders at most one toolbar; hidden bodies must not leave a second toolbar in the DOM.
- Non-embedded editor/browser rendering must keep working (they still render `DocumentFrame` + their own toolbar).
- Tests run with `--conditions=browser`; do not touch `.superpowers/e6-worktree`.

## Review Focus

1. **Single owner:** with file + web tabs open, the DOM contains exactly one `.mafw-document-toolbar`, and it switches content with active kind.
2. **Action fidelity:** editor save/preview/changes and browser back/forward/refresh/address/pick/external all still work from the shared toolbar.
3. **No remount of bodies:** toolbar extraction must not remount `EditorDock` / `BrowserDock` or reload webviews.
4. **Registry lifetime:** body unmount unregisters only its own provider; the other kind remains.
5. **Non-embedded fallback:** the old inline toolbar path remains intact for any future standalone use.

---

### Task 1: Toolbar slot registry

**Files:**
- Create: `packages/desktop/src/renderer/mafw/documents/document-toolbar-registry.ts`
- Create: `packages/desktop/src/renderer/mafw/documents/document-toolbar-registry.test.ts`

**Interfaces:**
```ts
export type DocumentToolbarSlots = {
  ariaLabel: string
  leading?: () => JSX.Element
  center?: () => JSX.Element
  trailing?: () => JSX.Element
}
export type DocumentToolbarProvider = () => DocumentToolbarSlots
export function registerDocumentToolbar(kind: DocumentTabKind, provider: DocumentToolbarProvider): () => void
export function documentToolbarProvider(kind: DocumentTabKind): DocumentToolbarProvider | null
export function resetDocumentToolbarRegistryForTests(): void
```

- [ ] **Step 1: Write failing registry tests**
  - register file provider → read it back;
  - web provider independent;
  - unregister removes only its kind;
  - unregister twice / wrong provider is a no-op;
  - reset clears both.
- [ ] **Step 2: Run and verify failure.**
- [ ] **Step 3: Implement with `createSignal` map.**
- [ ] **Step 4: Run tests and commit** `feat(desktop): add document toolbar registry`.

---

### Task 2: DocumentStage renders the active toolbar

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/DocumentStage.tsx`
- Modify: `packages/desktop/tests/document-stage-wiring.test.ts`

- Import `DocumentToolbar` and `documentToolbarProvider`.
- Add:
  ```ts
  const toolbar = createMemo(() => {
    const kind = activeKind()
    return kind ? documentToolbarProvider(kind)?.() ?? null : null
  })
  ```
- Render between tabs and body:
  ```tsx
  <Show when={toolbar()}>
    {(spec) => (
      <DocumentToolbar
        ariaLabel={spec().ariaLabel}
        leading={spec().leading?.()}
        center={spec().center?.()}
        trailing={spec().trailing?.()}
      />
    )}
  </Show>
  ```
- [ ] **Step 1: Write failing wiring assertions** (`DocumentToolbar`, `documentToolbarProvider`, `spec().leading`).
- [ ] **Step 2: Implement and run targeted tests.**
- [ ] **Step 3: Commit** `feat(desktop): render document toolbar in stage`.

---

### Task 3: EditorDock registers its toolbar

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`
- Modify: `packages/desktop/tests/document-stage-wiring.test.ts`
- Modify: `packages/desktop/tests/document-frame-wiring.test.ts` if needed.

- Extract the existing toolbar JSX into:
  ```ts
  const toolbarSlots = (): DocumentToolbarSlots => ({
    ariaLabel: "编辑器工具栏",
    leading: () => (<>…existing save/external…</>),
    trailing: () => (<>…existing preview/inline diff/changes…</>),
  })
  ```
- Register in `onMount` (not during render):
  ```ts
  onMount(() => {
    const unregister = registerDocumentToolbar("file", toolbarSlots)
    onCleanup(unregister)
  })
  ```
- Split the render:
  - build `body = <div class="mafw-editor-dock">…</div>`;
  - `if (props.embedded) return body`;
  - otherwise return `<DocumentFrame tabs={...} toolbar={<DocumentToolbar {...} />}>{body}</DocumentFrame>`.
- Keep the non-embedded `DocumentToolbar` using the same slots so the old path stays working.
- [ ] **Step 1: Add failing wiring assertions** (`registerDocumentToolbar("file"`, `props.embedded ? body` style, no `DocumentFrame` before embedded return).
- [ ] **Step 2: Implement and run `document-stage-wiring`, `document-frame-wiring`.**
- [ ] **Step 3: Commit** `feat(desktop): register editor toolbar with document stage`.

---

### Task 4: BrowserDock registers its toolbar

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/BrowserDock.tsx`
- Modify: `packages/desktop/tests/document-stage-wiring.test.ts`.

- Same split as editor, registering `"web"`.
- Preserve the dock-level context menu in embedded mode by attaching `onContextMenu={props.embedded ? requestDockMenu : undefined}` to `.mafw-browser-dock`.
- [ ] **Step 1: Add failing wiring assertions** (`registerDocumentToolbar("web"`, embedded body context menu).
- [ ] **Step 2: Implement and run targeted tests.**
- [ ] **Step 3: Commit** `feat(desktop): register browser toolbar with document stage`.

---

### Task 5: Verification, smoke, docs

- [ ] `npm run test:desktop` → all pass.
- [ ] `tsgo --noEmit -p tsconfig.json` → rc=0.
- [ ] `electron-vite build` → rc=0.
- [ ] Live smoke (fresh built app, CDP 9224):
  1. Open a file + web URL; assert exactly one `.mafw-document-toolbar` in the DOM.
  2. Switch file ↔ web; toolbar content/aria changes, editor state and webview persist.
  3. File toolbar: save button present/disabled correctly; preview/changes buttons for a markdown file.
  4. Web toolbar: address input shows URL; back/forward/refresh/pick/external present.
  5. No error overlay.
- [ ] Write `docs/releases/2026-11-13-unified-document-phase2b.md`.
- [ ] Update `docs/architecture/desktop.md` DocumentStage bullet.
- [ ] Commit docs.

## Self-Review

- Spec coverage: 2B toolbar registration only; 2C state migration untouched.
- Names consistent: `DocumentToolbarSlots`, `DocumentToolbarProvider`, `registerDocumentToolbar`,
  `documentToolbarProvider`.
- Each Review Focus has a test or smoke check: single owner (Task 2/5), action fidelity (Task 3/4/5),
  no remount (Task 5), registry lifetime (Task 1), non-embedded fallback (Task 3/4/5).
