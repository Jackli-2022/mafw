# Gateway Kernel: Deferred Minors Batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the B2 + Phase C deferred minors: registry semantics polish (ended-record handling, copy hygiene, delete semantics), the pool evictPair unification (sweeper now bounds idle pairs), and the four B2 leftovers (driver lastError fidelity, has() window comment, poisoning pin test, pod-event-wake id drop).

**Architecture:** Three TDD tasks against existing modules. The pool change unifies pair disposal into one guarded `evictPair()` entry (TtlMap onEvict, worker-record onEvict, disposeAll) so the 60s unified sweeper now actually bounds idle pairs — the Phase C review's deferred improvement.

**Tech Stack:** TypeScript (CJS), Jest, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-09-gateway-kernel-session-registry-design.md` §9 + `2026-11-09-gateway-kernel-scheduler-design.md` §9.1 (the deferred-minor lists live in the batch ledgers, recorded in the delivery reports).

## Global Constraints

- No new npm dependencies. Type gate `npx tsc --noEmit -p tsconfig.json` in `gateway/`.
- Do NOT commit another agent's uncommitted files; explicit `git add` lists only.
- Branch: `feat/gateway-kernel-minors` off `main`.
- One deferred minor is intentionally skipped: B2's "midground scans can queue behind saturated background slots" (already documented in spec §9.1 as a known bound — nothing to change).

## Review Focus

1. **evictPair exactly-once across THREE triggers** — TtlMap access-eviction + sweeper-driven worker-record onEvict + disposeAll must dispose a pair exactly once (guarded). Test: Task 2.
2. **Ended-record overlay re-registration** — a role/origin set on an expired-but-unswept record must NOT be silently dropped at the next sweep; it re-registers (generation bump). Test: Task 1.
3. **Active-record overlay merge preserved** — the ended-handling fix must not break the active-path merge (owner metadata survives an overlay patch). Test: Task 1.

---

### Task 1: Registry + view semantics fixes (Phase C minors)

**Files:**
- Modify: `gateway/src/session/registry.ts` (ended-branch metadata replace + createdAt reset; materialize strips onEvict; ttlMs doc)
- Modify: `gateway/src/session/views/internal-roles.ts` (ended → re-register; delete returns role-was-present)
- Modify: `gateway/src/recall/worker-origin.ts` (ended → re-register)
- Test: `gateway/tests/unit/session/registry.test.ts` + `internal-roles-view.test.ts` + `worker-origin-view.test.ts` (extend)

- [ ] **Step 1: Failing tests**

```ts
// registry.test.ts:
// - register over ended: createdAt resets to now, metadata REPLACED (not merged)
// - lookup(...).onEvict is undefined (callback never leaks on the public copy)
// internal-roles-view.test.ts:
// - set on an expired-but-unswept record → re-registers (get works, generation 2,
//   record active — not silently dropped at the next sweep)
// - delete on a foreign record with NO role set → returns false (Map.delete semantics)
// worker-origin-view.test.ts:
// - registerWorkerOrigin on an expired-but-unswept record → re-registers (resolve works)
```

- [ ] **Step 2: RED** — `npx jest tests/unit/session/ --no-coverage` → new tests fail.
- [ ] **Step 3: Implement** — registry `register` ended-branch: `existing.metadata = { ...(input.metadata ?? {}) }`, `existing.createdAt = this.now()`; `materialize` omits `onEvict`; `RegisterInput.ttlMs` doc: `0/null/undefined → never expires`. Views: `existing.status === 'active'` gate for the patch path (ended falls through to register).
- [ ] **Step 4: GREEN** + tsc. Commit: `fix(gateway): session registry ended-record semantics + copy hygiene (deferred minors)`.

### Task 2: Pool evictPair unification — sweeper bounds idle pairs

**Files:**
- Modify: `gateway/src/recall/session-worker-pool.ts`
- Test: `gateway/tests/unit/session/worker-pool-registry.test.ts` (extend)

- [ ] **Step 1: Failing test**

```ts
// sweeper-driven eviction: worker record registered with a per-record onEvict that
// evicts the PAIR — registry.sweep() alone (no getWorker access) disposes the pair
// exactly once, removes the TtlMap entry, and unregisters the sibling worker record.
// Sequence: create pair + prompt (extract session created), advance clock past TTL,
// registry.sweep() → disposed === 1 (not 2), pool.size() === 0, all worker records gone.
```

- [ ] **Step 2: RED** — sweep alone currently does nothing to the pair (worker records have no onEvict).
- [ ] **Step 3: Implement** — one guarded `evictPair(sourceSessionID)` (disposed-set guard; disposes both workers; unregisters worker records via the sid list; `entries.delete(source)`); TtlMap `onEvict` → `evictPair`; `registerWorkerSession` attaches a per-record `onEvict: () => this.evictPair(source)`; `disposeAll` → evictPair per source (replacing the explicit unregister loop).
- [ ] **Step 4: GREEN** (all pool tests incl. exactly-once) + tsc. Commit: `fix(gateway): unified evictPair — the 60s sweeper bounds idle worker pairs`.

### Task 3: B2 leftovers

**Files:**
- Modify: `gateway/src/core/goal/driver.ts` (lastError fidelity; has() window comment)
- Modify: `gateway/src/index.ts` (drop the pod-event-wake Date.now() id)
- Test: `gateway/tests/unit/goal/` (extend the driver suite — find the driver test file)

- [ ] **Step 1: Failing test**

```ts
// advance-after-reject: a withGoalMutex op that rejects (e.g. StalePlanError path)
// must NOT poison the next queued advance — advanceInner still runs afterwards
// (the B2 poisoning fix, pinned). Construct the driver harness, run a rejecting
// withGoalMutex op, then advance → advanceInner's effect visible (or the driver's
// own test harness pattern for observing advanceInner).
```

- [ ] **Step 2: RED where applicable** — the pin test passes immediately (behavior exists since B2); it is a regression pin, not a fix. The lastError fidelity change (`(err as any)?.message ?? String(err)`) IS fixable RED: a driver test asserting lastError content for an object throw.
- [ ] **Step 3: Implement** — driver catch: `const message = (err as any)?.message ?? String(err)`; comment at continueAdvance's `mutex.has` site documenting the one-microtask stale window; index.ts: drop `id: `pod-event-wake:${Date.now()}`` (scheduler auto-id is collision-free).
- [ ] **Step 4: GREEN** + tsc. Commit: `fix(gateway): B2 leftovers (driver lastError fidelity, has-window comment, poisoning pin, wake id drop)`.

### Task 4: Verify + docs

- [ ] Full suite on committed state (stash if needed); spec §9/§9.1 one-line notes (ended-record semantics; sweeper now bounds idle pairs); commit docs; ledger.
