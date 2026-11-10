# Gateway Kernel Phase C: Unified Session Registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `gateway/src/session/` — one process table (`SessionRegistry`) answering "sessionID → ownership / status / TTL" — and migrate the gateway-owned session registries to consume it as views, with a unified sweeper.

**Architecture:** One `SessionRecord` per sessionID. Views are either **record owners** (they own the record's lifetime: SessionWorkerPool kind 'worker' with TTL; LeadSessionRegistry kind 'lead'; PodSessionSupervisor kind 'goal'-scoped mirrors) or **metadata overlays** (internalSessionRoles = `metadata.role`; workerOrigin = `metadata.originSessionID`). The registry supports per-record `onEvict` (replaces the pool's TtlMap eviction) plus lazy expiry (lookup returns status 'ended' until swept). A module-level default instance (`getDefaultSessionRegistry()`) is shared by cross-module views; tests construct isolated instances.

**Tech Stack:** TypeScript (CJS), Jest, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-09-gateway-kernel-session-registry-design.md`

## Global Constraints

- No new npm dependencies.
- Type gate: `npx tsc --noEmit -p tsconfig.json` in `gateway/`.
- Full suite: `npx jest --no-coverage --forceExit`.
- Do NOT commit another agent's uncommitted files; explicit `git add` lists only.
- Branch: `feat/gateway-kernel-session-registry` off `main` (after B2 merges).
- **Behavior parity**: every view migration is behavior-equivalent except where a leak fix is explicitly pinned by test (worker-role lifetime now bounded by the worker record's TTL — see Task 4).
- The other agent's pod/lead files are currently stable (their workstream moved to SDK contract files); if they touch `lead-session-registry.ts` / `pod-session-supervisor.ts` mid-flight, rebase carefully.

## Key Rulings (spec §8 + stale inventory corrections)

1. **PiSessionRegistry EXCLUDED.** The spec's §2 inventory lists it at `runtime/pi/pi-session.ts`, but the neutral-runtime-driver work moved pi sessions into `adapters/pi/src/pi-session.ts` — outside `gateway/src`. Coupling the gateway registry to adapter-internal state would run against the driver architecture (adapter owns its runtime's session lifecycle). Gateway process table covers gateway-owned state only. Cost if wrong: pi sessions stay invisible to gateway lookup (acceptable — they're the adapter's business).
2. **eventTaps / probeScopes TTL: already done in Phase A** (TtlMap migration). Acceptance criterion #2 is pre-satisfied; no task needed.
3. **metadata typing: `Record<string, unknown>`** (spec §8 option A). Views cast at their boundary with local type guards. No generics on the registry.
4. **kv persistence scope: internalSessionRoles only** (its existing dual-write stays). No new persistence for other views. Cost if wrong: other views lose nothing they had (they were in-memory).
5. **PodSessionSupervisor: observe-only mirror** (spec's own call). Its lease logic (unique-index fallback / single-flight / conflict attribution) is untouched; ensure/retire write mirror records.
6. **CI guard deviation (same class as Phase B ruling 5):** the spec's literal `grep "new Map.*[Ss]ession"` over `gateway/src/` hits non-registry activity bookkeeping that legitimately stays (`busySessions`, `recallCalledBySession`, driver mutex). The guard pins the MIGRATED files against re-introducing bare Maps instead.
7. **Not migrated (stays with rulings):** `busySessions` (activity timestamps, 15min sweep — not ownership), `recallCalledBySession` (bounded 500 self-trim), memory-worker `compactIdleMs` (policy check at prompt time, not TTL eviction), `sweepBusyAndQueue` (keeps its 60s interval; the unified sweeper is a separate interval — see Task 7).
8. **Generation semantics:** register over an existing in-table record with status 'ended' → generation = prev + 1; register over an 'active' record → in-place update (scope may be replaced — new owner takes the record; keep generation); register after the record was swept/unregistered → generation = retiredGenerations.get(sid) + 1 (a bounded map, FIFO-trimmed at 10k, preserves the spec's "retire → rebuild → +1" across sweeps); first registration → generation 1.

## Review Focus

1. **Worker-role lifetime coupling** — after the pool migration, a swept worker record removes its `metadata.role`; sessions visibility must not regress for LIVE workers. Test: Task 4 pins role readable while record active.
2. **Pair disposal exactly-once** — registry sweep + explicit unregister + disposeAll must not double-dispose a WorkerPair (idempotency pinned by test).
3. **TTL refresh semantics** — `touch()` refreshes `expiresAt` (matches the pool's TtlMap reset-on-use); an idle 24h worker is evicted by the NEXT sweep, not by lookup alone. Test: Task 1 + Task 4.
4. **Single-record rule under concurrent views** — a session registered by two views (pool + role overlay) stays ONE record; the overlay never orphans the owner's pair. Test: Task 4.
5. **Registry sweep must not evict TTL-less records** (lead/pod mirrors have no TTL). Test: Task 1.

---

### Task 1: `session/` module — scope + registry (TDD)

**Files:**
- Create: `gateway/src/session/scope.ts`
- Create: `gateway/src/session/registry.ts`
- Create: `gateway/src/session/index.ts` (barrel + default instance)
- Test: `gateway/tests/unit/session/registry.test.ts`

**Interfaces:**

`scope.ts`:
```ts
export interface SessionScope {
  kind: 'project' | 'goal' | 'probe' | 'worker' | 'lead' | 'internal';
  projectId?: string;
  goalId?: string;
  revision?: number;
  podId?: string;
  memberId?: string;
  role?: string;
}
```

`registry.ts`:
```ts
export type SessionStatus = 'active' | 'idle' | 'ended';

export interface SessionRecord {
  sessionID: string;
  scope: SessionScope;
  status: SessionStatus;          // 'ended' materialized lazily on expiry
  runtimeName?: string;
  generation: number;
  createdAt: number;
  lastActiveAt: number;
  ttlMs: number | null;           // null = never expires
  expiresAt: number | null;
  metadata: Record<string, unknown>;
}

export interface RegisterInput {
  sessionID: string;
  scope: SessionScope;
  metadata?: Record<string, unknown>;
  ttlMs?: number | null;          // undefined/null → no expiry
  runtimeName?: string;
  /** Per-record eviction callback (fires from sweep() only — NOT from unregister). */
  onEvict?: (record: SessionRecord) => void;
}

export interface SessionRegistryOpts {
  now?: () => number;
  log?: (msg: string) => void;
}

export class SessionRegistry {
  constructor(opts?: SessionRegistryOpts);
  register(input: RegisterInput): SessionRecord;   // upsert per Key Ruling 8
  unregister(sessionID: string): boolean;          // silent (no onEvict)
  touch(sessionID: string): boolean;               // refresh lastActiveAt + expiresAt
  lookup(sessionID: string): SessionRecord | null; // null after unregister/sweep; 'ended' copy if expired
  byScope(scope: Partial<SessionScope>): SessionRecord[];  // ACTIVE records only (expired excluded)
  sweep(): number;                                  // expired → collect + onEvict
  updateMetadata(sessionID: string, patch: Record<string, unknown>): boolean;  // merges
  size(): { active: number; ended: number };
}
```

`index.ts`: re-exports + `getDefaultSessionRegistry(): SessionRegistry` (lazy module singleton).

- [ ] **Step 1: Write the failing tests** (~16):

```ts
// 1.  register → lookup returns the record (status 'active', generation 1)
// 2.  single-record rule: re-register same sid (active) → one record, scope replaced,
//     generation kept, metadata merged
// 3.  register over 'ended' record → generation +1, status back to 'active'
// 4.  register after sweep → generation = retired+1 (Key Ruling 8's bounded map)
// 5.  unregister → lookup null; re-register → generation continues
// 6.  TTL: register with ttlMs → after expiry (now() stub advanced) lookup returns
//     status 'ended' (lazy) — record still in table (size().ended === 1)
// 7.  sweep() collects expired, fires per-record onEvict with the ended record,
//     returns count; lookup null afterwards
// 8.  sweep() does NOT evict TTL-less (ttlMs null) records
// 9.  touch() refreshes expiresAt (record with ttlMs survives past original expiry
//     after touch) and lastActiveAt
// 10. byScope matches on provided fields only; excludes expired; includes records
//     from other kinds when partial is just {kind}
// 11. byScope({kind:'goal', goalId:'g', revision:2}) — revision participates
// 12. updateMetadata merges patch into existing record; false for unknown sid
// 13. size(): active/ended counts
// 14. unregister does NOT fire onEvict (dispose is sweep-only; explicit paths own it)
// 15. register with metadata → defaults {} when absent
// 16. retiredGenerations bounded: >10k distinct sids cycled → oldest trimmed (spot check:
//     first sid's generation restarts at 1)
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/unit/session/ --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — pure module, `now()` injectable (tests advance via a mutable stub). `lookup` returns a **copy** with status materialized (callers must not mutate table state). `sweep()` iterates all records; expired → per-record onEvict → delete → stash retiredGeneration. FIFO trim `retiredGenerations` at 10k.

- [ ] **Step 4: Run to verify pass** — Expected: 16/16 PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/session/ gateway/tests/unit/session/
git commit -m "feat(gateway): add unified session registry (process table + scopes + TTL sweep)"
```

---

### Task 2: internalSessionRoles view (index.ts)

**Files:**
- Create: `gateway/src/session/views/internal-roles.ts`
- Modify: `gateway/src/index.ts` (~L546 declaration + call sites L595/1843/2468/2474/3614/4118/4132/5011/5017-5018/5287)
- Test: `gateway/tests/unit/session/internal-roles-view.test.ts`

**Interfaces:**
- Consumes: `SessionRegistry` (Task 1).
- Produces: `class InternalRolesView { get(sid): string | undefined; has(sid): boolean; set(sid, role): void; delete(sid): boolean }` — drop-in for the Map<string, string> surface index.ts uses. Lives in the gateway class as the replacement for the `internalSessionRoles` field; kv dual-write code at the register/unregister methods stays untouched.

- [ ] **Step 1: Write the failing tests** (~6):

```ts
// 1. set → get returns the role (record kind 'internal', scope.role set)
// 2. set on an existing record of another kind (e.g. kind 'worker') → patches
//    scope.role/metadata in place — the record keeps its owner's TTL and metadata
// 3. has → true only when role present
// 4. delete on an internally-owned record → unregisters it; get → undefined
// 5. delete on a foreign-owned record (kind 'worker' with TTL) → clears the role,
//    record SURVIVES (owner keeps lifetime — pinned by Review Focus 4)
// 6. get for unknown sid → undefined
```

- [ ] **Step 2: Run to verify they fail** (module not found).

- [ ] **Step 3: Implement** — view holds the registry reference; `set` = register-or-patch (scope.role + metadata.role); `get` = lookup → role from scope/metadata (only when the view set it — track ownership via `metadata.roleOwner === 'internal-roles'` or scope.kind === 'internal'); `delete` per test 4/5 semantics.

- [ ] **Step 4: index.ts wiring** — `private sessionRegistry = new SessionRegistry()` field; `private internalSessionRoles = new InternalRolesView(this.sessionRegistry)` (mind field-initializer order — construct in the field list, sessionRegistry first). The 10+ call sites keep their `.get/.has/.set/.delete` syntax (view is drop-in). kv dual-write untouched.

- [ ] **Step 5: Run** — `npx jest tests/unit/session/ tests/unit/session-visibility.test.ts --no-coverage` + tsc. Expected: PASS (session-visibility consumes isInternalSession).

- [ ] **Step 6: Commit**

```bash
git add gateway/src/session/views/internal-roles.ts gateway/src/index.ts gateway/tests/unit/session/internal-roles-view.test.ts
git commit -m "refactor(gateway): internalSessionRoles consumes the session registry"
```

---

### Task 3: worker-origin view

**Files:**
- Create: `gateway/src/session/views/worker-origin.ts`
- Modify: `gateway/src/recall/worker-origin.ts` (module functions delegate)
- Test: `gateway/tests/unit/session/worker-origin-view.test.ts`

**Interfaces:**
- Consumes: `getDefaultSessionRegistry()` (module singleton — the pool's records live there too, see Task 4).
- Produces: same function signatures (`registerWorkerOrigin`, `resolveWorkerOrigin`, `clearWorkerOrigins`) — callers (session-worker-pool, index.ts `/api/memory/add` rewrite) unchanged.

- [ ] **Step 1: Write the failing tests** (~4):

```ts
// 1. register → resolve returns origin (patches metadata.originSessionID on the
//    record if present; creates kind 'worker' TTL-less record if absent)
// 2. resolve for unknown sid → null
// 3. clear → resolve null afterwards (clears the view's metadata only)
// 4. register for a sid already owning a record with TTL → TTL preserved
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** — `registerWorkerOrigin` = updateMetadata-or-register; `resolveWorkerOrigin` = lookup?.metadata.originSessionID ?? null; `clearWorkerOrigins` = iterate byScope({kind:'worker'}) clearing originSessionID (and unregistering view-created TTL-less records — track creation via metadata flag).

- [ ] **Step 4: Run** — `npx jest tests/unit/session/ --no-coverage` + tsc. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/session/views/worker-origin.ts gateway/src/recall/worker-origin.ts gateway/tests/unit/session/worker-origin-view.test.ts
git commit -m "refactor(gateway): worker-origin map consumes the session registry"
```

---

### Task 4: SessionWorkerPool — records own the pool

**Files:**
- Modify: `gateway/src/recall/session-worker-pool.ts`
- Test: `gateway/tests/unit/session/worker-pool-registry.test.ts` (new; existing pool tests must stay green)

**Interfaces:**
- Consumes: `SessionRegistry` (injected via deps: `registry: SessionRegistry`; tests pass an isolated instance; production wiring passes the gateway's).
- Produces: same public surface (`getWorker`, `runExclusive`, `isRunning`, `size`, `disposeAll`). The internal `TtlMap` + `creationOrder` are REPLACED by registry records (metadata: `{ pair, kind, label, originSessionID? }`, ttlMs = existing `opts.ttlMs`, refreshed on get via `touch`).

- [ ] **Step 1: Write the failing tests** (~6):

```ts
// 1. getWorker creates a record (kind 'worker', scope.role = worker kind) — pair
//    retrievable via getWorker again (touch refreshes TTL)
// 2. expired worker: advance now past ttl → sweep() → per-record onEvict disposes
//    the pair exactly once (dispose flag counter pinned — Review Focus 2)
// 3. getWorker after expiry+recreation → new pair, generation +1
// 4. overflow: >maxSessions records → oldest (createdAt) evicted first (disposes)
// 5. role overlay coexistence: registerWorkerOrigin + internal-role patch on a live
//    worker record — record still one, pair intact (Review Focus 4)
// 6. disposeAll: disposes every pair, unregisters all worker records, no onEvict
//    double-fire (explicit path)
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** — pool deps gain `registry`; entries logic rewrites to register/lookup/touch/sweep; overflow eviction via byScope sorted by createdAt; `runExclusive` stays on `Singleflight` (Phase A — unchanged). The old TtlMap import removed.

- [ ] **Step 4: Run** — `npx jest tests/unit/recall/ tests/unit/session/ --no-coverage` + tsc. Expected: PASS (existing pool tests + new).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/session-worker-pool.ts gateway/tests/unit/session/worker-pool-registry.test.ts
git commit -m "refactor(gateway): SessionWorkerPool entries live in the session registry (TtlMap retired)"
```

---

### Task 5: LeadSessionRegistry mirror

**Files:**
- Modify: `gateway/src/core/manager/lead-session-registry.ts`
- Modify: `gateway/src/index.ts` (wire the registry dep)
- Test: `gateway/tests/unit/session/lead-mirror.test.ts`

**Interfaces:**
- Consumes: `SessionRegistry` via optional dep `sessionRegistry?: SessionRegistry` in `LeadSessionRegistryDeps` — mirror only; all existing logic (kv rows, liveness, snapshot/retire, conflict errors) untouched.
- Produces: no new public API. Side effect: bind/ensure/archive write/unregister registry records (kind 'lead', scope.projectId, metadata.podId, runtimeName).

- [ ] **Step 1: Write the failing tests** (~4):

```ts
// 1. ensure → registry has kind 'lead' record with projectId
// 2. archive (snapshot/retire path) → record unregistered (or ended)
// 3. mirror absent (no dep) → everything works as before (existing tests prove this)
// 4. two projects → two records; byScope({kind:'lead', projectId}) isolates them
```

- [ ] **Step 2–4: RED → implement → GREEN** — hook the mirror at the same places the kv rows are written (bindLead / archive paths). Existing lead-session tests must stay green (they construct deps without the registry).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/manager/lead-session-registry.ts gateway/src/index.ts gateway/tests/unit/session/lead-mirror.test.ts
git commit -m "feat(gateway): LeadSessionRegistry mirrors bindings into the session registry"
```

---

### Task 6: PodSessionSupervisor observe-sync

**Files:**
- Modify: `gateway/src/core/pod/pod-session-supervisor.ts`
- Modify: `gateway/src/index.ts` (wire the dep)
- Test: `gateway/tests/unit/session/pod-mirror.test.ts`

**Interfaces:**
- Consumes: optional `sessionRegistry?: SessionRegistry` dep. Lease logic untouched (Key Ruling 5).
- Produces: mirror records on ensure (kind 'goal', scope {podId, memberId, goalId, revision}, metadata {leaseKind, runtime, generation}) and unregister on retire. Snapshot-retire also unregisters.

- [ ] **Step 1: Write the failing tests** (~4):

```ts
// 1. ensure → record with the lease scope (revision + memberId present)
// 2. retire → record gone
// 3. no dep → existing supervisor tests green (they already construct without it)
// 4. re-ensure after retire → generation continues (+1)
```

- [ ] **Step 2–4: RED → implement → GREEN** (existing pod-session-supervisor tests stay green).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-session-supervisor.ts gateway/src/index.ts gateway/tests/unit/session/pod-mirror.test.ts
git commit -m "feat(gateway): PodSessionSupervisor mirrors leases into the session registry"
```

---

### Task 7: Unified sweeper + guard + docs + full verification

**Files:**
- Modify: `gateway/src/index.ts` (sweep interval; pool wiring passes `this.sessionRegistry`)
- Modify: `gateway/tests/unit/concurrency/regression-guard.test.ts` (session patterns)
- Modify: `docs/architecture/gateway.md` (session registry section)
- Modify: `docs/superpowers/specs/2026-11-09-gateway-kernel-session-registry-design.md` (status → 已实施 + implementation notes)

- [ ] **Step 1: Wire the unified sweeper** — index.ts startup: `setInterval(() => { this.sessionRegistry.sweep(); }, 60_000).unref?.()` next to the existing queueSweepTimer (Key Ruling 7: `sweepBusyAndQueue` keeps its own interval). Pass `registry: this.sessionRegistry` into the pool wiring.

- [ ] **Step 2: Extend the regression guard** (RED first):

```ts
// - index.ts declares `new SessionRegistry(` and does NOT declare
//   `internalSessionRoles = new Map`
// - recall/worker-origin.ts does not declare `const origins = new Map`
// - recall/session-worker-pool.ts does not import TtlMap for entries
//   (runExclusive's Singleflight stays)
```

- [ ] **Step 3: Docs** — gateway.md: new "统一会话注册表（session/，内核重构 Phase C）" section (module map, one-record-per-sid + overlay model, view table, what stayed out with rulings — PiSessionRegistry, busySessions, compactIdleMs). Spec: status 已实施 + §9 implementation notes (the 8 Key Rulings).

- [ ] **Step 4: Full verification on committed state**

`git stash` → `npx tsc --noEmit -p tsconfig.json` → `npx jest --no-coverage --forceExit` → `git stash pop`. Record counts; pre-existing flakiness documented by name.

- [ ] **Step 5: Commit + ledger**

```bash
git add gateway/src/index.ts gateway/tests/unit/concurrency/regression-guard.test.ts docs/architecture/gateway.md docs/superpowers/specs/2026-11-09-gateway-kernel-session-registry-design.md
git commit -m "feat(gateway): unified session sweeper + registry guard + docs"
```

Ledger: `.superpowers/sdd/2026-11-10-gateway-kernel-session-registry/progress.md`.
