# Gateway Kernel B2: Scheduler Adoption Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Phase B follow-ups: the 5 deferred review minors, the NodeDriver promise-chain mutex migration to `MutexQueue`, and the PodEventWake scan coalesce — plus explicit rulings for the two non-migrations (RunCoordinator, serve watchdog).

**Architecture:** Three small TDD batches against existing modules — `scheduler/` + `automation-engine.ts` (minors), `concurrency/` + `core/goal/driver.ts` (mutex primitive + consumer), `core/pod/pod-event-wake.ts` (scan single-flight via injected scheduler submit). Behavior-equivalent except the PodEventWake coalesce, which fixes a real double-delivery race (timer scan + notify scan could run concurrently).

**Tech Stack:** TypeScript (CJS), Jest, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-09-gateway-kernel-scheduler-design.md` (§5.1 forward mappings + §9 Phase B2 notes)

## Global Constraints

- No new npm dependencies.
- Type gate: `npx tsc --noEmit -p tsconfig.json` in `gateway/`.
- Full suite: `npx jest --no-coverage --forceExit`.
- Do NOT commit another agent's uncommitted files (currently: `packages/gateway-sdk/contract/openapi.json`, `api-schema.gen.ts`, untracked docs). Explicit `git add` lists only.
- Branch: `feat/gateway-kernel-b2` off `main`.
- Cron/schedule frequencies and skip semantics unchanged.

## Key Rulings (decided up front)

1. **RunCoordinator NOT migrated.** Its `pendingSuspend` Set is a 409-conflict contract (`suspend already in progress` → HTTP 409), not a scheduling gate. Replacing it with scheduler admission (skip/coalesce) would break the documented HTTP contract, and its `awaitingStart`/`settled`/`suspended` sets are run-state-machine transitions. Cost if wrong: nothing else changes.
2. **Serve watchdog NOT migrated.** The 30s probe loop cannot stack probes — `isServeHealthy()` → `runtimeHost.healthCheck()` has adapter-level timeouts shorter than the interval; the loop also has its own `serveRecovering` flag. It is a probe loop, not a task gate. Cost if wrong: none.
3. **NodeDriver mutex → MutexQueue, NOT scheduler submission.** The driver's completion detection is event-driven (turn.completed + artifact files + idle attribution + grace + watchdog — the 2026-11-05 work); node dispatch is fire-and-forget `promptAsync`. A scheduler task models "promise settles = task done", which does not fit: a dispatch-only task is instantly done (useless), a completion-tracking task would hold the key for the entire node run (which the mutex already provides). The honest B2 value: replace the raw promise-chain mutex (a Phase A miss) with `MutexQueue`. Cost if wrong: driver concurrency behavior identical; queue semantics FIFO per goal, same as the chain.
4. **PodEventWake scan coalesce** routes ALL scan entries (interval, startup, notify) through `scheduler.submit` with `mutexKey: 'pod-event-wake'`, `strategy: 'coalesce'`, `priority: 'midground'` — concurrent scans join the in-flight one (fn runs once, all callers share the result). This closes the real double-delivery race.

## Review Focus

1. **Driver mutex error semantics** — the current chain swallows `advanceInner` errors (writes lastError, never rejects the caller). The MutexQueue migration must preserve the never-reject contract. Test: Task 2 test 3.
2. **Coalesce joined result sharing for scan(podId)** — a specific-pod notify scan joining an all-pods in-flight scan shares the broader result; scan() must still return `PodEventWakeResult`-shaped data to joiners. Test: Task 3 test 2.
3. **executeAction status truthfulness** — 'executed' must only be claimed for a real run; skip/timeout/denied/error statuses must flow to the MCP caller. Test: Task 1 test 5.
4. **maxConcurrent clamp** — `0` must not silently deadlock the queue. Test: Task 1 test 2.
5. **Non-Error throws (null/undefined/string)** — the no-scheduler catch path must not crash on `err.message` access. Test: Task 1 test 6.

---

### Task 1: Scheduler + engine minors (M1–M5)

**Files:**
- Modify: `gateway/src/scheduler/scheduler.ts` (M1, M5)
- Modify: `gateway/src/automation-engine.ts` (M2, M3, M4)
- Test: `gateway/tests/unit/scheduler/scheduler.test.ts` (extend)
- Test: `gateway/tests/unit/automation-engine.test.ts` (extend)

**Interfaces:**
- Produces: `executeAction` now returns `Promise<ActionRunStatus>` where `export type ActionRunStatus = 'ran' | 'skipped' | 'timeout' | 'denied' | 'error' | 'missing'`. Internal/private — only `runRuleFromLLM` consumes it in this batch.

- [ ] **Step 1: Write the failing tests** — append to the two test files:

```ts
// scheduler.test.ts additions:
// 1. fn returning a non-promise (plain value) still resolves + releases the key
//    (submit with mutexKey k + sync-returning fn as any; next same-key task runs)
// 2. maxConcurrent: 0 is clamped to 1 — a queued task still runs

// automation-engine.test.ts additions:
// 3. two concurrent action submissions produce distinct task ids
//    (timeoutMs: 10, never-resolving handlers; the two TaskTimeoutError messages differ)
// 4. executeAction returns 'ran' for a successful run (no scheduler AND with scheduler)
// 5. runRuleFromLLM message reflects the status:
//    - skip path (concurrent run in flight) → message contains 'skipped', not 'executed'
//    - budget denial → message contains 'denied'
// 6. handler throws null in the no-scheduler path → executeAction resolves with 'error' (no TypeError)
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/unit/scheduler/scheduler.test.ts tests/unit/automation-engine.test.ts --no-coverage`
Expected: FAIL (new tests).

- [ ] **Step 3: Implement**

- scheduler.ts `start()`: `fnPromise = Promise.resolve(task.fn())` inside the existing try (M1 — sync throw still caught; non-promise returns wrapped).
- scheduler.ts constructor: `this.maxConcurrent = Math.max(1, opts?.maxConcurrent ?? 4)` + comment (M5).
- automation-engine.ts: add `private _actionSeq = 0;` — task id becomes `automation:${actionType}:${++this._actionSeq}` (M2).
- automation-engine.ts: `executeAction` returns `ActionRunStatus` — return values: 'missing' (no handler), 'ran', 'skipped', 'timeout', 'denied', 'error'; both paths (with/without scheduler) (M3). No-scheduler catch: `err instanceof Error ? err.message : err` (M4).
- automation-engine.ts `runRuleFromLLM`: `const status = await this.executeAction(...)`; message: `Action ${rule.action.type} ${status === 'ran' ? 'executed' : status}`. Callers of executeAction that ignore the return value (executeRule) stay unchanged.

- [ ] **Step 4: Run to verify pass**

Run: same command. Expected: PASS (all previous + new).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/scheduler/scheduler.ts gateway/src/automation-engine.ts gateway/tests/unit/scheduler/scheduler.test.ts gateway/tests/unit/automation-engine.test.ts
git commit -m "fix(gateway): address Phase B review minors M1-M5 (non-promise fn, id seq, action status, throw parity, cap clamp)"
```

---

### Task 2: MutexQueue.has + NodeDriver mutex migration

**Files:**
- Modify: `gateway/src/concurrency/mutex-queue.ts`
- Modify: `gateway/src/core/goal/driver.ts` (~L311, L366-378, L1148)
- Test: `gateway/tests/unit/concurrency/mutex-queue.test.ts` (extend)
- Test: extend `gateway/tests/unit/concurrency/regression-guard.test.ts`

**Interfaces:**
- Produces: `MutexQueue.has(key: string): boolean` — true while the key is running **or has queued tasks**.
- Consumes: driver's `advance()` never-reject contract (existing).

- [ ] **Step 1: Write the failing tests**

```ts
// mutex-queue.test.ts additions:
// 1. has() false for unknown key; true while running; true while queued (cap via
//    a slow first task); false after completion
// 2. has() reflects queued tasks: task A running, task B queued → has('k') true;
//    after A settles and B runs → still true; after B settles → false

// regression-guard.test.ts addition (new describe or extend scheduler guard):
// - driver.ts (core/goal/driver.ts) must not contain `private mutex = new Map<string, Promise`
// - driver.ts must import MutexQueue from '../concurrency/mutex-queue' (path relative from core/goal)
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/unit/concurrency/ --no-coverage`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `MutexQueue.has(key)`: `return this.running.has(key) || (this.queues.get(key)?.length ?? 0) > 0;`
- driver.ts: replace `private mutex = new Map<string, Promise<void>>()` with `private mutex = new MutexQueue()` (+ import). `advance` becomes:

```ts
async advance(goalId: string): Promise<void> {
  await this.mutex.run(goalId, async () => {
    try {
      await this.advanceInner(goalId);
    } catch (err) {
      // 驱动器异常绝不外抛（spec §7）；落 lastError
      try {
        const mafwDir = this.stateDirs.get(goalId);
        if (mafwDir) writeGoalState(mafwDir, goalId, { lastError: `driver: ${err?.message ?? err}` });
      } catch { /* last-resort */ }
    }
  });
}
```

`continueAdvance`'s `this.mutex.has(goalId)` works unchanged (new API).

- [ ] **Step 4: Run driver + concurrency suites**

Run: `npx jest tests/unit/concurrency/ tests/unit/goal/ --no-coverage`
Expected: PASS (goal suite includes driver tests — the never-reject and queue-order behavior must hold).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/concurrency/mutex-queue.ts gateway/src/core/goal/driver.ts gateway/tests/unit/concurrency/mutex-queue.test.ts gateway/tests/unit/concurrency/regression-guard.test.ts
git commit -m "refactor(gateway): NodeDriver promise-chain mutex to MutexQueue (+has())"
```

---

### Task 3: PodEventWake scan coalesce

**Files:**
- Modify: `gateway/src/core/pod/pod-event-wake.ts`
- Modify: `gateway/src/index.ts` (inject the submit wrapper at wiring)
- Test: `gateway/tests/unit/pod/pod-event-wake.test.ts` (extend — file exists from the 2026-11-04 batch)

**Interfaces:**
- Produces: `PodEventWakeDeps.runScan?: (fn: () => Promise<PodEventWakeResult>) => Promise<PodEventWakeResult>` — injected single-flight wrapper; absent = direct call (tests/standalone unchanged).

- [ ] **Step 1: Write the failing test**

```ts
// pod-event-wake.test.ts addition:
// scan coalesces through the injected runScan: two concurrent scan() calls
// while a scan is in flight → the underlying fn runs once, both callers get
// the same result object (deps.runScan wraps with a simple promise-caching impl
// in the test; production wiring uses the scheduler).
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/unit/pod/pod-event-wake.test.ts --no-coverage`
Expected: FAIL (deps.runScan not consumed).

- [ ] **Step 3: Implement**

- pod-event-wake.ts: deps add `runScan?`; `scan()` body becomes:

```ts
async scan(podId?: string): Promise<PodEventWakeResult> {
  const run = this.deps.runScan ?? ((fn: () => Promise<PodEventWakeResult>) => fn());
  return run(() => this.scanInner(podId));
}
```

with the current body renamed `scanInner(podId)`. `notify()`'s internal `setTimeout(() => void this.scan(), 0)` stays (it now coalesces through runScan too).

- index.ts wiring (where PodEventWake is constructed): inject
`runScan: (fn) => this.scheduler.submit({ priority: 'midground', mutexKey: 'pod-event-wake', strategy: 'coalesce' }, fn)`.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/unit/pod/pod-event-wake.test.ts tests/unit/pod/ --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-event-wake.ts gateway/src/index.ts gateway/tests/unit/pod/pod-event-wake.test.ts
git commit -m "fix(gateway): coalesce PodEventWake scans via scheduler (close double-delivery race)"
```

---

### Task 4: Docs + rulings + full verification

**Files:**
- Modify: `docs/architecture/gateway.md` (scheduler section: not-yet-migrated list update)
- Modify: `docs/superpowers/specs/2026-11-09-gateway-kernel-scheduler-design.md` (§9 B2 completion note)

- [ ] **Step 1: Update gateway.md scheduler section's 本批有意不迁移 list** — remove PodEventWake (now migrated); NodeDriver note becomes "mutex unified under MutexQueue; scheduler submission ruled out (event-driven completion)"; add RunCoordinator + serve-watchdog rulings.

- [ ] **Step 2: Append spec §9 B2 note** — the two non-migration rulings + driver MutexQueue decision.

- [ ] **Step 3: Full verification on committed state**

`git stash` (if other agent's changes present) → `npx tsc --noEmit -p tsconfig.json` → `npx jest --no-coverage --forceExit` → `git stash pop`. Expected: tsc clean; full suite green except documented pre-existing flakiness; record exact counts.

- [ ] **Step 4: Commit + ledger**

```bash
git add docs/architecture/gateway.md docs/superpowers/specs/2026-11-09-gateway-kernel-scheduler-design.md
git commit -m "docs: record B2 adoption-completion rulings"
```

Ledger: `.superpowers/sdd/2026-11-10-gateway-kernel-b2/progress.md`.
