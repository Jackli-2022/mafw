# Batch 5 — Queue Inbox UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, inline). Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Surface the existing gateway session queue in desktop/TUI, expose the queue API through SDK/preload, and ship v4.33.0 with full verification.

**Architecture:** Keep the desktop local turn queue unchanged; add a separate gateway-queue store fed by `queue.updated` + `GET /api/session/:id/queue`, render it above the composer, and expose queue methods through SDK/preload. TUI only adds a status-bar count. No gateway core changes.

**Spec:** `docs/superpowers/specs/2026-10-26-batch5-queue-inbox-ui-design.md`

## Global Constraints

- Reuse canonical `queue.updated`; no new vocabulary/event.
- `items` is a full snapshot; replace per session, never merge.
- Do not change local `turn-queue`/`use-send-message` behavior.
- Queue HTTP failures are fail-open UI; events remain source of truth.
- No queue persistence/reorder/priority.
- Do not touch parallel workbench docs.

## Review Focus

- Stale event from another session must not appear in the active session.
- Missing/non-array `items` must not clear the existing queue.
- Duplicate/replayed `queue.updated` is idempotent.
- Session switch must fetch fresh queue, and old events must stay keyed by session.
- Cancel/clear failure must not remove locally until a snapshot arrives.
- SDK queue methods must keep existing gateway URLs (no route changes).

---

### Task 1: SDK + preload queue surface

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Test: `packages/gateway-sdk/src/client.test.ts`

**Interfaces:**
```ts
export interface QueueItem {
  id: string; sessionID: string;
  text?: string; parts?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  agent?: string; model?: { providerID: string; modelID: string };
  expectReply?: boolean; idempotencyKey?: string;
  enqueuedAt: string; source: string;
}
// SessionNamespace
queueList(params: { path: { id: string } }): Promise<{ items: QueueItem[] }>
queueCancel(params: { path: { id: string; itemId: string } }): Promise<{ cancelled: string }>
queueClear(params: { path: { id: string } }): Promise<{ cleared: number }>
// promptAsync body additive
delivery?: 'queue' | 'steer' | 'followup'; idempotencyKey?: string; expectReply?: boolean
```

- [x] **Step 1: Write failing SDK tests** for queue URLs and promptAsync delivery body.
- [x] **Step 2: Run them** (`packages/gateway-sdk`: `npm test`) and confirm fail.
- [x] **Step 3: Implement types + client + preload**; client URL methods already exist, only typed return/body additions.
- [x] **Step 4: Run SDK tests + `npm run build`; desktop `tsgo --noEmit`.**
- [x] **Step 5: Commit** `feat(sdk): expose session queue surface`.

---

### Task 2: Desktop queue store + dispatcher

**Files:**
- Create: `packages/desktop/src/renderer/mafw/queue-store.ts`
- Create: `packages/desktop/src/renderer/mafw/queue-store.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/dispatcher.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/handlers/queue.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/src/renderer/mafw/sse/dispatcher.test.ts`

**Interfaces:**
```ts
queueForSession(sid: string): QueueItem[]
applyQueueSnapshot(prev: Record<string, QueueItem[]>, sid: string, items: QueueItem[]): Record<string, QueueItem[]>
ingestQueueEvent(fallbackSid: string, event: unknown): void
queueItemText(item: QueueItem, max?: number): string
fetchQueue(sid: string): Promise<void>
cancelQueueItem(sid: string, itemId: string): Promise<boolean>
clearGatewayQueue(sid: string): Promise<number | null>
```

- [x] **Step 1: Write failing store tests** (sort/replace/missing items/stale session/text extraction).
- [x] **Step 2: Write failing dispatcher test** (`queue.updated` forwards to `deps.queue.onEvent`).
- [x] **Step 3: Implement store, queue dep, handler wiring, MafwShell fetch on reconcile.**
- [x] **Step 4: Run focused desktop tests + tsgo.**
- [x] **Step 5: Commit** `feat(desktop): gateway queue store and SSE wiring`.

---

### Task 3: Desktop gateway queue bar

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Maybe modify CSS: `packages/desktop/src/renderer/mafw/mafw.css` (only if reuse classes insufficient)

- [x] **Step 1: Add `gwQueue` signal/accessor and `createEffect` fetch on active session.**
- [x] **Step 2: Render gateway queue bar above local queue** (preview/source/cancel/clear; hidden when empty).
- [x] **Step 3: Wire cancel/clear with fail-open toast.**
- [x] **Step 4: Run desktop tests + tsgo + electron-vite build.**
- [x] **Step 5: Commit** `feat(desktop): gateway queue bar`.

---

### Task 4: TUI gateway queue badge

**Files:**
- Modify: `packages/tui/src/ui/status-bar.ts`
- Modify: `packages/tui/src/ui/app.ts`
- Test: `packages/tui/tests/status-bar.test.ts` (or existing)

**Interfaces:** `StatusState.gatewayQueued?: number`; StatusBar renders `inbox N` when >0.

- [x] **Step 1: Write failing status-bar test.**
- [x] **Step 2: Implement status segment + app `queue.updated` handler + fetch after session switch.**
- [x] **Step 3: Run TUI tests.**
- [x] **Step 4: Commit** `feat(tui): gateway queue badge`.

---

### Task 5: Finalize + deploy

- [x] Bump `4.33.0`; update Batch 5 spec/plan status + AGENTS queue UI note.
- [x] Full verification:
  - gateway `npx jest --runInBand --forceExit`
  - desktop `npm test`, `tsgo --noEmit`, `electron-vite build`
  - SDK, session-ui, TUI, root build
- [x] Local deploy: `npm pack` → `mafw stop` → `npm install -g jack200714-mafw-4.33.0.tgz --force` → `mafw daemon`.
- [x] Live: `GET /api/session/:id/queue` returns `{items:[]}`; gateway `dialect=v21`; verify `queue.updated` via unit/event injection (busy queue only if practical).
- [x] Commit release; report version/hash and test counts.

## Verification (v4.33.0, 2026-10-26)

- SDK **146**; desktop **1430**; gateway **2607**; session-ui **89**; TUI **225** (224 pass / 1 smoke skip).
- desktop `tsgo --noEmit` rc=0; `electron-vite build` ok; root build ok.
- live: `GET /api/session/:id/queue` 200; queue event/store unit coverage; gateway dialect v21.
- commits: `7400c085` (SDK), `aebad5ed` (desktop store), `fd2b2193` (desktop bar), `6a4126c1` (TUI), release commit v4.33.0.

## Self-Review

- [x] Spec coverage: SDK, preload, desktop store/UI, TUI badge, finalization.
- [x] Failure modes pinned: stale session, missing items, duplicate events, fetch fallback, cancel failure.
- [x] No gateway core or local-queue behavior change.
- [x] Known boundary: local turn queue remains separate; gateway queue is in-memory and mostly used by queued HTTP notifications.
