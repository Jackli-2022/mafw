# ToolPresentation Wave 2 · Diff Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move `edit`, `write`, and `apply_patch` onto the same `ToolCard` shell as every other ChatView tool, keeping their existing diff bodies intact.

**Architecture:** A pure `diff-tool-model.ts` normalizes `metadata.files` and computes `+N / -M` meta. `presentDiffTool()` in `tool-presenters.ts` produces the collapsed row. `diff-tool-card.tsx` holds body-only `EditBody` / `WriteBody` / `ApplyPatchBody`; `message-part.tsx` registers `present` + `renderBody` and deletes the legacy `BasicTool` wrappers. `tool-card.css` owns the diff body header density so chat and the process timeline share one 11px card.

**Tech Stack:** TypeScript, SolidJS, `node:test` + `@mafw/test-shim`, Vite/Electron.

**Spec:** `docs/superpowers/specs/2026-11-19-tool-presentation-contract-design.md`

## Global Constraints

- Collapsed row: **11px / 550** title, **10.5px** object/meta, **28px** high, one line, 8px fade only before the chevron.
- Expanded body first line aligns at `--mafw-tool-content-left: 6px`.
- All tool cards default **collapsed**; only an explicit `defaultOpen` (details mode) opens.
- ChatView has one density: `ToolCard`; no `.mafw-process-step-card` diff-specific 11px overrides.
- `expanded.body: "custom"` requires a registered `renderBody`; never an empty expanded body.
- History output uses `partOutputText(state)`; do not read `state.output` directly.
- Do not touch approval cards, flow cards, `renderAfterPart`, or mobile.
- The worktree already has unrelated modified files. Stage **only** the files named in each task.
- Run `cd packages/session-ui && node --import tsx --import ../../packages/test-shim/register.mjs --test <files>`; exclude the pre-existing `architecture.test.ts` red from full runs. Type gate: `npx tsgo --noEmit -p tsconfig.json`.

## Review Focus

- Streaming `edit` with no `metadata.files`: collapsed row must still show the input path and must not render `+0 / -0`.
- `apply_patch` with zero parsed files: one titled row, empty expanded body, no crash.
- Single **deleted** file in `apply_patch`: only the `-N` meta, and its accordion must not be seeded open.
- `edit` error part: still routes to `ToolErrorCard` (the registration must not set `handlesError`).
- Details mode (`localStorage['mafw-chat-details']='1'`): `defaultOpen` still expands the card and mounts the diff renderer.

---

### Task 1: Diff model and presenter

**Files:**
- Create: `packages/session-ui/src/components/diff-tool-model.ts`
- Modify: `packages/session-ui/src/components/tool-presenters.ts`
- Test: `packages/session-ui/src/components/diff-tool-model.test.ts`
- Test: `packages/session-ui/src/components/tool-presenters.test.ts`

**Interfaces:**
- Produces in `diff-tool-model.ts`:
  ```ts
  export interface DiffMetadataFile {
    file: string
    patch?: string
    before?: string
    after?: string
    additions?: number
    deletions?: number
    status?: string
  }
  export function canonicalMetadataFiles(metadata: any): DiffMetadataFile[]
  export function contentLineCount(text: unknown): number
  export function diffMeta(additions: number, deletions: number): ToolMeta[] | undefined
  ```
- Produces in `tool-presenters.ts`:
  ```ts
  export const PRESENTED_DIFF_TOOLS = ["edit", "write", "apply_patch"] as const
  export type PresentedDiffTool = (typeof PRESENTED_DIFF_TOOLS)[number]
  export function presentDiffTool(tool: PresentedDiffTool, ctx: ToolPresentationContext): ToolPresentation
  ```
- `presentDiffTool` returns `expanded: { body: "custom" }` for all three tools.
- `diffMeta` returns `undefined` when `additions + deletions === 0`; otherwise only the non-zero sides (`+N` tone `ok`, `-M` tone `err`).

- [x] **Step 1: Write the failing model tests**

`diff-tool-model.test.ts`:
```ts
import { describe, expect, test } from "bun:test"
import { canonicalMetadataFiles, contentLineCount, diffMeta } from "./diff-tool-model"

describe("diff tool model", () => {
  test("keeps only canonical metadata files", () => {
    expect(canonicalMetadataFiles({ files: [{ file: "a.ts", additions: 1, deletions: 2 }, { path: "b.ts" }, null] })).toEqual([
      { file: "a.ts", additions: 1, deletions: 2 },
    ])
    expect(canonicalMetadataFiles({})).toEqual([])
  })

  test("counts content lines without a phantom trailing line", () => {
    expect(contentLineCount("")).toBe(0)
    expect(contentLineCount("a")).toBe(1)
    expect(contentLineCount("a\nb\n")).toBe(2)
    expect(contentLineCount("a\n\nb")).toBe(3)
    expect(contentLineCount(undefined)).toBe(0)
  })

  test("renders only non-zero sides and hides 0/0", () => {
    expect(diffMeta(4, 1)).toEqual([{ text: "+4", tone: "ok" }, { text: "-1", tone: "err" }])
    expect(diffMeta(3, 0)).toEqual([{ text: "+3", tone: "ok" }])
    expect(diffMeta(0, 3)).toEqual([{ text: "-3", tone: "err" }])
    expect(diffMeta(0, 0)).toBeUndefined()
  })
})
```

- [x] **Step 2: Run the model test to verify it fails**

Run (from `packages/session-ui`):
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/diff-tool-model.test.ts`
Expected: FAIL, module `./diff-tool-model` not found.

- [x] **Step 3: Implement `diff-tool-model.ts`**

Move the existing `canonicalMetadataFiles` filter out of `message-part.tsx` unchanged (same object identity, no default filling). `contentLineCount` returns `0` for non-strings, `0` for `""`, and counts `\n` without inventing a line after a trailing newline. `diffMeta` builds the meta array described in Interfaces.

- [x] **Step 4: Write the failing presenter tests**

Append to `tool-presenters.test.ts` (import `presentDiffTool` alongside the existing imports, and reuse the existing `ctx` helper):
```ts
const diff = (tool: string, props: any) => {
  const c = ctx(props)
  return resolvePresentation(presentDiffTool(tool as any, c), c)
}

describe("diff tool presentations", () => {
  test("edit shows the relative path and ± stats", () => {
    const out = diff("edit", {
      tool: "edit",
      status: "completed",
      input: { filePath: "C:/repo/src/a.ts" },
      metadata: { files: [{ file: "C:/repo/src/a.ts", additions: 4, deletions: 1 }] },
    })
    expect(out.collapsed).toMatchObject({ title: "ui.messagePart.title.edit", object: "src/a.ts" })
    expect(out.collapsed.meta).toEqual([{ text: "+4", tone: "ok" }, { text: "-1", tone: "err" }])
    expect(out.expanded.body).toBe("custom")
  })

  test("streaming edit falls back to the input path with no stats", () => {
    const out = diff("edit", { tool: "edit", status: "running", input: { filePath: "C:/repo/src/a.ts" }, metadata: {} })
    expect(out.collapsed.object).toBe("src/a.ts")
    expect(out.collapsed.meta).toBeUndefined()
  })

  test("write derives additions from content when metadata is absent", () => {
    const out = diff("write", {
      tool: "write",
      status: "completed",
      input: { filePath: "C:/repo/new.ts", content: "a\nb\n" },
      metadata: {},
    })
    expect(out.collapsed.object).toBe("new.ts")
    expect(out.collapsed.meta).toEqual([{ text: "+2", tone: "ok" }])
  })

  test("single-file apply_patch shows the path; multi-file shows the count and totals", () => {
    const single = diff("apply_patch", {
      tool: "apply_patch",
      status: "completed",
      input: {},
      metadata: { files: [{ file: "C:/repo/a.ts", additions: 2, deletions: 3, status: "modified" }] },
    })
    expect(single.collapsed.object).toBe("a.ts")
    expect(single.collapsed.meta).toEqual([{ text: "+2", tone: "ok" }, { text: "-3", tone: "err" }])

    const multi = diff("apply_patch", {
      tool: "apply_patch",
      status: "completed",
      input: {},
      metadata: {
        files: [
          { file: "C:/repo/a.ts", additions: 2, deletions: 3 },
          { file: "C:/repo/b.ts", additions: 3, deletions: 1, status: "added" },
        ],
      },
    })
    expect(multi.collapsed.object).toBe("2 ui.common.file.other")
    expect(multi.collapsed.meta).toEqual([{ text: "+5", tone: "ok" }, { text: "-4", tone: "err" }])
  })

  test("deleted single file only shows deletions; empty patch has no object", () => {
    const deleted = diff("apply_patch", {
      tool: "apply_patch",
      status: "completed",
      input: {},
      metadata: { files: [{ file: "C:/repo/gone.ts", additions: 0, deletions: 3, status: "deleted" }] },
    })
    expect(deleted.collapsed.meta).toEqual([{ text: "-3", tone: "err" }])

    const empty = diff("apply_patch", { tool: "apply_patch", status: "completed", input: {}, metadata: {} })
    expect(empty.collapsed.object).toBeUndefined()
    expect(empty.collapsed.meta).toBeUndefined()
  })
})
```

- [x] **Step 5: Run the presenter tests to verify they fail**

Run:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-presenters.test.ts`
Expected: FAIL, `presentDiffTool` is not exported.

- [x] **Step 6: Implement `presentDiffTool`**

Use `readPathInput` and the existing `pathLabel` helper. `write` uses `files[0]?.additions ?? contentLineCount(input.content)`. `apply_patch` with one file uses `pathLabel(files[0].file)`; with more than one uses `${files.length} ${ctx.t("ui.common.file.other")}` and summed stats. `edit` uses `files[0]?.file ?? readPathInput(input)`.

- [x] **Step 7: Run both tests and the type gate**

Run:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/diff-tool-model.test.ts src/components/tool-presenters.test.ts`
Expected: all tests pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 8: Commit**

```bash
git add packages/session-ui/src/components/diff-tool-model.ts packages/session-ui/src/components/diff-tool-model.test.ts packages/session-ui/src/components/tool-presenters.ts packages/session-ui/src/components/tool-presenters.test.ts
git commit -m "feat(session-ui): add diff tool presenter model"
```

---

### Task 2: Body-only diff card components

**Files:**
- Create: `packages/session-ui/src/components/diff-tool-card.tsx`
- Modify: `packages/session-ui/src/components/tool-card.css` (only the diff-body header block in this task)
- Test: `packages/session-ui/src/components/diff-tool-card.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function EditBody(props: ToolProps): JSX.Element
  export function WriteBody(props: ToolProps): JSX.Element
  export function ApplyPatchBody(props: ToolProps): JSX.Element
  ```
- Each body is content-only: no `BasicTool`, no collapsible trigger. `EditBody` / `WriteBody` keep the `data-component="edit-tool" | "write-tool"` wrapper; `ApplyPatchBody` keeps `data-component="apply-patch-tool"`.
- `ApplyPatchBody` keeps the single-file path and the multi-file accordion, the seeded-open behavior (skip `status === "deleted"`), and the `props.deferContent === false || visible()` gate.

- [x] **Step 1: Write the failing source test**

`diff-tool-card.test.ts`:
```ts
import * as fs from "node:fs"
import { describe, expect, test } from "bun:test"

const src = fs.readFileSync(new URL("./diff-tool-card.tsx", import.meta.url), "utf-8")

describe("diff card bodies", () => {
  test("exports body-only components and keeps the diff renderer contract", () => {
    for (const name of ["EditBody", "WriteBody", "ApplyPatchBody"]) expect(src).toContain(`export function ${name}`)
    expect(src).toContain('mode="diff"')
    expect(src).toContain("virtualize={props.virtualizeDiff}")
    expect(src).toContain("onRendered={props.onContentRendered}")
    expect(src).not.toContain("BasicTool")
  })

  test("keeps deferred per-file mounting, diagnostics, and the file accordion", () => {
    expect(src).toContain("props.deferContent === false || visible()")
    expect(src).toContain("DiagnosticsDisplay")
    expect(src).toContain("ToolFileAccordion")
  })
})
```

- [x] **Step 2: Run it to verify it fails**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/diff-tool-card.test.ts`
Expected: FAIL, `diff-tool-card.tsx` not found.

- [x] **Step 3: Move the body code into `diff-tool-card.tsx`**

Move `Diagnostic`, `getDiagnostics`, `DiagnosticsDisplay`, `ToolFileAccordion` from `message-part.tsx`, plus the three card bodies. Reuse `canonicalMetadataFiles` from `./diff-tool-model`; keep `useFileComponent`, `useData`, `checksum`, `patchFiles`, `resolveFileDiff`, `DiffChanges`, `Accordion`, `StickyAccordionHeader`, `FileIcon`, and `Icon`. Keep the existing `diffSource` memo equality guard in `EditBody`.

- [x] **Step 4: Run the test and the type gate**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/diff-tool-card.test.ts`
Expected: pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/diff-tool-card.tsx packages/session-ui/src/components/diff-tool-card.test.ts
git commit -m "refactor(session-ui): extract diff tool card bodies"
```

---

### Task 3: Register the presenter and delete the legacy cards

**Files:**
- Modify: `packages/session-ui/src/components/message-part.tsx`
- Modify: `packages/session-ui/src/components/message-part.test.ts`

**Interfaces:**
- Consumes: `presentDiffTool` (Task 1), `EditBody` / `WriteBody` / `ApplyPatchBody` (Task 2).
- Registrations become exactly:
  ```ts
  ToolRegistry.register({ name: "edit", present: (ctx) => presentDiffTool("edit", ctx), renderBody: EditBody })
  ToolRegistry.register({ name: "write", present: (ctx) => presentDiffTool("write", ctx), renderBody: WriteBody })
  ToolRegistry.register({ name: "apply_patch", present: (ctx) => presentDiffTool("apply_patch", ctx), renderBody: ApplyPatchBody })
  ```
- No `render` and no `handlesError`, so error parts keep `ToolErrorCard`.
- `message-part.tsx` re-exports `canonicalMetadataFiles` from `./diff-tool-model` for compatibility.

- [x] **Step 1: Write the failing wiring tests**

Append to `message-part.test.ts`:
```ts
describe("diff tools use the shared presentation path", () => {
  const block = (name: string, next: string) => {
    const start = componentSource.indexOf(`name: "${name}"`)
    return componentSource.slice(start, componentSource.indexOf(`name: "${next}"`, start))
  }

  test("edit/write/apply_patch register present + renderBody without a legacy shell", () => {
    const edit = block("edit", "write")
    expect(edit).toContain('present: (ctx) => presentDiffTool("edit", ctx)')
    expect(edit).toContain("renderBody: EditBody")
    expect(edit).not.toContain("BasicTool")

    const write = block("write", "apply_patch")
    expect(write).toContain('present: (ctx) => presentDiffTool("write", ctx)')
    expect(write).toContain("renderBody: WriteBody")

    const patch = block("apply_patch", "todowrite")
    expect(patch).toContain('present: (ctx) => presentDiffTool("apply_patch", ctx)')
    expect(patch).toContain("renderBody: ApplyPatchBody")
  })

  test("details mode still drives defaultOpen and error parts stay generic", () => {
    expect(componentSource).toContain("defaultOpen={props.defaultOpen}")
    for (const [name, next] of [["edit", "write"], ["write", "apply_patch"], ["apply_patch", "todowrite"]] as const) {
      expect(block(name, next)).not.toContain("handlesError")
    }
  })
})
```

- [x] **Step 2: Run it to verify it fails**

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/message-part.test.ts`
Expected: FAIL, the first block still contains `BasicTool`.

- [x] **Step 3: Replace the three registrations and delete the legacy render bodies**

Remove the old `render(props) { ... }` bodies and the now-unused trigger markup. Remove imports that only served them (`Accordion`, `StickyAccordionHeader`, `DiffChanges`, `checksum`, `patchFiles`, `normalize` / `resolveFileDiff`), keeping imports still used elsewhere (`Icon`, `FileIcon`, `Dynamic`). Import the three bodies from `./diff-tool-card` and `presentDiffTool` from `./tool-presenters`.

- [x] **Step 4: Run the wiring test, the diff tests, and the type gate**

Run:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/message-part.test.ts src/components/diff-tool-card.test.ts src/components/tool-presenters.test.ts`
Expected: all pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/message-part.tsx packages/session-ui/src/components/message-part.test.ts
git commit -m "feat(session-ui): route diff cards through ToolCard"
```

---

### Task 4: One diff-body density in `tool-card.css`

**Files:**
- Modify: `packages/session-ui/src/components/tool-card.css`
- Modify: `packages/session-ui/src/components/process-timeline.css`
- Modify: `packages/session-ui/src/components/tool-card.test.ts`
- Modify: `packages/session-ui/src/components/process-timeline.test.ts`

**Interfaces:**
- `tool-card.css` gains the diff body normalization scoped under `.mafw-tool-card`:
  - `[data-scope="apply-patch"] h3 > button { padding-left: var(--mafw-tool-content-left); }`
  - `[data-slot="apply-patch-filename"]` → 11px / 550 / `var(--text-strong)`
  - `[data-slot="apply-patch-directory"]` → 10.5px / `var(--text-weak)`
  - `[data-slot="apply-patch-change"]`, `[data-component="diff-changes"]` → 10.5px
- `process-timeline.css` drops the `message-part-title*` rules and the `[data-scope="apply-patch"] h3 > button` block (now in `tool-card.css`).

- [x] **Step 1: Write the failing CSS assertions**

Append to `tool-card.test.ts`:
```ts
test("normalises the diff body header to the chat density", () => {
  expect(css).toContain('[data-scope="apply-patch"] h3 > button')
  expect(css).toContain("padding-left: var(--mafw-tool-content-left)")
  expect(css).toMatch(/\[data-slot="apply-patch-filename"\]\s*\{[^}]*font-size:\s*11px/)
  expect(css).toMatch(/\[data-slot="apply-patch-directory"\]\s*\{[^}]*font-size:\s*10\.5px/)
})
```
Change the existing timeline test `aligns expanded content with the collapsed title` to read `tool-card.css` instead of `process-timeline.css`, and change `matches the edit card title size to the tool rows` to:
```ts
test("no longer ships a separate edit card density", () => {
  expect(css()).not.toContain('data-slot="message-part-title')
  expect(css()).not.toContain('[data-scope="apply-patch"] h3 > button')
})
```

- [x] **Step 2: Run them to verify they fail**

Run:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-card.test.ts src/components/process-timeline.test.ts`
Expected: FAIL on the new diff-header assertions and the moved timeline assertions.

- [x] **Step 3: Add the shared rules and delete the scoped legacy rules**

Append the diff-body block at the end of `tool-card.css`. Delete lines 200–220 (`message-part-title*`) and lines 249–253 (`apply-patch h3 > button`) from `process-timeline.css`; keep the generic `tool-output` / `bash` alignment rules.

- [x] **Step 4: Run the tests and the type gate**

Run:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-card.test.ts src/components/process-timeline.test.ts src/components/process-timeline-model.test.ts`
Expected: all pass.
Run: `npx tsgo --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/tool-card.css packages/session-ui/src/components/process-timeline.css packages/session-ui/src/components/tool-card.test.ts packages/session-ui/src/components/process-timeline.test.ts
git commit -m "style(session-ui): unify diff body density"
```

---

### Task 5: Conformance, docs, full gates, and real-device check

**Files:**
- Modify: `packages/session-ui/src/components/tool-conformance.test.ts`
- Modify: `docs/architecture/desktop.md`
- Modify: `docs/releases/2026-11-18-memory-receipt-timeline-meta.md`
- Modify: `docs/superpowers/plans/2026-11-19-tool-presentation-wave2-diff.md` (checkboxes)

**Interfaces:**
- Consumes: `PRESENTED_DIFF_TOOLS` + `presentDiffTool` (Task 1), the three registrations (Task 3).

- [x] **Step 1: Add the conformance test**

In `tool-conformance.test.ts`, import `PRESENTED_DIFF_TOOLS, presentDiffTool` and add:
```ts
test("every diff tool resolves both states", () => {
  for (const name of PRESENTED_DIFF_TOOLS) {
    const ctx = {
      ...base,
      props: {
        ...base.props,
        tool: name,
        metadata: { files: [{ file: "C:/repo/a.ts", additions: 1, deletions: 1 }] },
      },
    }
    const out = resolvePresentation(presentDiffTool(name, ctx), ctx)
    expect(out.collapsed.title).toBeTruthy()
    expect(out.collapsed.status).toBeTruthy()
    expect(out.expanded.body).toBe("custom")
  }
})
```

- [x] **Step 2: Run conformance and the full session-ui suite**

Run conformance:
`node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-conformance.test.ts`
Expected: pass.
Run the full suite (exclude `architecture.test.ts`):
```powershell
$files = Get-ChildItem src -Recurse -Filter *.test.ts | Where-Object { $_.Name -ne 'architecture.test.ts' } | ForEach-Object { $_.FullName }
node --import tsx --import ../../packages/test-shim/register.mjs --test @files
```
Expected: `fail 0`.

- [x] **Step 3: Run desktop gates**

From `packages/desktop`:
```bash
npm test
npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
```
Expected: desktop tests `fail 0`, `tsgo` exit 0, build exit 0.

- [x] **Step 4: Verify in the running desktop app**

Reload the renderer (CDP `Page.reload`). In the current chat, expand one `编辑` card and, if present, one `补丁` card. Confirm:
- collapsed row is a single 28px line: title 11px/550, path 10.5px, `+N` / `-M` meta;
- expanded body's first line and the collapsed title share the same left edge (6px);
- details mode (`mafw-chat-details=1`) opens the diff body; default mode stays collapsed;
- no `.mafw-turn-render-error` in the DOM.

- [x] **Step 5: Update docs with real gate numbers**

- `docs/architecture/desktop.md`: extend the 2026-11-19 tool-presentation bullet with Wave 2 (diff cards on `ToolCard`, `diff-tool-model.ts`, `diff-tool-card.tsx`, `presentDiffTool`, collapsed-by-default, one density).
- `docs/releases/2026-11-18-memory-receipt-timeline-meta.md`: add the commit list and the exact suite counts observed in Steps 2–3.
- Tick every checkbox in this plan file.

- [x] **Step 6: Commit docs and plan**

```bash
git add docs/architecture/desktop.md docs/releases/2026-11-18-memory-receipt-timeline-meta.md docs/superpowers/plans/2026-11-19-tool-presentation-wave2-diff.md docs/superpowers/specs/2026-11-19-tool-presentation-contract-design.md
git commit -m "docs: record tool presentation wave 2"
```
