# Gateway Kernel Phase A: Unified Concurrency Primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `gateway/src/concurrency/` with 5 orthogonal primitives (singleflight / mutex-queue / guard / ttl-map / watermark), migrate 12+ scattered handwritten concurrency implementations to consume them, and add CI guards preventing regression.

**Architecture:** Each primitive is a small class in its own file under `gateway/src/concurrency/`. They have no dependencies on each other. Consumers hold instances and call `.run(key, fn, opts?)`. Migration is behavior-equivalent except `snapshotBuildInFlight` which changes from drop to queue (explicitly tested).

**Tech Stack:** TypeScript (CJS), Jest (existing gateway test runner), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-09-gateway-kernel-concurrency-design.md`

## Global Constraints

- No new npm dependencies — implement from scratch.
- All files CJS (`module.exports` pattern used by gateway `tsc` build).
- Tests live in `gateway/tests/unit/concurrency/` using Jest.
- Every migration must keep existing gateway tests green (behavior-equivalent).
- `snapshotBuildInFlight` is the **only** semantic change (drop → queue); pin with a new test.
- Import path for all consumers: `../concurrency` or `./concurrency` (relative to file location).

## Review Focus

1. **Promise leak on error** — if `fn()` throws, the key must be released so subsequent calls can retry. Test: call, throw, call again succeeds.
2. **Stale watermark after long idle** — watermark `isStale` must return false if counter never advanced past the mark. Test: mark, no bump, isStale = false.
3. **Guard queue FIFO order** — when `onConflict: 'queue'`, queued tasks must execute in submission order, not completion order. Test: submit A (slow), B, C; B starts before C.
4. **TtlMap sweep removes expired but not active** — `sweep()` must not evict entries whose TTL hasn't elapsed. Test: set two entries with different TTLs, advance time, sweep, only expired one removed.
5. **Singleflight dedup on concurrent calls only** — sequential calls to the same key must both execute (the map entry is cleaned after the first completes). Test: await first call, then call again — both execute.

---

### Task 1: Create `concurrency/` module — all 5 primitives + tests

**Files:**
- Create: `gateway/src/concurrency/singleflight.ts`
- Create: `gateway/src/concurrency/mutex-queue.ts`
- Create: `gateway/src/concurrency/guard.ts`
- Create: `gateway/src/concurrency/ttl-map.ts`
- Create: `gateway/src/concurrency/watermark.ts`
- Create: `gateway/src/concurrency/index.ts`
- Test: `gateway/tests/unit/concurrency/singleflight.test.ts`
- Test: `gateway/tests/unit/concurrency/mutex-queue.test.ts`
- Test: `gateway/tests/unit/concurrency/guard.test.ts`
- Test: `gateway/tests/unit/concurrency/ttl-map.test.ts`
- Test: `gateway/tests/unit/concurrency/watermark.test.ts`

**Interfaces:**

`singleflight.ts`:
```ts
export class Singleflight {
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
  get size(): number;
}
```

`mutex-queue.ts`:
```ts
export class MutexQueue {
  run<T>(key: string, fn: () => Promise<T>): Promise<T>;
  queueLength(key: string): number;
}
```

`guard.ts`:
```ts
export interface GuardOpts {
  /** How to handle a call when the key is already held. */
  onConflict?: 'skip' | 'queue';       // default 'skip'
  /** Force-release after this duration. */
  timeoutMs?: number;
  /** What to do on timeout. */
  onTimeout?: 'release' | 'error';     // default 'release'
}

export class Guard {
  /**
   * Returns the result of fn(), or null if skipped (onConflict: 'skip' and key was held).
   * Throws GuardTimeoutError if timeout fires with onTimeout: 'error'.
   */
  run<T>(key: string, fn: () => Promise<T>, opts?: GuardOpts): Promise<T | null>;
  isHeld(key: string): boolean;
  get heldKeys(): string[];
}

export class GuardTimeoutError extends Error {
  readonly code = 'guard_timeout';
  constructor(key: string, timeoutMs: number);
}
```

`ttl-map.ts` (migrated from `recall/ttl-map.ts`, same public API):
```ts
export interface TtlMapOptions<K, V> {
  ttlMs: number;
  sweepIntervalMs?: number;
  onEvict?: (key: K, value: V) => void;
  now?: () => number;
}

export class TtlMap<K, V> {
  constructor(opts: TtlMapOptions<K, V>);
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): boolean;
  has(key: K): boolean;
  get size(): number;
  sweep(): number;
  stop(): void;
}
```

`watermark.ts`:
```ts
export class Watermark {
  /** Snapshot the current counter value for a key (the "watermark"). */
  mark(key: string): number;
  /** Record activity — increments the counter. */
  bump(key: string): void;
  /** True if the counter has advanced past the watermark since it was taken. */
  hasActivitySince(key: string, watermark: number): boolean;
}
```

`index.ts`:
```ts
export { Singleflight } from './singleflight';
export { MutexQueue } from './mutex-queue';
export { Guard, GuardTimeoutError, type GuardOpts } from './guard';
export { TtlMap, type TtlMapOptions } from './ttl-map';
export { Watermark } from './watermark';
```

- [ ] **Step 1: Write failing tests for Singleflight**

Test cases in `gateway/tests/unit/concurrency/singleflight.test.ts`:

```ts
describe('Singleflight', () => {
  it('concurrent calls to same key execute fn once and share result');
  it('different keys execute in parallel');
  it('sequential calls to same key both execute (entry cleaned after first)');
  it('callers waiting on the same promise all get the same resolved value');
  it('if fn rejects, all callers get the rejection, and next call retries');
  it('size reflects number of in-flight keys');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway && npx jest tests/unit/concurrency/singleflight.test.ts --no-coverage`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `Singleflight` in `gateway/src/concurrency/singleflight.ts`**

Internal `Map<string, Promise<unknown>>`. `run()` checks for existing promise, creates new one if absent, cleans up in `.finally()` (only if the map entry is still this promise).

- [ ] **Step 4: Run singleflight tests to verify they pass**

- [ ] **Step 5: Write failing tests for MutexQueue**

Test cases in `gateway/tests/unit/concurrency/mutex-queue.test.ts`:

```ts
describe('MutexQueue', () => {
  it('same-key calls execute sequentially (FIFO)');
  it('different keys execute in parallel');
  it('queued tasks start in submission order, not completion order');
  it('if a task throws, the next queued task still runs');
  it('queueLength returns pending count for a key');
});
```

- [ ] **Step 6: Run tests to verify they fail**

- [ ] **Step 7: Implement `MutexQueue` in `gateway/src/concurrency/mutex-queue.ts`**

Internal `Map<string, Promise<unknown>>` as promise chain per key. Each `run()` appends to the chain, but the chain entry is cleaned when queue is empty.

- [ ] **Step 8: Run mutex-queue tests to verify they pass**

- [ ] **Step 9: Write failing tests for Guard**

Test cases in `gateway/tests/unit/concurrency/guard.test.ts`:

```ts
describe('Guard', () => {
  it('skip mode: second call returns null while first is in flight');
  it('skip mode: after first completes, next call runs');
  it('queue mode: second call waits for first, then runs');
  it('queue mode: FIFO order is preserved');
  it('timeout releases the lock (subsequent calls can run)');
  it('timeout with onTimeout error throws GuardTimeoutError');
  it('isHeld returns true while held, false after release');
  it('if fn throws, lock is released');
});
```

- [ ] **Step 10: Run tests to verify they fail**

- [ ] **Step 11: Implement `Guard` in `gateway/src/concurrency/guard.ts`**

Combines skip/queue semantics with a timeout watchdog. Internally uses a `Set<string>` for held keys and a `Map<string, Promise<unknown>>` for queued chains.

- [ ] **Step 12: Run guard tests to verify they pass**

- [ ] **Step 13: Write failing tests for TtlMap**

Copy the existing test file from `gateway/tests/unit/recall/ttl-map.test.ts` if it exists; otherwise write:

```ts
describe('TtlMap', () => {
  it('set then get before TTL returns value');
  it('set then get after TTL returns undefined');
  it('sweep removes expired entries and returns count');
  it('sweep does not remove unexpired entries');
  it('onEvict is called for expired entries');
  it('delete removes entry immediately');
  it('stop clears the sweep interval');
  it('entries with different TTLs expire independently (requires per-entry TTL override or separate TtlMap instances)');
});
```

- [ ] **Step 14: Run tests to verify they fail**

- [ ] **Step 15: Migrate `TtlMap` implementation to `gateway/src/concurrency/ttl-map.ts`**

Copy from `gateway/src/recall/ttl-map.ts` (same public API, same behavior). Add `stop()` method if not already present. The old file becomes `export * from '../concurrency/ttl-map';` (re-export, one cleanup cycle).

- [ ] **Step 16: Run ttl-map tests to verify they pass**

- [ ] **Step 17: Write failing tests for Watermark**

```ts
describe('Watermark', () => {
  it('mark returns current counter value');
  it('hasActivitySince returns false when no bumps happened');
  it('hasActivitySince returns true after bump');
  it('multiple bumps are cumulative');
  it('different keys have independent counters');
  it('mark after bumps reflects the new baseline');
});
```

- [ ] **Step 18: Run tests to verify they fail**

- [ ] **Step 19: Implement `Watermark` in `gateway/src/concurrency/watermark.ts`**

Two internal Maps: `counters` (persistent) and the mark is just the return value of `current()`. `hasActivitySince` compares counter > watermark.

- [ ] **Step 20: Run watermark tests to verify they pass**

- [ ] **Step 21: Create `gateway/src/concurrency/index.ts` barrel export**

- [ ] **Step 22: Run all concurrency tests together**

Run: `cd gateway && npx jest tests/unit/concurrency/ --no-coverage`
Expected: ALL PASS

- [ ] **Step 23: Verify existing TtlMap consumers still work**

Run: `cd gateway && npx jest tests/unit/recall/session-worker-pool --no-coverage`
Expected: PASS (re-export preserves types)

- [ ] **Step 24: Commit**

```bash
git add gateway/src/concurrency/ gateway/tests/unit/concurrency/ gateway/src/recall/ttl-map.ts
git commit -m "feat(gateway): add unified concurrency primitives (singleflight/mutex-queue/guard/ttl-map/watermark)

Phase A of gateway kernel refactor. Five orthogonal primitives replace
7+ scattered handwritten implementations. TtlMap migrated from recall/
with re-export for backward compatibility.

Spec: docs/superpowers/specs/2026-11-09-gateway-kernel-concurrency-design.md"
```

---

### Task 2: Migrate recall/memory consumers

**Files:**
- Modify: `gateway/src/recall/session-worker-pool.ts:103-112` (runExclusive → Singleflight)
- Modify: `gateway/src/memory/write-queue.ts` (WriteQueue → MutexQueue internally)
- Modify: `gateway/src/memory/harmonic-file-store.ts:11` (import path if WriteQueue API changes)
- Modify: `gateway/src/index.ts:546` (PipelineGuard import → Guard from concurrency)
- Modify: `gateway/src/index.ts:3281-3282` (runPipelineGuarded → Guard.run with skip)
- Test: existing tests in `gateway/tests/unit/recall/` and `gateway/tests/unit/memory/` must stay green

**Interfaces:**
- Consumes: `Singleflight`, `MutexQueue`, `Guard` from `gateway/src/concurrency/`

- [ ] **Step 1: Replace `runExclusive` in session-worker-pool.ts with Singleflight**

Replace the private `runExclusive` method with an internal `Singleflight` instance:
```ts
import { Singleflight } from '../concurrency';
// ...
private readonly flight = new Singleflight();
// replace runExclusive(sessionID, kind, fn) calls with:
// this.flight.run(`${sessionID}:${kind}`, fn)
```

Keep the `runExclusive` method signature as a thin wrapper so external callers don't change (index.ts L3827, L3850).

- [ ] **Step 2: Run session-worker-pool tests**

Run: `cd gateway && npx jest tests/unit/recall/session-worker-pool --no-coverage`
Expected: PASS

- [ ] **Step 3: Replace `WriteQueue` internals with MutexQueue**

In `gateway/src/memory/write-queue.ts`, replace the promise-chain implementation with `MutexQueue`. Keep the public `WriteQueue` class and its `enqueue()` method signature (consumed by `harmonic-file-store.ts`).

- [ ] **Step 4: Run harmonic-file-store tests**

Run: `cd gateway && npx jest tests/unit/memory/harmonic-file-store --no-coverage`
Expected: PASS

- [ ] **Step 5: Replace PipelineGuard usage in index.ts with Guard**

In `gateway/src/index.ts`:
- Replace L546: `private pipelineGuard = new Guard({ timeoutMs: 30 * 60_000 })`
- Replace L3281-3282: `runPipelineGuarded` calls `this.pipelineGuard.run(name, fn, { onConflict: 'skip', timeoutMs: 30 * 60_000, onTimeout: 'release' })`

The existing `PipelineGuard` class in `recall/pipeline-guard.ts` stays for one cleanup cycle (marked deprecated).

- [ ] **Step 6: Run pipeline guard related tests**

Run: `cd gateway && npx jest tests/unit/recall/pipeline-guard --no-coverage` (if exists)
Expected: PASS (old class untouched, just no longer consumed by index.ts)

- [ ] **Step 7: Run broader recall/memory test suite**

Run: `cd gateway && npx jest tests/unit/recall/ tests/unit/memory/ --no-coverage`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add gateway/src/recall/session-worker-pool.ts gateway/src/memory/write-queue.ts gateway/src/index.ts
git commit -m "refactor(gateway): migrate recall/memory concurrency to unified primitives

runExclusive → Singleflight, WriteQueue → MutexQueue internally,
PipelineGuard usage in index.ts → Guard from concurrency/.

Behavior-equivalent migration; existing tests unchanged."
```

---

### Task 3: Migrate index.ts consumers (including snapshotBuildInFlight semantic change)

**Files:**
- Modify: `gateway/src/index.ts:584` (registryWriteQueue → MutexQueue)
- Modify: `gateway/src/index.ts:620` (eventTaps → TtlMap with 5min TTL)
- Modify: `gateway/src/index.ts:654` (probeScopes → TtlMap with probe timeout)
- Modify: `gateway/src/index.ts:690` (ttsInflight → TtlMap or Guard)
- Modify: `gateway/src/index.ts:3021,3046-3051` (snapshotBuildInFlight → Guard with queue)
- Modify: `gateway/src/index.ts:10007-10074` (managerSessionInflight → Singleflight)
- Test: `gateway/tests/unit/gateway/snapshot-queue.test.ts` (new — pins the drop→queue semantic change)

**Interfaces:**
- Consumes: `Singleflight`, `MutexQueue`, `Guard`, `TtlMap` from `gateway/src/concurrency/`

- [ ] **Step 1: Write failing test for snapshotBuildInFlight queue semantics**

New test file `gateway/tests/unit/gateway/snapshot-queue.test.ts`:

```ts
it('snapshot build: second request queues (not drops) while first is building', async () => {
  // Create a Guard with onConflict: 'queue'
  // Submit task A (slow)
  // Submit task B while A is running
  // Both should complete (B waits for A, then runs)
  // Previously B would be dropped
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Replace snapshotBuildInFlight boolean with Guard**

In `gateway/src/index.ts`:
- Remove: `private snapshotBuildInFlight = false;` (L3021)
- Add: `private snapshotGuard = new Guard();`
- Replace L3046-3051:
```ts
// OLD: if (this.snapshotBuildInFlight) return; this.snapshotBuildInFlight = true; try { ... } finally { this.snapshotBuildInFlight = false; }
// NEW:
await this.snapshotGuard.run(sessionID, async () => {
  // ... existing build logic ...
}, { onConflict: 'queue' });
```

- [ ] **Step 4: Run new test to verify it passes**

- [ ] **Step 5: Replace registryWriteQueue with MutexQueue**

In `gateway/src/index.ts`:
- Remove: `private registryWriteQueue: Promise<void> = Promise.resolve();` (L584)
- Add: `private registryQueue = new MutexQueue();`
- Replace L8802: `this.registryQueue.run('registry', async () => { ... })`
- Replace L8824: `await this.registryQueue.run('registry', () => Promise.resolve())` or equivalent

- [ ] **Step 6: Replace managerSessionInflight with Singleflight**

In `gateway/src/index.ts`:
- Remove: `private managerSessionInflight = new Map<string, Promise<unknown>>();` (L10007)
- Add: `private managerFlight = new Singleflight();`
- Replace L10010-10017 and L10058-10074 with `this.managerFlight.run(projectDir, fn)` calls

Note: the existing code has two call sites — one that creates and one that maps an existing promise. The Singleflight primitive handles both (the second call site should just call `.run()` and get the same or new promise).

- [ ] **Step 7: Add TTL to eventTaps**

In `gateway/src/index.ts`:
- Replace: `private eventTaps = new Map<string, Set<...>>();` (L620)
- Add: `private eventTaps = new TtlMap<string, Set<...>>({ ttlMs: 5 * 60_000 });`
- Update L1696, L2624-2627 to use TtlMap's get/set/delete API
- Sweep is handled by TtlMap's internal interval

- [ ] **Step 8: Add TTL to probeScopes**

In `gateway/src/index.ts`:
- Replace: `private readonly probeScopes = new Map<string, GoalProbeSessionBinding>();` (L654)
- Add: `private readonly probeScopes = new TtlMap<string, GoalProbeSessionBinding>({ ttlMs: 10 * 60_000 });`
- Update L4067, L9560-9561 to use TtlMap API

- [ ] **Step 9: Migrate ttsInflight**

In `gateway/src/index.ts`:
- Replace: `private ttsInflight = new Map<string, Set<AbortController>>();` (L690)
- The current usage tracks AbortControllers per session for cancellation. This is not a lock/mutex — it's a resource registry.
- Replace with: `private ttsInflight = new TtlMap<string, Set<AbortController>>({ ttlMs: 180_000 })` (3min = max TTS duration)
- Update L5849-5854, L5886 to use TtlMap API

- [ ] **Step 10: Run broader gateway test suite**

Run: `cd gateway && npx jest tests/unit/gateway/ --no-coverage`
Expected: ALL PASS (including existing snapshot/manager/tts tests)

- [ ] **Step 11: Commit**

```bash
git add gateway/src/index.ts gateway/tests/unit/gateway/snapshot-queue.test.ts
git commit -m "refactor(gateway): migrate index.ts concurrency to unified primitives

- registryWriteQueue → MutexQueue
- managerSessionInflight → Singleflight
- snapshotBuildInFlight → Guard (semantic change: drop → queue, pinned by test)
- eventTaps → TtlMap (5min TTL, fixes unbounded growth)
- probeScopes → TtlMap (10min TTL, fixes unbounded growth)
- ttsInflight → TtlMap (3min TTL)

The snapshotBuildInFlight change is the only behavioral difference:
previously concurrent build requests were silently dropped; now they
queue and execute after the current build completes."
```

---

### Task 4: Migrate core consumers (instructionSync + NodeDriver watermark)

**Files:**
- Modify: `gateway/src/core/instructions/instruction-sync-service.ts:103-138` (singleFlight → Singleflight)
- Modify: `gateway/src/core/goal/driver.ts` (dispatchSeq/activitySeq → Watermark)
- Test: existing tests must stay green

**Interfaces:**
- Consumes: `Singleflight`, `Watermark` from `gateway/src/concurrency/`

- [ ] **Step 1: Replace instructionSync singleFlight with Singleflight**

In `instruction-sync-service.ts`, replace the private single-flight implementation (L103-138) with an internal `Singleflight` instance. Keep the public method signatures unchanged.

- [ ] **Step 2: Run instruction sync tests**

Run: `cd gateway && npx jest tests/unit/core/instructions/ --no-coverage`
Expected: PASS

- [ ] **Step 3: Replace NodeDriver dispatchSeq/activitySeq with Watermark**

In `driver.ts`:
- Identify the dispatchSeq and activitySeq fields (they're per-goal or per-session counters)
- Replace with a `Watermark` instance
- At dispatch time: `const wm = this.watermark.mark(sessionId)` (instead of `dispatchSeq = activitySeq`)
- On activity events: `this.watermark.bump(sessionId)` (instead of `activitySeq++`)
- On idle event: `this.watermark.hasActivitySince(sessionId, wm)` (instead of `activitySeq > dispatchSeq`)

The exact field names and locations need to be confirmed by reading the driver code. The key invariant: **stale idle (no activity since dispatch) does not trigger completion**.

- [ ] **Step 4: Run NodeDriver / goal tests**

Run: `cd gateway && npx jest tests/unit/core/goal/ --no-coverage`
Expected: PASS (idle-attribution tests unchanged)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/instructions/instruction-sync-service.ts gateway/src/core/goal/driver.ts
git commit -m "refactor(gateway): migrate core concurrency to unified primitives

instructionSync singleFlight → Singleflight, NodeDriver
dispatchSeq/activitySeq → Watermark. Behavior-equivalent."
```

---

### Task 5: CI guard + full verification

**Files:**
- Create: `gateway/tests/unit/concurrency/regression-guard.test.ts`
- Test: full gateway test suite

**Interfaces:**
- No new interfaces; this is a verification task.

- [ ] **Step 1: Write regression guard test**

In `gateway/tests/unit/concurrency/regression-guard.test.ts`:

```ts
// CI guard: index.ts should not contain raw concurrency primitives
// (handwritten inflight Maps, boolean mutex, promise chains)

it('index.ts should not contain handwritten concurrency Map declarations', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/index.ts'), 'utf-8');
  // Check for patterns like: private.*Map<string,.*Promise
  // private.*Map<string,.*inflight
  // private.*= false.*// mutex
  // Exclude: TtlMap (it IS from concurrency/)
  expect(source).not.toMatch(/private\s+\w+\s*=\s*new\s+Map<string,\s*Promise/);
  expect(source).not.toMatch(/private\s+\w+Inflight\s*=\s*new\s+Map/);
});
```

- [ ] **Step 2: Run guard test to verify it passes**

Run: `cd gateway && npx jest tests/unit/concurrency/regression-guard.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 3: Run FULL gateway test suite**

Run: `cd gateway && npx jest --no-coverage --forceExit`
Expected: ALL PASS (existing ~4800+ tests plus ~50 new concurrency tests)

- [ ] **Step 4: Run TypeScript compilation check**

Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Expected: rc=0

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/unit/concurrency/regression-guard.test.ts
git commit -m "test(gateway): add CI regression guard for unified concurrency primitives

Prevents index.ts from regressing to handwritten inflight Maps,
boolean mutexes, or promise chains."
```

---

## Post-Plan Verification

After all tasks complete:

1. `gateway/src/concurrency/` exists with 6 files (5 primitives + index)
2. `gateway/tests/unit/concurrency/` exists with 6 test files
3. `index.ts` no longer has `snapshotBuildInFlight` boolean or `managerSessionInflight` Map
4. `recall/ttl-map.ts` is a re-export from `concurrency/ttl-map.ts`
5. `recall/pipeline-guard.ts` is marked deprecated (still present, one cleanup cycle)
6. Full gateway test suite green
7. `tsc --noEmit` passes
8. CI guard test passes
