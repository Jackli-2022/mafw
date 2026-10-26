# Batch 6 — Thinking/Effort + Signature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native, inline). Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add `thinkingLevel`/`variant` prompt controls and preserve reasoning signatures across Pi normalization and SDK DTOs.

**Architecture:** Additive contract fields; Pi maps to native `thinkingLevel`/`setThinkingLevel`, OpenCode uses existing model `variant`; queue carries both. Signature is an additive part field preserved by Pi history normalization and exposed in SDK types.

**Spec:** `docs/superpowers/specs/2026-10-26-batch6-thinking-signature-design.md`

## Global Constraints

- `ThinkingLevel = 'off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max'`.
- No signature generation/validation; read-only fidelity.
- No UI controls in this batch.
- Additive fields only; old clients must continue working.
- Queue flush must preserve controls.
- No runtime-specific cross-mapping (opencode variant ≠ pi thinkingLevel).

## Review Focus

- Invalid thinkingLevel should 400 at HTTP, not panic runtime.
- Busy Pi path (`sendUserMessage`) still applies thinking level.
- Queue items preserve variant/thinkingLevel through flush.
- Pi thinkingSignature is not dropped for redacted/encrypted blocks.
- SDK history types expose signature without including it in prompts.

---

### Task 1: Contract + SDK/preload

**Files:**
- Modify: `gateway/src/runtime/contract.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Test: `packages/gateway-sdk/src/client.test.ts`

**Interfaces:**
```ts
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
// promptAsync body
thinkingLevel?: ThinkingLevel; variant?: string
// SessionMessagePart
signature?: string; native?: Record<string, unknown>
// MafwPartBase
signature?: string; native?: Record<string, unknown>
```

- [x] **Step 1: Write failing SDK test** asserting promptAsync body includes `thinkingLevel:'high', variant:'max'`.
- [x] **Step 2: Run SDK test; confirm fail.**
- [x] **Step 3: Implement contract/SDK/preload; build SDK.**
- [x] **Step 4: Run SDK tests + desktop tsgo.**
- [x] **Step 5: Commit** `feat(sdk): thinking level and variant prompt options`.

---

### Task 2: Pi runtime thinking level + signature normalize

**Files:**
- Modify: `gateway/src/runtime/pi/pi-session.ts`
- Modify: `gateway/src/runtime/pi/pi-message-normalize.ts`
- Test: `gateway/tests/unit/runtime/pi-runtime.test.ts` (or pi-message-normalize test)
- Test: `gateway/tests/unit/runtime/pi-message-normalize.test.ts`

**Interfaces:**
- `promptAsync(id, text, opts?: { thinkingLevel?: ThinkingLevel; ... })`
- `buildPiPromptOpts` returns `{ thinkingLevel }`.
- `normalizePiMessages` reasoning part includes `{ signature: c.thinkingSignature }` when present.

- [x] **Step 1: Write failing tests** for thinkingLevel and signature.
- [x] **Step 2: Run tests; confirm fail.**
- [x] **Step 3: Implement pi opts + setThinkingLevel + signature mapping.**
- [x] **Step 4: Run focused tests + gateway tsc.**
- [x] **Step 5: Commit** `feat(pi): thinking level control and signature fidelity`.

---

### Task 3: Gateway routes + queue propagation

**Files:**
- Modify: `gateway/src/index.ts`
- Modify: `gateway/src/resources/sdk-session.ts`
- Modify: `gateway/src/core/session-queue.ts`
- Test: `gateway/tests/unit/routes/...` / `gateway/tests/unit/core/session-queue.test.ts`

- [x] **Step 1: Write failing tests** for HTTP promptAsync body → runtime opts, and queue item preservation/flush.
- [x] **Step 2: Run tests; confirm fail.**
- [x] **Step 3: Implement route parsing/validation, SDK session opts, QueuedItem fields, enqueue/intercept/flush.**
- [x] **Step 4: Run focused gateway tests + tsc.**
- [x] **Step 5: Commit** `feat(gateway): propagate thinking controls through prompt and queue`.

---

### Task 4: Signature DTO surface / history

**Files:**
- Modify: `gateway/src/runtime/canonical-types.ts`
- Test: `gateway/tests/unit/runtime/...` (canonical types / messages)
- Maybe `packages/session-ui` types if it has its own part model.

- [x] **Step 1: Add `signature/native` to `MafwPartBase`; keep reasoning union compatible.**
- [x] **Step 2: Add/confirm test that a reasoning part with signature survives validation and history enrich.**
- [x] **Step 3: Run gateway tests.**
- [x] **Step 4: Commit** `feat(runtime): expose signature on canonical parts`.

---

### Task 5: Finalize + deploy

- [x] Version bump `4.34.0`; update docs/T1-5 status.
- [x] Full tests/build; deploy; live:
  - promptAsync with `thinkingLevel` on pi? (if pi not active, source tests)
  - promptAsync with `variant` on opencode returns 200.
  - signature unit.
- [x] Commit release; report counts/hash.

## Verification (v4.34.0, 2026-10-26)

- gateway **2616**; SDK **147**; TUI **225** (224 pass / 1 smoke skip); session-ui **89**; desktop full **1445** (shared workspace includes parallel TerminalDock tests).
- gateway tsc rc=0; SDK build ok; desktop tsgo rc=0; electron-vite build ok; root build ok.
- live: opencode promptAsync with `variant:'max'` returns 200; invalid `thinkingLevel` returns 400.
- commits: `52526e8b` (contract/SDK), `83ad6730` (Pi), `16f782d1` (gateway/queue), `9d5f437c` (canonical signature), release v4.34.0.

## Self-Review

- [x] Signature fidelity: DTO, Pi normalize, SDK history.
- [x] Control plane: contract, HTTP, SDK, preload, queue.
- [x] No UI and no cross-runtime mapping (spec non-goals).
- [x] Failure modes: invalid level, queue preserve, missing signature.
