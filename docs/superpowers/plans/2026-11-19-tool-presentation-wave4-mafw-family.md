# ToolPresentation Wave 4 · MAFW Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move the 30 MAFW family specs from `familyCard`/`BasicTool` onto `ToolCard` with a declarative presenter, while keeping the bespoke cards untouched.

**Architecture:** `family-present.ts` turns a `ToolCardSpec` into a `ToolPresentation`: title/subtitle/badge → collapsed row, `extract` → `expanded.sections`. `ToolRegistryEntry` gains `renderSections`, so desktop keeps `ToolSections` while session-ui only forwards the slot. `familyCard` becomes a thin `ToolCard` wrapper for the `goal-created` legacy fallback; the 30 specs register `present` + `renderSections`, not `render`.

**Tech Stack:** TypeScript, SolidJS, `node:test` + `@mafw/test-shim`, Vite/Electron.

**Spec:** `docs/superpowers/specs/2026-11-19-tool-presentation-contract-design.md`

## Global Constraints

- Collapsed row: **11px / 550** title, **10.5px** object/meta, **28px** high, one line.
- Expanded body first line aligns at `--mafw-tool-content-left: 6px`.
- All cards default **collapsed**; only explicit `defaultOpen` (details mode) opens.
- `expanded.body: "custom"` requires `renderBody`; `expanded.sections` requires `renderSections`.
- Session-ui does not take over `mafw-tool-*` CSS; desktop keeps `ToolSections`.
- Do not touch approval cards, flow cards, `renderAfterPart`, or mobile.
- Stage only the files named in each task; the worktree has unrelated changes.

## Review Focus

- Family spec whose `extract` throws: completed output must fall back to `genericSections`, not an empty body.
- Family spec with completed output but empty `extract`: must show the generic JSON sections, not an empty card.
- Family spec with no output: must show `(无输出)`, not an empty body.
- Plugin override on a family tool: `ToolPresentationFallback` must forward `renderSections`, or the fallback loses the extracted content.
- `goal-created` legacy fallback: must render the family ToolCard, not the old `BasicTool` trigger.

---

### Task 1: `renderSections` registry slot

**Files:**
- Modify: `packages/session-ui/src/components/tool-registry.ts`
- Modify: `packages/session-ui/src/components/message-part.tsx`
- Test: `packages/session-ui/src/components/message-part.test.ts`
- Test: `packages/session-ui/src/components/tool-registry.test.ts`

**Interfaces:**
- `ToolRegistryEntry` gains:
  ```ts
  /** Desktop-injected renderer for `expanded.sections`. */
  renderSections?: (sections: Section[]) => JSX.Element
  ```
- `ToolPartDisplay` and `ToolPresentationFallback` pass `renderSections={entry.renderSections}` to `ToolCard`.

- [x] **Step 1: Write the failing tests**

Append to `message-part.test.ts`:
```ts
test("forwards the desktop section renderer to ToolCard", () => {
  expect(componentSource).toContain("renderSections={entry()?.renderSections}")
  expect(componentSource).toContain("renderSections={props.entry.renderSections}")
})
```
Append to `tool-registry.test.ts` (use the existing `ToolRegistry` import/registration style in that file):
```ts
test("keeps a renderSections slot on the entry", () => {
  const renderSections = () => null
  ToolRegistry.register({ name: "family_probe", present: () => ({}), renderSections })
  expect(ToolRegistry.entry("family_probe")?.renderSections).toBe(renderSections)
})
```

- [x] **Step 2: Run them to verify they fail**

Run:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/message-part.test.ts src/components/tool-registry.test.ts`
Expected: FAIL, the source has no `renderSections` wiring.

- [x] **Step 3: Add the type and the two props**

Import `type Section` in `tool-registry.ts` and add the field. In `message-part.tsx`, add `renderSections={entry()?.renderSections}` to the `ToolCard` inside `ToolPartDisplay`, and `renderSections={props.entry.renderSections}` inside `ToolPresentationFallback`.

- [x] **Step 4: Run the tests and the type gate**

Run:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/message-part.test.ts src/components/tool-registry.test.ts`
Expected: all pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/tool-registry.ts packages/session-ui/src/components/message-part.tsx packages/session-ui/src/components/message-part.test.ts packages/session-ui/src/components/tool-registry.test.ts
git commit -m "feat(session-ui): add renderSections registry slot"
```

---

### Task 2: Pure family presenter

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/tool-cards/family-present.ts`
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/family-present.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function familySections(spec: ToolCardSpec, props: ToolProps): Section[]
  export function presentFamily(spec: ToolCardSpec, ctx: ToolPresentationContext): ToolPresentation
  ```
- `familySections`:
  - `status !== "completed"` → `[]`.
  - completed with no output → `[{ kind: "text", text: "(无输出)", tone: "muted" }]`.
  - `spec.extract` empty → `genericSections(output)`.
  - `spec.extract` throws → `genericSections(output)`.
- `presentFamily`: `title = spec.title`, `object = spec.subtitle?.(input)`, `meta = badge` only when completed, `expanded.sections = familySections(...)`.

- [x] **Step 1: Write the failing tests**

`family-present.test.ts`:
```ts
import { describe, expect, test } from "bun:test"
import { familySections, presentFamily } from "./family-present"
import type { ToolCardSpec } from "./extract"

const spec = (extract: ToolCardSpec["extract"]): ToolCardSpec => ({
  icon: "x",
  title: "MAFW Probe",
  subtitle: (input) => input?.query,
  badge: () => ({ text: "ok", tone: "ok" }),
  extract,
})

const props = (overrides: any = {}) => ({ tool: "mafw_probe", input: { query: "q" }, metadata: {}, status: "completed", ...overrides })
const ctx = (p: any) => ({ props: p, mode: "chat" as const, t: (key: string) => key })

describe("family presenter", () => {
  test("uses title, subtitle, badge, and extracted sections", () => {
    const out = presentFamily(spec(() => [{ kind: "text", text: "body" }]), ctx(props()))
    expect(out.collapsed).toMatchObject({ title: "MAFW Probe", object: "q", meta: [{ text: "ok", tone: "ok" }] })
    expect(out.expanded.sections).toEqual([{ kind: "text", text: "body" }])
  })

  test("no output shows the empty marker; empty extract falls back to generic sections", () => {
    expect(familySections(spec(() => []), props({ status: "completed", output: "" }))).toEqual([
      { kind: "text", text: "(无输出)", tone: "muted" },
    ])
    expect(familySections(spec(() => []), props({ output: '{"a":1}' }))).toEqual([{ kind: "kv", rows: [["a", "1"]] }])
  })

  test("extract errors fall back to generic sections", () => {
    const out = familySections(
      spec(() => {
        throw new Error("boom")
      }),
      props({ output: "raw text" }),
    )
    expect(out).toEqual([{ kind: "code", text: "raw text" }])
  })

  test("pending parts do not run extract", () => {
    expect(familySections(spec(() => [{ kind: "text", text: "body" }]), props({ status: "running", output: "x" }))).toEqual([])
  })
})
```

- [x] **Step 2: Run it to verify it fails**

From `packages/desktop`:
`node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/tool-cards/family-present.test.ts`
Expected: FAIL, module not found.

- [x] **Step 3: Implement `family-present.ts`**

Import `genericSections` / `Section` / `ToolCardSpec` from `./extract` and `ToolProps` / presentation types from `@mafw/session-ui/message-part` and `@mafw/session-ui/tool-presentation`. Keep the `console.warn("[mafw]", e)` from `familyCard` in the catch.

- [x] **Step 4: Run the tests and the type gate**

Run:
`node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/tool-cards/family-present.test.ts`
Expected: pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/family-present.ts packages/desktop/src/renderer/mafw/components/tool-cards/family-present.test.ts
git commit -m "feat(desktop): add MAFW family presenter"
```

---

### Task 3: Wire family registrations and the ToolCard fallback

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/shared.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/index.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/goal-created.tsx`
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/family-registration.test.ts`
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/shared.test.ts`

**Interfaces:**
- `shared.tsx` exports:
  ```ts
  export function familyRenderSections(sections: Section[]): JSX.Element
  export const FamilyCard: Component<ToolProps & { spec: ToolCardSpec }>
  ```
- `FamilyCard` renders `ToolCard` with `presentFamily(props.spec, ctx)`, `renderSections={familyRenderSections}`.
- `index.ts` registers every `TOOL_SPECS` entry for all `aliasKeys(name)` with `present: (ctx) => presentFamily(spec, ctx)` and `renderSections: familyRenderSections`; no `render`.
- `goal-created.tsx` uses `<FamilyCard spec={TOOL_SPECS.mafw_create_goal} {...props} />` as its legacy fallback; `familyCard` is removed.

- [x] **Step 1: Write the failing tests**

`shared.test.ts`:
```ts
import * as fs from "node:fs"
import { describe, expect, test } from "bun:test"

const src = fs.readFileSync(new URL("./shared.tsx", import.meta.url), "utf-8")

describe("family card shell", () => {
  test("uses ToolCard and keeps the desktop section renderer", () => {
    expect(src).toContain("ToolCard")
    expect(src).toContain("familyRenderSections")
    expect(src).toContain("presentFamily")
    expect(src).not.toContain("BasicTool")
    expect(src).not.toContain("trigger={{")
  })
})
```

`family-registration.test.ts`:
```ts
import { describe, expect, test } from "bun:test"
import { ToolRegistry } from "@mafw/session-ui/message-part"
import { registerMafwToolCards } from "./index"
import { TOOL_SPECS } from "./extract"

registerMafwToolCards()

describe("MAFW family registration", () => {
  test("every family spec registers present + renderSections, not render", () => {
    for (const name of Object.keys(TOOL_SPECS)) {
      const entry = ToolRegistry.entry(name)
      expect(entry?.present).toBeDefined()
      expect(entry?.renderSections).toBeDefined()
      expect(entry?.render).toBeUndefined()
    }
  })
})
```

- [x] **Step 2: Run them to verify they fail**

Run:
`node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/tool-cards/shared.test.ts src/renderer/mafw/components/tool-cards/family-registration.test.ts`
Expected: FAIL, `shared.tsx` still imports `BasicTool`, and family entries still have `render`.

- [x] **Step 3: Rewrite `shared.tsx` and `index.ts`**

`shared.tsx`:
```tsx
import { For, Show, createMemo, type Component } from "solid-js"
import { ToolCard } from "@mafw/session-ui/tool-card"
import { resolvePresentation, type Section as ToolSection, type ToolPresentationContext } from "@mafw/session-ui/tool-presentation"
import type { ToolProps } from "@mafw/session-ui/message-part"
import { presentFamily } from "./family-present"
import type { Section, ToolCardSpec } from "./extract"

export function familyRenderSections(sections: ToolSection[]) {
  return <ToolSections sections={sections as unknown as Section[]} />
}

export const FamilyCard: Component<ToolProps & { spec: ToolCardSpec }> = (props) => {
  const context = (): ToolPresentationContext => ({ props, mode: "chat", t: (key) => key })
  const presentation = createMemo(() => resolvePresentation(presentFamily(props.spec, context()), context()))
  return <ToolCard props={props} presentation={presentation()} renderSections={familyRenderSections} />
}
```
Keep `ToolSections` / `SectionView` / `Badge` unchanged. Remove `BasicTool` import.

`index.ts`:
```ts
import { ToolRegistry, type ToolProps } from "@mafw/session-ui/message-part"
import { TOOL_SPECS } from "./extract"
import { FamilyCard, familyRenderSections } from "./shared"
...
function registerFamily(name: string, spec: ToolCardSpec) {
  for (const key of aliasKeys(name)) {
    ToolRegistry.register({ name: key, present: (ctx) => presentFamily(spec, ctx), renderSections: familyRenderSections })
  }
}
for (const [name, spec] of Object.entries(TOOL_SPECS)) registerFamily(name, spec)
```
`goal-created.tsx`: replace `FallbackTool` with:
```tsx
const fallback = () => <FamilyCard spec={TOOL_SPECS.mafw_create_goal} {...props} />
...
<Show when={view().kind === "tech_lead"} fallback={fallback()}>...</Show>
```
Import `FamilyCard` from `./shared`.

- [x] **Step 4: Run the tests and the type gate**

Run:
`node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/tool-cards/shared.test.ts src/renderer/mafw/components/tool-cards/family-registration.test.ts src/renderer/mafw/components/tool-cards/family-present.test.ts`
Expected: all pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/shared.tsx packages/desktop/src/renderer/mafw/components/tool-cards/index.ts packages/desktop/src/renderer/mafw/components/tool-cards/goal-created.tsx packages/desktop/src/renderer/mafw/components/tool-cards/shared.test.ts packages/desktop/src/renderer/mafw/components/tool-cards/family-registration.test.ts
git commit -m "feat(desktop): route MAFW family through ToolCard"
```

---

### Task 4: Full gates, docs, and real-device check

**Files:**
- Modify: `docs/architecture/desktop.md`
- Modify: `docs/releases/2026-11-18-memory-receipt-timeline-meta.md`
- Modify: `docs/superpowers/plans/2026-11-19-tool-presentation-wave4-mafw-family.md`

**Interfaces:**
- Consumes `familyRenderSections` / `FamilyCard` (Task 3).

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

- [x] **Step 3: Verify in the running desktop app**

Reload the renderer (CDP `Page.reload`). Open a session that contains MAFW family tool calls and check:
- family card collapsed row is 28px, title 11px/550, subtitle 10.5px; badge in `meta`;
- expanded body uses the existing `ToolSections` markup (`.mafw-tool-box`), with `(无输出)` when there is no output;
- no `.mafw-turn-render-error`.
If the current session has no family calls, record that in the release note and rely on `family-present` / registration tests.

- [x] **Step 4: Update docs with real gate numbers**

- `docs/architecture/desktop.md`: extend the tool-presentation bullet with Wave 4 (`renderSections` registry slot, `presentFamily`, `FamilyCard`, 30 specs).
- `docs/releases/2026-11-18-memory-receipt-timeline-meta.md`: add the Wave 4 commit list and exact suite counts.
- Tick every checkbox in this plan file.

- [x] **Step 5: Commit docs and plan**

```bash
git add docs/architecture/desktop.md docs/releases/2026-11-18-memory-receipt-timeline-meta.md docs/superpowers/plans/2026-11-19-tool-presentation-wave4-mafw-family.md docs/superpowers/specs/2026-11-19-tool-presentation-contract-design.md
git commit -m "docs: record tool presentation wave 4"
```
