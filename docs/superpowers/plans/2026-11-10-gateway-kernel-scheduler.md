# Gateway Kernel Phase B: Unified Scheduler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `gateway/src/scheduler/` with a unified priority-based task scheduler (foreground / midground / background / idle; strategies skip / coalesce / defer-to-idle / queue; budget admission), migrate the automation engine and index.ts scheduling gates to consume it, and fix the automation-engine incoherent-copy bugs.

**Architecture:** A `Scheduler` class holds a priority queue + per-key mutex set + an injected budget checker. Foreground tasks execute immediately (never queued); everything else is drained by a pump in priority order with a concurrency cap. `AutomationEngine` becomes a client of the scheduler: every action execution is submitted as a background (cron/event) or foreground (user/LLM-triggered) task keyed `action:<type>`, replacing the per-handler `runPipelineGuarded` wrappers. The engine's action registry moves from a module-global Map to an instance-owned registry rebuilt at `start()`/`reloadRules()`.

**Tech Stack:** TypeScript (CJS), Jest (existing gateway test runner), no new dependencies. Builds on Phase A's `concurrency/` primitives (available on `main`).

**Spec:** `docs/superpowers/specs/2026-11-09-gateway-kernel-scheduler-design.md`

## Global Constraints

- No new npm dependencies.
- Zero runtime dependencies for `gateway/src/scheduler/` on index.ts or any service — pure module (like `concurrency/`).
- Type gate: `npx tsc --noEmit -p tsconfig.json` in `gateway/` (不带 `-p` 是假绿).
- Full suite: `npx jest --no-coverage --forceExit` (zeromq handles keep jest alive otherwise).
- **Do NOT commit another agent's uncommitted files** (pod/*, manager/lead-session-registry, runtime/opencode-adapter, session-liveness, gateway-sdk/types.ts, their tests). `git add` only the exact files each task lists. This was review finding C1 in Phase A.
- Work on branch `feat/gateway-kernel-scheduler` off `main`.
- The kernel specs + this plan are currently **untracked** — Task 5 commits them (Phase A merged without its docs; fix that here).
- Existing behavior parity: cron schedules/frequencies unchanged; skip-on-conflict semantics for cron actions preserved; snapshot queue semantics (Phase A) preserved (defer-to-idle adds an additional start-time condition only).

## Key Rulings (decisions the spec left open or ambiguous)

1. **Skip resolves via rejection, not null.** `submit` rejects with `TaskSkippedError` instead of resolving `null` (Phase A review minor M3: null conflation). Call sites catch the typed error. New API — no legacy constraint.
2. **defer-to-idle condition** = "no foreground task currently in flight" (`foregroundInFlight === 0`), evaluated at pump time. Not full event-loop idleness (not observable in Node).
3. **Boundary recall (100ms contract) is NOT routed through the scheduler** this phase — zero added latency on the most latency-sensitive path; fail-open there is already plugin-side. Consequence: until Phase C/D wire HTTP admission, defer-to-idle degenerates to queue semantics in production (unit tests still pin the semantics). The real foreground consumer in this phase is **user/LLM-triggered automation runs** (`executeAction` with source `'user'|'llm'` → foreground priority — an interactive caller is waiting).
4. **actionRegistry rebuild on reloadRules**: instance-owned registry + `refreshActions()` (clear + re-register builtins + re-run host provider). A bare `registerAction` after refresh writes the live map and IS visible immediately; the next `refreshActions()` wipes it unless re-registered via provider — the documented lifecycle contract.
5. **CI guard deviation from spec §7**: the literal repo-wide `grep inflight` cannot pass today — it hits `discovery-service.ts`, `core/goal/driver.ts` (variable names), and `lead-session-registry.ts` (another agent's active workstream). The guard instead pins *migrated files* against reintroducing handwritten gates (extends Phase A's `regression-guard.test.ts` pattern).
6. **Cron priority is global** (all actions background unless user/LLM-triggered), not per-rule — per-rule priority metadata is follow-up when rules gain a priority field.
7. **`/api/scheduler/stats` HTTP endpoint deferred** to Phase D diagnostics consolidation (route catalog → openapi → SDK contract overhead not worth it now); `scheduler.stats()` is public and tested.
8. **memory:prune incoherent copy also fixed** — spec §5.3 names `new HarmonicIndexManager` (L164/L209) but `memory:prune` L217 has the same bug class with `new CognitiveGraphManager` (the gateway's `MemoryService.cognitiveGraph` is the live instance that would clobber). Fix via `setGraphProvider`.
9. **Budget admission is additive** — pipelines keep their internal per-LLM-call `PipelineBudget.allow()` checks (finer-grained); the scheduler-level check is an admission gate that skips *starting* a pipeline when the daily cap is already blown. Names must match the internal `allow()` names exactly (`extract`/`reflect`/`review`/`reconsolidate`/`dream`/`axiomDistill` — found via grep, see Task 3).
10. **NodeDriver / RunCoordinator / SessionWorkerPool.runExclusive / PodEventWake are NOT migrated** (spec §4 non-goal: no NodeDriver state-machine refactor; the other agent is actively modifying pod-domain files). Spec §5.1's table rows for them are forward mappings. Phase B2 follow-up. **runExclusive specifically**: it is per-(session,kind) promise-dedup — a concurrency primitive already unified under `Singleflight` in Phase A, not a scheduling gate. Routing it through the global priority queue would *add* queueing delay under the concurrency cap that does not exist today (Singleflight executes immediately). The acceptance criterion's mention of it is satisfied by the Phase A unification; the regression guard (Phase A) already pins session-worker-pool to `../concurrency`.

## Review Focus

1. **Foreground starvation of defer-to-idle** — a defer-to-idle task must start once foreground drains (not be lost). Test: Task 1 test 10 (`defer-to-idle waits for foreground drain, then runs`).
2. **Timeout must measure execution, not queue wait** — a task queued behind a slow one must not burn its watchdog while waiting. Test: Task 1 test 16 (`timeout measures execution not queue wait`).
3. **Scheduler must not wedge on fn failure** — sync throw (Phase A I1) or async rejection must free the key and keep the queue draining. Tests: Task 1 tests 17–18.
4. **reloadRules while an action is in flight** — `refreshActions()` rebuilds the dispatch registry without disturbing the running task (whose handler closure is already captured). Test: Task 2 test 7.
5. **Budget admission double-check must not double-deny-log** — admission uses the exact internal pipeline name so `PipelineBudget`'s per-day deduped deny log stays single. Test: Task 3 wiring test (budget names asserted against the internal `allow()` names).

---

### Task 1: `scheduler/` module — TaskDescriptor + Scheduler + errors (TDD)

**Files:**
- Create: `gateway/src/scheduler/task-descriptor.ts`
- Create: `gateway/src/scheduler/scheduler.ts`
- Create: `gateway/src/scheduler/index.ts` (barrel)
- Test: `gateway/tests/unit/scheduler/scheduler.test.ts`

**Interfaces:**

`task-descriptor.ts`:
```ts
export type TaskPriority = 'foreground' | 'midground' | 'background' | 'idle';
export type SubmitStrategy = 'skip' | 'coalesce' | 'defer-to-idle' | 'queue';

export interface TaskBudget {
  /** Which budget system the injected checker consults. */
  kind: 'pipeline' | 'session' | 'pod';
  /** Pipeline name for kind:'pipeline' — MUST match the pipeline's internal
   *  PipelineBudget.allow() name (e.g. 'extract', 'reflect'). */
  pipeline?: string;
  /** Per-task turn cap (session budgets). Unused by the default checker. */
  maxTurns?: number;
  /** Per-task USD cap (session/pod budgets). Unused by the default checker. */
  maxCostUsd?: number;
}

export interface TaskDescriptor<T = unknown> {
  /** Diagnostic id; auto-generated (`task_<seq>`) when absent. */
  id?: string;
  priority: TaskPriority;
  strategy: SubmitStrategy;
  /** Same-key mutual exclusion. */
  mutexKey?: string;
  /** Watchdog: reject with TaskTimeoutError and free the key after this many
   *  ms of EXECUTION (queue wait does not count). Timer is unref'd. */
  timeoutMs?: number;
  budget?: TaskBudget;
}

export class TaskSkippedError extends Error {
  readonly code = 'task_skipped';
  constructor(key: string) { super(`task skipped: "${key}" already in use`); this.name = 'TaskSkippedError'; }
}
export class TaskTimeoutError extends Error {
  readonly code = 'task_timeout';
  constructor(id: string, timeoutMs: number) { super(`task "${id}" exceeded ${timeoutMs}ms`); this.name = 'TaskTimeoutError'; }
}
export class BudgetExceededError extends Error {
  readonly code = 'budget_exceeded';
  constructor(reason: string) { super(`budget exceeded: ${reason}`); this.name = 'BudgetExceededError'; }
}

export interface BudgetCheckResult { ok: boolean; reason?: string; }
export type BudgetChecker = (task: TaskDescriptor<any>) => BudgetCheckResult;

export interface SchedulerStats {
  queued: number;
  running: number;  // includes foreground
  byPriority: Record<TaskPriority, number>;  // QUEUED per priority, all four keys present
}

export interface SchedulerOpts {
  /** Max concurrently running non-foreground tasks. Default 4. */
  maxConcurrent?: number;
  /** Admission budget check at submit. Default: allow everything. */
  budgetChecker?: BudgetChecker;
  log?: (msg: string) => void;
}
```

`scheduler.ts`:
```ts
export class Scheduler {
  constructor(opts?: SchedulerOpts);
  submit<T>(task: TaskDescriptor<T>, fn: () => Promise<T>): Promise<T>;
  /** Pump the queue until nothing eligible; resolves immediately (does not
   *  wait for running tasks to complete). */
  sweep(): Promise<void>;
  stats(): SchedulerStats;
}
```

Semantics (implement exactly; tests pin each):
- **Budget first**: if `task.budget` and `budgetChecker` returns `{ok:false}` → reject `BudgetExceededError(reason)` before any queueing; fn never runs.
- **Foreground**: if `priority === 'foreground'` and `mutexKey` is not in use → execute immediately (never queued). If foreground + mutexKey in use → apply the task's strategy (skip → reject `TaskSkippedError`; coalesce → join; queue/defer-to-idle → enqueue at rank 0).
- **skip**: at submit, if `mutexKey` in use (running OR queued under that key) → reject `TaskSkippedError`. Without mutexKey, skip behaves as queue.
- **coalesce**: at submit, if a task with the same `mutexKey` is queued or running → return that task's promise (cast; namespaced-key discipline documented — same key different T is the caller's bug). After settle, the map entry is cleaned, so the next coalesce call starts a fresh run.
- **queue / defer-to-idle**: enqueue. defer-to-idle tasks are additionally ineligible at pump time while `foregroundInFlight > 0`.
- **Pump** (called on submit, on task settle, on foreground start/end): while `runningNonForeground < maxConcurrent`, scan the queue in priority rank order (foreground=0, midground=1, background=2, idle=3; FIFO by submission seq within a rank), pass over tasks that are mutex-blocked (key in use) or defer-blocked, and start the first eligible ones. Pass-over keeps queue position.
- **Settle**: resolve/reject the caller's promise, free the mutex key, clean coalesce entry, decrement counters, pump again.
- **Timeout**: timer starts when the task STARTS EXECUTING. On expiry: reject `TaskTimeoutError`, free the key (the abandoned fn keeps running in the background; its eventual settle is a no-op for the caller). `timer.unref?.()`.
- **Sync-throw defense** (Phase A I1 parity): `fn()` invoked inside try-catch; sync throw rejects and frees the key.

- [ ] **Step 1: Write the failing tests** — `gateway/tests/unit/scheduler/scheduler.test.ts`, ~20 tests:

```ts
import { Scheduler, TaskSkippedError, TaskTimeoutError, BudgetExceededError } from '../../../src/scheduler';

// Test list (each `it(...)`; use manually-resolved promises + maxConcurrent:1
// for deterministic ordering — no fake timers needed):
// 1.  foreground executes immediately and returns fn's value
// 2.  foreground + held mutexKey + strategy skip → rejects TaskSkippedError
// 3.  budget exceeded → rejects BudgetExceededError, fn never called
// 4.  skip on running same key → rejects TaskSkippedError, fn not run
// 5.  skip on queued same key (key blocked by concurrency cap, not running) → rejects
// 6.  coalesce joins in-flight run: fn called once, both callers get same result
// 7.  coalesce joins queued run (cap-blocked): fn called once, both resolve
// 8.  coalesce after completion starts a NEW run (no stale join)
// 9.  queue strategy: same-key tasks run FIFO
// 10. defer-to-idle waits for foreground drain, then runs
// 11. defer-to-idle with no foreground ever in flight runs like queue
// 12. priority order: with cap 1 + a blocker, later-submitted midground runs
//     before earlier background before idle (completion order pinned)
// 13. maxConcurrent caps concurrent non-foreground (5 submits, cap 2 → at most 2 running)
// 14. mutex-blocked task passes over; different-key task proceeds
// 15. timeout: rejects TaskTimeoutError, key freed (next same-key submit runs),
//     original fn's late completion does not throw unhandled
// 16. timeout measures execution not queue wait (queued task with tiny
//     timeoutMs behind a slow task gets its full window once started)
// 17. sync-throw in fn → rejects, key freed, next same-key task runs
// 18. async rejection: later queued tasks still run (pump survives)
// 19. stats(): { queued, running, byPriority{all four keys} } — pin exact shape
//     (3 queued background + 1 running → { queued: 3, running: 1, byPriority: {foreground:0, midground:0, background:3, idle:0} })
// 20. sweep() drains the queue (all started; running may continue)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/scheduler/ --no-coverage` in `gateway/`
Expected: FAIL — cannot find module `../../../src/scheduler`

- [ ] **Step 3: Implement `task-descriptor.ts`, `scheduler.ts`, `index.ts`**

`index.ts` barrel exports: `TaskPriority`, `SubmitStrategy`, `TaskBudget`, `TaskDescriptor`, `TaskSkippedError`, `TaskTimeoutError`, `BudgetExceededError`, `BudgetCheckResult`, `BudgetChecker`, `SchedulerStats`, `SchedulerOpts`, `Scheduler`.

Internal state: `queue: QueuedTask[]` (scan-in-rank-order each pump — array stays small), `held: Set<string>`, `keyTask: Map<string, Promise<unknown>>` (coalesce), `foregroundInFlight: number`, `runningNonForeground: number`, `seq` counter. Enqueue sorts naturally by (rank, seq) via linear scan at pick time. `keyInUse(key)` = `held.has(key) || queue.some(t => t.descriptor.mutexKey === key)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/scheduler/ --no-coverage`
Expected: PASS (20/20)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/scheduler/ gateway/tests/unit/scheduler/
git commit -m "feat(gateway): add unified scheduler (priority queue + strategies + budget admission)"
```

---

### Task 2: AutomationEngine — instance action registry, live instances, scheduler submission

**Files:**
- Modify: `gateway/src/automation-engine.ts`
- Modify: `gateway/tests/unit/memory-decay.test.ts` (6 `actionRegistry.get` call sites)
- Test: `gateway/tests/unit/automation-engine.test.ts` (new)

**Interfaces:**
- Consumes: `Scheduler`, `TaskDescriptor`, `TaskSkippedError`, `TaskTimeoutError`, `TaskBudget` from `./scheduler` (Task 1).
- Produces (used by Task 3):
  - `registerAction(type: string, handler: ActionHandler, taskOpts?: { budget?: TaskBudget; timeoutMs?: number }): void`
  - `getAction(type: string): ActionHandler | undefined`
  - `hasAction(type: string): boolean`
  - `setActionsProvider(fn: () => void): void`
  - `refreshActions(): void` — clear + builtins + provider
  - `setGraphProvider(fn: () => CognitiveGraphManager | undefined): void` / `getGraphManager()`
  - `setScheduler(s: Scheduler): void`
  - `executeAction(actionType: string, rule: AutomationRule, source?: 'cron' | 'event' | 'user' | 'llm'): Promise<void>`
  - module exports `actionRegistry`, `unregisterAction`, `resetActionRegistry` — **DELETED**

- [ ] **Step 1: Write the failing tests** — `gateway/tests/unit/automation-engine.test.ts`:

Private methods may be accessed via `(engine as any)` (Phase A test precedent). Tests that need rule dispatch can also load a rule JSON into `<tmp>/automations/` and call `executeRule`, but direct `executeAction` access is simpler:

```ts
// Test list:
// 1.  constructor registers builtin actions (getAction('memory:decay'|'memory:review'|'memory:prune') defined)
// 2.  refreshActions rebuilds: provider-registered action survives refresh;
//     a bare registerAction (not via provider) is wiped by the next refreshActions
// 3.  executeAction dispatch (engine WITHOUT scheduler): registered handler invoked with (rule, engine)
// 4.  executeAction WITH scheduler + slow handler: two concurrent executeAction calls →
//     handler called exactly once (second rejects TaskSkippedError internally), both resolve
// 5.  executeAction WITH scheduler + taskOpts.timeoutMs tiny + never-resolving handler:
//     executeAction resolves, handler's completion flag flips later (timeout warn path)
// 6.  executeAction submits user/llm source as foreground: defer-to-idle task queued on the
//     same scheduler does not start until the user-triggered action settles
// 7.  refreshActions during an in-flight action: running handler unaffected (completion flag still flips)
// 8.  memory:decay without index provider → returns without error, energy unchanged
//     (write v2 index file, run handler, energy identical)
// 9.  memory:prune without graph provider → returns without error
// 10. engine action timeout/budget defaults: registering with taskOpts {budget} passes it through —
//     observed via a BudgetExceededError rejection surfaced through executeAction (scheduler with denying checker)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/automation-engine.test.ts --no-coverage`
Expected: FAIL — `getAction` / `refreshActions` / `setGraphProvider` do not exist; `actionRegistry` import still works (old API) so import errors appear only after the refactor — write the tests against the NEW API so they fail to compile first, then the refactor makes them pass.

- [ ] **Step 3: Implement the engine refactor in `gateway/src/automation-engine.ts`**

- Delete module-global `actionRegistry` / `unregisterAction` / `resetActionRegistry`.
- Add instance `actions = new Map<string, { handler: ActionHandler; taskOpts?: {...} }>()`; constructor calls `this.registerBuiltinActions()`.
- Move the three module-level `actionRegistry.set(...)` builtin registrations into `private registerBuiltinActions()`:
  - `memory:decay`: `const indexManager = this.getLiveIndexManager(); if (!indexManager) { log.warn('[AutomationEngine] memory:decay skipped: no live index manager injected'); return; }` — **no `new HarmonicIndexManager` fallback** (spec §5.3).
  - `memory:review` stub: same live-instance discipline via `getLiveIndexManager()`; warn + return when absent.
  - `memory:prune`: `const graph = this.getGraphManager(); if (!graph) { log.warn(...); return; }` — **no `new CognitiveGraphManager`**. Remove the `CognitiveGraphManager` value import (keep type import only if needed for the provider signature).
- `executeAction(actionType, rule, source?)`: look up `this.actions`; submit through `this._scheduler` when set with descriptor `{ id: 'automation:' + actionType + ':' + Date.now(), priority: (source === 'user' || source === 'llm') ? 'foreground' : 'background', mutexKey: 'action:' + actionType, strategy: 'skip', timeoutMs: taskOpts?.timeoutMs ?? 30 * 60_000, budget: taskOpts?.budget }`; catch `TaskSkippedError` → `log.info('[AutomationEngine] <type> skipped: previous run still in flight')`; catch `TaskTimeoutError` → `log.warn('[AutomationEngine] <type> watchdog timeout — run continues in background')`; other errors → `log.error` (existing message format). Without scheduler: call handler directly (standalone/test compat). **Note the deliberate improvement**: the three builtins (decay/review/prune) previously ran unguarded; they now get the same per-key skip + 30min watchdog as the index.ts-registered actions.
- `executeRule` (L494) and `runRuleFromLLM` (L690) pass their source through to `executeAction` (runRuleFromLLM passes `'llm'`).
- `start()` calls `this.refreshActions()` before scheduling rules; `reloadRules()` calls `this.refreshActions()` after `loadRules()` (spec §5.4).
- `validateRule` L752: `actionRegistry.has(...)` → `this.hasAction(...)`.
- Drive-by: `stop()` L382 logs `this.jobs.size` after the delete loop — always 0; capture the count before the loop.

- [ ] **Step 4: Update `gateway/tests/unit/memory-decay.test.ts`**

Replace all 6 `actionRegistry.get('memory:decay')` sites with an engine helper:

```ts
import { AutomationEngine } from '../../src/automation-engine';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';

function makeEngine(dir: string): AutomationEngine {
  const engine = new AutomationEngine(dir);
  const live = new HarmonicIndexManager(dir);   // the test's own "live" instance
  engine.setIndexManagerProvider(() => live);
  return engine;
}
// const action = makeEngine(tmpDir).getAction('memory:decay');
```

The handler signature `(rule, engine)` is unchanged. Remove the `actionRegistry` import.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/unit/automation-engine.test.ts tests/unit/memory-decay.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: Typecheck + targeted regression**

Run: `npx tsc --noEmit -p tsconfig.json` then `npx jest tests/unit/harmonic-index-energy-batch.test.ts tests/unit/graph/d5-ppr-catd.test.ts --no-coverage`
Expected: tsc clean (grep `actionRegistry` in `src/` → only `plugins/package-host.ts`'s unrelated `PluginActionRegistry` remains); both suites pass.

- [ ] **Step 7: Commit**

```bash
git add gateway/src/automation-engine.ts gateway/tests/unit/automation-engine.test.ts gateway/tests/unit/memory-decay.test.ts
git commit -m "refactor(gateway): instance-owned action registry + scheduler submission in AutomationEngine"
```

---

### Task 3: index.ts pipeline migration — engine wiring + budget admission

**Files:**
- Modify: `gateway/src/index.ts` (scheduler field; engine wiring; registerMemoryPipelineActions refactor; delete runPipelineGuarded/pipelineGuard)
- Test: source-pattern assertions added to `gateway/tests/unit/concurrency/regression-guard.test.ts`

**Interfaces:**
- Consumes: `Scheduler`, `SchedulerOpts` (Task 1); `registerAction`/`setActionsProvider`/`setScheduler`/`setGraphProvider` (Task 2).
- Produces: `private scheduler: Scheduler` on the gateway class (Task 4 consumes for snapshot).

Pipeline-name map for budget admission (verified against internal `allow()` calls — grep `budget.allow` in `gateway/src/`):
- `memory:turnCompress` → `'extract'` (turn-pipeline.ts L290)
- `memory:reflect` → `'reflect'` (reflection.ts L451; grace-revisit also uses 'reflect')
- `memory:review` → `'review'` (stale-verify.ts L91)
- `memory:reconsolidate` → `'reconsolidate'` (reconsolidate-pipeline.ts L48)
- `memory:dream` → `'dream'` (index.ts L3571)
- `memory:axiomDistill` → `'axiomDistill'` (index.ts L3608)
- `memory:skillPromotion` → no budget (no internal check)
- `memory:decay` → no budget (builtin, non-LLM)

- [ ] **Step 1: Write the failing source-pattern tests** — extend `gateway/tests/unit/concurrency/regression-guard.test.ts`:

```ts
// New assertions:
// - index.ts contains `new Scheduler(` and imports from './scheduler/'
// - index.ts does NOT contain: `runPipelineGuarded`, `pipelineGuard`,
//   `actionRegistry.set`, `import { ... actionRegistry ... } from "./automation-engine"`
// - index.ts contains `setActionsProvider`, `setScheduler`, `setGraphProvider`, `registerAction(`
// - index.ts registers budgets with the exact internal pipeline names: for each of
//   ['extract','reflect','review','reconsolidate','dream','axiomDistill'] expect
//   /pipeline:\s*'<name>'/ to appear in a registerAction taskOpts near that action
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/unit/concurrency/regression-guard.test.ts --no-coverage`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement in `gateway/src/index.ts`**

- Add field + import: `private scheduler = new Scheduler({ budgetChecker: (task) => { const b = task.budget; if (b?.kind === 'pipeline' && b.pipeline) { return { ok: this.getPipelineBudget().allow(b.pipeline), reason: 'pipeline daily cap' }; } return { ok: true }; } });`
- In `initServices` next to the existing `setIndexManagerProvider` (L4857): add `this.automationEngine.setScheduler(this.scheduler);` and `this.automationEngine.setGraphProvider(() => this.memoryService?.cognitiveGraph);`
- Refactor `registerMemoryPipelineActions()` (L3387): wrap the 7 registrations in `engine.setActionsProvider(() => { ... })`; each becomes `engine.registerAction('memory:turnCompress', async () => { /* inner body only */ }, { budget: { kind: 'pipeline', pipeline: 'extract' } });` etc. per the map above (skillPromotion without taskOpts). **Strip every `await this.runPipelineGuarded(name, async () => {...})` wrapper — keep the inner body, heartbeat records, and logs.**
- Delete `private pipelineGuard = new Guard();` and the whole `runPipelineGuarded` method (L3302-ish; grep to locate). Remove `Guard`/`GuardTimeoutError` imports only if no other use remains (snapshotGuard still uses Guard until Task 4 — keep the import, remove in Task 4).
- Verify: `git grep -n "runPipelineGuarded" gateway/src` → 0 hits.

- [ ] **Step 4: Typecheck + run affected suites**

Run: `npx tsc --noEmit -p tsconfig.json` then `npx jest tests/unit/concurrency/ tests/unit/scheduler/ tests/unit/automation-engine.test.ts --no-coverage`
Expected: tsc clean; suites green.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/tests/unit/concurrency/regression-guard.test.ts
git commit -m "refactor(gateway): route cron pipeline actions through unified scheduler with budget admission"
```

---

### Task 4: Snapshot migration (defer-to-idle) + guard extension

**Files:**
- Modify: `gateway/src/index.ts` (refreshSnapshot; delete snapshotGuard)
- Modify: `gateway/tests/unit/concurrency/snapshot-queue.test.ts` (re-pin at scheduler layer)
- Modify: `gateway/tests/unit/concurrency/regression-guard.test.ts` (snapshot patterns)

**Interfaces:**
- Consumes: `this.scheduler` (Task 3); `TaskTimeoutError` if a timeout is added (not added — parity with Phase A: snapshotGuard had no watchdog).

- [ ] **Step 1: Rewrite `gateway/tests/unit/concurrency/snapshot-queue.test.ts` against the Scheduler**

Header comment updates: "pins the scheduler defer-to-idle + same-key queue semantics that refreshSnapshot now relies on". Same two test bodies, but through `new Scheduler()` with the exact descriptor refreshSnapshot uses: `{ priority: 'midground', mutexKey: 'snapshot', strategy: 'defer-to-idle' }` — second/multiple build requests queue (not drop) and run sequentially; add a third test: a queued snapshot build does not start while a foreground task is in flight (defer-to-idle), and starts after it settles.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/unit/concurrency/snapshot-queue.test.ts --no-coverage`
Expected: still PASS (it pins scheduler semantics that already exist — this is a re-pin, not RED). The RED comes from the guard test below.

Extend `regression-guard.test.ts`: index.ts must NOT contain `snapshotGuard = new Guard` / `snapshotGuard.run`; must contain `strategy: 'defer-to-idle'`. Run → FAIL (index still has snapshotGuard).

- [ ] **Step 3: Implement in `gateway/src/index.ts`**

```ts
private async refreshSnapshot(sessionID: string): Promise<void> {
  if (!this.memoryService) return;
  // One build at a time (shared GPU sidecars); queued builds additionally defer
  // until no foreground task is in flight (midground + defer-to-idle).
  await this.scheduler.submit(
    { id: `snapshot:${sessionID}`, priority: 'midground', mutexKey: 'snapshot', strategy: 'defer-to-idle' },
    () => this.refreshSnapshotInner(sessionID),
  );
}
```
Delete `private snapshotGuard = new Guard();` and remove the `Guard` import if now unused (grep `new Guard\|GuardTimeoutError` in index.ts → expect 0). The existing `.catch(() => {})` at the call site (L3034) stays — fn errors must stay fail-open.

- [ ] **Step 4: Typecheck + run**

Run: `npx tsc --noEmit -p tsconfig.json` then `npx jest tests/unit/concurrency/ tests/unit/scheduler/ --no-coverage`
Expected: clean + green.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/tests/unit/concurrency/snapshot-queue.test.ts gateway/tests/unit/concurrency/regression-guard.test.ts
git commit -m "refactor(gateway): snapshot builds submit to scheduler as midground defer-to-idle"
```

---

### Task 5: Docs + spec commits + full-suite verification

**Files:**
- Modify: `docs/architecture/gateway.md` (scheduler 现状段)
- Create: commit of the 5 untracked kernel specs + this plan
- Modify: `docs/superpowers/specs/2026-11-09-gateway-kernel-scheduler-design.md` (status 待批准 → 已实施, add Implementation Notes for the rulings)

**Interfaces:** none — documentation and verification only.

- [ ] **Step 1: Update `docs/architecture/gateway.md`**

Add a scheduler section to the 现状 description: module map (`gateway/src/scheduler/`), the four priorities + four strategies, budget admission (kind:'pipeline' only, names must match internal `allow()`), AutomationEngine integration (action registry lifecycle: builtins + provider, refresh on start/reloadRules; user/LLM-triggered → foreground), snapshot defer-to-idle, what is NOT yet migrated (NodeDriver / RunCoordinator / SessionWorkerPool / PodEventWake / boundary recall — Phase B2), and the foreground-channel note (100ms path stays outside the scheduler).

- [ ] **Step 2: Commit specs + plan + doc updates**

```bash
git add docs/superpowers/specs/2026-11-09-gateway-kernel-*.md docs/superpowers/plans/2026-11-09-gateway-kernel-concurrency.md docs/superpowers/plans/2026-11-10-gateway-kernel-scheduler.md docs/architecture/gateway.md
git commit -m "docs: kernel refactor specs + Phase A/B plans (untracked since Phase A merge)"
```

- [ ] **Step 3: Full verification on committed state**

The other agent's uncommitted files must be stashed for this to reflect the committed tree:

Run: `git stash` → `npx tsc --noEmit -p tsconfig.json` → `npx jest --no-coverage --forceExit` → `git stash pop`
Expected: tsc clean; full suite green except pre-existing failures unrelated to this work (pod-worktree / serve-supervisor / laya flakiness — same set Phase A documented). Record exact counts.

- [ ] **Step 4: Final commit if the stash-pop reveals nothing to fix**

Ledger: `.superpowers/sdd/2026-11-10-gateway-kernel-scheduler/progress.md` — create with task-by-task results (commits, test counts, rulings).
