# T1 Atom Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the T1 embedding atoms actually sparse, reachable from retrieval, and live on the real gateway, with measured before/after evidence.

**Architecture:** Add a pure calibration module (per-anchor baseline + per-text centering, top-2), apply it inside the existing `T1SemanticEncoder`, emit `sem:` term ids on the query side, switch `intent_shift` to atom Jaccard, backfill existing turns, and operate the rollout (build → restart → backfill → rebuild episodes → measure).

**Tech Stack:** TypeScript, better-sqlite3, Jest, the local llama.cpp embedding sidecar (`Qwen3-Embedding-0.6B`, 1024d), Node test runner for desktop/SDK.

**Spec:** `docs/superpowers/specs/2026-11-17-t1-atom-calibration-design.md`

## Global Constraints

- Raw T1 is immutable; atoms are additive rows in `t1_sparse_terms` (`kind='semantic'`).
- Every new path is fail-open: embedding/provider/DB errors leave lexical/concept code and raw T1 intact.
- The sync boundary recall path keeps the 100 ms contract; query-side atoms only run on async T1 search paths.
- No new HTTP route. The only API change is the `t1.atoms` stats field.
- `recall.t1Recall.semanticAtoms='off'` disables both write and query atoms.
- Baselines are per embedding provider instance; never persist across a model change.
- Gateway type gate: `cd gateway && npx tsc --noEmit -p tsconfig.json`.
- Gateway tests: `cd gateway && npx jest --runInBand --forceExit <paths>`.

## File Structure

| File | Responsibility |
|---|---|
| `gateway/src/recall/t1-atom-calibration.ts` (new) | Pure math: anchor baselines, double centering, top-k selection |
| `gateway/src/recall/t1-semantic-atoms.ts` | Encoder applies calibration; exposes calibration state |
| `gateway/src/recall/t1-sparse.ts` | `T1SparseAtom.score`; stop filtering calibrated atoms by raw cosine |
| `gateway/src/recall/t1-search.ts` | Query atoms → `sem:` ids; optional injection seam |
| `gateway/src/memory/gateway-db.ts` | `searchT1Sparse` extra ids; atom backfill queries; atom stats; reference sampling |
| `gateway/src/recall/t1-atom-backfill.ts` (new) | Bounded idempotent atom backfill |
| `gateway/src/recall/t1-episode-boundary.ts` | `intent_shift` via atom Jaccard |
| `gateway/src/kernel.ts` | Wire reference texts + calibration into the encoder |
| `gateway/src/routes/memory.ts` | `t1.atoms` stats |
| `gateway/scripts/backfill-t1-atoms.ts` (new) | One-off operational backfill |
| `evaluation/t1/src/run-real-atoms.ts` (new) | Real-model before/after probe |
| `docs/releases/2026-11-17-t1-atom-calibration.md` (new) | Delivered numbers + commit |

---

### Task 1: Calibration math + atom score rename

**Files:**
- Create: `gateway/src/recall/t1-atom-calibration.ts`
- Modify: `gateway/src/recall/t1-sparse.ts` (`T1SparseAtom.cosine` → `score`; remove the raw-cosine filter)
- Modify: `gateway/src/recall/t1-encode.ts`, `gateway/src/recall/turn-pipeline.ts` (type rename only)
- Modify: `gateway/tests/unit/recall/t1-encoding.test.ts`, `gateway/tests/unit/turn-pipeline-features.test.ts`
- Test: `gateway/tests/unit/recall/t1-atom-calibration.test.ts`

**Interfaces:**
- Produces:
```ts
export interface SelectAtomOptions {
  topK?: number;     // default 2
  minScore?: number; // default 0.02
  minTop1?: number;  // default 0.05
}
export function computeAnchorBaselines(
  anchorVectors: number[][],
  referenceVectors: number[][],
): number[];
export function selectCalibratedAtoms(
  raw: Array<{ termId: string; cosine: number }>,
  baselines: number[],
  opts?: SelectAtomOptions,
): T1SparseAtom[];
```
```ts
// t1-sparse.ts
export interface T1SparseAtom {
  termId: string;
  /** Calibrated atom weight (centered score), not a raw cosine. */
  score: number;
}
```

- [ ] **Step 1: Write the failing test** (pure math; no embedder)

```ts
import { computeAnchorBaselines, selectCalibratedAtoms } from '../../../src/recall/t1-atom-calibration';

const anchors = Array.from({ length: 12 }, (_, i) => `c${i}`);
const flat = Array(12).fill(0.5);
const baselines = computeAnchorBaselines(anchors.map(() => flat), [flat, flat]);

test('flat text yields zero atoms', () => {
  expect(baselines).toEqual(flat);
  expect(selectCalibratedAtoms(anchors.map((termId, i) => ({ termId, cosine: flat[i] })), baselines)).toEqual([]);
});

test('a hub anchor at its baseline contributes nothing', () => {
  const raw = anchors.map((termId, i) => ({ termId, cosine: i === 0 ? 0.6 : 0.5 }));
  expect(selectCalibratedAtoms(raw, Array(12).fill(0.5))).toEqual([]);
});

test('the single standing-out atom survives with its centered score', () => {
  const raw = anchors.map((termId, i) => ({ termId, cosine: i === 3 ? 0.72 : 0.5 }));
  const out = selectCalibratedAtoms(raw, Array(12).fill(0.5));
  expect(out).toHaveLength(1);
  expect(out[0]).toEqual({ termId: 'c3', score: expect.closeTo(0.2017, 3) });
});

test('top2 keeps the runner-up only when it stands out', () => {
  const raw = anchors.map((termId, i) => ({ termId, cosine: i === 3 ? 0.72 : i === 4 ? 0.65 : 0.5 }));
  expect(selectCalibratedAtoms(raw, Array(12).fill(0.5)).map((a) => a.termId)).toEqual(['c3', 'c4']);
});

test('minTop1 suppresses a weak best atom', () => {
  const raw = anchors.map((termId, i) => ({ termId, cosine: i === 0 ? 0.54 : 0.5 }));
  expect(selectCalibratedAtoms(raw, Array(12).fill(0.5))).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-atom-calibration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module and rename the field**

Math: `b_k = mean_i cos(ref_i, anchor_k)`; `s_k = cos_k - b_k`; `mean_s = mean(s)`; `score_k = s_k - mean_s`. Return `[]` when `max(score) < minTop1`. Keep `score >= minScore`, sort desc, slice `topK`. Round to 6 decimals. Import `cosineSimilarity` from `t1-semantic-atoms`.

In `t1-sparse.ts`, remove `MIN_SEMANTIC_COSINE` filtering (calibration already selected) and store `weight: atom.score`; keep the max-terms cap. Update every `{ termId, cosine }` atom literal in source and tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-atom-calibration.test.ts tests/unit/recall/t1-encoding.test.ts tests/unit/turn-pipeline-features.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/t1-atom-calibration.ts gateway/src/recall/t1-sparse.ts gateway/src/recall/t1-encode.ts gateway/src/recall/turn-pipeline.ts gateway/tests/unit/recall/t1-atom-calibration.test.ts gateway/tests/unit/recall/t1-encoding.test.ts gateway/tests/unit/turn-pipeline-features.test.ts
git commit -m "feat(memory): calibrate T1 atom selection"
```

---

### Task 2: Encoder applies calibration

**Files:**
- Modify: `gateway/src/recall/t1-semantic-atoms.ts`
- Modify: `gateway/src/memory/gateway-db.ts` (`sampleTurnTexts`)
- Test: `gateway/tests/unit/recall/t1-semantic-atoms.test.ts`

**Interfaces:**
- Consumes: `selectCalibratedAtoms`, `computeAnchorBaselines`, `T1SparseAtom.score` (Task 1).
- Produces:
```ts
export interface T1SemanticEncoderOptions {
  /** Legacy raw path; ignored once calibration is active. */
  minCosine?: number;
  maxAtoms?: number;
  anchors?: Array<{ termId: string; text: string }>;
  /** Reference population for per-anchor baselines (default: built-in list). */
  referenceTexts?: () => string[];
  /** Test/ops seam: precomputed baselines; skips reference embedding. */
  baselines?: number[];
  select?: SelectAtomOptions;
}
export function getT1AtomCalibration(): {
  anchors: number;
  referenceCount: number;
  baselines: number[];
} | null;
export function resetT1AtomCalibration(): void; // test seam
// gateway-db
sampleTurnTexts(limit: number): string[];
```

- [ ] **Step 1: Write the failing test**

```ts
// Helper: fake embedder from a term -> precomputed vector map; anchor vectors
// are injected via opts.anchors and a fixed 4-dim space.
test('a strong signal keeps one atom; OOD text keeps none', async () => {
  const encoder = new T1SemanticEncoder(fakeEmbedder, {
    anchors: ANCHORS_4,
    baselines: [0.5, 0.5, 0.5, 0.5],
  });
  const out = await encoder.encodeMany([
    { traceId: 'signal', text: 'unparseable JSON' },
    { traceId: 'ood', text: 'weather tomorrow' },
  ]);
  expect(out.get('signal')!.map((a) => a.termId)).toEqual(['error:json_parse']);
  expect(out.has('ood')).toBe(false);
});

test('referenceTexts sets calibration state once', async () => {
  resetT1AtomCalibration();
  const encoder = new T1SemanticEncoder(fakeEmbedder, {
    anchors: ANCHORS_4,
    referenceTexts: () => ['ref-a', 'ref-b'],
  });
  await encoder.encodeMany([{ traceId: 'a', text: 'x' }]);
  expect(getT1AtomCalibration()).toMatchObject({ anchors: 4, referenceCount: 2 });
  const callsAfterFirst = fakeEmbedder.embed.mock.calls.length;
  await encoder.encodeMany([{ traceId: 'b', text: 'y' }]);
  // reference + anchors must not be re-embedded
  expect(fakeEmbedder.embed.mock.calls.length).toBe(callsAfterFirst + 1);
});

test('two providers get independent calibration', async () => {
  const a = new T1SemanticEncoder({ embed: embedA }, { anchors: ANCHORS_4, referenceTexts: () => ['a'] });
  const b = new T1SemanticEncoder({ embed: embedB }, { anchors: ANCHORS_4, referenceTexts: () => ['b'] });
  await a.encodeMany([{ traceId: 'x', text: 'x' }]);
  await b.encodeMany([{ traceId: 'y', text: 'y' }]);
  expect(embedA).toHaveBeenCalled();
  expect(embedB).toHaveBeenCalled();
});

test('empty reference list falls back to the built-in list', async () => {
  const encoder = new T1SemanticEncoder(fakeEmbedder, {
    anchors: ANCHORS_4,
    referenceTexts: () => [],
  });
  await encoder.encodeMany([{ traceId: 'a', text: 'x' }]);
  expect(getT1AtomCalibration()!.referenceCount).toBeGreaterThan(0);
});

test('provider failure is fail-open', async () => {
  const encoder = new T1SemanticEncoder({ embed: async () => { throw new Error('down'); } });
  expect(await encoder.encodeMany([{ traceId: 'a', text: 'x' }])).toEqual(new Map());
});
```

- [ ] **Step 2: Run; expect failures.**

- [ ] **Step 3: Implement**
  - Cache `{ baselines, referenceCount }` lazily per encoder instance. Reference texts: `opts.referenceTexts?.()` filtered non-empty, else `DEFAULT_REFERENCE_TEXTS` (the 24 zh/en sentences from the design). Embed once with `kind:'document'`.
  - Use `selectCalibratedAtoms` per turn; set the module-level calibration snapshot (anchors count, reference count, baselines) for stats.
  - `sampleTurnTexts(limit)`: deterministic `ORDER BY trace_id` over turns, take observation/archive content, truncate 500, dedupe, return `[]` when empty. Put it next to `readTrajectoryEvents`.

- [ ] **Step 4: Run tests**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-semantic-atoms.test.ts tests/unit/recall/t1-encoding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/t1-semantic-atoms.ts gateway/src/memory/gateway-db.ts gateway/tests/unit/recall/t1-semantic-atoms.test.ts
git commit -m "feat(memory): apply calibrated atoms in the T1 encoder"
```

---

### Task 3: Query-side atoms

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts` (`searchT1Sparse` signature)
- Modify: `gateway/src/recall/t1-search.ts`
- Modify: `gateway/src/kernel.ts` (`semanticAtomsFor` passes reference texts)
- Test: `gateway/tests/unit/recall/t1-query-atoms.test.ts`

**Interfaces:**
- Consumes: `T1SemanticEncoder`, `T1SparseAtom`, `sampleTurnTexts`.
- Produces:
```ts
searchT1Sparse(query: string, topK: number, extraTermIds?: string[]): T1LexicalHit[];
export function createGatewayT1Search(
  db: GatewayDatabase,
  getRuntime?: () => EmbeddingRuntime | null,
  opts?: { atomsForQuery?: (query: string) => Promise<T1SparseAtom[]> },
): (query: string, k: number) => Promise<T1Hit[]>;
```

- [ ] **Step 1: Write the failing test**

```ts
test('extra ids make stored sem: atoms reachable', () => {
  // seed one turn + upsertSparseTerms with
  // { termId: 'sem:error:json_parse', kind: 'semantic', weight: 0.2, model: 'sparse-embed-v1' }
  expect(db.searchT1Sparse('weather', 5)).toHaveLength(0);
  expect(db.searchT1Sparse('weather', 5, ['sem:error:json_parse'])[0].traceId).toBe(traceId);
});

test('T1 search passes query atoms into the sparse channel', async () => {
  const seen: string[][] = [];
  jest.spyOn(db, 'searchT1Sparse').mockImplementation((_q, _k, extra = []) => { seen.push(extra); return []; });
  const search = createGatewayT1Search(db, () => null, {
    atomsForQuery: async () => [{ termId: 'error:json_parse', score: 0.2 }],
  });
  await search('解码失败', 3);
  expect(seen[0]).toContain('sem:error:json_parse');
});

test('atom failure leaves lexical hits intact', async () => {
  const search = createGatewayT1Search(db, () => null, {
    atomsForQuery: async () => { throw new Error('down'); },
  });
  await expect(search('解码失败', 3)).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run; expect failures.**

- [ ] **Step 3: Implement**
  - `searchT1Sparse`: `const termIds = [...new Set([...querySparseTermIds(query), ...(extraTermIds ?? [])])].slice(0, 64)`.
  - `createGatewayT1Search`: fetch the runtime once. If `config.recall.t1Recall.semanticAtoms !== 'off'`, compute atoms via `opts.atomsForQuery` or the default `getT1SemanticEncoder(runtime.provider, { referenceTexts: () => db.sampleTurnTexts(24) })`; pass `sem:<id>` for each atom.
  - Kernel: `semanticAtomsFor` passes the same `referenceTexts` closure.

- [ ] **Step 4: Run tests + verify the boundary path**

Run: `npx jest --runInBand --forceExit tests/unit/recall/t1-query-atoms.test.ts tests/unit/mcp/search-t1-layer.test.ts`
Then: `grep -rn "searchT1(" gateway/src/recall/recall-context.ts gateway/src/recall/snapshot-builder.ts`
Expected: only `snapshot-builder.ts` (async path), proving the sync boundary path is untouched.

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(memory): reach T1 semantic atoms from queries"
```

---

### Task 4: intent_shift via atom Jaccard

**Files:**
- Modify: `gateway/src/recall/t1-episode-boundary.ts`
- Test: `gateway/tests/unit/recall/t1-episode-boundary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('one shared atom out of a large episode profile still splits', () => {
  const out = ranges([
    turn(1, { isUserTurn: true, conceptIds: ['concept:shared'], semanticAtoms: ['a', 'b', 'c', 'd', 'e', 'f'], intent: 'fix parser' }),
    turn(2, { semanticAtoms: ['a', 'f'] }),
    turn(3, { isUserTurn: true, conceptIds: ['concept:shared'], semanticAtoms: ['a', 'z'], intent: 'ship release' }),
  ]);
  // Jaccard = |{a}| / |{a,b,c,d,e,f,z}| = 1/7 < 0.2 -> split
  expect(out.map((r) => r.startTurn)).toEqual([1, 3]);
  expect(out[1].boundaryReason).toBe('intent_shift');
});

test('half-overlapping atom sets do not split', () => {
  const out = ranges([
    turn(1, { isUserTurn: true, conceptIds: ['concept:shared'], semanticAtoms: ['a', 'b'], intent: 'fix parser' }),
    turn(2),
    turn(3, { isUserTurn: true, conceptIds: ['concept:shared'], semanticAtoms: ['b', 'c'], intent: 'ship release' }),
  ]);
  expect(out.map((r) => r.startTurn)).toEqual([1]);
});
```

- [ ] **Step 2: Run; the first test fails** (current `!intersects` sees `a` shared and refuses to split).

- [ ] **Step 3: Implement** `jaccard(atoms, turnAtoms) < 0.2` in place of `!intersects(atoms, turnAtoms)`; keep the intent-token condition.

- [ ] **Step 4: Run the suite; commit.**

```bash
git commit -am "feat(memory): split episodes on atom Jaccard"
```

---

### Task 5: Turn-code + atom backfill

**Files:**
- Create: `gateway/src/recall/t1-atom-backfill.ts`
- Modify: `gateway/src/memory/gateway-db.ts` (`listTurnsMissingTurnCode`, `t1CodeStats`)
- Modify: `gateway/src/recall/t1-encode.ts` (`atomsAttempted` marker)
- Modify: `gateway/src/automation-engine.ts` (`memory:decay` bounded pass)
- Create: `gateway/scripts/backfill-t1-atoms.ts`
- Test: `gateway/tests/unit/recall/t1-atom-backfill.test.ts`

**Interfaces:**
- Produces:
```ts
export async function backfillT1Atoms(
  db: GatewayDatabase,
  encodeAtoms: (turns: Array<{ traceId: string; text: string }>) => Promise<Map<string, T1SparseAtom[]>>,
  opts?: { limit?: number; batchSize?: number },
): Promise<{ scanned: number; encoded: number; failed: number; sessionIds: string[] }>;

listTurnsMissingTurnCode(limit: number): Array<{ trace_id: string; session_id: string; turn_seq: number }>;
t1CodeStats(): { turns: number; features: number; actors: number; concepts: number; atoms: number };
```

The live DB has **zero** turn code for 4,380 turns, so this pass writes the whole
code (features, actors, concepts, lexical sparse, `sem:` atoms), not just atoms.

- [ ] **Step 1: Write the failing test**

```ts
test('backfill is bounded, converges, and preserves lexical terms', async () => {
  seed 3 turns with lexical concept terms;
  const first = await backfillT1Atoms(db, fakeAtoms, { limit: 2 });
  expect(first).toMatchObject({ scanned: 2, encoded: 2, failed: 0 });
  const second = await backfillT1Atoms(db, fakeAtoms, { limit: 2 });
  expect(second).toMatchObject({ scanned: 1, encoded: 1 });
  expect((await backfillT1Atoms(db, fakeAtoms, { limit: 2 })).scanned).toBe(0);
  expect(db.getSparseTerms(traceId).some((t) => t.kind === 'concept')).toBe(true);
  expect(db.getSparseTerms(traceId).some((t) => t.kind === 'semantic')).toBe(true);
});

test('a turn with zero atoms is marked and not rescanned', async () => {
  // encoder returns an empty map for this trace
  await backfillT1Atoms(db, async () => new Map(), { limit: 1 });
  expect((await backfillT1Atoms(db, async () => new Map(), { limit: 1 })).scanned).toBe(0);
});
```

- [ ] **Step 2: Run; expect failure.**

- [ ] **Step 3: Implement**
  - Select turns with no `t1_turn_encoding` row at all (covers historical turns with no features/actors/concepts either).
  - Join observation/archive content per turn, truncate 2000.
  - Encode in batches; call `encodeT1Turn(turn, deps, { atoms, atomsAttempted: true })`.
  - In `encodeT1Turn`, `model = opts.atomsAttempted ? SPARSE_EMBED_MODEL : (sparse[0]?.model ?? SPARSE_LEX_MODEL)`.
  - Per-turn try/catch; collect `sessionIds`.

- [ ] **Step 4: Run the test.**

- [ ] **Step 5: Wire the daily decay**: after the T1 vector backfill, `backfillT1Atoms(db, encoderFn, { limit: 128 })` when `semanticAtoms !== 'off'`; add counts to the heartbeat.

- [ ] **Step 6: Script**
  - `initEmbeddingRuntime({ baseDir: config.resolvePath(), cfg: config.memory.embedding, vectorDb: db.getStore() })`
  - loop until `scanned === 0` or `--limit` reached; print `{pass, scanned, encoded, failed}`.
  - after each pass, `rebuildSessionEpisodes` for `sessionIds`.
  - `await runtime.provider.dispose?.()` in a `finally`.

- [ ] **Step 7: Commit.**

---

### Task 6: Stats

**Files:**
- Modify: `gateway/src/routes/memory.ts`
- Modify: `gateway/tests/unit/routes/memory-wiring.test.ts`

- [ ] **Step 1: Add the expectation**

```ts
atoms: { turns: 2, atoms: 3, avgPerTurn: 1.5, calibrated: true },
code: { turns: 3, features: 3, actors: 2, concepts: 3 },
```

- [ ] **Step 2: Run; fail.**
- [ ] **Step 3: Implement** `t1CodeStats()` + `getT1AtomCalibration()`; fail-open `{turns:0, atoms:0, avgPerTurn:0, calibrated:false}` and `{turns:0, features:0, actors:0, concepts:0}` when the tables are absent.
- [ ] **Step 4: Run; pass; commit.**

---

### Task 7: Real-model eval

**Files:**
- Create: `evaluation/t1/src/real-embedding.ts`
- Create: `evaluation/t1/src/run-real-atoms.ts`
- Modify: root `package.json` (`eval:t1:real`)

- [ ] **Step 1: Implement `createRealEmbedder(baseUrl)`** (POST `/v1/embeddings`, index-ordered, 10 s timeout).
- [ ] **Step 2: Script**: seed fixtures; run the 16 baseline queries under three sparse modes — off, raw (`0.35/top8`), calibrated (Task 1) — and print `recall@3`, MRR, atoms/turn, pairwise overlap, and the `q-parse-holdout` atom. Query atoms use the same calibrated encoder.
- [ ] **Step 3: Run against 14700 and record the table** in the release note.
- [ ] **Step 4: Commit the script only; never commit a baseline produced by a non-deterministic model.**

---

### Task 8: Live rollout + measurement

**Files:** `docs/releases/2026-11-17-t1-atom-calibration.md` (new)

- [ ] **Step 1: Build main**

Run: `npm run build` at repo root.
Expected: rc=0; `gateway/dist/release.json` epoch bumped.

- [ ] **Step 2: Restart the gateway**

Use the `mafw-gateway-restart` skill. If a goal run is active, wait for it. Expected: `/health` 200, `mafw status` running, no orphaned llama-server.

- [ ] **Step 3: Verify schema + boot backfill**

```bash
node -e "const D=require('better-sqlite3');const db=new D(process.env.USERPROFILE+'/.mafw/memory/gateway.db',{readonly:true});console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name IN ('t1_sparse_terms','t1_episodes')\").all())"
```
Expected: both tables. Then `curl http://127.0.0.1:3000/api/memory/stats` → `t1.atoms`, `t1.episodes` present.

- [ ] **Step 4: Backfill turn code + atoms**

```bash
cd gateway && npx ts-node --transpile-only --project tsconfig.json scripts/backfill-t1-atoms.ts --limit 5000
```
Expected: `scanned` 4,380 total, `encoded` ≈ all, `failed` 0.
Before: `features=0 actors=0 concepts=0 atoms=0`; after: all > 0, atoms/turn ≈ 1.2,
`sem:` rows > 0.

- [ ] **Step 5: Rebuild episodes** (the script does it per pass; verify counts):
```bash
node -e "... SELECT boundary_source, boundary_reason, COUNT(*) FROM t1_episodes GROUP BY 1,2 ..."
```
Expected: > 0 episodes, and after turn code exists the distribution can include
`declared`/`inferred`; before the backfill it is only `session_end`/`max_length`/`session_start`.

- [ ] **Step 6: Measure real recall**

Run 5 queries through `/api/memory/search?layer=episodes` and `layer=both`:
`解析失败`, `解码失败`, `覆盖率`, `合并`, `连接重置`, plus one OOD `明天天气`.
Record: top episode/turn, sources, whether `sem` contributed.

- [ ] **Step 7: Record the release note** with commit hash, new test count, full-suite counts, the real-model table, and rollback switches.

---

## Review Focus

- Embedding provider down or slow → capture still writes lexical/concept code; T1 search still returns lexical hits. (Task 2/3 tests)
- Model switch (ONNX → llama.cpp, or dims change) → baselines recomputed, never reused. (Task 2: two-provider test)
- Fresh install / empty DB → built-in reference list, not an empty baseline array. (Task 2 test)
- Out-of-domain query → zero atoms; sparse abstains instead of forcing `metric:coverage`. (Task 1/2 tests)
- Backfill racing live capture on the same trace → `DELETE + INSERT` in one transaction; no duplicate `(trace_id, term_id, model)`. (Task 5 test)
- A turn that legitimately has zero atoms → marked `sparse-embed-v1` so the backfill converges. (Task 5 test)

## Self-review notes

- Task 4's failing test is the "one shared atom out of a large episode profile" case; the naive "partially overlapping" case already passes under `!intersects`, so it is not the red test.
- The `T1SparseAtom.cosine` → `score` rename lives in Task 1 so Task 1's pure module compiles; Task 2 only consumes it.
- Stats are read on demand from SQLite; no cache invalidation.
- No HTTP route is added, so the E10 contract ledgers do not move.
