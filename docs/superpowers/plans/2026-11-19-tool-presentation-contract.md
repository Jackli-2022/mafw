# ToolPresentation Contract (Wave 1 + 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every ChatView tool card use one `ToolPresentation` contract with explicit `collapsed` / `expanded` states, explicit defaults, one 11px density, and a real expanded body for row tools + the context group.

**Architecture:** Add a pure `tool-presentation.ts` contract and a `ToolCard` shell in session-ui. `ToolRegistry` gains `present`, `renderCollapsed`, `renderBody`, `override`, `has`, `names`. `ToolPartDisplay` renders `ToolCard` when a presentation exists, otherwise keeps legacy `render`. `ProcessTimeline` and `AssistantParts` share the same card; no second density.

**Tech Stack:** TypeScript, SolidJS, `node:test` + `@mafw/test-shim`, Vite/Electron.

**Spec:** `docs/superpowers/specs/2026-11-19-tool-presentation-contract-design.md`

## Global Constraints

- ChatView collapsed row: **11px / 550** title, **10.5px** object/meta, **28px** high, full available width, one line only.
- Long `object` fades only in the last **8px** before the chevron; chevron/meta sit outside the mask.
- Expanded body first line aligns with the collapsed title: `--mafw-tool-content-left: 6px`.
- Every tool must have both states. Missing `collapsed` / `expanded` fields fall back to `defaultCollapsed()` / `DEFAULT_EXPANDED` (`body: "default"`).
- `body: "custom"` without `renderBody` is a conformance failure; never render an empty expanded body.
- History output must use `partOutputText(state)` (`state.output ?? state.content[].text`); never assume `state.output`.
- CodeMode child calls expose **name / status / input only** (`metadata.toolCalls`); per-call output is not available. Only the final `execute.output` exists. Do not fabricate child results.
- Plugin cards keep `render` as the override surface; `override` wins and restore must return the full prior entry.
- Do not touch approval cards, flow cards, `renderAfterPart`, or mobile.
- Run the session-ui full suite excluding the pre-existing `architecture.test.ts` red; desktop full suite + `tsgo` + `electron-vite build` per task where the change can affect them.

## Review Focus

- Unknown/MCP tool with empty input and empty output: must still collapse to a titled row and expand to the generic default body, never crash.
- History tool part with `state.content[]` and no `state.output`: expanded body must show the content text.
- CodeMode `execute` child calls with dotted names, missing input, running/error states: collapsed/expanded must be stable; no per-child output is shown.
- Plugin `override` on a first-party tool that now has `present`: override must win; restore must bring back `present`, not drop it.
- Context group with `read` missing a path or using `file_path`: filename/subtitle must not be `undefined`.

---

### Task 1: Contract types, defaults, and output normalization

**Files:**
- Create: `packages/session-ui/src/components/tool-presentation.ts`
- Test: `packages/session-ui/src/components/tool-presentation.test.ts`

**Interfaces:**
- Produces: `ToolStatus`, `ToolMeta`, `ToolAction`, `ToolCollapsedPresentation`, `ToolExpandedPresentation`, `ToolPresentation`, `ResolvedToolPresentation`, `ToolPresentationContext`, `ToolPresenter`, `defaultCollapsed()`, `DEFAULT_EXPANDED`, `resolvePresentation()`, `partOutputText()`.
- `resolvePresentation(raw, ctx) -> ResolvedToolPresentation` where `ResolvedToolPresentation = { collapsed: ToolCollapsedPresentation; expanded: ToolExpandedPresentation }`.

- [ ] **Step 1: Write the failing tests**

`tool-presentation.test.ts`:
```ts
import { describe, expect, test } from "bun:test"
import { DEFAULT_EXPANDED, defaultCollapsed, partOutputText, resolvePresentation } from "./tool-presentation"

const ctx = (tool = "mcp_probe", status: any = "completed") => ({
  props: { tool, input: {}, metadata: {}, status } as any,
  mode: "chat" as const,
  t: (key: string) => key,
})

describe("tool presentation defaults", () => {
  test("undefined presentation still collapses to a titled row and expands to default", () => {
    const out = resolvePresentation(undefined, ctx())
    expect(out.collapsed.title).toBe("mcp_probe")
    expect(out.collapsed.status).toBe("completed")
    expect(out.expanded.body).toBe("default")
  })
  test("partial collapsed keeps title and fills status", () => {
    const out = resolvePresentation({ collapsed: { title: "Read" } }, ctx("read", "running"))
    expect(out.collapsed.title).toBe("Read")
    expect(out.collapsed.status).toBe("running")
  })
  test("DEFAULT_EXPANDED is default body", () => {
    expect(DEFAULT_EXPANDED.body).toBe("default")
    expect(defaultCollapsed(ctx()).title).toBe("mcp_probe")
  })
  test("partOutputText prefers output and joins history content text", () => {
    expect(partOutputText({ output: "out" })).toBe("out")
    expect(partOutputText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("a\nb")
    expect(partOutputText({})).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/session-ui && node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-presentation.test.ts`
Expected: FAIL because `tool-presentation.ts` does not exist.

- [ ] **Step 3: Implement the module**

`tool-presentation.ts` must export the types from the spec, `Section` / `ListItem` / `ToolBadge` (moved from desktop later; for now define them here), and:
```ts
export function statusOf(props: ToolProps): ToolStatus
export function defaultCollapsed(ctx: ToolPresentationContext): ToolCollapsedPresentation
export const DEFAULT_EXPANDED: ToolExpandedPresentation
export function resolvePresentation(
  raw: ToolPresentation | undefined,
  ctx: ToolPresentationContext,
): { collapsed: ToolCollapsedPresentation; expanded: ToolExpandedPresentation }
export function partOutputText(state: any): string | undefined
```
`partOutputText` returns `state.output` when string; otherwise joins `state.content` text parts with `\n`; empty → `undefined`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/session-ui && node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-presentation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/tool-presentation.ts packages/session-ui/src/components/tool-presentation.test.ts
git commit -m "feat(session-ui): add the tool presentation contract"
```

---

### Task 2: Registry surface (`present`, custom states, override, enumeration)

**Files:**
- Modify: `packages/session-ui/src/components/tool-registry.ts`
- Test: `packages/session-ui/src/components/tool-registry.test.ts`

**Interfaces:**
- Consumes: `ToolPresenter`, `ToolPresentation` from Task 1.
- Produces: `ToolRegistryEntry` fields `present`, `renderCollapsed`, `renderBody`, `render`, `override`, `handlesError`; `ToolRegistry.override(name, render)`, `ToolRegistry.has(name)`, `ToolRegistry.names()`, `ToolRegistry.entry(name)`.

- [ ] **Step 1: Write the failing tests**

`tool-registry.test.ts`:
```ts
import { describe, expect, test } from "bun:test"
import { ToolRegistry } from "./tool-registry"

describe("ToolRegistry presentation surface", () => {
  test("has() sees a presenter-only entry", () => {
    ToolRegistry.register({ name: "present_only", present: () => ({}) })
    expect(ToolRegistry.has("present_only")).toBe(true)
    expect(ToolRegistry.names()).toContain("present_only")
  })
  test("override wins and restore brings back present", () => {
    const original = () => null
    ToolRegistry.register({ name: "overridable", present: () => ({}) })
    const restore = ToolRegistry.override("overridable", original)
    expect(ToolRegistry.entry("overridable")?.override).toBe(true)
    expect(ToolRegistry.entry("overridable")?.render).toBe(original)
    restore()
    expect(ToolRegistry.entry("overridable")?.present).toBeDefined()
    expect(ToolRegistry.entry("overridable")?.override).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/session-ui && node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/tool-registry.test.ts`
Expected: FAIL on missing `has` / `override` / `entry`.

- [ ] **Step 3: Implement the registry changes**

`registerTool` keeps replace semantics. Add:
```ts
export function overrideTool(name: string, render: ToolComponent) {
  const previous = state[name]
  state[name] = { ...(previous ?? { name }), name, render, override: true }
  return () => { if (previous) state[name] = previous; else delete state[name] }
}
export function hasTool(name: string): boolean { return !!(state[name]?.present || state[name]?.render) }
export function toolNames(): string[] { return Object.keys(state) }
export function toolEntry(name: string): ToolRegistryEntry | undefined { return state[name] }
```
Expose on `ToolRegistry`.

- [ ] **Step 4: Run the test to verify it passes**

Run the same single-file command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/tool-registry.ts packages/session-ui/src/components/tool-registry.test.ts
git commit -m "feat(session-ui): extend the tool registry for presentations"
```

---

### Task 3: `ToolCard` shell (collapsed/expanded, fade, alignment)

**Files:**
- Create: `packages/session-ui/src/components/tool-card.tsx`
- Create: `packages/session-ui/src/components/tool-card.css`
- Test: `packages/session-ui/src/components/tool-card.test.ts`

**Interfaces:**
- Consumes: `resolvePresentation`, `ToolPresentationContext`, `partOutputText`.
- Produces: `<ToolCard props={ToolProps} presentation={ResolvedToolPresentation} open? defaultOpen? onOpenChange? renderCollapsed? renderBody? renderSections? />`.

- [ ] **Step 1: Write the failing source/CSS test**

`tool-card.test.ts` asserts:
- `tool-card.tsx` contains `data-state`, `mafw-tool-card`, `Collapsible.Arrow`, `renderCollapsed`, `renderBody`.
- `tool-card.css` contains `--mafw-tool-content-left: 6px`, `max-height: 28px`, `mask-image`, `calc(100% - 8px)`.

- [ ] **Step 2: Run it to verify it fails**

Run: single-file test command; expected FAIL (files missing).

- [ ] **Step 3: Implement `ToolCard`**

- Collapsed row: `data-state`, `mafw-tool-card-trigger`, title/object/meta, arrow.
- If `renderCollapsed` provided, render it inside the trigger; still wrap in the 28px one-line shell.
- Body selection: `renderBody` → `expanded.sections` via `renderSections` → built-in `body` (`default`/`markdown`/`terminal`/`json`) → `DEFAULT_EXPANDED`.
- Default body: input JSON + output text (`partOutputText` or `props.output`).
- Root `data-state="collapsed" | "expanded"`; default collapsed; `defaultOpen` opt-in.

- [ ] **Step 4: Run the test to verify it passes**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/tool-card.tsx packages/session-ui/src/components/tool-card.css packages/session-ui/src/components/tool-card.test.ts
git commit -m "feat(session-ui): add the collapsed/expanded tool card shell"
```

---

### Task 4: Row presenters and generic fallback

**Files:**
- Modify: `packages/session-ui/src/components/message-part.tsx` (read/list/glob/grep/webfetch/websearch/bash registrations)
- Modify: `packages/session-ui/src/components/basic-tool.tsx` (`GenericTool` presentation helper)
- Test: `packages/session-ui/src/components/tool-presenters.test.ts`

**Interfaces:**
- Consumes: Task 1 contract and Task 2 registry.
- Produces: `present` on each row tool; `genericPresentation(props, ctx)` for `GenericTool`.

- [ ] **Step 1: Write the failing tests**

Use fixture `ToolProps` and a fake `t`; assert:
- `read` collapsed title `ui.tool.read`, object is relative path (with directory), expanded body `default`.
- `list/glob/grep` object/args.
- `webfetch` has a `link` action and **default expanded body** (no `hideDetails` regression).
- `bash` body `terminal`.
- unknown tool via `genericPresentation` yields title = tool name, body `default`.

- [ ] **Step 2: Run and verify fail**

Single-file test; expected FAIL.

- [ ] **Step 3: Implement the presenters**

Add `present` functions next to each registration; keep legacy `render` until later tasks. Do not change existing `getToolInfo` yet. `webfetch` collapsed action `{ kind: "link", href: input.url }`; expanded default body. `bash` expanded `body: "terminal"`. `read/list/glob/grep/websearch` default body.

- [ ] **Step 4: Run and verify pass**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/message-part.tsx packages/session-ui/src/components/basic-tool.tsx packages/session-ui/src/components/tool-presenters.test.ts
git commit -m "feat(session-ui): present row tools with collapsed/expanded states"
```

---

### Task 5: `ToolPartDisplay` uses `ToolCard` + history output

**Files:**
- Modify: `packages/session-ui/src/components/message-part.tsx:1626-1712`
- Test: `packages/session-ui/src/components/message-part.test.ts`

**Interfaces:**
- Consumes: `resolvePresentation`, `ToolCard`, `partOutputText`.
- Produces: `output={partOutputText(part().state)}` for every tool; `ToolCard` when `entry.present || entry.renderCollapsed` exists; legacy `Dynamic` otherwise.

- [ ] **Step 1: Write the failing test**

Add source assertions:
- `message-part.tsx` contains `partOutputText(` and `ToolCard`.
- `ToolPartDisplay` no longer passes `output={part().state.output}` only.

- [ ] **Step 2: Run and verify fail**

Single-file test; expected FAIL.

- [ ] **Step 3: Implement the wiring**

Build `ctx` with `props`, `directory: data.directory`, `mode: "chat"`, `t: i18n.t`, `sessionHref`/`agent` where available. If `present` exists, render `<ToolCard>`; else keep `Dynamic`. Pass `output={partOutputText(part().state)}` to both paths. Keep `todowrite` early return and `question` pending gate.

- [ ] **Step 4: Run and verify pass**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/message-part.tsx packages/session-ui/src/components/message-part.test.ts
git commit -m "feat(session-ui): render presented tools through the shared card"
```

---

### Task 6: Context group migration

**Files:**
- Modify: `packages/session-ui/src/components/message-part.tsx:893-961,1178-1214`
- Test: `packages/session-ui/src/components/context-group.test.ts`

**Interfaces:**
- Consumes: `resolvePresentation` with `mode: "context"`, `ToolCard`.
- Produces: no `contextToolTrigger` / `contextToolDetail`; group rows use `present` (filename for read, directory for list/glob/grep, args).

- [ ] **Step 1: Write the failing test**

Assert source no longer contains `contextToolTrigger` / `contextToolDetail`; `ContextToolGroup` contains `resolvePresentation` and `mode: "context"`. Add a pure fixture test that a read part with `file_path` yields the filename, not `undefined`.

- [ ] **Step 2: Run and verify fail**

Single-file test; expected FAIL.

- [ ] **Step 3: Implement**

Replace the trigger builder with `resolvePresentation` and render the group row through `ToolCard` with `data-in-group` (CSS can flatten the shell). Keep the group summary counts.

- [ ] **Step 4: Run and verify pass**

Same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/session-ui/src/components/message-part.tsx packages/session-ui/src/components/context-group.test.ts
git commit -m "feat(session-ui): migrate the context group to tool presentations"
```

---

### Task 7: Plugin override integration

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/UserPluginCards.tsx`
- Modify: `packages/desktop/src/renderer/mafw/plugins/PluginToolCard.tsx`
- Modify: `packages/desktop/src/renderer/mafw/plugins/plugin-tool-card-model.ts`
- Test: existing `plugin-tool-card-model` tests + add override/restore case.

- [ ] **Step 1: Write the failing test**

Add a test that a plugin override on a `present`-only tool wins and restore returns the `present` entry (fake registry).

- [ ] **Step 2: Run and verify fail**

Run the desktop plugin test file; expected FAIL.

- [ ] **Step 3: Implement**

Use `ToolRegistry.has` for slot occupancy and `ToolRegistry.override` for install/restore; remove `{ name, render: original }` restore.

- [ ] **Step 4: Run and verify pass**

Same test file; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/UserPluginCards.tsx packages/desktop/src/renderer/mafw/plugins/PluginToolCard.tsx packages/desktop/src/renderer/mafw/plugins/plugin-tool-card-model.ts <test files>
git commit -m "feat(desktop): preserve presentations through plugin overrides"
```

---

### Task 8: ChatView density + real-machine verification

**Files:**
- Modify: `packages/session-ui/src/components/process-timeline.css` (remove obsolete density overrides; keep 11px token)
- Modify: `packages/session-ui/src/components/message-part.css` if the native 14px fallback is still used in the timeline
- Test: `packages/session-ui/src/components/process-timeline.test.ts`

- [ ] **Step 1: Write the failing CSS test**

Assert the shared card selectors use 11px/10.5px, `--mafw-tool-content-left: 6px`, and `mask-image ... calc(100% - 8px)`; assert no `.mafw-process-step-card` rule sets 14px.

- [ ] **Step 2: Run and verify fail**

Single-file test; expected FAIL for missing shared selectors.

- [ ] **Step 3: Implement/clean CSS**

Point the timeline and AssistantParts at the `ToolCard` classes; remove duplicated title/path overrides that are now owned by `ToolCard`.

- [ ] **Step 4: Run and verify pass**

Single-file test; expected PASS.

- [ ] **Step 5: Real-machine smoke**

Reload the dev app; open a segment with Read/Shell/Edit; verify 11px title, 10.5px path, 8px fade, one-line collapsed, body aligned at 6px, no `.mafw-turn-render-error`.

- [ ] **Step 6: Commit**

```bash
git add packages/session-ui/src/components/process-timeline.css packages/session-ui/src/components/process-timeline.test.ts
git commit -m "feat(session-ui): unify ChatView tool cards at 11px"
```

---

### Task 9 (follow-up, not blocking Wave 1): CodeMode `execute` adapter

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/execute.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/tool-cards/execute-model.ts`
- Test: `packages/desktop/src/renderer/mafw/components/tool-cards/execute-model.test.ts`

**Interfaces:**
- Consumes: `present` / `renderBody` escape hatch from Task 2/3.
- Produces: `execute` collapsed fields (title `Code Mode 执行`, meta `N 次调用`, failed marker) and expanded body = current `MafwExecuteCard` body.

- [ ] **Step 1: Write the failing test**

Assert `executeCalls` keeps dotted/bare names, drops malformed entries, and never invents an `output` field. Add a source assertion that the `execute` entry has `present` and `renderBody`.

- [ ] **Step 2: Run and verify fail**

Run the desktop execute-model test; expected FAIL on the new source assertion.

- [ ] **Step 3: Implement**

Split `MafwExecuteCard` into `executeCollapsed` (title/meta) + `ExecuteBody` (current `BasicTool` children). Register `{ name: "execute", present, renderBody }`. Keep `defaultOpen: true`, `defer: false`.

- [ ] **Step 4: Run and verify pass**

Same test; expected PASS.

- [ ] **Step 5: Document the boundary**

In the plan/spec note: child calls expose name/status/input only; per-call output is not available. If per-call results are required, use `codemode: false` or an upstream opencode change.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/tool-cards/execute.tsx packages/desktop/src/renderer/mafw/components/tool-cards/execute-model.ts packages/desktop/src/renderer/mafw/components/tool-cards/execute-model.test.ts
git commit -m "feat(desktop): adopt the tool presentation contract for CodeMode"
```

---

### Task 10: Full gates

- [ ] **Step 1: Session UI full suite (excluding the existing architecture red)**

Run: `cd packages/session-ui && $files = Get-ChildItem src -Recurse -Filter *.test.ts | Where-Object { $_.Name -ne 'architecture.test.ts' } | ForEach-Object { $_.FullName }; node --import tsx --import ../../packages/test-shim/register.mjs --test @files`
Expected: all pass; record the new count.

- [ ] **Step 2: Desktop full suite + tsgo**

Run: `cd packages/desktop && npm test`; `npx tsgo --noEmit -p tsconfig.json`.
Expected: 0 failures; rc 0.

- [ ] **Step 3: Build**

Run: `cd packages/desktop && npx electron-vite build`.
Expected: rc 0.

- [ ] **Step 4: Real machine**

Reload the dev app; no `.mafw-turn-render-error`; open Read/Shell/Edit/WebFetch/Generic MCP; verify collapsed/expanded, 8px fade, 6px body alignment, 11px title.

- [ ] **Step 5: Commit the remaining docs/release note**

```bash
git add docs/architecture/desktop.md docs/releases/2026-11-18-memory-receipt-timeline-meta.md
git commit -m "docs: record the tool presentation wave 1"
```
