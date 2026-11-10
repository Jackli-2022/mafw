# T1 Activation Phase 3B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maintain a durable, bounded activation state for T1 traces from existing retrieval/redemption observations and exact memory provenance, with daily decay — storing the signal for a later ranking phase, not consuming it yet.

**Architecture:** Add `t1_trace_state(trace_id PK, activation, retrieval_count, last_retrieved_at, last_replayed_at, activation_updated_at)`. `recordT1RetrievalEvent` updates it in the same transaction; redeeming a memory propagates a small bounded increment to its exact `source_trace_ids`; the daily decay pass applies exponential decay by elapsed days. T1/Harmonic ordering is untouched.

**Tech Stack:** TypeScript, better-sqlite3, Jest.

**Spec:** `docs/superpowers/specs/2026-11-10-t1-experience-knowledge-skill-design.md` §5.3 / §12 step 4.

## Global Constraints

- Activation is a state field only; **no ranking, energy, snapshot, or injection change** in this phase.
- Increments are bounded (cap 1.0) and decay daily (half-life default 14 days).
- Unknown trace ids never create state rows.
- All state updates are fail-open; retrieval/redemption must never fail because state is unavailable.
- Exact provenance from Phase 3A is the only propagation edge (no session-level guessing).

---

### Task 1: `t1_trace_state` + Event-Driven Activation

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts`
- Test: `gateway/tests/unit/gateway-db-t1-activation.test.ts` (create)

**Interfaces:**
- `GatewayDatabase.recordT1RetrievalEvent` additionally upserts state for a known trace:
  - `activation = min(1, activation + 0.1)`
  - `retrieval_count += 1`
  - `last_retrieved_at = now`
- `t1TraceActivation(traceId): { activation, retrievalCount, lastRetrievedAt, lastReplayedAt } | null`
- `propagateT1Activation(traceIds: string[], weight = 0.05): number` (returns rows touched)
- `decayT1TraceState(opts?: { now?: number; halfLifeDays?: number }): number`
- `t1ActivationStats(): { traces: number; mean: number; max: number }`

- [ ] **Step 1: Write the failing tests**

- One `search` event on a real trace → activation `0.1`, count 1, last timestamp set.
- Three events → activation capped at `1` (0.1 + 0.1 + … is not capped until 10; use 12 events to pin the cap), count 12.
- Event for an unknown trace → event row exists but no state row.
- `propagateT1Activation(['t1t_a','t1t_b','t1t_missing'])` touches 2, rejects unknown.
- `decayT1TraceState({ halfLifeDays: 14, now: base + 14d })` halves a seeded activation (allow ±0.01); a zero-activation row is untouched.
- `t1ActivationStats` reports traces/mean/max.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/gateway-db-t1-activation.test.ts`
Expected: FAIL because the table/methods are missing.

- [ ] **Step 3: Implement the table and methods**

Create the table in the constructor schema. Wrap the event insert + state upsert in one transaction with `INSERT ... SELECT ... FROM t1_turns WHERE trace_id = ? AND true ON CONFLICT(trace_id) DO UPDATE`. Propagate uses the same upsert without an event row. Decay reads the rows, applies `0.5 ** (elapsedDays / halfLifeDays)`, updates in one transaction, and zeroes values below 0.01.

- [ ] **Step 4: Run the focused test**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/gateway-db-t1-activation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/tests/unit/gateway-db-t1-activation.test.ts
git commit -m "feat(memory): track bounded T1 trace activation"
```

---

### Task 2: Propagate Memory Redemption to Exact Traces

**Files:**
- Modify: `gateway/src/types.ts`
- Modify: `gateway/src/mcp/handlers/get-memory.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/get-memory-source.test.ts`

**Interfaces:**
- `Services.propagateT1Activation?: (traceIds: string[]) => void`.
- On successful exact-provenance resolution, `handleGetMemory` calls it once with the resolved trace ids; failures are swallowed.
- No call for legacy/C0-only units.

- [ ] **Step 1: Write the failing tests**

- Exact traces present + `propagateT1Activation` spy → called with `['t1t_a']` (resolved ids only).
- Legacy unit (no exact ids) → not called.
- Propagation throwing does not fail the read.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/get-memory-source.test.ts`
Expected: FAIL because the service is not called.

- [ ] **Step 3: Implement propagation**

Thread the service through the gateway wiring; call it after `source.traces` is built, inside try/catch.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/get-memory-source.test.ts tests/unit/mcp/get-memory-t1.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/types.ts gateway/src/mcp/handlers/get-memory.ts gateway/src/index.ts gateway/tests/unit/get-memory-source.test.ts
git commit -m "feat(memory): propagate memory redemption to exact T1 traces"
```

---

### Task 3: Daily Decay + Stats + Docs/Gates

**Files:**
- Modify: `gateway/src/automation-engine.ts`
- Modify: `gateway/src/config.ts`
- Modify: `gateway/src/routes/memory.ts`
- Modify: `gateway/tests/unit/memory-decay.test.ts`
- Modify: `gateway/tests/unit/routes/memory-wiring.test.ts`
- Docs: `docs/architecture/memory.md`, `docs/releases/2026-11-10-t1-activation-3b.md`

**Interfaces:**
- `config.recall.t1Recall.activationHalfLifeDays` default `14`.
- `memory:decay` calls `decayT1TraceState({ halfLifeDays })` and records `t1ActivationDecayed`.
- `/api/memory/stats` `t1.activation` = `{ traces, mean, max }` (zeroed when unavailable).

- [ ] **Step 1: Write the failing tests**

- `memory:decay` with a fake DB records `t1ActivationDecayed` from `decayT1TraceState` and passes the configured half-life.
- Stats exposes the activation bucket and tolerates a DB without the method.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/memory-decay.test.ts tests/unit/routes/memory-wiring.test.ts`
Expected: FAIL because decay/stat wiring is missing.

- [ ] **Step 3: Implement and document**

Wire the daily decay next to T1 prune/backfill, add the stats bucket with a try/catch default, and document the state table, increments, decay, propagation source, and the explicit non-goal (ranking unchanged).

- [ ] **Step 4: Full gates**

Run: `cd gateway; npx jest --runInBand --forceExit` → record suites/tests.
Run: `cd gateway; npx tsc --noEmit -p tsconfig.json` → rc=0.
Run: `cd packages/gateway-sdk; npm test` → all pass.
Run from repo root: `npm run build` → rc=0.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/automation-engine.ts gateway/src/config.ts gateway/src/routes/memory.ts gateway/tests/unit/memory-decay.test.ts gateway/tests/unit/routes/memory-wiring.test.ts docs/architecture/memory.md docs/releases/2026-11-10-t1-activation-3b.md
git commit -m "feat(memory): decay T1 activation daily and expose stats"
```
