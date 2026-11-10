# T1 Retrieval Phase 2B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lexical channel for exact identifiers, automatic vector backfill/coverage, and SQLite-backed binary T1 vectors, so T1 retrieval covers function names, paths, error codes, config keys, and numbers without unbounded JSON rewriting.

**Architecture:** FTS5 (`trigram`) indexes every active/archive observation row at write time and rebuilds once for legacy rows. T1 search fuses dense and lexical rankings with RRF while keeping dense-only behavior when either channel fails. A paginated backfill embeds rows whose vector key is missing, and the T1 vector namespace moves from one large JSON file to per-row `Float32` BLOBs in `gateway.db`, with a one-time JSON import.

**Tech Stack:** TypeScript, better-sqlite3 (SQLite 3.53, FTS5 trigram), Jest, existing `EmbeddingIndexer`/`EmbeddingRuntime`.

**Spec:** `docs/superpowers/specs/2026-11-10-t1-experience-knowledge-skill-design.md` §5.2 / §6.1.

## Global Constraints

- T1 raw content remains immutable; lexical and vector data are rebuildable derivatives.
- Every new T1 failure path is fail-open: a lexical/FTS failure must not break dense T1, Harmonic search, or the 100ms boundary recall contract.
- `layer=gist` callers must see no behavior or payload change.
- Observed retrieval events remain observe-only; this phase does not add activation/energy effects.
- FTS query input is user-controlled: tokenize and quote it; never interpolate raw MATCH syntax.
- Vector migration keeps the legacy JSON file as a rename (no deletion on the success path).
- Gateway tests: `npx jest --runInBand --forceExit`; type gate `npx tsc --noEmit -p tsconfig.json`.

## Review Focus

- Query strings containing FTS syntax (`"`, `*`, `:`, `-`) must not throw; Task 1 pins injection-safe quoting.
- Rows shorter than 3 chars cannot be trigram-matched; Task 1 pins the empty/fallback result.
- Archive move must not lose lexical searchability; Task 1 pins search after `archiveTurn`.
- A dense or lexical channel outage must leave the other channel usable; Task 2 pins both single-channel failures.
- Backfill must resume across days without re-embedding existing keys; Task 3 pins pagination + skip-existing.
- Migration must not lose vectors when the JSON file is corrupt or the table already has rows; Task 4 pins both.

---

### Task 1: FTS5 Lexical Index for T1

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts`
- Test: `gateway/tests/unit/gateway-db-t1-lexical.test.ts` (create)

**Interfaces:**
- Produces:

```ts
export interface T1LexicalHit {
  traceId: string;
  sessionId: string;
  turnId: number;
  source: string;
  excerpt: string;
  /** FTS5 bm25 rank (lower is better). */
  rank: number;
}

/** Tokenize + quote a user query for FTS5 MATCH. Empty when no token ≥3 chars. */
export function buildT1FtsQuery(query: string): string;

class GatewayDatabase {
  /** Best lexical hit per trace, ordered by bm25. */
  searchT1Lexical(query: string, topK: number): T1LexicalHit[];
  /** Rebuild from active+archive; callable by tests/ops. Returns indexed rows. */
  rebuildT1Fts(): number;
}
```

- Table: `t1_fts` = `fts5(content, trace_id UNINDEXED, observation_key UNINDEXED, session_id UNINDEXED, turn_id UNINDEXED, source UNINDEXED, tokenize='trigram')`.
- `append()` inserts one FTS row when the observation insert is not a duplicate.
- `deleteTurn()` / `deleteSession()` delete the matching active FTS rows by `observation_key`; archive move leaves FTS untouched (content is unchanged).
- Constructor calls `rebuildT1Fts()` when the FTS table is empty but active+archive rows exist.

- [ ] **Step 1: Write the failing tests**

Cover:
- `buildT1FtsQuery('gateway-db.ts ECONNRESET')` returns quoted OR terms; raw `"`/`*` input never leaks unquoted.
- `searchT1Lexical('gateway-db.ts', 5)` finds a row containing `C:/repo/gateway-db.ts`, and `searchT1Lexical('ECONNRESET', 5)` finds the same trace; Chinese query `部署失败` finds Chinese content.
- Two rows in one trace dedupe to one hit with the best excerpt.
- Row archived via `archiveTurn` remains findable; `deleteTurn` and `deleteSession` remove active-only rows from FTS.
- Legacy rows inserted directly into `t1_observations` before a fresh `rebuildT1Fts()` are indexed; calling rebuild twice does not duplicate hits.
- Query with no token ≥3 chars (e.g. `a b`) returns `[]`.
- FTS syntax input (`'foo" OR bar*'`) resolves without throwing.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/gateway-db-t1-lexical.test.ts`
Expected: FAIL because `t1_fts`, `searchT1Lexical`, and `buildT1FtsQuery` do not exist.

- [ ] **Step 3: Implement the index and query**

Add the virtual table to the constructor schema. Implement `buildT1FtsQuery` with `String(query).match(/[\p{L}\p{N}_./:\\-]{3,}/gu)`, dedupe/lowercase, cap 12 terms, wrap each in double quotes with `"` doubled. `searchT1Lexical` runs `bm25(t1_fts)` + `snippet(t1_fts, 0, '', '', '…', 32)`, fetches `topK * 4` rows, dedupes by `trace_id` preserving order, slices `topK`. Hook append/delete and the constructor rebuild.

- [ ] **Step 4: Run the focused test**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/gateway-db-t1-lexical.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/tests/unit/gateway-db-t1-lexical.test.ts
git commit -m "feat(memory): index T1 turns with FTS5 trigram"
```

---

### Task 2: Fuse Lexical and Dense T1 Search

**Files:**
- Modify: `gateway/src/recall/verbatim-recall.ts`
- Modify: `gateway/src/recall/t1-search.ts`
- Modify: `gateway/src/mcp/handlers/search-hybrid.ts`
- Modify: `gateway/src/routes/memory.ts`
- Test: `gateway/tests/unit/recall/t1-search.test.ts`

**Interfaces:**
- `T1Hit` gains optional `sources?: Array<'dense' | 'lexical'>` and `score?: number` (RRF score, not cosine).
- Produces `fuseT1Hits(dense: T1Hit[], lexical: T1LexicalHit[], k: number): T1Hit[]`.
- `createGatewayT1Search` returns fused hits; dense-only when lexical is disabled/unavailable; lexical-only when the embedding runtime is absent.
- MCP `searchT1Hits` and HTTP route pass `hit.score ?? hit.cosine` to `recordT1Retrieval`.

- [ ] **Step 1: Write the failing tests**

Add to `t1-search.test.ts`:
- fake DB with `searchT1Lexical` returns a lexical-only hit and `getRuntime` returns null → one hit with `sources: ['lexical']`, `cosine: 0`.
- dense + lexical hit the same trace → one fused hit with both sources, lexical excerpt preferred, `score > 0`.
- lexical throws → dense results unchanged; dense provider throws → lexical results returned.
- `config.recall.t1Recall.lexical === false` → lexical search is not called.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/recall/t1-search.test.ts`
Expected: FAIL because fusion and lexical fallback are missing.

- [ ] **Step 3: Implement fusion**

In `t1-search.ts`, gather dense via the existing helper and lexical via `db.searchT1Lexical` when `config.recall.t1Recall?.lexical !== false`. Use RRF `1/(60 + rank)`, key `traceId || sessionId:turnId`, sum per key, prefer the lexical excerpt when present, and sort by fused score descending. Keep every call wrapped in try/catch. Add `lexical: boolean` to `t1Recall` config (default `true`). Update event score call sites.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/recall/t1-search.test.ts tests/unit/mcp/search-t1-layer.test.ts tests/unit/routes/memory-wiring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/verbatim-recall.ts gateway/src/recall/t1-search.ts gateway/src/config.ts gateway/src/mcp/handlers/search-hybrid.ts gateway/src/routes/memory.ts gateway/tests/unit/recall/t1-search.test.ts
git commit -m "feat(memory): fuse T1 lexical and dense retrieval"
```

---

### Task 3: Automatic T1 Vector Backfill and Coverage

**Files:**
- Create: `gateway/src/memory/t1-backfill.ts`
- Modify: `gateway/src/memory/gateway-db.ts` (row paging)
- Modify: `gateway/src/automation-engine.ts` (`memory:decay`)
- Modify: `gateway/src/config.ts` (`t1BackfillLimit`)
- Test: `gateway/tests/unit/memory/t1-backfill.test.ts` (create)
- Test: `gateway/tests/unit/memory-decay.test.ts`

**Interfaces:**
- `GatewayDatabase.listT1RowsForBackfill(opts: { offset: number; limit: number })` returns `Array<{ observationKey: string; sessionId: string; turnId: number; content: string }>` (archive rows first, then active).
- Produces:

```ts
export interface T1BackfillDeps {
  listRows(offset: number, limit: number): Array<{ observationKey: string; sessionId: string; turnId: number; content: string }>;
  hasVector(key: string): boolean;
  enqueue(key: string, text: string): void;
  flush(): Promise<{ indexed: number; failed: number }>;
}

export async function backfillT1Vectors(
  deps: T1BackfillDeps,
  opts?: { limit?: number; pageSize?: number },
): Promise<{ scanned: number; indexed: number; missing: number; failed: number }>;
```

- `memory:decay` calls it after harmonic backfill with `limit = config.recall.t1Recall.t1BackfillLimit ?? 200` (0/negative disables), and records `t1BackfillIndexed` / `t1BackfillMissing` / `t1BackfillFailed` in heartbeat counts.
- Default config: `t1BackfillLimit: 200`.

- [ ] **Step 1: Write the failing tests**

`t1-backfill.test.ts`:
- 3 rows, one already indexed → enqueues only the 2 missing with `t1VectorKey` and `content.slice(0, 2000)`; counts `scanned/indexed/missing`.
- `limit: 1` enqueues one and leaves the rest for a later call (offset pagination driven by page size).
- `flush` rejects → `failed` equals enqueued count and the function never throws.
- empty rows → zeroed result.

`memory-decay.test.ts`: with a fake DB returning one unindexed row and a fake embedding runtime, `memory:decay` enqueues it and heartbeat counts carry the three T1 fields.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/memory/t1-backfill.test.ts tests/unit/memory-decay.test.ts`
Expected: FAIL because the backfill helper and DB paging are missing.

- [ ] **Step 3: Implement paging, helper, and wiring**

`listT1RowsForBackfill` counts archive rows, slices archive first then active with the remaining limit/offset (both ordered by `id`). The helper scans pages, skips keys already present, stops at `limit` enqueued, flushes once, and returns counts (flush failure increments `failed`, never throws). Wire into `memory:decay` behind the config gate and add the heartbeat fields.

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/memory/t1-backfill.test.ts tests/unit/memory-decay.test.ts tests/unit/gateway-db-t1-lexical.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/t1-backfill.ts gateway/src/memory/gateway-db.ts gateway/src/automation-engine.ts gateway/src/config.ts gateway/tests/unit/memory/t1-backfill.test.ts gateway/tests/unit/memory-decay.test.ts
git commit -m "feat(memory): backfill T1 vectors automatically"
```

---

### Task 4: Binary SQLite T1 Vector Store with JSON Migration

**Files:**
- Create: `gateway/src/memory/sqlite-vector-store.ts`
- Modify: `gateway/src/memory/vector-store.ts` (widen the indexer's store type)
- Modify: `gateway/src/memory/embedding-runtime.ts`
- Modify: `gateway/src/index.ts` (pass the DB handle)
- Modify: `gateway/src/config.ts` (`t1VectorStore`)
- Test: `gateway/tests/unit/memory/sqlite-vector-store.test.ts` (create)

**Interfaces:**
- Produces `VectorStoreLike`:

```ts
export interface VectorStoreLike {
  upsert(id: string, vector: number[]): void;
  get(id: string): number[] | Float32Array | undefined;
  remove(id: string): void;
  flush(): void;
  size(): number;
  ids(): string[];
  searchByCosine(query: number[], topK: number): Array<{ id: string; cosine: number }>;
}
```

- Produces:

```ts
export class SqliteT1VectorStore implements VectorStoreLike {
  constructor(db: Database.Database, opts: {
    dims: number;
    model: string;
    legacyJsonPath?: string;
  });
  /** Rows imported from the legacy JSON file (0 when none/table non-empty/corrupt). */
  readonly migrated: number;
}
```

- Table `t1_vectors(key TEXT PRIMARY KEY, dims INTEGER NOT NULL, model TEXT, vector BLOB NOT NULL, updated_at INTEGER DEFAULT (unixepoch()))`; floats stored as little-endian `Float32`.
- `initEmbeddingRuntime` accepts `vectorDb?: Database.Database`; when present and `config.memory.embedding.t1VectorStore !== 'json'`, T1 uses `SqliteT1VectorStore`, importing `vectors-t1-<tag>.json` once and renaming it to `<name>.migrated-<ISO>`.
- `EmbeddingIndexerDeps.vectors` becomes `VectorStoreLike`.

- [ ] **Step 1: Write the failing tests**

- roundtrip: upsert 3 vectors, flush, reopen the same DB file → `size`, `get`, and cosine search return expected ids.
- `remove` + flush deletes the row; `ids()` reflects it.
- dimension mismatch vectors are skipped in search (not thrown).
- migration: write a small legacy JSON `{ model, dims, vectors }`, construct the store → `migrated` equals the count, search finds the vector, JSON renamed to `.migrated-*`, second construction imports 0 and table count stays the same.
- corrupt JSON → `migrated: 0`, store empty, constructor does not throw.
- table already populated → JSON is ignored (no duplicate import).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/memory/sqlite-vector-store.test.ts`
Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement the store and migration**

Keep decoded vectors in a `Map<string, Float32Array>`; `flush()` writes only dirty keys in one transaction with `INSERT ... ON CONFLICT(key) DO UPDATE`. `searchByCosine` mirrors the JSON store, using the `Float32Array` stride. Migration reads JSON only when the table is empty and the file exists, inserts in one transaction, then renames the file. Wire `vectorDb` from `this.getGatewayDb().getStore()` in `initEmbeddingServices`, and fall back to the JSON store when the DB handle is absent (tests/eval harnesses).

- [ ] **Step 4: Run focused tests**

Run: `cd gateway; npx jest --runInBand --forceExit tests/unit/memory/sqlite-vector-store.test.ts tests/unit/memory/embedding-runtime-t1.test.ts tests/unit/memory-decay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/sqlite-vector-store.ts gateway/src/memory/vector-store.ts gateway/src/memory/embedding-runtime.ts gateway/src/index.ts gateway/src/config.ts gateway/tests/unit/memory/sqlite-vector-store.test.ts
git commit -m "feat(memory): store T1 vectors as SQLite blobs"
```

---

### Task 5: Documentation, Full Gates, Release Note

**Files:**
- Modify: `docs/architecture/memory.md`
- Modify: `docs/releases/2026-11-10-t1-retrieval-2a.md` or create `docs/releases/2026-11-10-t1-retrieval-2b.md`

- [ ] **Step 1: Run the full gateway suite**

Run: `cd gateway; npx jest --runInBand --forceExit`
Expected: all suites pass; record exact suite/test counts.

- [ ] **Step 2: Run the type gate and SDK tests**

Run: `cd gateway; npx tsc --noEmit -p tsconfig.json` → rc=0
Run: `cd packages/gateway-sdk; npm test` → all pass

- [ ] **Step 3: Run the root build**

Run from repo root: `npm run build` → rc=0

- [ ] **Step 4: Document the new retrieval shape**

In `docs/architecture/memory.md`: FTS5 trigram index and rebuild policy; RRF fusion and fail-open rules; backfill limits and heartbeat fields; SQLite `t1_vectors` BLOB layout, JSON migration/rename, and `t1VectorStore='json'` rollback. Add the release note with exact counts, migration behavior, and known limits (no sqlite-vec/ANN; floats not quantized; FTS trigram minimum 3 chars).

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/memory.md docs/releases/2026-11-10-t1-retrieval-2b.md
git commit -m "docs(memory): record T1 retrieval phase 2b"
```
