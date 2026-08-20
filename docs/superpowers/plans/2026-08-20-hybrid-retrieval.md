# Plan: bm25 + Dense Hybrid Retrieval with RRF Fusion

## Context

Current memory retrieval is BM25-only (R@10=0.949, R@1=0.586 on LongMemEval). BM25
misses semantic paraphrase matches — e.g. "preferred programming language" won't match
"favorite coding language". Adding a dense (embedding) retrieval path and fusing with
RRF is the lowest-latency way to close this gap (<10ms, no online model inference).

## Architecture

```
Query
  ├─→ BM25 (primary_abstraction + cue_anchors) → top-50 ranked list
  └─→ Dense (embedding cosine)                  → top-50 ranked list
                                                        │
                                              RRF Fusion (k=60)
                                                        │
                                                  top-20 results
```

- **Embedding model**: `Xenova/all-MiniLM-L6-v2` (384-dim, ~80MB, <1ms/query for <1000 entries)
- **Brute-force cosine**: no FAISS/HNSW needed at this scale
- **Vectors persisted** in `.harmonic_index.json` alongside entries (lazy computation)
- **Config**: `config.search.dense.enabled`, `config.search.dense.model`, `config.search.dense.weight`

## Files to Create/Modify

### 1. NEW: `gateway/src/core/memory/dense-index.ts`

Standalone dense retrieval engine:
- `DenseIndex` class with `EmbeddingProvider` abstraction
- `EmbeddingProvider` interface: `embed(texts: string[]) => Promise<Float32Array[]>`
- `HFEmbeddingProvider`: lazy-loads `feature-extraction` pipeline from `@huggingface/transformers`
- `CosineIndex`: brute-force cosine similarity search over Float32Array vectors
- Persistence: `save(path)` / `load(path)` writing `{ id: Float32Array }` map as JSON
- `buildFromEntries(entries, textFn)`: batch-embed all entries
- `search(query, topK)`: embed query → cosine against all vectors → ranked results

### 2. MODIFY: `gateway/src/core/memory/harmonic-types.ts`

Add optional `dense_vector?: number[]` to `HarmonicIndexEntry`:
```typescript
export interface HarmonicIndexEntry {
  // ... existing fields ...
  dense_vector?: number[];  // persisted embedding, lazy-computed
}
```

### 3. MODIFY: `gateway/src/core/memory/harmonic-index.ts`

In `HarmonicIndexManager`:
- Add `denseIndex: DenseIndex | null` field
- Lazy-init dense index on first search (if `config.search.dense.enabled`)
- New `denseSearchScored(query, topK)` method
- Modify `searchScored()`: when dense enabled, run BM25 + dense in parallel, RRF-fuse
- On `addEntry()`: mark dense index as dirty (rebuild on next search)
- On `save()`: persist dense vectors alongside index entries
- Load dense vectors from entries on init

RRF formula: `score(d) = Σ 1/(k + rank_i(d))` where k=60, rank_i = position in each retriever's ranked list (1-indexed, unseen=∞).

### 4. MODIFY: `gateway/src/config.ts`

Add dense config under `search`:
```typescript
search: {
  // ... existing ...
  dense: {
    enabled: boolean;      // default false
    model: string;         // default 'Xenova/all-MiniLM-L6-v2'
    weight: number;        // RRF weight (default 1.0, same as bm25)
    rrfK: number;          // RRF constant (default 60)
  }
}
```

### 5. MODIFY: `gateway/src/mcp/handlers/search-hybrid.ts`

No change needed — it delegates to `memory.search()` which calls `searchScored()`.
The hybrid fusion is transparent to the MCP layer.

### 6. MODIFY: `evaluation/longmemeval/src/l1-retrieval.ts`

Add `--retriever hybrid` option that enables dense + BM25 fusion. This lets us
A/B test: `--retriever bm25` vs `--retriever hybrid` on the same questions.

### 7. NEW: `tests/unit/dense-index.test.ts`

Unit tests for DenseIndex: embed, search, save/load round-trip, empty index,
cosine similarity correctness. Mock the embedding pipeline.

### 8. MODIFY: `tests/unit/vector-index.test.ts`

Fix the failing test: mock needs to handle `@huggingface/transformers` v4 API
（the mock returns `{ data }` but pipeline now returns Tensor with `.dims`）.

## Implementation Order

1. Create `dense-index.ts` + unit tests (standalone, no integration)
2. Add `dense_vector` to `HarmonicIndexEntry` type
3. Modify `HarmonicIndexManager` to integrate dense index
4. Add config for dense settings
5. Run L1 benchmark: `--retriever bm25` baseline vs `--retriever hybrid`
6. Fix vector-index.test.ts mock for v4

## Verification

1. **Unit tests**: `npm run test:unit -- tests/unit/dense-index.test.ts`
2. **Build**: `npm run build` (no type errors)
3. **L1 benchmark**: compare R@1/R@10 between bm25-only and hybrid
   ```bash
   # Baseline
   npx ts-node --project evaluation/longmemeval/tsconfig.json \
     evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity session --retriever bm25
   # Hybrid
   npx ts-node --project evaluation/longmemeval/tsconfig.json \
     evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity session --retriever hybrid
   ```
4. **Latency**: should be <10ms total (embedding + cosine + RRF for ~1000 entries)

## Risk Mitigation

- Dense is **opt-in** (`dense.enabled: false` default) — zero impact on existing users
- Brute-force cosine is O(n·d) per query — fine for <5000 entries; if scale grows,
  swap to hnswlib-node later (same `DenseIndex` API)
- Model download uses hf-mirror.com (already configured in `reranker.ts`)
- If model unavailable, fall back to BM25-only (graceful degradation)
