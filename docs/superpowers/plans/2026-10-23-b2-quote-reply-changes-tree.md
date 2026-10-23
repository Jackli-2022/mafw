# B2: Quote-Reply + Live Changes Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add selection-to-quote insertion in the chat composer and upgrade ChangesDock from a flat file list to a collapsible live-updating directory tree.

**Architecture:** Two pure modules (`quote-format.ts`, `change-tree.ts`) with node --test coverage; thin Solid wiring in `ChatPane.tsx` (selection toolbar + insertion + Esc priority), `ChangesDock.tsx` (tree + pulse), `MafwShell.tsx` (pass `liveDiffs`), and CSS. No gateway/runtime/session-ui changes.

**Tech Stack:** Electron + SolidJS, `@mafw/ui` v2 components, node --test + `@mafw/test-shim`, tsgo, electron-vite.

**Spec:** `docs/superpowers/specs/2026-10-23-b2-quote-reply-changes-tree-design.md`

## Global Constraints

- No gateway/runtime/session-ui changes; do not touch `gateway/src/runtime/pi/*`.
- Renderer uses `window.api` only; this batch needs no new IPC.
- TDD: failing test → watch fail → minimal implementation → watch pass. One commit per task on `main`.
- Desktop test command (cwd `packages/desktop`): `node --import tsx --import ../../packages/test-shim/register.mjs --test <file>`; full `npm test`; `npx tsgo --noEmit -p tsconfig.json`; `npx electron-vite build`.
- Theme tokens only; no literal colors. Reduced-motion must disable the pulse animation.
- Stage only files listed per task; user's parallel TUI/SDK changes are off-limits.

## Review Focus

1. **Selection vs focus** — dragging/selecting transcript text must not focus the composer; clicking the quote toolbar must not clear the selection before insertion (mousedown preventDefault).
2. **Esc priority** — while the quote toolbar is visible, Esc hides it and does NOT abort the running turn; the next Esc aborts as before.
3. **Pulse baseline** — switching sessions must not pulse every file; the first live snapshot per session (including empty) only establishes the baseline; later snapshots pulse only changed files.
4. **Aggregate tree vs live pulse** — tree/stats come from `aggregateSessionDiffs`; pulse comes from `store.session_diff`; files present in one but not the other must not crash or pulse a nonexistent row.
5. **Path/selection edge cases** — Windows separators, root files, `(unknown)`, nested dirs, and quote truncation at 4000 chars must behave predictably.

---

### Task 1: Quote formatting + insertion helper

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/quote-format.ts`
- Test: `packages/desktop/src/renderer/mafw/components/quote-format.test.ts`

**Interfaces:**
- Produces:
  - `export const QUOTE_MAX_CHARS = 4000`
  - `export function formatQuote(text: string, opts?: { maxChars?: number }): string`
  - `export function appendQuote(prev: string, block: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { expect, test } from "bun:test"
import { appendQuote, formatQuote, QUOTE_MAX_CHARS } from "./quote-format"

test("single line", () => {
  expect(formatQuote("hello")).toBe("> hello")
})

test("multi-line preserves blank lines", () => {
  expect(formatQuote("a\n\nb")).toBe("> a\n>\n> b")
})

test("CRLF normalized", () => {
  expect(formatQuote("a\r\nb")).toBe("> a\n> b")
})

test("leading/trailing blank lines removed, indentation preserved", () => {
  expect(formatQuote("\n  const x = 1\n\n")).toBe(">   const x = 1")
})

test("whitespace-only returns empty", () => {
  expect(formatQuote("  \n ")).toBe("")
})

test("truncates with a visible marker", () => {
  const out = formatQuote("x".repeat(QUOTE_MAX_CHARS + 1))
  expect(out.split("\n").at(-1)).toBe("> …（引用已截断）")
  expect(out.length).toBeGreaterThan(QUOTE_MAX_CHARS)
})

test("Chinese text", () => {
  expect(formatQuote("为什么这样写？")).toBe("> 为什么这样写？")
})

test("appendQuote preserves draft and adds spacing", () => {
  expect(appendQuote("", "> q")).toBe("> q\n\n")
  expect(appendQuote("draft  ", "> q")).toBe("draft\n\n> q\n\n")
  expect(appendQuote("  \n", "> q")).toBe("> q\n\n")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (cwd `packages/desktop`):
```bash
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/quote-format.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `quote-format.ts`**

- Normalize `\r\n?` → `\n`; drop leading/trailing **blank lines** (`.trim() === ""`), do not strip content indentation.
- Empty → `""`.
- If `body.length > maxChars` slice to `maxChars` and append a final `> …（引用已截断）` line.
- Prefix each line with `> `; blank line → `>`.
- `appendQuote`: `prev.trim() ? prev.replace(/\s*$/, "") + "\n\n" + block + "\n\n" : block + "\n\n"`.

- [ ] **Step 4: Run test to verify it passes**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/quote-format.ts packages/desktop/src/renderer/mafw/components/quote-format.test.ts
git commit -m "feat(desktop): quote formatting + composer insertion helper"
```

---

### Task 2: Selection quote toolbar + ChatPane wiring

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/QuoteToolbar.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Test wiring: `packages/desktop/tests/quote-reply-wiring.test.ts`
- Modify CSS: `packages/desktop/src/renderer/mafw/mafw.css` (toolbar only)

**Interfaces:**
- Consumes: `formatQuote`, `appendQuote` (Task 1).
- Produces:
  - `export interface QuoteAnchor { left: number; top: number; width: number; height: number }`
  - `export function QuoteToolbar(props: { anchor: QuoteAnchor | null; onQuote: () => void }): JSX.Element`

- [ ] **Step 1: Write the failing wiring test**

`quote-reply-wiring.test.ts` reads `ChatPane.tsx` and `QuoteToolbar.tsx`, asserting:
- ChatPane contains `formatQuote`, `appendQuote`, `QuoteToolbar`, `quoteAnchor`, `selectionchange`, `mouseup`, and `dismissQuote`.
- ChatPane Esc branch checks `quoteAnchor()` before `interrupt()`.
- QuoteToolbar contains `Portal`, `onMouseDown`, `preventDefault`.
- CSS contains `.mafw-quote-toolbar`.

Run it; expected FAIL (files missing).

- [ ] **Step 2: Implement `QuoteToolbar.tsx`**

- `Portal mount={document.body}`; render only when `props.anchor`.
- Fixed pill, `ButtonV2 variant="contrast" size="small"` with text `引用`, `aria-label="引用选中文本"`.
- Position: left = clamp(anchor.left + anchor.width/2 - 32, 8, innerWidth - 72); top = anchor.top > 48 ? anchor.top - 36 : anchor.top + anchor.height + 8.
- `onMouseDown={(e) => e.preventDefault()}`; `onClick={props.onQuote}`.

- [ ] **Step 3: Wire ChatPane selection state**

Add:
- `const [quoteAnchor, setQuoteAnchor] = createSignal<QuoteAnchor | null>(null)`
- `const [quoteText, setQuoteText] = createSignal("")`
- `const dismissQuote = () => { setQuoteAnchor(null); setQuoteText("") }`
- `updateQuoteSelection()`: selection must be non-collapsed, non-empty, inside `containerRef()` (scroller), with a non-zero range rect; set anchor + text.
- In `onMount`: `document.addEventListener("mouseup", updateQuoteSelection)`, `keyup`, `selectionchange` (hide when collapsed/empty), `resize` (dismiss); cleanup all.
- Session change effect: `sidProp(); dismissQuote()`.

- [ ] **Step 4: Wire insertion + Esc**

- `insertQuote()`: `const block = formatQuote(quoteText()); const next = appendQuote(input(), block); setInput(next); setDraft(sidProp(), next); dismissQuote(); window.getSelection()?.removeAllRanges(); queueMicrotask(focus + caret to end + autoGrow)`.
- Render `<QuoteToolbar anchor={quoteAnchor()} onQuote={insertQuote} />` at the ChatPane root.
- Scroller `onScroll` calls both `handleScroll()` and `dismissQuote()`.
- Esc handler: move the `props.focused` check first, then:
  ```ts
  if (e.key === "Escape" && quoteAnchor()) { e.preventDefault(); dismissQuote(); return }
  if (!sending()) return
  ```
  Keep Ctrl+C behavior unchanged.

- [ ] **Step 5: CSS**

Add `.mafw-quote-toolbar { position: fixed; z-index: 60; ... }` with surface background, border, shadow tokens, padding 4px; respect reduced-motion (no animation needed).

- [ ] **Step 6: Run wiring test + full desktop tests + tsgo**

```bash
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/quote-reply-wiring.test.ts
npm test
npx tsgo --noEmit -p tsconfig.json
```
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/QuoteToolbar.tsx packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/quote-reply-wiring.test.ts
git commit -m "feat(desktop): selection quote toolbar inserts into composer"
```

---

### Task 3: Change tree builder + pulse paths

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/change-tree.ts`
- Test: `packages/desktop/src/renderer/mafw/components/change-tree.test.ts`

**Interfaces:**
- Consumes: `FileDiffEntry` type from `./DiffReviewPanel`.
- Produces:
  - `export interface ChangeTreeNode { kind: "dir" | "file"; name: string; path: string; additions: number; deletions: number; status?: string; file?: FileDiffEntry; children: ChangeTreeNode[] }`
  - `export function normalizeDiffPath(file: string | undefined): string`
  - `export function buildChangeTree(files: FileDiffEntry[]): ChangeTreeNode[]`
  - `export function changedDiffPaths(prev: FileDiffEntry[] | null, next: FileDiffEntry[]): Set<string>`
  - `export function changeStatusLetter(status: string | undefined): string`

- [ ] **Step 1: Write failing tests**

```ts
import { expect, test } from "bun:test"
import { buildChangeTree, changedDiffPaths, changeStatusLetter, normalizeDiffPath } from "./change-tree"

test("nested dirs aggregate counts and sort dirs before files", () => {
  const tree = buildChangeTree([
    { file: "src/a.ts", additions: 2, deletions: 1 },
    { file: "src/ui/b.ts", additions: 3, deletions: 0 },
    { file: "README.md", additions: 1, deletions: 1 },
  ])
  expect(tree[0]).toMatchObject({ kind: "dir", name: "src", additions: 5, deletions: 1 })
  expect(tree[0].children[0]).toMatchObject({ kind: "dir", name: "ui" })
  expect(tree[0].children[1]).toMatchObject({ kind: "file", name: "a.ts" })
  expect(tree[1]).toMatchObject({ kind: "file", name: "README.md" })
})

test("windows separators, root files, unknown", () => {
  const tree = buildChangeTree([{ file: "src\\a.ts" }, { file: undefined }])
  expect(tree[0].name).toBe("src")
  expect(tree[0].children[0].name).toBe("a.ts")
  expect(tree.find(n => n.name === "(unknown)")).toBeTruthy()
  expect(normalizeDiffPath(".\\src\\a.ts")).toBe("src/a.ts")
})

test("status letter", () => {
  expect(changeStatusLetter("added")).toBe("A")
  expect(changeStatusLetter("deleted")).toBe("D")
  expect(changeStatusLetter("modified")).toBe("M")
  expect(changeStatusLetter(undefined)).toBe("")
})

test("changedDiffPaths: null baseline is silent, new/count changes pulse, unchanged don't", () => {
  expect(changedDiffPaths(null, [{ file: "a", additions: 1 }])).toEqual(new Set())
  const prev = [{ file: "a", additions: 1 }, { file: "b", additions: 2 }]
  const next = [{ file: "a", additions: 1 }, { file: "b", additions: 3 }, { file: "c", additions: 1 }]
  expect(changedDiffPaths(prev, next)).toEqual(new Set(["b", "c"]))
  expect(changedDiffPaths(prev, prev)).toEqual(new Set())
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/change-tree.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `change-tree.ts`**

- Normalize paths; split on `/`; build dir map per path segment; file leaf keeps original entry.
- Aggregate counts recursively; sort dirs first then `name.localeCompare`.
- `changedDiffPaths`: if `prev == null` return empty; map signature `${additions}|${deletions}|${status ?? ""}`; include next paths absent from prev or with a different signature.
- `changeStatusLetter`: added→A, deleted→D, modified→M, other non-empty→first uppercase, undefined→"".

- [ ] **Step 4: Run tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/change-tree.ts packages/desktop/src/renderer/mafw/components/change-tree.test.ts
git commit -m "feat(desktop): change tree builder + pulse path diff"
```

---

### Task 4: ChangesDock tree UI + live pulse + MafwShell wiring

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChangesDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx:2048-2063`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test wiring: `packages/desktop/tests/change-tree-wiring.test.ts`

**Interfaces:**
- Consumes: `buildChangeTree`, `changedDiffPaths`, `changeStatusLetter` (Task 3).
- `ChangesDock` props add `liveDiffs?: FileDiffEntry[]`.
- MafwShell passes `liveDiffs={store.session_diff?.[currentSessionID()]}` (do **not** default to `[]`; undefined means "no snapshot yet").

- [ ] **Step 1: Write failing wiring test**

`change-tree-wiring.test.ts` asserts:
- ChangesDock contains `buildChangeTree`, `changedDiffPaths`, `liveDiffs`, `mafw-change-pulse`, `mafw-change-dir`.
- MafwShell passes `liveDiffs={store.session_diff`.
- CSS contains `.mafw-change-pulse` and a reduced-motion override.

Run it; expected FAIL.

- [ ] **Step 2: Implement the tree UI**

- `const tree = createMemo(() => buildChangeTree(files()))`.
- `const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set())`.
- Recursive `ChangeNode` component with dir/file rows, chevrons (`chevron-down`/`chevron-right`), `folder` icon, aggregate stats, status badge, indentation `depth * 12`.
- Dir click toggles path in `collapsed`; file click sets `openFile(node.file?.file ?? "(unknown)")`.
- Keep header stats and empty state.

- [ ] **Step 3: Implement pulse**

- One `createEffect` tracking `props.sessionID` and `props.liveDiffs`:
  - On session change: reset `lastSid`, `seen=false`, `prevLive=null`, `pulse`, `collapsed`, `openFile`.
  - If `liveDiffs` is not an array: return (no baseline).
  - If `!seen`: `seen=true; prevLive=live; return`.
  - Else compute `changedDiffPaths(prevLive, live)`, update `prevLive`, set pulse, clear after 1200ms.
- `onCleanup` clears the timer.

- [ ] **Step 4: CSS**

- `.mafw-change-dir`, `.mafw-change-name`, `.mafw-change-status*`, indent handled inline.
- `.mafw-change-pulse` keyframes using `--hover`/`--accent`; `@media (prefers-reduced-motion: reduce)` disables animation and keeps a static left border.
- Keep existing `.mafw-changes-row` styles for file rows.

- [ ] **Step 5: Full gates**

```bash
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/change-tree-wiring.test.ts
npm test
npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ChangesDock.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/change-tree-wiring.test.ts
git commit -m "feat(desktop): collapsible live changes tree with pulse"
```

---

### Task 5: Docs, full gates, independent review

**Files:**
- Modify: `AGENTS.md` (§5.5 B2 paragraph)
- Ledger: `.superpowers/sdd/2026-10-23-b2-quote-reply-changes-tree/progress.md`

- [ ] **Step 1: Update AGENTS.md**

Add a dated B2 bullet with: quote format/cap, toolbar Esc priority, tree source (`aggregateSessionDiffs`) vs pulse source (`store.session_diff`), baseline rule, commit hashes, test counts.

- [ ] **Step 2: Full gates**

```bash
cd packages/desktop && npm test && npx tsgo --noEmit -p tsconfig.json && npx electron-vite build
```
Expected: all green; record exact counts (baseline 1332).

- [ ] **Step 3: Independent review**

Dispatch a fresh reviewer with the spec, plan, Review Focus, ledger rulings, and the diff. If the provider 403s, self-review and record it.

- [ ] **Step 4: Fix Critical/Important in one TDD pass**

Each fix: failing test, fix, green suite, ledger line `Final: fixed ...`. Minors → ledger.

- [ ] **Step 5: Commit docs**

```bash
git add AGENTS.md
git commit -m "docs: B2 quote-reply + live changes tree ship notes"
```

---

## Self-Review (plan vs spec)

- **Spec coverage:** quote format/insertion → Task 1; toolbar/selection/Esc → Task 2; tree/pulse pure logic → Task 3; tree UI/live wiring → Task 4; docs/review → Task 5.
- **Interface consistency:** `formatQuote`/`appendQuote` used only in ChatPane; `buildChangeTree`/`changedDiffPaths`/`changeStatusLetter` used only in ChangesDock; `liveDiffs` added to ChangesDock and passed from MafwShell.
- **Review Focus tests:** selection/focus (Task 2 wiring + manual), Esc (Task 2 wiring), pulse baseline (Task 3 + Task 4 wiring), aggregate/live divergence (Task 3 `changedDiffPaths` + Task 4), paths/truncation (Tasks 1/3 tests).
- **Proportion:** two pure modules + two thin wiring tasks; no task is a transcript.
