# B3: Checkpoint / Rewind Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a checkpoint timeline over the loaded session history with two actions: revert conversation+files (existing `session.revert`) and rewind code only (sequential per-turn `revertDiff`).

**Architecture:** Pure `checkpoint-model.ts` (user turns → checkpoints) and `checkpoint-revert.ts` (all-hunk patches, rewind ordering, runtime-aware copy); `CheckpointOverlay.tsx` modal; ChatPane entry/callbacks; MafwShell supplies runtime name/capabilities. No gateway/runtime/session-ui changes.

**Tech Stack:** Electron + SolidJS, `@mafw/ui` v2 components, node --test + `@mafw/test-shim`, tsgo, electron-vite.

**Spec:** `docs/superpowers/specs/2026-10-23-b3-checkpoint-rewind-design.md`

## Global Constraints

- Desktop-only; do not modify gateway/runtime/session-ui or the user's parallel files.
- Renderer uses `window.api` only; reuse `sessions.revert`, `sessions.diff`, `sessions.revertDiff`.
- TDD: failing test → watch fail → minimal implementation → watch pass. One commit per task on `main`.
- Desktop test command (cwd `packages/desktop`): `node --import tsx --import ../../packages/test-shim/register.mjs --test <file>`; full `npm test`; `npx tsgo --noEmit -p tsconfig.json`; `npx electron-vite build`.
- Theme tokens only; destructive actions require explicit confirmation; no silent retries.

## Review Focus

1. **Irreversible conversation revert** — opencode 2.1 revert is stage+commit (`revertUndoApi:false`); the UI must never promise undo, must use runtime-aware copy, and must disable actions while the session is busy.
2. **Code rewind ordering** — target checkpoint included, newest→oldest, `summary.diffs` first with `sessions.diff(messageID)` fallback, stop on patch failure with an honest partial-progress toast.
3. **Runtime boundary** — opencode removes the target prompt and reverts files; pi keeps the target prompt, drops only later replies, and does not touch files; `diffApi:false` hides code rewind.
4. **Data honesty** — timeline only covers loaded messages, not a guaranteed 30 days; subtitle/footer say so; `user-`/`local-`/`queued-` ids are excluded.
5. **Newest checkpoint actionable** — the latest persisted user turn remains revertable (undo last turn), matching the existing inline revert; no "current, no actions" dead row.

---

### Task 1: Checkpoint model (pure)

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/checkpoint-model.ts`
- Test: `packages/desktop/src/renderer/mafw/components/checkpoint-model.test.ts`

**Interfaces:**
- Produces:

```ts
export const CHECKPOINT_RETENTION_DAYS = 30

export interface CheckpointFile {
  file: string
  additions?: number
  deletions?: number
  status?: string
  patch?: string
}

export interface Checkpoint {
  messageID: string
  createdAt: number | null
  prompt: string
  files: CheckpointFile[]
}

export function promptTextOf(message: any, parts: Record<string, any[]>): string
export function buildCheckpoints(
  messages: any[],
  parts: Record<string, any[]>,
  now: number,
  retentionDays?: number,
): Checkpoint[]
```

- [ ] **Step 1: Write failing tests**

```ts
import { expect, test } from "bun:test"
import { buildCheckpoints, promptTextOf } from "./checkpoint-model"

const NOW = 1_700_000_000_000
const DAY = 86_400_000

test("only persisted user messages, newest first", () => {
  const out = buildCheckpoints([
    { id: "u1", role: "user", time: { created: NOW - 3000 } },
    { id: "a1", role: "assistant", time: { created: NOW - 2000 } },
    { id: "u2", role: "user", time: { created: NOW - 1000 } },
    { id: "user-123", role: "user", time: { created: NOW } },
  ], {}, NOW)
  expect(out.map(c => c.messageID)).toEqual(["u2", "u1"])
})

test("prompt falls back text -> parts -> placeholder", () => {
  expect(promptTextOf({ id: "u1", text: " hello " }, {})).toBe("hello")
  expect(promptTextOf({ id: "u2" }, { u2: [{ type: "text", text: " A" }, { type: "tool" }, { type: "text", text: "B " }] })).toBe("A\nB")
  expect(promptTextOf({ id: "u3" }, {})).toBe("(无文本)")
})

test("30-day filter keeps null timestamps", () => {
  const out = buildCheckpoints([
    { id: "old", role: "user", time: { created: NOW - 31 * DAY } },
    { id: "recent", role: "user", time: { created: NOW - 1 * DAY } },
    { id: "unknown", role: "user" },
  ], {}, NOW)
  expect(out.map(c => c.messageID)).toEqual(["recent", "unknown"])
})

test("copies summary.diffs and skips malformed entries", () => {
  const out = buildCheckpoints([
    { id: "u1", role: "user", time: { created: NOW }, summary: { diffs: [
      { file: "a.ts", additions: 2, deletions: 1, status: "modified", patch: "P" },
      { additions: 1 }, { file: "" }, null,
    ] } },
  ], {}, NOW)
  expect(out[0].files).toEqual([{ file: "a.ts", additions: 2, deletions: 1, status: "modified", patch: "P" }])
})

test("excludes local/optimistic/queued ids", () => {
  const out = buildCheckpoints([
    { id: "local-1", role: "user" }, { id: "queued-1", role: "user" }, { id: "ok", role: "user" },
  ], {}, NOW)
  expect(out.map(c => c.messageID)).toEqual(["ok"])
})

test("empty session", () => {
  expect(buildCheckpoints([], {}, NOW)).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/checkpoint-model.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `checkpoint-model.ts`**

- Import `isLocalMessageId` from `../chat/local-id`.
- Filter `role === "user"`, id present, `!isLocalMessageId(id)`.
- `createdAt = typeof m.time?.created === "number" ? m.time.created : null`.
- 30-day filter; null kept.
- Sort: non-null descending, null last.
- `promptTextOf`: `text` string → trim; else parts text join `\n`; else `"(无文本)"`.
- `files`: `summary.diffs` entries with non-empty string `file`; copy numeric additions/deletions, string status, and string `patch` (needed for code rewind).

- [ ] **Step 4: Run test to verify it passes**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/checkpoint-model.ts packages/desktop/src/renderer/mafw/components/checkpoint-model.test.ts
git commit -m "feat(desktop): checkpoint model from loaded user turns"
```

---

### Task 2: Rewind patches + runtime copy (pure)

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/checkpoint-revert.ts`
- Test: `packages/desktop/src/renderer/mafw/components/checkpoint-revert.test.ts`

**Interfaces:**
- Consumes: `FileDiffEntry` from `./DiffReviewPanel`; `Checkpoint` from `./checkpoint-model`.
- Produces:

```ts
export interface RevertPatch { file?: string; patch: string; hunkIndices: number[] }
export function allHunksPatches(files: FileDiffEntry[]): RevertPatch[]
export function checkpointsToRewind(checkpoints: Checkpoint[], targetMessageID: string): Checkpoint[]
export function revertWarning(runtimeName: string | undefined, undoable: boolean, diffApi: boolean): string
```

- [ ] **Step 1: Write failing tests**

```ts
import { expect, test } from "bun:test"
import { allHunksPatches, checkpointsToRewind, revertWarning } from "./checkpoint-revert"

const PATCH = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n@@ -3 +3 @@\n-c\n+d"

test("allHunksPatches selects every hunk", () => {
  expect(allHunksPatches([{ file: "x", patch: PATCH }])).toEqual([{ file: "x", patch: PATCH, hunkIndices: [0, 1] }])
})

test("skips missing/empty patches and zero-hunk patches", () => {
  expect(allHunksPatches([{ file: "a" }, { file: "b", patch: "  " }, { file: "c", patch: "no hunks" }])).toEqual([])
})

test("multiple files", () => {
  expect(allHunksPatches([{ file: "a", patch: PATCH }, { file: "b", patch: PATCH }]).map(p => p.file)).toEqual(["a", "b"])
})

test("checkpointsToRewind includes target and newer, newest first", () => {
  const cps = [{ messageID: "c" }, { messageID: "b" }, { messageID: "a" }] as any
  expect(checkpointsToRewind(cps, "b").map(c => c.messageID)).toEqual(["c", "b"])
  expect(checkpointsToRewind(cps, "c").map(c => c.messageID)).toEqual(["c"])
  expect(checkpointsToRewind(cps, "missing")).toEqual([])
})

test("revertWarning is runtime-aware", () => {
  expect(revertWarning("pi", false, false)).toContain("文件不会回滚")
  expect(revertWarning("opencode", false, true)).toContain("不可撤销")
  expect(revertWarning("opencode", true, true)).toContain("撤销回滚")
  expect(revertWarning("other", false, false)).toContain("以运行时为准")
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/components/checkpoint-revert.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

- `allHunksPatches`: filter non-empty string patch; count lines starting `@@ `; skip count 0; hunkIndices 0..n-1.
- `checkpointsToRewind`: find target index; return `slice(0, idx+1)`; missing → [].
- `revertWarning`:
  - pi → includes "pi 回滚保留这条消息、只撤回其后的回复；文件不会回滚，且不可撤销。"
  - opencode + undoable → "撤回这条消息及其后内容；可通过撤销回滚恢复对话。"
  - opencode + !undoable → "opencode 2.1 的回滚会 stage+commit，撤回这条消息及其后内容；不可撤销，请确认已提交/备份。"
  - other → "当前 runtime 的回滚语义以运行时为准；请确认已备份。" + (if !diffApi) " 当前 runtime 不提供文件回滚。"

- [ ] **Step 4: Run test to verify it passes**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/checkpoint-revert.ts packages/desktop/src/renderer/mafw/components/checkpoint-revert.test.ts
git commit -m "feat(desktop): checkpoint rewind patches + runtime copy"
```

---

### Task 3: CheckpointOverlay + CSS

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/CheckpointOverlay.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`
- Test wiring: `packages/desktop/tests/checkpoint-overlay-wiring.test.ts`

**Interfaces:**
- Consumes: `buildCheckpoints`, `Checkpoint`; `checkpointsToRewind`, `revertWarning`.
- Produces:

```ts
export function CheckpointOverlay(props: {
  sessionID: string
  messages: any[]
  parts: Record<string, any[]>
  runtimeName?: string
  caps?: Record<string, boolean>
  busy?: boolean
  onClose: () => void
  onRevert: (messageID: string) => Promise<boolean>
  onRevertCode: (targets: Checkpoint[]) => Promise<boolean>
}): JSX.Element
```

- [ ] **Step 1: Write failing wiring test**

Asserts the component source contains: `buildCheckpoints`, `checkpointsToRewind`, `revertWarning`, `caps?.diffApi`, `caps?.sessionBranchApi`, `最新回合`, `onRevertCode`, `role="dialog"`; CSS contains `.mafw-checkpoint-panel`, `.mafw-checkpoint-row`, `.mafw-checkpoint-confirm`.

- [ ] **Step 2: Implement the overlay**

- Memo `checkpoints = buildCheckpoints(props.messages, props.parts, Date.now())`.
- `conversationAvailable = props.caps?.sessionBranchApi !== false`.
- `codeAvailable = props.caps?.diffApi === true`.
- Top note only when `props.caps && props.caps.diffApi === false`: "当前 runtime 的回滚只影响对话，不改文件。"
- Rows: time, prompt, file chips (first 5 basenames + `+N`), `最新回合` badge for index 0, actions.
- Actions disabled when `props.busy` or local `working`; show note.
- Confirm state `{ mode: "revert" | "code", messageID }`.
  - Revert confirm text = `revertWarning(props.runtimeName, props.caps?.revertUndoApi === true, codeAvailable())`.
  - Code confirm text = `` `将撤销这条消息及之后 ${targets.length} 个回合的文件改动；对话保留。不可自动撤销；patch 冲突时可能停在中间态。` ``.
  - Confirm buttons: cancel / confirm; confirm calls `props.onRevert` or `props.onRevertCode(targets)`; closes the overlay if the callback returns true.
- Esc handler: capture keydown Escape → close and stop propagation.
- Backdrop click closes; panel click stops propagation.
- Footer: "更早的检查点请先在聊天中加载更早历史。"

- [ ] **Step 3: CSS**

Add `.mafw-checkpoint-backdrop` (fixed inset 0, z-index 70), `.mafw-checkpoint-panel` (max-width 560px, max-height 70vh, flex column, bg-float, border, shadow), `.mafw-checkpoint-head`, `.mafw-checkpoint-list` (overflow-y auto), `.mafw-checkpoint-row`, `.mafw-checkpoint-time`, `.mafw-checkpoint-prompt`, `.mafw-checkpoint-files`, `.mafw-checkpoint-chip`, `.mafw-checkpoint-actions`, `.mafw-checkpoint-confirm`, `.mafw-checkpoint-note`, `.mafw-checkpoint-latest`. Token-only; no keyframe.

- [ ] **Step 4: Run wiring test**

```bash
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/checkpoint-overlay-wiring.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/CheckpointOverlay.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/checkpoint-overlay-wiring.test.ts
git commit -m "feat(desktop): checkpoint timeline overlay"
```

---

### Task 4: ChatPane + MafwShell wiring

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test wiring: `packages/desktop/tests/checkpoint-wiring.test.ts`

**Interfaces:**
- ChatPane props add `runtimeName?: string`, `runtimeCaps?: Record<string, boolean>`.
- MafwShell adds `rtName` signal and passes `runtimeName={rtName()}` / `runtimeCaps={rtCaps()}`.

- [ ] **Step 1: Write failing wiring test**

Asserts ChatPane contains `时间线`, `CheckpointOverlay`, `revertCodeTo`, `allHunksPatches`, `runtimeCaps`, `runtimeName`, `revertWarning` in the inline confirm; MafwShell contains `rtName` and passes both props.

- [ ] **Step 2: Refactor revert + add code rewind**

- Add `revertTo(messageID): Promise<boolean>`; `doRevert` calls it after clearing `revertConfirm`.
- Add `revertCodeTo(targets: Checkpoint[]): Promise<boolean>`:
  - Loop `targets` newest-first. If `cp.files` is non-empty and **every** file has a non-empty `patch`, use `allHunksPatches(cp.files)`; otherwise fetch `sessions.diff(sid, cp.messageID)` and use `allHunksPatches(res.files ?? [])`.
  - Skip turns with no patches; `await sessions.revertDiff(sid, patches)` for the rest.
  - Success: toast `已回滚到该检查点（N 个回合）`; return true.
  - Failure: toast `回滚到该检查点失败（已完成 M/N）；工作树可能处于中间态`; return false.
- Inline confirm text: `revertWarning(props.runtimeName, props.revertUndoEnabled === true, props.runtimeCaps?.diffApi === true)`.
- Add `checkpointsOpen` signal; header `ButtonV2 ghost small`「时间线」near `并行`/`细节`.
- Render overlay when open, passing store messages/parts, caps/name, `busy={sending() || store.session_status[sid]?.type === "busy"}`, callbacks that close on true.
- `refreshAfterRevert()` after conversation revert.

- [ ] **Step 3: MafwShell**

- Add `const [rtName, setRtName] = createSignal("")`; in the runtime effect `setRtName(r?.active?.name ?? "")`.
- Pass `runtimeName={rtName()}` and `runtimeCaps={rtCaps()}` at the ChatPane call site.

- [ ] **Step 4: Run wiring test + full gates**

```bash
cd packages/desktop
node --import tsx --import ../../packages/test-shim/register.mjs --test tests/checkpoint-wiring.test.ts
npm test
npx tsgo --noEmit -p tsconfig.json
npx electron-vite build
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/ChatPane.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/checkpoint-wiring.test.ts
git commit -m "feat(desktop): checkpoint timeline entry + code rewind wiring"
```

---

### Task 5: Docs, full gates, independent review

**Files:**
- Modify: `AGENTS.md` (§5.5 B3 paragraph)
- Ledger: `.superpowers/sdd/2026-10-23-b3-checkpoint-rewind/progress.md`

- [ ] **Step 1: Update AGENTS.md**

Add a dated B3 bullet: timeline source/loaded-window caveat, opencode vs pi boundary, newest actionable, code rewind newest→oldest with partial-failure policy, local-id exclusion, inline warning fix, commit hashes, test counts.

- [ ] **Step 2: Full gates**

```bash
cd packages/desktop && npm test && npx tsgo --noEmit -p tsconfig.json && npx electron-vite build
```
Record exact counts.

- [ ] **Step 3: Independent review**

Dispatch a fresh reviewer with the spec, plan, Review Focus, ledger rulings, and diff. If provider 403, self-review and record.

- [ ] **Step 4: Fix Critical/Important in one TDD pass**

Each fix: failing test, fix, green suite, ledger line. Minors → ledger.

- [ ] **Step 5: Commit docs**

```bash
git add AGENTS.md
git commit -m "docs: B3 checkpoint/rewind ship notes"
```

---

## Self-Review (plan vs spec)

- **Spec coverage:** model/filters → Task 1; all-hunk/order/copy → Task 2; overlay/confirm/gates → Task 3; entry/callbacks/caps → Task 4; docs/review → Task 5.
- **Interface consistency:** `Checkpoint` used by overlay/rewind; `allHunksPatches`/`checkpointsToRewind`/`revertWarning` used only in overlay/ChatPane; `runtimeName`/`runtimeCaps` flow MafwShell → ChatPane → overlay.
- **Review Focus tests:** irreversible copy (Task 2/4), ordering (Task 2), runtime gates (Task 3), data honesty/local ids (Task 1/3), newest actionable (Task 3).
- **Proportion:** two pure modules + overlay + one wiring task; no transcript.

## Final Review Corrections (2026-10-23)

- **Code rewind is gated off in current opencode 2.1.** Real-user probe showed user/assistant messages have no `summary.diffs`, and `sessions.diff(messageID)` returns the same session-wide patch for any/all message IDs. The planned `sessions.diff` fallback was removed; `canRewindCode` requires `filesKnown` + complete invertible per-turn patches. The UI hides the code action and labels file chips "文件记录不可用".
- **Added/deleted files are not invertible** by the gateway hunk inverter (`/dev/null`, `new file mode`, `deleted file mode`); `isInvertiblePatch` rejects them, disabling code rewind for those turns.
- **Confirmation split:** row buttons only request; the confirmation panel is the sole executor; row buttons disable while their confirm is open (double-click safe).
- **Honest counters:** `applied` vs `noChanges`; failure toast reports applied/N; no skipped turn is reported as reverted.
- **Safety:** inline revert now shares the busy gate and runtime-aware copy; `runtime_switched` refreshes caps/name.
- **Gates:** desktop 1388/1388, tsgo rc=0, build ok.
