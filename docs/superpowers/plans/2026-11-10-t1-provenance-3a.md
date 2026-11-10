# T1 Exact Provenance Phase 3A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every Harmonic memory carry exact T1 `source_trace_ids` captured at write time, expose them through `mafw_get_memory`, and measure coverage — with zero activation/ranking behavior change.

**Architecture:** Add `source_trace_ids` to the OKF frontmatter and index entry. The extraction transcript stamps each line with its permanent `[trace:<id>]`, the curator passes the supporting ids to `mafw_add_memory`, and the handler validates them against `t1_turns` before storing. `mafw_get_memory` resolves exact ids to trace pointers/excerpts and falls back to the existing C0 session search for legacy units. Merges union trace ids.

**Tech Stack:** TypeScript, OKF/YAML files, better-sqlite3, Jest.

**Spec:** `docs/superpowers/specs/2026-11-10-t1-experience-knowledge-skill-design.md` §5.3 / §6.1 / §12 step 4 (provenance half only).

## Global Constraints

- `source_trace_ids` is additive and optional; units without it behave exactly as today.
- Provenance never changes energy, ranking, activation, or recall injection in this phase.
- Unknown/fabricated trace ids are dropped, never fail the memory write.
- Max 20 ids per memory, deduped, `t1:` prefix tolerated.
- Legacy Harmonic `source_session_id` (C0) stays as fallback.
- No T1 activation or replay behavior in 3A.

## Review Focus

- A worker that ignores the prompt must still write memories successfully (empty provenance); Task 2 pins it.
- Fabricated/foreign trace ids must not be stored; Task 2 pins validation.
- Merge/update paths must union provenance instead of dropping the older unit's traces; Task 1 pins both merge sites.
- Legacy units with only `source_session_id` must keep the C0 evidence path; Task 4 pins it.
- Existing OKF files without the field must parse unchanged; Task 1 pins it.

---

### Task 1: `source_trace_ids` on Units, Index, and OKF

**Files:**
- Modify: `gateway/src/core/memory/harmonic-types.ts`
- Modify: `gateway/src/core/memory/harmonic-index.ts`
- Modify: `gateway/src/memory/okf-writer.ts`
- Modify: `gateway/src/memory/harmonic-file-store.ts`
- Modify: `gateway/src/memory/route-write.ts`
- Modify: `gateway/src/memory/consolidation-service.ts`
- Test: `gateway/tests/unit/memory/okf-provenance.test.ts` (create)

**Interfaces:**
- `HarmonicUnit.source_trace_ids?: string[]`
- `HarmonicIndexEntry.source_trace_ids?: string[]`
- OKF frontmatter key `source_trace_ids`.
- Merge rule: `unionTraceIds(a, b)` = dedupe cap 20, incoming first.

- [ ] **Step 1: Write the failing tests**

- `buildOKF` includes `source_trace_ids`; `parseOKF` recovers it.
- A unit without the field roundtrips unchanged (no key emitted).
- `HarmonicUnitFileStore.write` puts the ids on the index entry, and `read` returns them.
- `route-write` update merge and `consolidation-service` merge union the target's ids with the incoming ids (dedupe, cap 20).
- Existing OKF without the field parses and `source_trace_ids` is absent.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/memory/okf-provenance.test.ts`
Expected: FAIL because the field is not persisted.

- [ ] **Step 3: Implement persistence and union**

Add the optional field to both interfaces, emit/parse it in OKF, pass it through `addEntry`, and union it in both merge constructors (incoming + target).

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/memory/okf-provenance.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/memory/harmonic-types.ts gateway/src/core/memory/harmonic-index.ts gateway/src/memory/okf-writer.ts gateway/src/memory/harmonic-file-store.ts gateway/src/memory/route-write.ts gateway/src/memory/consolidation-service.ts gateway/tests/unit/memory/okf-provenance.test.ts
git commit -m "feat(memory): persist exact T1 provenance on memory units"
```

---

### Task 2: Accept and Validate `sourceTraceIds` on Write

**Files:**
- Create: `gateway/src/core/memory/provenance.ts`
- Modify: `gateway/src/memory/gateway-db.ts` (`hasTrace`, `traceIds`)
- Modify: `gateway/src/types.ts` (Services)
- Modify: `gateway/src/mcp/handlers/add-memory.ts`
- Modify: `gateway/src/mcp/tool-registry.ts`
- Modify: `gateway/src/index.ts` (HTTP `/api/memory/add` + Services wiring)
- Test: `gateway/tests/unit/memory/provenance-write.test.ts` (create)

**Interfaces:**
- `normalizeSourceTraceIds(value: unknown, exists: (id: string) => boolean): string[]` — strips `t1:`, trims, dedupes, caps 20, drops unknown.
- `GatewayDatabase.hasTrace(traceId: string): boolean`.
- `GatewayDatabase.traceIdsForSession(sessionId: string): string[]` (for stats/debug, optional).
- `Services.hasTrace?: (traceId: string) => boolean`.
- `mafw_add_memory` input schema gains `sourceTraceIds: string[]`.
- Response gains `sourceTraceIds` when non-empty.

- [ ] **Step 1: Write the failing tests**

- `normalizeSourceTraceIds` accepts bare and `t1:` ids, dedupes, caps 20, drops non-strings/unknown.
- `handleAddMemory({ sourceTraceIds: ['t1t_a','t1t_missing'] }, { hasTrace })` stores only `t1t_a` on the unit and returns it.
- `handleAddMemory` without the arg writes with no `source_trace_ids` (worker non-compliance is non-fatal).
- `hasTrace` returns true for `t1_turns.trace_id`, false otherwise.
- Tool schema exposes the new array argument.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/memory/provenance-write.test.ts`
Expected: FAIL because validation and the argument are missing.

- [ ] **Step 3: Implement validation and wiring**

Create the helper, add `hasTrace`, thread the service, parse `args.sourceTraceIds` before building the unit, and mirror the parse in the HTTP route using `getGatewayDb().hasTrace`. Keep the write successful when every id is rejected.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/memory/provenance-write.test.ts tests/unit/mcp/structured-handlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/memory/provenance.ts gateway/src/memory/gateway-db.ts gateway/src/types.ts gateway/src/mcp/handlers/add-memory.ts gateway/src/mcp/tool-registry.ts gateway/src/index.ts gateway/tests/unit/memory/provenance-write.test.ts
git commit -m "feat(memory): accept validated T1 provenance on write"
```

---

### Task 3: Trace-Stamped Extraction Transcript

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts`
- Test: `gateway/tests/unit/recall/turn-pipeline-provenance.test.ts` (create)

**Interfaces:**
- `observationsToTranscript` (exported for tests) prefixes each line with `[trace:<trace_id>]` when the observation has one, then the existing `[USER]/[TOOL]/...` tag.
- `TOOL_EXTRACTION_SYSTEM` instructs the curator to pass `sourceTraceIds` copied from those markers (max 20), and never invent ids.

- [ ] **Step 1: Write the failing tests**

- Transcript lines render `[trace:t1t_x][USER] ...` when trace ids exist; lines without trace ids keep the old shape.
- The extraction prompt contains the `sourceTraceIds` instruction.
- A pipeline run with a fake worker that calls the add-memory handler stores the batch trace id (integration through the prompt text is not required; the prompt test covers the instruction).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/recall/turn-pipeline-provenance.test.ts`
Expected: FAIL because the transcript has no trace markers.

- [ ] **Step 3: Implement markers and instruction**

Prefix only when `o.trace_id` is present; export the builder. Add the prompt bullet.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/recall/turn-pipeline-provenance.test.ts tests/unit/recall/turn-pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/turn-pipeline.ts gateway/tests/unit/recall/turn-pipeline-provenance.test.ts
git commit -m "feat(memory): stamp T1 traces into extraction transcripts"
```

---

### Task 4: Read Exact Provenance and Coverage

**Files:**
- Modify: `gateway/src/mcp/handlers/get-memory.ts`
- Modify: `gateway/src/routes/memory.ts` (stats)
- Test: `gateway/tests/unit/get-memory-source.test.ts`
- Test: `gateway/tests/unit/routes/memory-wiring.test.ts`

**Interfaces:**
- `mafw_get_memory` response `source` gains optional:

```ts
source: {
  sessionId: string;
  evidence?: string; // C0 fallback
  traces?: Array<{
    traceId: string;
    sessionId: string;
    turnId: number;
    archived: boolean;
    excerpt: string; // first non-empty row, ≤300 chars
  }>;
}
```

- Exact traces win over C0; C0 still runs when no exact ids or resolution yields none.
- `/api/memory/stats` `t1` gains:

```ts
provenance: { memories: number; withExact: number; coverage: number }
```

- [ ] **Step 1: Write the failing tests**

- Unit with `source_trace_ids` + `readTrace` returns `source.traces` with the exact ids and no C0 call.
- Unit with only `source_session_id` keeps `source.evidence` (existing test stays green).
- Unit with unknown ids falls back to C0.
- Stats counts index entries with non-empty `source_trace_ids` and reports coverage.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/get-memory-source.test.ts tests/unit/routes/memory-wiring.test.ts`
Expected: FAIL because traces/coverage are missing.

- [ ] **Step 3: Implement read-side resolution and stats**

Resolve up to 5 ids through `readTrace`, build excerpts from the first row, keep `sessionId` for compatibility, and add the stats bucket guarded by try/catch.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/get-memory-source.test.ts tests/unit/routes/memory-wiring.test.ts tests/unit/mcp/get-memory-t1.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mcp/handlers/get-memory.ts gateway/src/routes/memory.ts gateway/tests/unit/get-memory-source.test.ts gateway/tests/unit/routes/memory-wiring.test.ts
git commit -m "feat(memory): read exact T1 provenance and coverage"
```

---

### Task 5: Documentation, Full Gates, Release Note

**Files:**
- Modify: `docs/architecture/memory.md`
- Create: `docs/releases/2026-11-10-t1-provenance-3a.md`

- [ ] **Step 1: Run the full gateway suite** → record suites/tests.
- [ ] **Step 2: Run `npx tsc --noEmit -p tsconfig.json`** → rc=0.
- [ ] **Step 3: Run SDK tests and root build** → rc=0.
- [ ] **Step 4: Document the provenance field, capture path, validation/cap, read shape, coverage metric, and explicitly state no activation/ranking change.**
- [ ] **Step 5: Commit docs.**
