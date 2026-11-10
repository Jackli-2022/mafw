# T1 Retrieval Phase 2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make T1 verbatim turns independently searchable and readable by the agent, allow T1-only automatic recall, and record durable T1 retrieval observations without changing activation or memory energy.

**Architecture:** Extend the existing dense T1 layer with trace-aware hit identities and a shared gateway search wrapper. Add explicit `layer` selection to MCP and HTTP search, let snapshot building proceed from T1 hits when Harmonic has none, add `t1:<traceId>` redemption, and persist observe-only retrieval events in `gateway.db`.

**Tech Stack:** TypeScript, better-sqlite3, Jest, existing `EmbeddingRuntime`/`MemoryVectorStore`, MCP tool registry, route registry.

**Spec:** `docs/superpowers/specs/2026-11-10-t1-experience-knowledge-skill-design.md`

## Global Constraints

- Existing callers that omit `layer` keep Harmonic-only search behavior, response shape, and latency.
- T1 raw content is immutable; this phase only adds retrieval/read/observability.
- No T1 activation, energy, provenance propagation, replay, or skill behavior changes.
- `trace_id`/`observation_key` remain permanent; legacy pointer `t1:<sessionTail>:<turn>` remains supported.
- Every T1 search failure is fail-open: it must not break Harmonic search or the 100ms boundary recall contract.
- T1-only snapshots must include pointer labels that tell the agent to use `mafw_get_memory`.
- Retrieval events are observe-only and durable; they must not affect ranking or energy.
- Gateway tests use `npx jest --runInBand`; type gate is `npx tsc --noEmit -p tsconfig.json`.

## Review Focus

- Existing `mafw_search_hybrid({query})` callers: no T1 work may run and no new fields may appear; Task 3 pins this.
- Harmonic zero-hit + T1 hit: snapshot must be built rather than returning null; Task 5 pins this.
- T1 search with embedding runtime off or throwing: both MCP and snapshot remain usable; Tasks 3 and 5 pin this.
- Old archive-only pointer and new trace pointer: both must resolve, and active (not-yet-archived) turns must not be lost; Task 6 pins this.
- Durable retrieval stats across DB reopen and concurrent kinds; Task 2 pins this.

---

### Task 1: Trace-Aware T1 Hits and Pointer Rendering

**Files:**
- Modify: `gateway/src/recall/verbatim-recall.ts`
- Test: `gateway/tests/unit/recall/verbatim-recall.test.ts`

**Interfaces:**
- Consumes: existing `makeT1Search`, `renderT1Lines`, `T1Row`.
- Produces:

```ts
export interface T1Row {
  session_id: string;
  turn_id: number;
  trace_id?: string | null;
  source: string;
  content: string;
}

export interface T1Hit {
  sessionId: string;
  turnId: number;
  traceId?: string | null;
  cosine: number;
  excerpt: string;
}

export const T1_POINTER_HEADER: string;
// exact value:
// `[T1 原始记录 · 依据前请核实：取全文 → mafw_get_memory("t1:<traceId>")]`
```

- `renderT1Lines` emits `[t1|<traceId>]` when a hit has a non-empty trace id, otherwise the legacy `[t1|<sessionTail>:<turnId>]`.
- `makeT1Search` populates `traceId` from the matched row, falling back to the first row's trace id, then `null`.

- [ ] **Step 1: Write the failing tests**

Add to `verbatim-recall.test.ts`:

```ts
test('prefers the permanent trace id in pointer lines', () => {
  const lines = renderT1Lines(
    [{ sessionId: 'ses_PROVIDER123456', turnId: 7, traceId: 't1t_abc', cosine: 0.8, excerpt: 'hello' }],
    { k: 3, maxChars: 600 },
  );
  expect(lines).toContain('[t1|t1t_abc]');
  expect(lines).not.toContain('[t1|123456:7]');
});

test('makeT1Search returns the matched row trace id', async () => {
  const key = t1VectorKey('s1', 1, 'row a');
  const search = makeT1Search({
    runtime: {
      provider: { embed: async () => [[1, 0]] },
      t1Vectors: { searchByCosine: () => [{ id: key, cosine: 0.9 }] } as any,
    },
    fetchRows: () => [
      { session_id: 's1', turn_id: 1, trace_id: 't1t_source', source: 'user_input', content: 'row a' },
    ],
  });
  const hits = await search('query', 1);
  expect(hits[0].traceId).toBe('t1t_source');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gateway; npx jest --runInBand tests/unit/recall/verbatim-recall.test.ts`
Expected: FAIL because `traceId` is absent and the renderer only emits the legacy pointer.

- [ ] **Step 3: Implement trace-aware rendering**

Update `T1Row`/`T1Hit`, add `T1_POINTER_HEADER`, change the pointer selection in `renderT1Lines`, and populate `traceId` in `makeT1Search`. Keep the legacy format when no trace id exists.

- [ ] **Step 4: Run the focused test**

Run: `cd gateway; npx jest --runInBand tests/unit/recall/verbatim-recall.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/verbatim-recall.ts gateway/tests/unit/recall/verbatim-recall.test.ts
git commit -m "feat(memory): make T1 hits trace-aware"
```

---

### Task 2: Durable T1 Retrieval Events

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts`
- Test: `gateway/tests/unit/gateway-db-t1-retrieval-events.test.ts` (create)

**Interfaces:**
- Produces:

```ts
export type T1RetrievalKind = 'search' | 'recall' | 'redeem';

export interface T1RetrievalStats {
  total: number;
  byKind: Record<T1RetrievalKind, number>;
  uniqueTraces: number;
  lastAt: number | null;
}

recordT1RetrievalEvent(event: {
  traceId: string;
  kind: T1RetrievalKind;
  score?: number;
  ts?: number;
}): void;

t1RetrievalStats(opts?: { since?: number }): T1RetrievalStats;
// `since` is Unix seconds, matching created_at/ts.
```

- Adds table `t1_retrieval_events(id, trace_id, kind, score, created_at)` with indexes on `(trace_id, created_at)` and `created_at`.
- Unknown/empty trace ids are ignored; all methods are fail-open.

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';

describe('T1 retrieval events', () => {
  test('records kinds and survives reopen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-events-'));
    const file = path.join(dir, 'test.db');
    let db = new GatewayDatabase(file);
    db.recordT1RetrievalEvent({ traceId: 't1t_a', kind: 'search', score: 0.9 });
    db.recordT1RetrievalEvent({ traceId: 't1t_a', kind: 'redeem' });
    db.recordT1RetrievalEvent({ traceId: 't1t_b', kind: 'recall' });
    db.recordT1RetrievalEvent({ traceId: '', kind: 'search' });
    expect(db.t1RetrievalStats()).toEqual({
      total: 3,
      byKind: { search: 1, recall: 1, redeem: 1 },
      uniqueTraces: 2,
      lastAt: expect.any(Number),
    });
    db.close();

    db = new GatewayDatabase(file);
    expect(db.t1RetrievalStats().total).toBe(3);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('since filters by event timestamp', () => {
    const db = new GatewayDatabase(':memory:');
    db.recordT1RetrievalEvent({ traceId: 't1t_old', kind: 'search', ts: 100 });
    db.recordT1RetrievalEvent({ traceId: 't1t_new', kind: 'search', ts: 200 });
    const stats = db.t1RetrievalStats({ since: 150 });
    expect(stats.total).toBe(1);
    expect(stats.uniqueTraces).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gateway; npx jest --runInBand tests/unit/gateway-db-t1-retrieval-events.test.ts`
Expected: FAIL because the table and methods are missing.

- [ ] **Step 3: Implement the table and methods**

Add the schema to the main database creation block and implement inserts/aggregation with SQL. Use `unixepoch()` when `ts` is missing. Return zeroed stats for empty tables.

- [ ] **Step 4: Run the focused test**

Run: `cd gateway; npx jest --runInBand tests/unit/gateway-db-t1-retrieval-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/tests/unit/gateway-db-t1-retrieval-events.test.ts
git commit -m "feat(memory): persist T1 retrieval observations"
```

---

### Task 3: Shared T1 Search and MCP `layer` Selection

**Files:**
- Create: `gateway/src/recall/t1-search.ts`
- Modify: `gateway/src/types.ts`
- Modify: `gateway/src/mcp/handlers/search-hybrid.ts`
- Modify: `gateway/src/mcp/tool-registry.ts`
- Modify: `gateway/src/index.ts` (MCP services + snapshot helper reuse)
- Test: `gateway/tests/unit/recall/t1-search.test.ts` (create)
- Test: `gateway/tests/unit/mcp/search-t1-layer.test.ts` (create)
- Test: `gateway/tests/unit/mcp/structured-handlers.test.ts`

**Interfaces:**
- Consumes: `T1Hit`, `makeT1Search`, `GatewayDatabase`, `getEmbeddingRuntime`, `recordT1RetrievalEvent`.
- Produces:

```ts
export function createGatewayT1Search(
  db: GatewayDatabase,
  getRuntime: () => EmbeddingRuntime | null = getEmbeddingRuntime,
): (query: string, k: number) => Promise<T1Hit[]>;
```

- `Services` gains:

```ts
searchT1?: (query: string, k: number) => Promise<import('./recall/verbatim-recall').T1Hit[]>;
recordT1Retrieval?: (
  traceId: string,
  kind: 'search' | 'recall' | 'redeem',
  score?: number,
) => void;
```

- `mafw_search_hybrid` accepts `layer: 'gist' | 't1' | 'both'`, default `gist`.
- Default gist payload is byte-shape compatible with today (no `t1Results` field).
- T1 response entries include `traceId`, `sessionId`, `turnId`, `cosine`, `excerpt`.
- T1/both modes record `kind='search'` for each returned T1 trace.

- [ ] **Step 1: Write the failing helper tests**

`t1-search.test.ts` should verify:
- no runtime → `[]`, no throw
- runtime returns vector hits → archive rows are preferred, active rows fall back
- provider throw → `[]`

- [ ] **Step 2: Write the failing MCP tests**

`search-t1-layer.test.ts` should verify:
- omitted layer calls only `memory.search`; no `searchT1`; payload has no `t1Results`
- `layer:'t1'` calls no Harmonic search, returns `t1Results`, `results: []`, `canExpand:false`
- `layer:'both'` returns both arrays
- invalid layer returns `isError` with an error mentioning `gist|t1|both`
- `searchT1` throws → T1 array empty, Harmonic path still succeeds

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd gateway; npx jest --runInBand tests/unit/recall/t1-search.test.ts tests/unit/mcp/search-t1-layer.test.ts`
Expected: FAIL because the helper and layer switch are missing.

- [ ] **Step 4: Implement the helper and MCP layer**

Create `createGatewayT1Search` with hot-swappable runtime resolution and archive-first row fetching. Add `layer` parsing before Harmonic work. Keep the existing Harmonic block unchanged for gist/both. Record T1 search events through `services.recordT1Retrieval`. Update the tool schema and description. Wire `searchT1`/`recordT1Retrieval` into the MCP services object in `index.ts`, reusing the same helper for snapshot wiring.

- [ ] **Step 5: Run focused tests**

Run: `cd gateway; npx jest --runInBand tests/unit/recall/t1-search.test.ts tests/unit/mcp/search-t1-layer.test.ts tests/unit/mcp/structured-handlers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/recall/t1-search.ts gateway/src/types.ts gateway/src/mcp/handlers/search-hybrid.ts gateway/src/mcp/tool-registry.ts gateway/src/index.ts gateway/tests/unit/recall/t1-search.test.ts gateway/tests/unit/mcp/search-t1-layer.test.ts gateway/tests/unit/mcp/structured-handlers.test.ts
git commit -m "feat(memory): expose T1 layer in agent search"
```

---

### Task 4: HTTP T1 Search and Stats

**Files:**
- Modify: `gateway/src/routes/memory.ts`
- Modify: `gateway/src/index.ts` (route deps wiring)
- Test: `gateway/tests/unit/routes/memory-wiring.test.ts`

**Interfaces:**
- `MemoryRouteDeps` gains `searchT1?: (query: string, k: number) => Promise<T1Hit[]>`.
- `GET /api/memory/search` accepts `layer=gist|t1|both`, default `gist`.
- `layer=t1` does not require a Harmonic memory service.
- Response:
  - gist: existing `{ results }`
  - t1: `{ results: [], t1Results }`
  - both: `{ results, t1Results }`
- `/api/memory/stats` gains `t1`:

```ts
t1: {
  vectors: number;
  activeRows: number;
  archiveRows: number;
  coverage: number; // vectors / (activeRows + archiveRows), capped at 1
  retrieval: T1RetrievalStats; // trailing 7 days
}
```

The stats branch must `try/catch` optional fake-DB methods and return zeroed T1
counts rather than failing the whole stats response.

- [ ] **Step 1: Write failing route tests**

Add tests to `memory-wiring.test.ts`:
- `search?layer=t1` with no memory service returns 200 and only T1 results
- `search?layer=both` calls both and preserves both arrays
- `search` without layer returns exactly `{ results }` (no L1 field)
- invalid layer returns 400
- stats includes `t1.vectors/activeRows/archiveRows/coverage/retrieval` from fake runtime/db

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gateway; npx jest --runInBand tests/unit/routes/memory-wiring.test.ts`
Expected: FAIL because HTTP has no layer handling or T1 stats.

- [ ] **Step 3: Implement route behavior and stats**

Parse/validate `layer`; branch before the memory-service guard; reuse `deps.searchT1`; record T1 search events through `deps.getGatewayDb().recordT1RetrievalEvent`; add guarded T1 stats using the embedding runtime, DB counts, and trailing-7-day event stats. Wire `searchT1` into `attachMemoryRoutes` from `index.ts`.

- [ ] **Step 4: Run the focused route test**

Run: `cd gateway; npx jest --runInBand tests/unit/routes/memory-wiring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/memory.ts gateway/src/index.ts gateway/tests/unit/routes/memory-wiring.test.ts
git commit -m "feat(memory): expose T1 search and stats over HTTP"
```

---

### Task 5: Independent T1 Snapshot and Recall Observability

**Files:**
- Modify: `gateway/src/recall/snapshot-builder.ts`
- Modify: `gateway/src/recall/recall-snapshot.ts`
- Modify: `gateway/src/routes/recall.ts`
- Modify: `gateway/src/index.ts` (snapshot wiring if not already via Task 3)
- Test: `gateway/tests/unit/recall/snapshot-t1.test.ts`
- Test: `gateway/tests/unit/recall/recall-snapshot.test.ts` (extend existing)

**Interfaces:**
- `RecallSnapshot.t1Hits` uses trace-aware `T1Hit`.
- `decideSnapshotUse` accepts a snapshot with no Harmonic ids when `t1Hits` is non-empty.
- T1-only block starts with `T1_POINTER_HEADER`.
- Serving a snapshot records `kind='recall'` once per trace in `snap.t1Hits`.

- [ ] **Step 1: Write failing builder/decision tests**

Add:
```ts
test('builds a T1-only snapshot when Harmonic has no hits', async () => {
  const stored: any[] = [];
  const deps = makeDeps({
    search: () => [],
    searchT1: async () => [
      { sessionId: 'ses_1', turnId: 2, traceId: 't1t_hit', cosine: 0.9, excerpt: 'raw evidence' },
    ],
    store: (_sid, snap) => stored.push(snap),
  });
  const snap = await buildSnapshot(deps, 's1', { maxTurns: 4, maxChars: 400, t1K: 3, t1MaxChars: 300 } as any, 3);
  expect(snap).toBeTruthy();
  expect(snap!.ids).toEqual([]);
  expect(snap!.block).toContain('[T1 原始记录 · 依据前请核实：取全文 → mafw_get_memory("t1:<traceId>")]');
  expect(snap!.block).toContain('[t1|t1t_hit]');
  expect(snap!.t1Hits).toHaveLength(1);
  expect(stored).toHaveLength(1);
});

test('T1-only snapshot is usable', () => {
  expect(decideSnapshotUse({
    query: 'q', block: 'x', ids: [], t1Hits: [{ sessionId: 's', turnId: 1, traceId: 't1t_x', cosine: 0.8, excerpt: 'e' }],
    builtAt: new Date().toISOString(),
  }, 'q')).toBe('use');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd gateway; npx jest --runInBand tests/unit/recall/snapshot-t1.test.ts tests/unit/recall/recall-snapshot.test.ts`
Expected: FAIL because Harmonic zero-hit returns null and decision rejects empty ids.

- [ ] **Step 3: Implement T1-independent snapshot flow**

Search T1 even when Harmonic returns no hits. Render a T1-only block with `T1_POINTER_HEADER` when needed. Keep existing gist verification/render behavior when Harmonic hits exist. Update `decideSnapshotUse` to accept either ids or T1 hits. In `routes/recall.ts`, record recall events from `snap.t1Hits` with trace ids.

- [ ] **Step 4: Run snapshot and recall tests**

Run: `cd gateway; npx jest --runInBand tests/unit/recall/snapshot-t1.test.ts tests/unit/recall/recall-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/snapshot-builder.ts gateway/src/recall/recall-snapshot.ts gateway/src/routes/recall.ts gateway/src/index.ts gateway/tests/unit/recall/snapshot-t1.test.ts gateway/tests/unit/recall/recall-snapshot.test.ts
git commit -m "feat(memory): allow T1-only recall snapshots"
```

---

### Task 6: Trace Pointers and Active/Archive Redemption

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts` (active fallback lookup)
- Modify: `gateway/src/mcp/handlers/get-memory.ts`
- Modify: `gateway/src/types.ts`
- Modify: `gateway/src/mcp/tool-registry.ts`
- Modify: `gateway/src/routes/memory.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/mcp/get-memory-t1.test.ts`
- Test: `gateway/tests/unit/gateway-db-t1-archive-identity.test.ts`

**Interfaces:**
- `GatewayDatabase.findT1BySessionTail(tail, turnId)` returns archive rows first, then active rows.
- `Services.readTrace?: (traceId: string) => T1TraceRead | null`.
- `handleGetMemory` accepts `t1:<traceId>` and returns:

```ts
{
  success: true,
  t1: {
    traceId: string;
    sessionId: string;
    turnId: number;
    archived: boolean;
    legacyAmbiguous: boolean;
    rows: Array<{ source: string; content: string; observationKey?: string }>;
  }
}
```

- Legacy `t1:<sessionTail>:<turnId>` still returns its existing shape, now with optional `traceId` when rows carry one.
- Both forms call `recordT1Retrieval(traceId, 'redeem')` when a trace id is available.

- [ ] **Step 1: Write failing DB/handler tests**

Add:
- DB test: seed active observation, `findT1BySessionTail` finds it when archive is empty.
- handler test: `t1:t1t_abc` uses `readTrace` and returns archived/rows/legacyAmbiguous.
- handler test: legacy pointer still works and records redeem.
- handler test: unknown trace returns `success:false` with a helpful `t1` error.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest --runInBand tests/unit/mcp/get-memory-t1.test.ts tests/unit/gateway-db-t1-archive-identity.test.ts`
Expected: FAIL because trace pointers and active fallback do not exist.

- [ ] **Step 3: Implement pointer redemption and wiring**

Add `findT1BySessionTail`; update all internal `resolveT1` injections to use it. Add `readTrace` to services and route deps. Implement the trace branch before the legacy branch. Record redeem events. Update the tool description to document `t1:<traceId>`.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest --runInBand tests/unit/mcp/get-memory-t1.test.ts tests/unit/gateway-db-t1-archive-identity.test.ts tests/unit/mcp/structured-handlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/src/mcp/handlers/get-memory.ts gateway/src/types.ts gateway/src/mcp/tool-registry.ts gateway/src/routes/memory.ts gateway/src/index.ts gateway/tests/unit/mcp/get-memory-t1.test.ts gateway/tests/unit/gateway-db-t1-archive-identity.test.ts gateway/tests/unit/mcp/structured-handlers.test.ts
git commit -m "feat(memory): redeem T1 by permanent trace id"
```

---

### Task 7: Documentation, Full Gates, and Release Note

**Files:**
- Modify: `docs/architecture/memory.md`
- Create: `docs/releases/2026-11-10-t1-retrieval-2a.md`
- No source changes beyond fixes found by gates.

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: updated current-state architecture docs and a release record with exact counts.

- [ ] **Step 1: Run the full gateway suite**

Run: `cd gateway; npx jest --runInBand --forceExit`
Expected: all suites pass; record exact suite/test counts.

- [ ] **Step 2: Run the type gate**

Run: `cd gateway; npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Run the root build**

Run from repo root: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Update architecture documentation**

In `docs/architecture/memory.md`, document:
- `mafw_search_hybrid` layer selection and T1-only behavior
- T1 trace pointers and legacy pointer compatibility
- `t1_retrieval_events` table and its observe-only status
- T1-only snapshot behavior and `T1_POINTER_HEADER`
- Explicit non-goals: no activation/energy/provenance/replay changes in 2A

- [ ] **Step 5: Write the release note**

Create `docs/releases/2026-11-10-t1-retrieval-2a.md` with commit range, exact test/build counts, search/layer/pointer behavior, stats shape, known limits (dense-only T1 search, in-process 100ms unaffected, event table growth unpruned), and deferred phases.

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/memory.md docs/releases/2026-11-10-t1-retrieval-2a.md
git commit -m "docs(memory): record T1 retrieval phase 2a"
```
