# Desktop Interaction Parity (B 线) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three interaction gaps the user named (subagent jump, composer readline/history, background-task capability visibility) plus click-to-focus the composer, without touching gateway/runtime.

**Architecture:** Pure reducers/predicates in small light modules (node --test friendly), thin Solid wiring in `ChatPane.tsx` / `MafwShell.tsx` / `BackgroundDock.tsx` / `BackgroundWorkBar.tsx`, and one small `session-ui` change for task-card navigation. Each task is independently testable and committed.

**Tech Stack:** Electron + SolidJS, `@mafw/session-ui`, node --test + `@mafw/test-shim`, tsgo, electron-vite.

**Spec:** `docs/superpowers/specs/2026-10-23-desktop-interaction-parity-design.md`

## Global Constraints

- No gateway/runtime changes; do not touch `gateway/src/runtime/pi/*` or `gateway/tests/unit/runtime/pi-cognition.test.ts` (user's parallel work).
- Renderer calls only `window.api` (preload); no direct `fetch` from renderer.
- TDD: write the failing test, watch it fail, implement, watch it pass, commit. One commit per task on `main`.
- Desktop test command (cwd `packages/desktop`): `node --import tsx --import ../../packages/test-shim/register.mjs --test <file>`; full: `npm test`.
- Session-ui test command (cwd `packages/session-ui`): `node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/<file>`; full: `npm test`.
- Typecheck: `packages/desktop` → `npx tsgo --noEmit -p tsconfig.json`; `packages/session-ui` → `npm run typecheck`. Build: `packages/desktop` → `npx electron-vite build`.
- CSS/theme: use existing tokens; no literal colors; no new global button/input primitives.
- Do not commit unrelated user changes; stage only the files listed per task.

## Review Focus

1. **Text selection vs focus stealing** — dragging or double-clicking transcript text must keep the selection and NOT move focus to the composer (B4).
2. **Ctrl+F / Ctrl+K ownership** — with the composer focused, readline must win; global search must only fire when focus is outside `.mafw-composer` (B2a).
3. **Oversized history safety** — entries > 4KB must be dropped whole, never recalled truncated; total history stays ≤ 20KB (B2b).
4. **Failed subagent cards** — error-state task cards must navigate to the child session when metadata has an id, not just normal cards (B1).
5. **REST capability transition** — `unavailable` must become `available` (buttons appear) without a remount, via the 60s re-probe/reset path (B3).

---

### Task 0: Live wire probe (task metadata + `/api/shell` two-state)

**Files:**
- Create: `docs/research/2026-10-23-task-metadata-probe.md`
- Delete (after probe): the scratch session created below

**Interfaces:**
- Produces: a pinned metadata key set (`sessionId` / `sessionID` / `childSessionID` / none) and the observed `/api/shell` status (200 / 401 / 502), recorded in the probe doc. Task 1 and Task 4 consume this decision.

- [ ] **Step 1: Check serve**

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health | ConvertTo-Json -Depth 2
```

Expected: `serveRunning: true`. If false, run `mafw restart-agent` (or start the dev app) and re-check up to 60s. If still false, record `serve blocked` in the probe doc and continue — Task 1's three-key compatibility and Task 4's injected probes do not depend on live serve.

- [ ] **Step 2: Create a scratch session**

```powershell
$s = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/session -ContentType 'application/json' -Body '{"directory":"C:\\work\\work-loop\\opencode-plugin-mafw"}'
$sid = $s.id
```

Expected: a session object; capture `id` (if wrapped, use `$s.data.id` / `$s.info.id` — record the actual envelope in the probe doc).

- [ ] **Step 3: Spawn one subagent**

```powershell
$body = '{"message":"Use the task tool to spawn exactly one subagent. Instruct it to reply with exactly OK and nothing else. Do not do anything else.","parts":[{"type":"text","text":"Use the task tool to spawn exactly one subagent. Instruct it to reply with exactly OK and nothing else. Do not do anything else."}]}'
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/api/session/$sid/promptAsync" -ContentType 'application/json' -Body $body
Start-Sleep -Seconds 30
```

Expected: 200. If the runtime rejects the body shape, record the error and use the desktop app to create the subagent manually; the probe goal is the part metadata, not the API shape.

- [ ] **Step 4: Capture the task part metadata**

```powershell
Invoke-RestMethod "http://127.0.0.1:3000/api/sessions/$sid/messages?limit=50" | ConvertTo-Json -Depth 12 > .superpowers/task-probe.json
Invoke-RestMethod "http://127.0.0.1:3000/api/sessions/$sid/children" | ConvertTo-Json -Depth 6
```

Find the part with `tool === "task"`. Record:
- `state.status`
- exact `state.metadata` keys (especially `sessionId`, `sessionID`, `childSessionID`)
- whether `state.metadata` is absent entirely
- the child id returned by `/children`

- [ ] **Step 5: Probe `/api/shell` two-state**

```powershell
try { (Invoke-WebRequest http://127.0.0.1:3000/api/shell -UseBasicParsing).StatusCode } catch { $_.Exception.Response.StatusCode.value__ }
Invoke-RestMethod http://127.0.0.1:3000/api/runtime | ConvertTo-Json -Depth 4
```

Record status (200 / 401 / 502) and `active.name`. This pins the B3 gate's starting state.

- [ ] **Step 6: Write the probe doc and delete the scratch session**

Create `docs/research/2026-10-23-task-metadata-probe.md` with a small table:

| Item | Observed |
|---|---|
| task `state.status` | … |
| metadata keys | … |
| child id key | … |
| `/api/shell` via :3000 | … |
| runtime | … |
| decision | prefer `<key>`; tracker fallback needed? yes/no |

Then `DELETE http://127.0.0.1:3000/api/sessions/$sid`.

- [ ] **Step 7: Commit**

```bash
git add docs/research/2026-10-23-task-metadata-probe.md
git commit -m "docs: task part metadata + shell REST probe (B line Task 0)"
```

---

### Task 1: Task-card subagent jump (B1)

**Files:**
- Create: `packages/session-ui/src/components/task-session.ts`
- Test: `packages/session-ui/src/components/task-session.test.ts`
- Modify: `packages/session-ui/src/components/message-part.tsx` (import; `taskId` at ~1611; error branch at ~1648; task card at ~2070)
- Modify: `packages/session-ui/src/components/tool-error-card.tsx` (props/split/render)
- Test wiring: `packages/desktop/tests/task-card-wiring.test.ts` (new; source assertion that the error branch passes `onNavigate`)

**Interfaces:**
- Produces:
  - `export function taskChildSessionID(metadata: Record<string, unknown> | null | undefined): string | undefined` — first non-empty string of `sessionId` → `sessionID` → `childSessionID`.
  - `ToolErrorCardProps.onNavigate?: () => void` — when present, the subtitle becomes a clickable button-like element; `href` still takes precedence when both exist.

- [ ] **Step 1: Write the failing test**

`packages/session-ui/src/components/task-session.test.ts`:

```ts
import { describe, expect, test } from "bun:test"
import { taskChildSessionID } from "./task-session"

describe("taskChildSessionID", () => {
  test("accepts camelCase sessionId", () => {
    expect(taskChildSessionID({ sessionId: "a" })).toBe("a")
  })
  test("accepts opencode sessionID (capital ID)", () => {
    expect(taskChildSessionID({ sessionID: "b" })).toBe("b")
  })
  test("accepts childSessionID", () => {
    expect(taskChildSessionID({ childSessionID: "c" })).toBe("c")
  })
  test("prefers sessionId over sessionID", () => {
    expect(taskChildSessionID({ sessionId: "a", sessionID: "b" })).toBe("a")
  })
  test("ignores empty / non-string values", () => {
    expect(taskChildSessionID({ sessionId: "", sessionID: 42 })).toBeUndefined()
    expect(taskChildSessionID({})).toBeUndefined()
    expect(taskChildSessionID(null)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (cwd `packages/session-ui`):

```bash
node --import tsx --import ../../packages/test-shim/register.mjs --test src/components/task-session.test.ts
```

Expected: FAIL — cannot find module `./task-session`.

- [ ] **Step 3: Implement `task-session.ts`**

```ts
export function taskChildSessionID(
  metadata: Record<string, unknown> | null | undefined,
): string | undefined {
  const m = metadata ?? {}
  for (const key of ["sessionId", "sessionID", "childSessionID"] as const) {
    const value = m[key]
    if (typeof value === "string" && value) return value
  }
  return undefined
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the same command. Expected: PASS (5 tests).

- [ ] **Step 5: Wire the normal task card**

If Task 0 recorded `metadata = none` (no usable key), stop here and add the tracker-enrichment follow-up described in spec §B1.3 before wiring; do not guess a title match in this task.

In `message-part.tsx`:
- import `{ taskChildSessionID } from "./task-session"`.
- `taskId` memo (`partMetadata().sessionId`) → `taskChildSessionID(partMetadata())`.
- task render's `childSessionId` memo (`props.metadata.sessionId`) → `taskChildSessionID(props.metadata)`.

- [ ] **Step 6: Wire the failed task card**

In `tool-error-card.tsx`:
- add `onNavigate?: () => void` to `ToolErrorCardProps`.
- add `"onNavigate"` to `splitProps`.
- change the subtitle `Show` condition from `split.href && split.subtitle` to `(split.href || split.onNavigate) && split.subtitle`.
- render `<a href={split.href} role={!split.href ? "button" : undefined} tabIndex={!split.href ? 0 : undefined} onClick={(e) => { e.stopPropagation(); split.onNavigate?.() }} onKeyDown={(e) => { if (!split.href && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); split.onNavigate?.() } }}>`.

In `message-part.tsx` error branch, pass:

```tsx
onNavigate={() => {
  const id = taskChildSessionID(partMetadata())
  if (id) data.navigateToSession?.(id)
}}
```

- [ ] **Step 7: Add the desktop wiring test**

`packages/desktop/tests/task-card-wiring.test.ts` reads `packages/session-ui/src/components/message-part.tsx` and asserts:
- `taskChildSessionID(partMetadata())`
- `onNavigate={` in the `ToolErrorCard` JSX
- `data.navigateToSession?.(id)`

Run: `node --import tsx --import ../../packages/test-shim/register.mjs --test tests/task-card-wiring.test.ts` from `packages/desktop`. Expected: PASS.

- [ ] **Step 8: Full session-ui tests + typecheck**

```bash
cd packages/session-ui && npm test && npm run typecheck
```

Expected: all pass; no TS errors.

- [ ] **Step 9: Commit**

```bash
git add packages/session-ui/src/components/task-session.ts packages/session-ui/src/components/task-session.test.ts packages/session-ui/src/components/message-part.tsx packages/session-ui/src/components/tool-error-card.tsx packages/desktop/tests/task-card-wiring.test.ts
git commit -m "fix(session-ui): task card jump accepts sessionID metadata + failed card navigation"
```

---

### Task 2: Composer readline editing layer (B2a)

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/composer-readline.ts`
- Test: `packages/desktop/src/renderer/mafw/components/composer-readline.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx` (import; keydown branch; Ctrl+F guard)
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx` (Ctrl+K guard)
- Test wiring: `packages/desktop/tests/composer-readline-wiring.test.ts` (new)

**Interfaces:**
- Produces:

```ts
export interface ReadlineState { value: string; start: number; end: number }
export interface ReadlineMods { ctrl?: boolean; alt?: boolean; meta?: boolean; shift?: boolean }
export function applyReadlineKey(
  state: ReadlineState,
  key: string,
  mods: ReadlineMods,
): ReadlineState | null
```

Returns the new value/selection, or `null` when the key is not a readline binding. Selection is always collapsed (`start === end`) on a handled key.

- [ ] **Step 1: Write the failing tests**

`composer-readline.test.ts` (`import { describe, expect, test } from "bun:test"`):

```ts
import { expect, test } from "bun:test"
import { applyReadlineKey } from "./composer-readline"

const S = (value: string, start: number, end = start) => ({ value, start, end })

test("Ctrl+A to line start", () => {
  expect(applyReadlineKey(S("abc def\nghi", 6), "a", { ctrl: true })).toEqual(S("abc def\nghi", 0))
})
test("Ctrl+E to line end", () => {
  expect(applyReadlineKey(S("abc def\nghi", 6), "e", { ctrl: true })).toEqual(S("abc def\nghi", 7))
})
test("Ctrl+B/F move one char and clamp", () => {
  expect(applyReadlineKey(S("abc", 1), "b", { ctrl: true })).toEqual(S("abc", 0))
  expect(applyReadlineKey(S("abc", 1), "f", { ctrl: true })).toEqual(S("abc", 2))
})
test("Ctrl+K kills to line end (keeps newline)", () => {
  expect(applyReadlineKey(S("abc def\nghi", 4), "k", { ctrl: true })).toEqual(S("abc \nghi", 4))
})
test("Ctrl+U kills to line start", () => {
  expect(applyReadlineKey(S("abc def\nghi", 10), "u", { ctrl: true })).toEqual(S("abc def\ni", 8))
})
test("Ctrl+W deletes previous word", () => {
  expect(applyReadlineKey(S("abc def", 7), "w", { ctrl: true })).toEqual(S("abc ", 4))
})
test("Ctrl+T transposes around caret / at end", () => {
  expect(applyReadlineKey(S("abc", 2), "t", { ctrl: true })).toEqual(S("acb", 3))
  expect(applyReadlineKey(S("abc", 3), "t", { ctrl: true })).toEqual(S("acb", 3))
  expect(applyReadlineKey(S("a", 1), "t", { ctrl: true })).toBeNull()
  expect(applyReadlineKey(S("a\nb", 2), "t", { ctrl: true })).toBeNull()
})
test("kill commands delete a non-empty selection first", () => {
  expect(applyReadlineKey(S("abcdef", 1, 4), "k", { ctrl: true })).toEqual(S("aef", 1))
})
test("Alt+B/F move by word", () => {
  expect(applyReadlineKey(S("abc def ghi", 8), "b", { alt: true })).toEqual(S("abc def ghi", 4))
  expect(applyReadlineKey(S("abc def ghi", 4), "f", { alt: true })).toEqual(S("abc def ghi", 7))
})
test("returns null without ctrl/alt, or with meta/shift", () => {
  expect(applyReadlineKey(S("abc", 1), "a", {})).toBeNull()
  expect(applyReadlineKey(S("abc", 1), "a", { ctrl: true, meta: true })).toBeNull()
  expect(applyReadlineKey(S("abc", 1), "a", { ctrl: true, shift: true })).toBeNull()
  expect(applyReadlineKey(S("abc", 1), "q", { ctrl: true })).toBeNull()
})
```

Add: Ctrl+A/E on the last line; Alt+Backspace? No (out of scope); Ctrl+T with `\n` adjacent → `null`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/composer-readline.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `composer-readline.ts`**

Line helpers (`lineStart`, `lineEnd`, `wordLeft`, `wordRight`), then a switch on lowercased key:
- `lineStart`: `lastIndexOf("\n", caret - 1) + 1`; `lineEnd`: `indexOf("\n", caret)` or `value.length`.
- `wordLeft`: skip whitespace before the caret, then skip non-whitespace; `wordRight`: if the char at the caret is whitespace, skip it, then skip non-whitespace to the end of the next word (Emacs `forward-word` semantics).
- `a` with ctrl → lineStart; `e` → lineEnd; `b` → `alt ? wordLeft : start-1`; `f` → `alt ? wordRight : start+1`; `k/u/w` kill selection or range; `t` transpose. All clamp to `[0, value.length]`.
- Movement: `start = end = target` (collapse selection).
- Kill: if `end > start` → delete `[start, end)`, caret `start`; else delete the computed range.
- Transpose: no-op on a non-empty selection, at index 0, or when either neighbor is `\n`; at end swap the last two chars; otherwise swap `caret-1`/`caret` and move caret +1.

- [ ] **Step 4: Run tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Wire into ChatPane**

Import `{ applyReadlineKey }`. In `TextareaV2.onKeyDown`, insert **after** the picker/Enter branches and **before** the ↑/↓ history branch:

```tsx
else if (!e.isComposing && !pickerOpen()) {
  const edit = applyReadlineKey(
    { value: e.currentTarget.value, start: e.currentTarget.selectionStart ?? 0, end: e.currentTarget.selectionEnd ?? 0 },
    e.key,
    { ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey },
  )
  if (edit) {
    e.preventDefault()
    e.stopPropagation()
    setInput(edit.value)
    setDraft(sidProp(), edit.value)
    queueMicrotask(() => {
      const ta = textareaEl()
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(edit.start, edit.end)
      autoGrow(ta)
    })
  }
}
```

- [ ] **Step 6: Add the shortcut focus guards**

- `ChatPane.tsx` `onSearchKey` (Ctrl+F): before toggling, `if ((e.target as HTMLElement | null)?.closest?.(".mafw-composer")) return`.
- `MafwShell.tsx` Ctrl+K handler: `if ((e.target as HTMLElement | null)?.closest?.(".mafw-composer")) return` before `preventDefault`.

- [ ] **Step 7: Add the wiring test**

`packages/desktop/tests/composer-readline-wiring.test.ts` asserts source strings:
- `ChatPane.tsx` contains `applyReadlineKey(` and `closest?.(".mafw-composer")`.
- `MafwShell.tsx` contains `closest?.(".mafw-composer")` near the Ctrl+K handler.

Run it. Expected: PASS.

- [ ] **Step 8: Full desktop tests + typecheck**

```bash
cd packages/desktop && npm test && npx tsgo --noEmit -p tsconfig.json
```

Expected: all pass. Also resize the window to 720/620/520 px and confirm the composer toolbar still follows the existing `@container` degradation (no overflow past the input bar) — C-layout regression check.

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/composer-readline.ts packages/desktop/src/renderer/mafw/components/composer-readline.test.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/composer-readline-wiring.test.ts
git commit -m "feat(desktop): composer readline editing keys + shortcut focus guards"
```

---

### Task 3: Per-session persisted input history (B2b)

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/input-history-persist.ts`
- Test: `packages/desktop/src/renderer/mafw/components/input-history-persist.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/input-history.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/input-history.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx` (creation + sid effect)

**Interfaces:**
- Produces:

```ts
export interface HistoryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}
export const INPUT_HISTORY_MAX_ENTRY_CHARS = 4096
export const INPUT_HISTORY_MAX_TOTAL_CHARS = 20480
export function inputHistoryKey(sessionID: string): string // `mafw-input-history:v1:<sid>`
export function loadInputHistory(storage: HistoryStorage, sessionID: string, max?: number): string[]
export function saveInputHistory(storage: HistoryStorage, sessionID: string, entries: string[], max?: number): void
```

- `createInputHistory(max = 50, opts?: { onChange?: (entries: string[]) => void })` gains:
  - `entries(): string[]` (copy)
  - `replace(next: string[]): void` (resets cursor/liveDraft, does not fire onChange)
  - `push` fires `onChange` after mutation.

- [ ] **Step 1: Write failing persistence tests**

`input-history-persist.test.ts`:

```ts
const mem = () => {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v) },
    removeItem: (k: string) => { m.delete(k) },
    _m: m,
  }
}

test("round-trips per session", () => {
  const s = mem()
  saveInputHistory(s, "s1", ["a", "b"])
  expect(loadInputHistory(s, "s1")).toEqual(["a", "b"])
  expect(loadInputHistory(s, "s2")).toEqual([])
})
test("drops entries over 4KB", () => {
  const s = mem()
  saveInputHistory(s, "s1", ["ok", "x".repeat(4097)])
  expect(loadInputHistory(s, "s1")).toEqual(["ok"])
})
test("keeps total under 20KB by dropping oldest whole entries", () => {
  const s = mem()
  const big = "y".repeat(4000)
  saveInputHistory(s, "s1", ["old", big, big, big, big, big, big])
  const out = loadInputHistory(s, "s1")
  expect(out.reduce((n, x) => n + x.length, 0)).toBeLessThanOrEqual(20480)
  expect(out).not.toContain("old")
})
test("corrupt JSON fails open", () => {
  const s = mem()
  s.setItem(inputHistoryKey("s1"), "{not json")
  expect(loadInputHistory(s, "s1")).toEqual([])
})
test("empty history removes the key", () => {
  const s = mem()
  saveInputHistory(s, "s1", ["a"])
  saveInputHistory(s, "s1", [])
  expect(s.getItem(inputHistoryKey("s1"))).toBeNull()
})
```

Extend `input-history.test.ts`:

```ts
test("replace loads entries and resets browsing; does not fire onChange", () => {
  let fired = 0
  const h = createInputHistory(50, { onChange: () => fired++ })
  h.replace(["x", "y"])
  expect(h.up("draft")).toBe("y")
  expect(fired).toBe(0)
})
test("push fires onChange with a copy", () => {
  let seen: string[] = []
  const h = createInputHistory(50, { onChange: (e) => { seen = e } })
  h.push("a")
  expect(seen).toEqual(["a"])
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/input-history-persist.test.ts src/renderer/mafw/components/input-history.test.ts
```

Expected: FAIL — module missing / `replace` undefined.

- [ ] **Step 3: Implement persistence + history API**

`loadInputHistory`: parse JSON, keep only strings, drop `> 4096`, take last `max`, then shrink from the oldest until total `<= 20480`.
`saveInputHistory`: apply the same filter, `JSON.stringify`, `setItem`; if result is empty, `removeItem` (or `setItem("[]")`); swallow storage errors.
`createInputHistory`: add `entries`, `replace`, optional `onChange`; call `onChange(entries.slice())` after `push`.

- [ ] **Step 4: Run tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Wire ChatPane**

- Creation: `const history = createInputHistory(50, { onChange: (entries) => { const sid = sidProp(); if (sid) saveInputHistory(localStorage, sid, entries) } })`.
- Add an effect after creation:

```tsx
createEffect(() => {
  const sid = sidProp()
  history.replace(sid ? loadInputHistory(localStorage, sid) : [])
})
```

No changes needed in `use-send-message.ts` — all three `history.push` call sites now persist through the callback.

- [ ] **Step 6: Full desktop tests + typecheck**

```bash
cd packages/desktop && npm test && npx tsgo --noEmit -p tsconfig.json
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/input-history-persist.ts packages/desktop/src/renderer/mafw/components/input-history-persist.test.ts packages/desktop/src/renderer/mafw/components/input-history.ts packages/desktop/src/renderer/mafw/components/input-history.test.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx
git commit -m "feat(desktop): persist composer history per session (bounded)"
```

---

### Task 4: Background REST capability tri-state + re-probe (B3)

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/background-capability.ts`
- Test: `packages/desktop/src/renderer/mafw/background-capability.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/BackgroundDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/BackgroundWorkBar.tsx`
- Test wiring: `packages/desktop/tests/background-capability-wiring.test.ts` (new)

**Interfaces:**
- Produces:

```ts
export type BackgroundRestState = "checking" | "available" | "unavailable"
export function createRestProbe(
  probe: () => Promise<unknown>,
  now?: () => number,
): {
  state(): BackgroundRestState
  probe(): Promise<BackgroundRestState>
  reset(): void
}
export function backgroundRestState(): BackgroundRestState
export function probeBackgroundRest(): Promise<BackgroundRestState>
export function backgroundRestAvailable(): Promise<boolean> // compat: state === "available"
export function shouldShowRestUnavailableHint(state: BackgroundRestState, hasShellRows: boolean): boolean
```

- [ ] **Step 1: Write failing probe tests**

`background-capability.test.ts`:

```ts
import { expect, test } from "bun:test"
import { createRestProbe, shouldShowRestUnavailableHint } from "./background-capability"

test("starts checking", () => {
  const p = createRestProbe(async () => ({}))
  expect(p.state()).toBe("checking")
})
test("success -> available (sticky)", async () => {
  let t = 0
  const p = createRestProbe(async () => ({}), () => t)
  expect(await p.probe()).toBe("available")
  t += 120_000
  expect(await p.probe()).toBe("available")
})
test("failure -> unavailable; retries after 60s", async () => {
  let t = 0
  let ok = false
  const p = createRestProbe(async () => { if (!ok) throw new Error("502"); return {} }, () => t)
  expect(await p.probe()).toBe("unavailable")
  expect(await p.probe()).toBe("unavailable") // fresh within 60s, no new call
  t += 60_000
  ok = true
  expect(await p.probe()).toBe("available")
})
test("in-flight dedupe", async () => {
  let calls = 0
  const p = createRestProbe(async () => { calls++; await new Promise(r => setTimeout(r, 5)); return {} })
  await Promise.all([p.probe(), p.probe()])
  expect(calls).toBe(1)
})
test("reset -> checking", async () => {
  const p = createRestProbe(async () => ({}))
  await p.probe()
  p.reset()
  expect(p.state()).toBe("checking")
})
test("hint predicate", () => {
  expect(shouldShowRestUnavailableHint("unavailable", true)).toBe(true)
  expect(shouldShowRestUnavailableHint("unavailable", false)).toBe(false)
  expect(shouldShowRestUnavailableHint("checking", true)).toBe(false)
  expect(shouldShowRestUnavailableHint("available", true)).toBe(false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/background-capability.test.ts
```

Expected: FAIL — `createRestProbe` missing.

- [ ] **Step 3: Implement the probe factory + singleton**

`createRestProbe`: state `checking`, `at = 0`, `inflight = null`; `probe()` returns existing inflight, otherwise if `state === "available"` return it, else if `state === "unavailable" && now - at < 60_000` return it, else call the probe; success → `available`, failure → `unavailable`; set `at`.
Singleton `restProbe = createRestProbe(() => window.api.mafw.shells.list())`; export the wrappers. `resetBackgroundCapability()` calls `restProbe.reset()`. Keep `canUseBackgroundApi` as-is.

- [ ] **Step 4: Run tests to verify they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Wire the dock and work bar**

In both components:
- replace `const [restOk, setRestOk] = createSignal(false)` with `const [restState, setRestState] = createSignal<BackgroundRestState>(backgroundRestState())`.
- `createEffect(() => { void probeBackgroundRest().then(setRestState) })`.
- add a re-probe effect: if any shell row exists, `setInterval(() => { void probeBackgroundRest().then(setRestState) }, 60_000)` with `onCleanup`.
- Dock: after the hint line, add `<Show when={shouldShowRestUnavailableHint(restState(), rows().some(r => r.type === "shell"))}><div class="mafw-bg-dock-rest-hint">…</div></Show>`; change terminate button `restOk()` → `restState() === "available"`.
- Work bar: blocking row shows the hint when `shouldShowRestUnavailableHint(restState(), true)`; the `全部转后台` button only when `restState() === "available"`.
- Add `.mafw-bg-dock-rest-hint` / `.mafw-bg-bar-rest-hint` styles using existing tokens (`--text-4`, 11px) in `mafw.css`.

- [ ] **Step 6: Add the wiring test**

`packages/desktop/tests/background-capability-wiring.test.ts` asserts both components contain `probeBackgroundRest`, `60_000`, `shouldShowRestUnavailableHint`, and `restState() === "available"`.

- [ ] **Step 7: Full desktop tests + typecheck + build**

```bash
cd packages/desktop && npm test && npx tsgo --noEmit -p tsconfig.json && npx electron-vite build
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/renderer/mafw/background-capability.ts packages/desktop/src/renderer/mafw/background-capability.test.ts packages/desktop/src/renderer/mafw/components/BackgroundDock.tsx packages/desktop/src/renderer/mafw/components/BackgroundWorkBar.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/background-capability-wiring.test.ts
git commit -m "feat(desktop): background REST capability tri-state + retry hint"
```

---

### Task 5: Click chatview to focus composer (B4)

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/composer-focus.ts`
- Test: `packages/desktop/src/renderer/mafw/components/composer-focus.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx` (handler + scroller `onClick`)
- Test wiring: `packages/desktop/tests/composer-focus-wiring.test.ts` (new)

**Interfaces:**
- Produces:

```ts
export interface ComposerFocusClick {
  button: number
  detail: number
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  selectionCollapsed: boolean | null
  interactive: boolean
}
export function shouldFocusComposerFromClick(info: ComposerFocusClick): boolean
```

- [ ] **Step 1: Write failing tests**

```ts
import { expect, test } from "bun:test"
import { shouldFocusComposerFromClick } from "./composer-focus"

test("plain single left click on text focuses", () => {
  expect(shouldFocusComposerFromClick({ button: 0, detail: 1, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, selectionCollapsed: true, interactive: false })).toBe(true)
})
test("rejects non-primary / modifiers / multi-click", () => {
  const base = { button: 0, detail: 1, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, selectionCollapsed: true, interactive: false }
  expect(shouldFocusComposerFromClick({ ...base, button: 2 })).toBe(false)
  expect(shouldFocusComposerFromClick({ ...base, detail: 2 })).toBe(false)
  expect(shouldFocusComposerFromClick({ ...base, ctrlKey: true })).toBe(false)
  expect(shouldFocusComposerFromClick({ ...base, metaKey: true })).toBe(false)
  expect(shouldFocusComposerFromClick({ ...base, altKey: true })).toBe(false)
  expect(shouldFocusComposerFromClick({ ...base, shiftKey: true })).toBe(false)
})
test("rejects text selection and interactive targets", () => {
  const base = { button: 0, detail: 1, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, selectionCollapsed: true, interactive: false }
  expect(shouldFocusComposerFromClick({ ...base, selectionCollapsed: false })).toBe(false)
  expect(shouldFocusComposerFromClick({ ...base, selectionCollapsed: null })).toBe(true)
  expect(shouldFocusComposerFromClick({ ...base, interactive: true })).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/desktop && node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/composer-focus.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement the predicate**

Return true only when `button === 0 && detail === 1 && !ctrlKey && !metaKey && !altKey && !shiftKey && selectionCollapsed !== false && !interactive`.

- [ ] **Step 4: Run test to verify it passes**

Same command. Expected: PASS.

- [ ] **Step 5: Wire the scroller**

In `ChatPane.tsx`, add:

```tsx
const focusComposerFromView = (e: MouseEvent) => {
  const target = e.target as HTMLElement | null
  const selection = window.getSelection()
  const interactive = !!target?.closest?.(
    'a,button,input,textarea,select,[role="button"],[role="tab"],[contenteditable="true"]',
  )
  if (!shouldFocusComposerFromClick({
    button: e.button,
    detail: e.detail,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    altKey: e.altKey,
    shiftKey: e.shiftKey,
    selectionCollapsed: selection ? selection.isCollapsed : null,
    interactive,
  })) return
  textareaEl()?.focus({ preventScroll: true })
}
```

Attach `onClick={focusComposerFromView}` to `<div class="mafw-session-turn-container" ref={setContainerRef} onScroll={handleScroll}>`.

- [ ] **Step 6: Add the wiring test**

`packages/desktop/tests/composer-focus-wiring.test.ts` asserts `ChatPane.tsx` contains `focusComposerFromView`, `shouldFocusComposerFromClick`, and `focus({ preventScroll: true })`.

- [ ] **Step 7: Full desktop tests + typecheck + build**

```bash
cd packages/desktop && npm test && npx tsgo --noEmit -p tsconfig.json && npx electron-vite build
```

Expected: all pass.

- [ ] **Step 8: Manual smoke**

In the dev app: click a message → caret in composer; drag-select transcript text → no focus jump; double-click a word → selection preserved; click a link/button/tool card → no focus; with a draft, click → draft intact.

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/composer-focus.ts packages/desktop/src/renderer/mafw/components/composer-focus.test.ts packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/tests/composer-focus-wiring.test.ts
git commit -m "feat(desktop): click chat view focuses composer (selection-safe)"
```

---

### Task 6: Docs, full gates, independent review

**Files:**
- Modify: `AGENTS.md` (desktop section: B-line ship notes + T1 hold context)
- Ledger: `.superpowers/sdd/2026-10-23-desktop-interaction-parity/progress.md` (if using SDD) or session notes

- [ ] **Step 1: Update `AGENTS.md`**

Add a dated paragraph under the desktop section (§5.5) with: B-line scope (B1/B2a/B2b/B3/B4), the task-card metadata key root cause (`sessionID` vs `sessionId`), history persistence key/limits, background tri-state, click-to-focus semantics, commit hashes, test counts.

- [ ] **Step 2: Run every gate**

```bash
cd packages/session-ui && npm test && npm run typecheck
cd ../desktop && npm test && npx tsgo --noEmit -p tsconfig.json && npx electron-vite build
```

Expected: all green. Record exact counts (desktop baseline was 1269 before this batch).

- [ ] **Step 3: Independent review**

Dispatch a fresh reviewer with the spec + plan + diff. If the subagent provider returns 403, perform a self-review pass and record `Final review: self-review (subagent 403)` in the ledger.

- [ ] **Step 4: Fix review findings (one pass, TDD)**

Any Critical/Important → failing test first, fix, re-run gates, commit `fix(desktop): ...`.

- [ ] **Step 5: Commit docs**

```bash
git add AGENTS.md
git commit -m "docs: B-line desktop interaction parity ship notes"
```

---

## Self-Review (plan vs spec)

- **Spec coverage:** B1 → Task 1; B2a → Task 2; B2b → Task 3; B3 → Task 4; B4 → Task 5; docs/gates → Task 6; live assumptions → Task 0.
- **Interface consistency:** `taskChildSessionID` (Task 1) is used only in session-ui; `applyReadlineKey` (Task 2) only in ChatPane; `loadInputHistory`/`saveInputHistory` (Task 3) only in ChatPane; `probeBackgroundRest`/`shouldShowRestUnavailableHint` (Task 4) only in the two background components; `shouldFocusComposerFromClick` (Task 5) only in ChatPane.
- **Review Focus tests:** selection vs focus (Task 5), Ctrl+F/K guards (Task 2), oversized history (Task 3), failed card jump (Task 1), REST transition (Task 4).
- **Proportion:** each task has a pure module + a thin wiring commit; no task writes a transcript of the whole file.
