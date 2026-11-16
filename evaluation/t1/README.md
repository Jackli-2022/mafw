# T1 retrieval baseline

Measures the T1 retrieval pipeline, not a real embedding model:

- **FTS** — `t1_fts` trigram lexical channel
- **dense** — T1 vector channel via `makeT1Search`
- **feature** — `t1_feature_fts` over the sparse event code (intent/action/error/decision/entities)
- **concept** — `t1_turn_concepts` seeded alias dictionary (Chinese ↔ English synonyms)
- **actor** — `t1_turn_actors`, same-turn AND plus a bounded 12-turn session-window fallback
- **sparse** — `t1_sparse_terms` inverted index (concept + actor + entity + hashed token + embedding-derived semantic atoms)
- **episodes** — `searchT1Episodes`: turn hits aggregated into `t1_episodes`
- **fused** — RRF of dense + lexical + feature + concept + actor + sparse

The dense channel uses a deterministic **concept embedding** (`synthetic-concept-v1`) so the baseline is offline and reproducible. It is intentionally simple: it validates channel wiring and fusion, not model quality.

## Run

```bash
npm run eval:t1
```

Writes `evaluation/t1/baseline.json` and prints a summary table.

## Current baseline (fixtureVersion 3)

| channel | recall@3 | MRR | no-answer |
|---|---:|---:|---:|
| FTS | 0.625 | 0.563 | 1.00 |
| dense | 0.625 | 0.594 | 1.00 |
| feature | 0.625 | 0.563 | 1.00 |
| concept | 0.938 | 0.938 | 1.00 |
| actor | 0.188 | 0.188 | 1.00 |
| sparse | 0.938 | 0.875 | 1.00 |
| episodes | 0.938 | 0.938 | 1.00 |
| fused | 0.938 | 0.938 | 1.00 |

Misses:

- FTS: `q-parse-cn`, `q-coverage-cn`, `q-merge`, `q-synonym-net`, `q-episode-cn`, `q-parse-holdout`
- dense: `q-code`, `q-synonym-net`, `q-actor-pair`, `q-actor-cn`, `q-episode-cn`, `q-parse-holdout`
- feature: same lexical misses as FTS
- concept / sparse / episodes / fused: `q-parse-holdout` only

Interpretation:

- **FTS / feature** are lexical: strong for paths, error codes, structured fields; weak for Chinese synonyms.
- **concept** is the synonym layer. It is deterministic and auditable, but coverage is exactly the alias table.
- **actor** is a specialized channel: it answers "who took part", not "what was said".
- **sparse** is the union of concept + lexical atoms (semantic atoms when the encoder is wired).
- **episodes** aggregates turns into the "what happened" unit; `q-episode-deploy` / `q-episode-cn` both resolve to the deploy-plan episode.
- **fused** is the safety net: exact code + structured field + synonym + participant + episode each cover a different miss.

### Honest caveat: the concept score is partly circular

Most fixture queries use terms that are in `DEFAULT_CONCEPT_ALIASES` by design (they were added to demonstrate the channel). That measures wiring, not open-world synonym coverage.

`q-parse-holdout` (`解码失败`) is deliberately **not** in the alias table, the raw fixture text, or the synthetic embedding concepts. It is the one fused/episode miss, and it marks the current boundary:

> curated aliases cover known synonyms; unseen paraphrase still needs `semantic` atoms from the embedding encoder (or a dense fallback).

Do not treat the synthetic numbers as production retrieval quality. Replace `synthetic-concept-v1` with a real local embedding model only when the eval can run deterministically offline.

## Adding cases

1. Add a turn to `FIXTURE_TURNS` (or a query to `BASELINE_QUERIES`).
2. Bump `fixtureVersion` in `src/run.ts`.
3. Run `npm run eval:t1`.
4. Review the diff in `baseline.json`.

A fixture may declare `events: [{ agent, toolName }]`; the seed writes them to
`trajectory_events` so actor extraction exercises the real `(session_id,
turn_id)` join. Episodes are rebuilt for every fixture session after seeding.
