# Retrieval Path Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make REST search, MCP `mafw_search_hybrid`, auto-recall live search, and snapshot verification use the same retriever default, score scale, index state, reranker input, and scan-query provenance.

**Architecture:** This is a correctness slice, not a new retrieval algorithm. First pin each divergence with a failing test; then make the smallest production change that removes the divergence. Candidate admission, recency ranking, FOK policy, and note-board behavior stay unchanged.

**Tech Stack:** TypeScript, Jest, Node HTTP route registry, MCP tool handlers.

**Spec:** `docs/research/2026-11-17-brain-retrieval-control-and-next-step.md`

## Global Constraints

- Do not add recency to the main relevance score.
- Do not change note-board must-surface behavior.
- Do not render old recall bodies for `no-memory` / `low-confidence`.
- Do not add a background LLM, dream/reflection producer, or top-k expansion.
- Keep the auto-recall boundary path inside its 100ms contract.
- TDD: every production change starts with a failing test.
- Main checkout only; do not create a worktree.

## Review Focus

- A caller omits `retriever`: it must use the configured BM25 default, not token.
- MCP has two nonzero BM25 scores: ranking must retain their order before graph fusion.
- REST has a shared memory service with graph state: it must use that index, not a fresh disk instance.
- Snapshot verification sees a memory with cue anchors: the reranker input must contain those anchors.
- A scan snapshot was built for topic A but the current query is topic B: it must not inject A.

---

### Task 1: Default retriever is BM25

**Files:**
- Modify: `gateway/src/core/memory/harmonic-index.ts:343-361`
- Create: `gateway/tests/unit/core/memory/search-default-retriever.test.ts`

**Interfaces:**
- Consumes: `HarmonicIndexManager.searchScored(query, topK, options: { retriever?: 'token' | 'bm25' | 'guided' })`
- Produces: omitted `retriever` follows `'bm25'`; explicit `'token'` still selects token.

- [x] **Step 1: Write the failing test**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicIndexManager } from '../../../../src/core/memory/harmonic-index';

describe('searchScored default retriever', () => {
  test('omitted retriever uses BM25, not token substring scoring', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-default-retriever-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    const bm25 = jest.spyOn(index as any, 'bm25SearchScored').mockReturnValue([]);
    const token = jest.spyOn(index as any, 'tokenSearchScored').mockReturnValue([]);

    index.searchScored('mafw_topic_set', 5);
    expect(bm25).toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();

    index.searchScored('mafw_topic_set', 5, { retriever: 'token' });
    expect(token).toHaveBeenCalled();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/core/memory/search-default-retriever.test.ts`
Expected: FAIL because `tokenSearchScored` is called while `bm25SearchScored` is not.

- [x] **Step 3: Implement the branch fix**

Use the already-computed `retriever` for both `actualRetriever` and branch selection.

- [x] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand tests/unit/core/memory/search-default-retriever.test.ts tests/unit/superseded-resolve.test.ts tests/unit/time-anchor.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add gateway/src/core/memory/harmonic-index.ts gateway/tests/unit/core/memory/search-default-retriever.test.ts
git commit -m "fix(memory): honor bm25 default retriever"
```

### Task 2: MCP retains real retrieval scores

**Files:**
- Modify: `gateway/src/mcp/handlers/search-hybrid.ts:130-177`
- Create: `gateway/tests/unit/mcp/search-score-parity.test.ts`

**Interfaces:**
- Consumes: `memory.harmonicIndex.searchScored(query, topK, options)` when available, else `memory.search(...)`.
- Produces: initial/iterative scored candidates carry real scores; graph fusion keeps score and graph channels separate.

- [x] **Step 1: Write the failing test**

```ts
import { handleSearchHybrid } from '../../../src/mcp/handlers/search-hybrid';

const parse = (r: any) => JSON.parse(r.content[0].text);

test('MCP keeps BM25 score order instead of flattening every candidate to 1', async () => {
  const entries = [
    { id: 'low', type: 'semantic', primary_abstraction: 'weak hit' },
    { id: 'high', type: 'semantic', primary_abstraction: 'strong exact hit' },
  ];
  const services: any = {
    memory: {
      harmonicIndex: {
        searchScored: () => [
          { entry: entries[0], score: 0.2 },
          { entry: entries[1], score: 9.9 },
        ],
        getIndex: () => ({ entries }),
        getAnchorGraphStore: () => null,
      },
    },
    mafwDir: undefined,
  };
  const body = parse(await handleSearchHybrid({ query: 'exact hit', topK: 2 }, services));
  expect(body.results.map((r: any) => r.id)).toEqual(['high', 'low']);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/mcp/search-score-parity.test.ts`
Expected: FAIL with `['low', 'high']` because both scores are replaced by `1`.

- [x] **Step 3: Implement score-preserving candidate intake**

Add a helper that calls `harmonicIndex.searchScored` when present, otherwise maps `memory.search` entries to score `0`. Use it for first round, max-round fresh hits, and iterative fresh hits. Do not flatten scores.

- [x] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand tests/unit/mcp/search-score-parity.test.ts tests/unit/mcp/search-t1-layer.test.ts tests/unit/mcp/structured-handlers.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add gateway/src/mcp/handlers/search-hybrid.ts gateway/tests/unit/mcp/search-score-parity.test.ts
git commit -m "fix(mcp): preserve retrieval scores"
```

### Task 3: REST search shares the live index and default retriever

**Files:**
- Modify: `gateway/src/routes/memory.ts:419-459`
- Modify: `gateway/tests/unit/routes/memory-wiring.test.ts`

**Interfaces:**
- Consumes: `deps.memoryService()!.harmonicIndex` and `config.search.defaultRetriever`.
- Produces: REST query uses the shared graph-capable index; no retriever param means the configured default.

- [x] **Step 1: Add the failing test**

Append to `memory-wiring.test.ts`:

```ts
it('search uses the shared harmonic index and configured retriever default', async () => {
  const searchScored = jest.fn(() => [{
    entry: { id: 'mem_shared', type: 'semantic', primary_abstraction: 'shared', cue_anchors: [], energy: 0.8 },
    score: 9,
  }]);
  const { registry } = setup({
    memoryService: () => ({
      harmonicIndex: {
        searchScored,
        getIndex: () => ({ entries: [] }),
      },
    }) as any,
  });
  const r = fakeRes();
  await handlerFor(registry, 'GET', '/api/memory/search?query=shared')!(
    fakeReq({ method: 'GET', url: '/api/memory/search?query=shared' }), r.res,
  );
  expect(r.status).toBe(200);
  expect(searchScored).toHaveBeenCalledWith(
    'shared',
    50,
    expect.objectContaining({ retriever: config.search.defaultRetriever }),
  );
  expect(JSON.parse(r.body).results[0].id).toBe('mem_shared');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/routes/memory-wiring.test.ts`
Expected: FAIL because the route constructs a file store/index and never calls `searchScored`.

- [x] **Step 3: Implement shared-index REST search**

Use the live `harmonicIndex`; use `searchScored` for non-empty queries; retain the existing response mapping and `store.read` enrichment. Keep `hybrid` dense fusion and explicit `retriever=token` behavior.

- [x] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand tests/unit/routes/memory-wiring.test.ts tests/unit/routes/memory-episodes.test.ts tests/unit/api-contract.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add gateway/src/routes/memory.ts gateway/tests/unit/routes/memory-wiring.test.ts
git commit -m "fix(memory): share REST search index"
```

### Task 4: Snapshot reranker sees cue anchors

**Files:**
- Modify: `gateway/src/recall/recall-context.ts:166-193,330-342`
- Modify: `gateway/src/recall/snapshot-builder.ts`
- Modify: `gateway/src/kernel.ts:2723-2761`
- Modify: `gateway/tests/unit/recall/snapshot-builder.test.ts`

**Interfaces:**
- Produces: `RecallMemory.cue_anchors?: string[]`.
- Produces: `rerankerEntryFromRecall(memory: RecallMemory)` returns `{ id, primary_abstraction, cue_anchors, created_at }`.

- [x] **Step 1: Write the failing test**

Add to `snapshot-builder.test.ts`:

```ts
import { buildSnapshot, rerankerEntryFromRecall } from '../../../src/recall/snapshot-builder';

test('snapshot reranker input keeps cue anchors from the retrieved memory', () => {
  const mapped = rerankerEntryFromRecall({
    id: 'mem_a', primary_abstraction: 'mafw_topic_set', memory_value: '',
    energy: 0.8, score: 1, cue_anchors: ['mafw_topic_set', 'session-topic'],
  });
  expect(mapped.cue_anchors).toEqual(['mafw_topic_set', 'session-topic']);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand tests/unit/recall/snapshot-builder.test.ts`
Expected: FAIL because `rerankerEntryFromRecall` does not exist.

- [x] **Step 3: Implement the mapping**

Populate `cue_anchors` in `searchRecallMemories`; use `rerankerEntryFromRecall` in both kernel rerank and verify paths. Missing anchors remain `[]`.

- [x] **Step 4: Run test to verify it passes**

Run: `npx jest --runInBand tests/unit/recall/snapshot-builder.test.ts tests/unit/recall/recall-fok-zone.test.ts tests/unit/recall/layered-recall-render.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add gateway/src/recall/recall-context.ts gateway/src/recall/snapshot-builder.ts gateway/src/kernel.ts gateway/tests/unit/recall/snapshot-builder.test.ts
git commit -m "fix(recall): align snapshot reranker input"
```

### Task 5: Scan snapshots carry and validate their query

**Files:**
- Modify: `gateway/src/recall/index-scan.ts:31-35,481-508`
- Modify: `gateway/src/recall/recall-context.ts:367-371,387-437`
- Modify: `gateway/tests/unit/index-scan-http.test.ts`
- Modify: `gateway/tests/unit/recall-context-scoring.test.ts`

**Interfaces:**
- Produces: `ScanResult.query?: string`, `ScanResult.builtAt?: string`.
- Produces: `mergeScanResults(..., currentQuery?: string)` skips merges when snapshot query containment is below `SNAPSHOT_DEFAULTS.topicShiftThreshold`.

- [x] **Step 1: Write the scan-provenance test**

Add to `index-scan-http.test.ts`:

```ts
it('prefetch remembers which query built the scan snapshot', async () => {
  const svc = new IndexScanService(fakeIndex, { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' }, { apiKey: 'sk-test' });
  (svc as any).scan = async () => ({ relevantIds: [fullId], confidence: 0.9 });
  svc.prefetch('ses_provenance', 'find my preference');
  await new Promise(resolve => setImmediate(resolve));
  const snap = svc.getSnapshot('ses_provenance');
  expect(snap?.query).toBe('find my preference');
  expect(typeof snap?.builtAt).toBe('string');
});
```

- [x] **Step 2: Write the stale-scan rejection test**

Add to `recall-context-scoring.test.ts`:

```ts
test('scan snapshot from a different topic is not injected', async () => {
  const index: any = {
    searchScored: () => [],
    getIndex: () => ({ entries: [entry('old-topic', 'kubernetes deployment failure')] }),
  };
  const snapshot: any = {
    relevantIds: ['old-topic'], confidence: 0.99,
    query: 'kubernetes deployment rollout',
  };
  const res = await searchRecallMemories(index, 'pasta recipe tomato sauce', new Set(), 3, { scanSnapshot: snapshot });
  expect(res).toEqual([]);
});
```

- [x] **Step 3: Run both tests to verify failure**

Run: `npx jest --runInBand tests/unit/index-scan-http.test.ts tests/unit/recall-context-scoring.test.ts`
Expected: provenance test fails on missing `query`; stale-scan test fails because `old-topic` is injected.

- [x] **Step 4: Implement provenance and guard**

`prefetch` attaches query/builtAt. `searchRecallMemories` passes the current query to `mergeScanResults`. Legacy snapshots without `query` keep prior behavior; snapshots with a query must pass containment.

- [x] **Step 5: Run tests to verify they pass**

Run: `npx jest --runInBand tests/unit/index-scan-http.test.ts tests/unit/recall-context-scoring.test.ts tests/unit/index-scan-cap.test.ts tests/unit/index-scan-cooldown.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add gateway/src/recall/index-scan.ts gateway/src/recall/recall-context.ts gateway/tests/unit/index-scan-http.test.ts gateway/tests/unit/recall-context-scoring.test.ts
git commit -m "fix(recall): validate scan snapshot query"
```

### Task 6: Verify the slice

**Files:**
- Modify: `docs/architecture/memory.md` (retriever defaults and REST/MCP parity)
- Modify: `docs/research/2026-11-17-brain-retrieval-control-and-next-step.md` (implementation status only)
- Modify: `docs/releases/2026-11-17-proactive-topic-recall.md` (optional delivery note)

- [x] **Step 1: Run targeted suites**

Run:
```bash
npx jest --runInBand \
  tests/unit/core/memory/search-default-retriever.test.ts \
  tests/unit/mcp/search-score-parity.test.ts \
  tests/unit/mcp/search-t1-layer.test.ts \
  tests/unit/mcp/structured-handlers.test.ts \
  tests/unit/routes/memory-wiring.test.ts \
  tests/unit/routes/memory-episodes.test.ts \
  tests/unit/recall/snapshot-builder.test.ts \
  tests/unit/recall/recall-fok-zone.test.ts \
  tests/unit/index-scan-http.test.ts \
  tests/unit/recall-context-scoring.test.ts \
  tests/unit/api-contract.test.ts
```
Expected: all pass.

- [x] **Step 2: Run typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [x] **Step 3: Run full gateway suite**

Run: `npm test -- --forceExit`
Expected: 0 failed.

- [x] **Step 4: Build and hot-restart**

Run: `npm run build` in `gateway`; write restart token; verify `/health` returns `status: ok` and a new pid.

- [x] **Step 5: Live parity sample**

Call the same query through REST, MCP, and `/api/recall/context`; record IDs, order, path, FOK, and latency. Do not claim quality improvement from parity alone.

- [x] **Step 6: Commit docs and report**

Report commit, new test count, targeted count, full-suite count, and live-sample differences.
