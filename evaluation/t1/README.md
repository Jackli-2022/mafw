# T1 retrieval baseline

Measures the T1 retrieval pipeline, not a real embedding model:

- **FTS** — `t1_fts` trigram lexical channel
- **dense** — T1 vector channel via `makeT1Search`
- **fused** — RRF of dense + lexical

The dense channel uses a deterministic **concept embedding** (`synthetic-concept-v1`) so the baseline is offline and reproducible. It is intentionally simple: it validates channel wiring and fusion, not model quality.

## Run

```bash
npm run eval:t1
```

Writes `evaluation/t1/baseline.json` and prints a summary table.

## Current baseline (fixtureVersion 1)

| channel | recall@3 | MRR | no-answer |
|---|---:|---:|---:|
| FTS | 0.70 | 0.70 | 1.00 |
| dense | 0.90 | 0.90 | 1.00 |
| fused | 1.00 | 1.00 | 1.00 |

Misses:

- FTS: `q-parse-cn`, `q-coverage-cn`, `q-merge` (Chinese synonym queries)
- dense: `q-code` (`ECONNRESET` exact identifier)
- fused: none

This is why T1 should keep **both** channels: lexical for identifiers/errors, dense for paraphrase/synonyms, fused for coverage.

## Adding cases

1. Add a turn to `FIXTURE_TURNS` (or a query to `BASELINE_QUERIES`).
2. Bump `fixtureVersion` in `src/run.ts`.
3. Run `npm run eval:t1`.
4. Review the diff in `baseline.json`.

Do not treat the synthetic numbers as production retrieval quality. Replace `synthetic-concept-v1` with a real local embedding model only when the eval can run deterministically offline.
