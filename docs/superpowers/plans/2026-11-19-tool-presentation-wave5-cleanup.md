# ToolPresentation Wave 5 · Cleanup & Conformance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove the remaining duplicate presentation helpers and pin conformance for every first-party registration.

**Architecture:** Delete the unused `getToolInfo` duplicate in session-ui, make `ToolRegistry.has()` count all custom presentation slots, add a source-derived conformance harness for every `ToolRegistry.register` block, and remove the unused `ToolCardSpec.defaultOpen` plus stale timeline comments.

**Tech Stack:** TypeScript, SolidJS, `node:test` + `@mafw/test-shim`, Vite/Electron.

**Spec:** `docs/superpowers/specs/2026-11-19-tool-presentation-contract-design.md` (Wave 5)

## Global Constraints

- No new runtime behavior except `ToolRegistry.has()` slot coverage and the cleanup deletions.
- Preserve compatibility exports that are still consumed; `getToolInfo` is unused internally and has no consumer in the repo.
- Hidden tools (`HIDDEN_TOOLS`, e.g. `todowrite`) are explicitly exempt from presenter conformance.
- Stage only the files named in each task; the worktree has unrelated changes.

## Review Focus

- A source-derived conformance parser that stops at the next `ToolRegistry.register` must not leak one block's `present:` into another; test it with the real file.
- `ToolRegistry.has()` must count `renderCollapsed` / `renderBody` without changing `shouldUsePresentation`.
- Removing `getToolInfo` must not leave `UiI18n` / `ToolInfo` / `agentTitle` dangling imports or type errors.
- Removing `ToolCardSpec.defaultOpen` must not drop a property some spec still sets (none do today).
- Timeline scoped CSS must remain for bespoke cards and legacy plugin fallbacks.

---

### Task 1: Remove the unused `getToolInfo` duplicate

**Files:**
- Modify: `packages/session-ui/src/components/message-part.tsx`
- Test: `packages/session-ui/src/components/message-part.test.ts`

**Interfaces:**
- Delete `export type ToolInfo`, `export function getToolInfo(...)`, and the private `agentTitle(...)` helper.
- Drop the now-unused `type UiI18n` import; keep `useI18n`.

- [x] **Step 1: Write the failing source test**

Append to `message-part.test.ts`:
```ts
test("does not keep the legacy getToolInfo duplicate", () => {
  expect(componentSource).not.toContain("function getToolInfo")
  expect(componentSource).not.toContain("type ToolInfo")
  expect(componentSource).not.toContain("function agentTitle")
  expect(componentSource).not.toContain("UiI18n")
})
```

- [x] **Step 2: Run it to verify it fails**

Run:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/message-part.test.ts`
Expected: FAIL, the source still contains `getToolInfo`.

- [x] **Step 3: Delete the duplicate**

Remove the `ToolInfo` type, `getToolInfo`, `agentTitle`, and the `UiI18n` type import.

- [x] **Step 4: Run the test and the type gate**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/message-part.test.ts`
Expected: pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/message-part.tsx packages/session-ui/src/components/message-part.test.ts
git commit -m "refactor(session-ui): remove the legacy getToolInfo duplicate"
```

---

### Task 2: `ToolRegistry.has()` counts every custom slot

**Files:**
- Modify: `packages/session-ui/src/components/tool-registry.ts`
- Test: `packages/session-ui/src/components/tool-registry.test.ts`

**Interfaces:**
- `hasTool(name)` returns true when the entry has `present`, `render`, `renderCollapsed`, or `renderBody`.
- `shouldUsePresentation` is unchanged.

- [x] **Step 1: Write the failing test**

Append to `tool-registry.test.ts`:
```ts
test("has() counts custom slots without a legacy render", () => {
  ToolRegistry.register({ name: "body_only_probe", renderBody: () => null as any })
  ToolRegistry.register({ name: "collapsed_only_probe", renderCollapsed: () => null as any })
  expect(ToolRegistry.has("body_only_probe")).toBe(true)
  expect(ToolRegistry.has("collapsed_only_probe")).toBe(true)
})
```

- [x] **Step 2: Run it to verify it fails**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-registry.test.ts`
Expected: FAIL, `has()` is false for both.

- [x] **Step 3: Update `hasTool`**

Include `renderCollapsed` / `renderBody` in the occupancy check. Add a comment that occupancy and presentation are separate predicates.

- [x] **Step 4: Run the test and the type gate**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-registry.test.ts`
Expected: pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/tool-registry.ts packages/session-ui/src/components/tool-registry.test.ts
git commit -m "fix(session-ui): count custom slots in registry occupancy"
```

---

### Task 3: Source-derived first-party conformance

**Files:**
- Modify: `packages/session-ui/src/components/tool-conformance.test.ts`

**Interfaces:**
- Parse every `ToolRegistry.register({ ... })` block from `message-part.tsx` by splitting at the marker; each chunk ends at the next marker.
- For every registration not in `HIDDEN_TOOLS`, require `present:`.
- Require every `TOOL_NAME_ALIASES` target to be a registered name.

- [x] **Step 1: Write the conformance test**

Append to `tool-conformance.test.ts`:
```ts
import * as fs from "node:fs"
import { HIDDEN_TOOLS, TOOL_NAME_ALIASES } from "./parts-rules"

const componentSource = fs.readFileSync(new URL("./message-part.tsx", import.meta.url), "utf-8")

test("every non-hidden first-party registration has a presenter", () => {
  const chunks = componentSource.split("ToolRegistry.register({").slice(1)
  const names = new Set<string>()
  for (const chunk of chunks) {
    const name = chunk.match(/^\s*name: "([^"]+)"/)?.[1]
    if (!name) continue
    names.add(name)
    if (HIDDEN_TOOLS.has(name)) continue
    expect(chunk).toContain("present:")
  }
  expect(names.size).toBeGreaterThanOrEqual(13)
  for (const target of Object.values(TOOL_NAME_ALIASES)) expect(names.has(target)).toBe(true)
})
```

- [x] **Step 2: Run it**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-conformance.test.ts`
Expected: pass (this is a guard for the already-migrated state; if it fails, a registration lost its presenter).

- [x] **Step 3: Commit**

```bash
git add packages/session-ui/src/components/tool-conformance.test.ts
git commit -m "test(session-ui): pin presenter conformance for every registration"
```

---

### Task 4: Remove unused `ToolCardSpec.defaultOpen` and stale comments

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts`
- Modify: `packages/session-ui/src/components/process-timeline.css`
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts`

**Interfaces:**
- `ToolCardSpec` no longer has `defaultOpen`.
- `process-timeline.css` comment no longer claims "until Wave 4".

- [x] **Step 1: Write the failing test**

Append to `extract.test.ts`:
```ts
test("ToolCardSpec no longer carries the unused defaultOpen", () => {
  expect(Object.values(TOOL_SPECS).some((spec) => "defaultOpen" in spec)).toBe(false)
})
```
And a source assertion in `extract.test.ts`:
```ts
import * as fs from "node:fs"
const specSource = fs.readFileSync(new URL("./extract.ts", import.meta.url), "utf-8")
expect(specSource).not.toContain("defaultOpen?: boolean")
```

- [x] **Step 2: Run it to verify it fails**

Run:
`node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: FAIL, the interface still declares `defaultOpen`.

- [x] **Step 3: Remove the field and update the comment**

Delete `defaultOpen?: boolean` from `ToolCardSpec`. Change the timeline comment to: scoped rules remain for bespoke MAFW cards and legacy plugin fallbacks.

- [x] **Step 4: Run the test and the type gate**

Run:
`node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/tool-cards/extract.test.ts`
Expected: pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/extract.ts packages/desktop/src/renderer/mafw/components/tool-cards/extract.test.ts packages/session-ui/src/components/process-timeline.css
git commit -m "chore: remove unused ToolCardSpec field and stale timeline note"
```

---

### Task 5: Full gates, docs, and real-device spot check

**Files:**
- Modify: `docs/architecture/desktop.md`
- Modify: `docs/releases/2026-11-18-memory-receipt-timeline-meta.md`
- Modify: `docs/superpowers/plans/2026-11-19-tool-presentation-wave5-cleanup.md`

- [x] **Step 1: Run the full session-ui suite**

Exclude `architecture.test.ts`:
```powershell
$files = Get-ChildItem src -Recurse -Filter *.test.ts | Where-Object { $_.Name -ne 'architecture.test.ts' } | ForEach-Object { $_.FullName }
node --import tsx --import ../../packages/test-shim/register.mjs --test @files
```
Expected: `fail 0`.

- [x] **Step 2: Run desktop gates**

From `packages/desktop`:
```bash
npm test
npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
```
Expected: desktop tests `fail 0`, `tsgo` exit 0, build exit 0.

- [x] **Step 3: Real-device spot check**

Reload the renderer. Open the current chat and one process drawer. Confirm tool cards still collapse/expand and no `.mafw-turn-render-error`; this wave has no visual changes, so the check is a regression guard.

- [x] **Step 4: Update docs with real gate numbers**

- `docs/architecture/desktop.md`: note the `getToolInfo` removal, `ToolRegistry.has()` custom-slot coverage, and the first-party conformance harness.
- `docs/releases/2026-11-18-memory-receipt-timeline-meta.md`: add the Wave 5 commit list, exact suite counts, and the new-test delta.
- Tick every checkbox in this plan file.

- [x] **Step 5: Commit docs and plan**

```bash
git add docs/architecture/desktop.md docs/releases/2026-11-18-memory-receipt-timeline-meta.md docs/superpowers/plans/2026-11-19-tool-presentation-wave5-cleanup.md docs/superpowers/specs/2026-11-19-tool-presentation-contract-design.md
git commit -m "docs: record tool presentation wave 5"
```
