# Main Area Chat-Only / Workbench Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Approvals, Triage, Automations, MCP and Config into the right workbench as focus pages, leaving the main area with chat only.

**Architecture:** Add one generic `{ kind: "page"; id }` focus subject plus persistent `scene:page:<id>` tabs. `WorkbenchShell` / `FocusStage` render the page through a `renderPage(id)` slot; every page gets a `compact` mode. The main content drops every non-chat `activeTab` branch and the `showConfig` main render.

**Tech Stack:** SolidJS, TypeScript, `@mafw/ui` v2, Electron renderer, Node test runner (`node --test` + test shim).

**Spec:** `docs/superpowers/specs/2026-11-19-workbench-pages-design.md`

## Global Constraints

- Desktop renderer only; no Gateway / runtime contract changes.
- Main area renders chat (and Welcome) only; no page may replace it.
- Human-only approval / acceptance semantics must not change.
- Use `@mafw/ui` v2 components; no bare `button` / `input`.
- Use theme tokens; no raw colors.
- Tests run with `--conditions=browser`.
- Keep `projectDir={benchRoot() ?? undefined}` on ConfigPage (regression guarded by `config-discovery-scope.test.ts`).
- Every task ends with a commit; run the focused tests before committing.

## Review Focus

1. **Config forms at 640px** — a section that overflows horizontally is a failed move. Verify gateway / models / plugins / usage / keybindings in the dock.
2. **Approvals action row** — three buttons plus a command preview must wrap, and `onPermissionReply` must keep its exact `"once" | "always" | "reject"` semantics.
3. **Legacy `activeTab` paths** — a deep link or palette item that still calls `setActiveTab("approvals")` would blank the main area; guard and source-scan against it.
4. **Dock page persistence** — switching sessions or clicking chat must not close the page; only FrameBar back / tab close may.
5. **Page focus identity** — `subjectKey`, scene tab id and `stageKindFor` must agree on `page:<id>`; a mismatch duplicates tabs or renders an empty stage.

---

### Task 1: Generic page subject + scene tab + renderPage slot

**Files:**
- Create: `packages/desktop/src/renderer/mafw/focus/workbench-pages.ts`
- Create: `packages/desktop/src/renderer/mafw/focus/workbench-pages.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/focus-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/focus-model.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/stage-dispatch.ts`
- Modify: `packages/desktop/src/renderer/mafw/focus/stage-dispatch.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/documents/scene-tabs.ts`
- Modify: `packages/desktop/src/renderer/mafw/documents/scene-tabs.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/document-frame-model.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/FocusStage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Create: `packages/desktop/src/renderer/mafw/workbench-pages-wiring.test.ts`

**Interfaces:**
- Produces: `WORKBENCH_PAGE_IDS`, `WorkbenchPageId`, `WORKBENCH_PAGE_META`.
- Produces: `SubjectRef` variant `{ kind: "page"; id: WorkbenchPageId }`.
- Produces: `openPageFocus(id: WorkbenchPageId): void` in `MafwShell`.
- Produces: `renderPage?: (id: WorkbenchPageId) => JSX.Element` on `WorkbenchShell` / `FocusStage`.
- Consumes: existing `revealWorkbench()`, `openSceneTab()`, `openSubject()`, `seedWorldRoot()`.

- [ ] **Step 1: Write the failing page-meta test**

`workbench-pages.test.ts`:
```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { WORKBENCH_PAGE_IDS, WORKBENCH_PAGE_META } from "./workbench-pages"

test("every page has a label and an icon", () => {
  for (const id of WORKBENCH_PAGE_IDS) {
    assert.ok(WORKBENCH_PAGE_META[id].label)
    assert.ok(WORKBENCH_PAGE_META[id].icon)
  }
  assert.equal(WORKBENCH_PAGE_META.config.label, "设置")
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/focus/workbench-pages.test.ts`
Expected: FAIL — `workbench-pages` does not exist.

- [ ] **Step 3: Implement `workbench-pages.ts`**

```ts
export const WORKBENCH_PAGE_IDS = ["approvals", "triage", "automation", "mcp", "config"] as const
export type WorkbenchPageId = (typeof WORKBENCH_PAGE_IDS)[number]
export const WORKBENCH_PAGE_META: Record<WorkbenchPageId, { label: string; icon: string }> = {
  approvals: { label: "审批", icon: "checklist" },
  triage: { label: "分诊", icon: "warning" },
  automation: { label: "自动化", icon: "sliders" },
  mcp: { label: "MCP", icon: "mcp" },
  config: { label: "设置", icon: "settings-gear" },
}
```

- [ ] **Step 4: Add the page subject to `focus-model.ts` and its test**

Test: `page subject has a stable key and opens on the world scope` (key `page:triage`, subject kind `page`). Add:
```ts
| { kind: "page"; id: WorkbenchPageId }
```
and `case "page": return \`page:${subject.id}\``.

- [ ] **Step 5: Add page to stage dispatch**

`StageKind` adds `"page"`; `stageKindFor` returns `"page"` for `subject.kind === "page"`.
Test: `page subjects dispatch to the page stage`.

- [ ] **Step 6: Add page to scene tabs**

`SceneSubject` includes `page`; `sceneTabId` returns `scene:page:${id}`; `defaultLabel` / `defaultIcon` read `WORKBENCH_PAGE_META`; `isPersistentSceneSubject` returns true; `sceneTabForSubject` accepts page; `isSceneSubject` validates `WORKBENCH_PAGE_IDS.includes(value.id)`; `ICONS` includes `checklist`, `warning`, `sliders`, `mcp`, `settings-gear`.

Tests: add `sceneTabId({ kind: "page", id: "triage" }) === "scene:page:triage"` and a test that `openSceneTab` for page gives label / icon / persistent.

- [ ] **Step 7: Add the icons to `DocumentTabIcon`**

Add `"checklist" | "warning" | "sliders" | "mcp" | "settings-gear"`; `documentTabIconName` default returns the icon (no mapping needed).

- [ ] **Step 8: Wire `FocusStage` / `WorkbenchShell`**

`FocusStage` props add `renderPage?: (id: WorkbenchPageId) => JSX.Element`; add a `pageId()` getter and a `kind() === "page"` Match rendering `<div class="mafw-focus-page-stage">{props.renderPage?.(pageId()!)}</div>`.
`WorkbenchShell` props add `renderPage` and pass it to `FocusStage`.
Update `workbench-shell-focus.test.ts` to assert `kind() === "page"` and `renderPage`.

- [ ] **Step 9: Wire `MafwShell`**

Add `activePageId` memo and `openPageFocus`:
```ts
const openPageFocus = (id: WorkbenchPageId) => {
  revealWorkbench()
  const worldScope: Scope = { kind: "world", worldId: currentProject() ?? "unscoped" }
  openSceneTab({ subject: { kind: "page", id }, scope: worldScope })
  setFocusState((state) =>
    openSubject({ ...seedWorldRoot(state, worldScope), worldId: worldScope.worldId }, worldScope, { kind: "page", id }),
  )
}
```
Add `renderPage` to `<WorkbenchShell>` with a switch that returns a placeholder `DockEmpty` for each id for now. Add `frame` subject label for page from `WORKBENCH_PAGE_META`.

- [ ] **Step 10: Add `workbench-pages-wiring.test.ts`**

Assert `MafwShell` contains `openPageFocus`, `renderPage=`, `subject: { kind: "page", id }`; `FocusStage` contains `kind() === "page"`; `scene-tabs` contains `scene:page:`.

- [ ] **Step 11: Run focused tests, then commit**

Run the four test files; expected all PASS.
```bash
git add ... && git commit -m "feat(desktop): add portable workbench page subjects"
```

---

### Task 2: Triage in the dock

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/TriagePage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Create: `packages/desktop/src/renderer/mafw/pages/triage-dock-wiring.test.ts`

**Interfaces:**
- Consumes: `openPageFocus("triage")`, `renderPage`.
- Produces: `TriagePage({ compact?: boolean; onOpenGoals?: () => void })`.

- [ ] **Step 1: Write the failing wiring test**

Assert `TriagePage` contains `compact?: boolean`, `classList={{ "is-compact": !!props.compact }}`, `Show when={!props.compact}`, `class="mafw-triage-actions"`; `MafwShell` palette run calls `openPageFocus("triage")`; `renderPage` case `"triage"` renders `<TriagePage compact onOpenGoals={openProjectWork} />`.

- [ ] **Step 2: Run and see it fail.**

- [ ] **Step 3: Implement compact mode**

Root `<div class="mafw-triage-page" classList={{ "is-compact": !!props.compact }}>`; hide `PageHeader` behind `Show`; change the action row to `class="mafw-triage-actions"`.

- [ ] **Step 4: Add CSS**

`.mafw-triage-page.is-compact { flex:1; min-width:0; min-height:0; overflow-y:auto; padding:12px 14px 24px; }`
`.mafw-triage-actions { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }`

- [ ] **Step 5: Route palette + renderPage**

Replace palette `nav("triage", ...)` with an item that calls `openPageFocus("triage")`; add the `renderPage` case.

- [ ] **Step 6: Run the focused test + typecheck.**

- [ ] **Step 7: Live smoke**

Open Triage from the palette; verify chat remains, the dock shows the queue, buttons wrap at ~640, dismiss/confirm still work.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(desktop): open triage in the right workbench"
```

---

### Task 3: Approvals in the dock

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/ApprovalsPage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Create: `packages/desktop/src/renderer/mafw/pages/approvals-dock-wiring.test.ts`

- [ ] **Step 1: Failing test** — assert `compact?: boolean`, hidden PageHeader, `mafw-approvals-actions`, rail `onApprovals` calls `openPageFocus("approvals")`, renderPage passes `permissionCards` + `permReply`.
- [ ] **Step 2: Implement compact mode** — hide PageHeader; move inline action flex to `mafw-approvals-actions`; keep `onPermissionReply` calls unchanged.
- [ ] **Step 3: CSS** — `.mafw-approvals-page.is-compact` scroll/padding; `.mafw-approvals-actions { flex-wrap: wrap; }`.
- [ ] **Step 4: Route rail + palette + renderPage.**
- [ ] **Step 5: Focused tests + typecheck.**
- [ ] **Step 6: Live smoke** — approve once / always / reject still hit the same handlers; command preview wraps at 640.
- [ ] **Step 7: Commit** — `feat(desktop): open approvals in the right workbench`.

---

### Task 4: Automations in the dock

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/Automations.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Create: `packages/desktop/src/renderer/mafw/pages/automation-dock-wiring.test.ts`

- [ ] **Step 1: Failing test** — `compact?: boolean`, hidden PageHeader, `mafw-automations-field`, palette calls `openPageFocus("automation")`, renderPage case.
- [ ] **Step 2: Compact mode** — root class; hide PageHeader but keep the “+ 新建规则” button in a compact header; replace fixed inline widths with `mafw-automations-field` classes.
- [ ] **Step 3: CSS** — `.is-compact` scroll/padding; fields `width:100%; max-width:100%` in compact; header row wraps.
- [ ] **Step 4: Route palette + renderPage.**
- [ ] **Step 5: Focused tests + typecheck.**
- [ ] **Step 6: Live smoke** — new-rule form, save draft, enable toggle at 640.
- [ ] **Step 7: Commit** — `feat(desktop): open automations in the right workbench`.

---

### Task 5: MCP in the dock

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/McpPage.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Create: `packages/desktop/src/renderer/mafw/pages/mcp-dock-wiring.test.ts`

- [ ] **Step 1: Failing test** — `compact?: boolean`, `mafw-mcp-compact-actions`, hidden PageHeader, rail `openPageFocus("mcp")`, renderPage case.
- [ ] **Step 2: Compact mode** — hide PageHeader; move refresh / add to a compact action row; keep the server dialog unchanged.
- [ ] **Step 3: CSS** — `.mafw-mcp-page.is-compact` scroll/padding; summary/cards wrap; no horizontal overflow.
- [ ] **Step 4: Route rail + palette + renderPage.**
- [ ] **Step 5: Focused tests + typecheck.**
- [ ] **Step 6: Live smoke** — connect/disconnect, add server dialog, summary cards at 640.
- [ ] **Step 7: Commit** — `feat(desktop): open mcp in the right workbench`.

---

### Task 6: Config in the dock

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Create: `packages/desktop/src/renderer/mafw/pages/config-dock-wiring.test.ts`

- [ ] **Step 1: Failing test** — `compact?: boolean`, `mafw-config-compact-nav`, `SelectV2`, hidden `.mafw-config-nav` in compact; MafwShell `openConfigPage`, no main `<ConfigPage>`, `projectDir={benchRoot() ?? undefined}` preserved; `onOpenUsage` opens config at `usage`; no `showConfig`.
- [ ] **Step 2: Compact Config** — `classList={{ "is-compact": !!props.compact }}` on `.mafw-config-layout`; hide the left nav; add a compact `SelectV2` section picker above the panel head; keep `activeNav` / `initialSection` sync.
- [ ] **Step 3: CSS** — `.mafw-config-layout.is-compact { flex-direction: column; overflow-y: auto; }`; panel `overflow: visible; min-width: 0`; compact nav padding/border; grid rows wrap; inputs `max-width: 100%`.
- [ ] **Step 4: Replace config entry points** — rail `onConfig`, palette settings, `onOpenUsage`, `onOpenSettings`, notification `openConfig`, context-menu `openConfig` all use `openConfigPage(section?)`; `onBack` only via FrameBar.
- [ ] **Step 5: Remove main Config render** — delete the `showConfig() ? <ConfigPage/>` branch; keep `ConfigPage` only in `renderPage`.
- [ ] **Step 6: Focused tests + typecheck.**
- [ ] **Step 7: Live smoke** — every Config section at 640; usage ring opens `config/usage`; plugin creator entry; no horizontal scroll.
- [ ] **Step 8: Commit** — `feat(desktop): open config in the right workbench`.

---

### Task 7: Main area chat-only cleanup

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/IconRail.tsx` (only if prop docs change)
- Create: `packages/desktop/src/renderer/mafw/main-chat-only-wiring.test.ts`
- Update: `packages/desktop/src/renderer/mafw/config-discovery-scope.test.ts` if the ConfigPage prop moved (keep the `projectDir` assertion).

- [ ] **Step 1: Failing test** — assert MafwShell has no `showConfig`, no `activeTab() === "approvals" | "triage" | "automation" | "mcp" | "memory"`, has the chat-only guard, `workbenchContent` returns `"project"`, rail approvals/mcp/config active use `activePageId()`, palette routes all pages through `openPageFocus` / `openConfigPage` / `openMemoryFocus`.
- [ ] **Step 2: Remove `showConfig`** — delete the signal; replace reads with `activePageId() === "config"`; replace writes with `openConfigPage(section?)` / `closeConfigPage()`.
- [ ] **Step 3: Remove non-chat main branches** — delete approvals/triage/automation/mcp/memory branches; main content is chat only.
- [ ] **Step 4: Chat-only guard** — `createEffect(() => { if (activeTab() !== "chat") setActiveTab("chat") })`.
- [ ] **Step 5: Navigation unification** — add `navigateWorkbench(t: NavTab)` mapping chat/goals/memory/pages/config; use it for palette, rail, `onNavigateTab`, `onNavigate`.
- [ ] **Step 6: Workbench layout** — `workbenchContent` always `"project"`; remove `!showConfig()` from topstrip/narrow conditions; keep the dock toggle always visible.
- [ ] **Step 7: Active states** — IconRail approvals/mcp/config from `activePageId()`.
- [ ] **Step 8: Focused tests + full desktop suite + typecheck.**
- [ ] **Step 9: Live smoke** — every entry opens the dock and chat stays; no blank main area from palette/rail/deep link.
- [ ] **Step 10: Commit** — `feat(desktop): keep chat in the main area`.

---

### Task 8: Docs, gates, final smoke

**Files:**
- Create: `docs/releases/2026-11-19-main-chat-only-workbench-pages.md`
- Modify: `docs/architecture/desktop.md`

- [ ] **Step 1: Update the architecture current-state bullet**
- Describe: page subject, `scene:page:<id>`, compact pages, main chat-only, config section picker.
- [ ] **Step 2: Write the release note**
- Before/after, page matrix, test counts, build time, commits, live measurements.
- [ ] **Step 3: Full gates**

```bash
cd packages/desktop && npm test
npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
```
- [ ] **Step 4: Live matrix**
- Open each of approvals / triage / automation / mcp / config / memory from its entry.
- Confirm chat stays visible and the page is in the dock.
- Confirm FrameBar back / tab close returns focus without closing chat.
- Confirm 640px dock has no horizontal scroll.
- [ ] **Step 5: Commit docs** — `docs(desktop): record chat-only workbench pages`.

---

## Final Acceptance

- Main `.mafw-content` has one branch: chat.
- Right dock has memory + 5 page subjects, each with a persistent scene tab.
- No `setActiveTab` call can reach a non-chat page.
- Approvals/triage/automation/MCP/Config compact pages are usable at the 640 detent.
- Desktop tests, `tsgo --noEmit`, and `electron-vite build` pass; live smoke complete.
