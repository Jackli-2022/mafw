# T1 retrieval baseline

Measures the T1 retrieval pipeline, not a real embedding model:

- **FTS** — `t1_fts` trigram lexical channel
- **dense** — T1 vector channel via `makeT1Search`
- **feature** — `t1_feature_fts` over the sparse event code (intent/action/error/decision/entities)
- **fused** — RRF of dense + lexical + feature

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
| feature | 0.70 | 0.70 | 1.00 |
| fused | 1.00 | 1.00 | 1.00 |

Misses:

- FTS: `q-parse-cn`, `q-coverage-cn`, `q-merge` (Chinese synonym queries)
- dense: `q-code` (`ECONNRESET` exact identifier)
- feature: `q-parse-cn`, `q-coverage-cn`, `q-merge` (feature FTS is still lexical; it does not solve paraphrase)
- fused: none

Interpretation:

- FTS / feature are lexical channels: strong for paths, error codes, structured fields; weak for Chinese synonyms.
- dense is still the only channel covering paraphrase/synonym queries in this fixture.
- fused is why all three should remain: exact code + structured field + paraphrase each cover a different miss.

Do not treat the synthetic numbers as production retrieval quality. Replace `synthetic-concept-v1` with a real local embedding model only when the eval can run deterministically offline.

## Adding cases

1. Add a turn to `FIXTURE_TURNS` (or a query to `BASELINE_QUERIES`).
2. Bump `fixtureVersion` in `src/run.ts`.
3. Run `npm run eval:t1`.
4. Review the diff in `baseline.json`.
