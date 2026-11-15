# T1 retrieval baseline

Measures the T1 retrieval pipeline, not a real embedding model:

- **FTS** — `t1_fts` trigram lexical channel
- **dense** — T1 vector channel via `makeT1Search`
- **feature** — `t1_feature_fts` over the sparse event code (intent/action/error/decision/entities)
- **concept** — `t1_turn_concepts` seeded alias dictionary (Chinese ↔ English synonyms)
- **actor** — `t1_turn_actors`, with same-turn AND semantics plus a bounded 12-turn session-window fallback for multi-actor episodes
- **sparse** — `t1_sparse_terms` inverted index (concept + actor + entity + hashed token + embedding-derived semantic atoms)
- **fused** — RRF of every channel above

The dense channel uses a deterministic **concept embedding** (`synthetic-concept-v1`) so the baseline is offline and reproducible. It is intentionally simple: it validates channel wiring and fusion, not model quality.

## Run

```bash
npm run eval:t1
```

Writes `evaluation/t1/baseline.json` and prints a summary table.

## Current baseline (fixtureVersion 2)

| channel | recall@3 | MRR | no-answer |
|---|---:|---:|---:|
| FTS | 0.643 | 0.571 | 1.00 |
| dense | 0.643 | 0.643 | 1.00 |
| feature | 0.643 | 0.607 | 1.00 |
| concept | 0.929 | 0.857 | 1.00 |
| actor | 0.214 | 0.214 | 1.00 |
| sparse | 0.929 | 0.857 | 1.00 |
| fused | 0.929 | 0.929 | 1.00 |

Misses:

- FTS: `q-parse-cn`, `q-coverage-cn`, `q-merge`, `q-synonym-net`, `q-parse-holdout`
- dense: `q-code`, `q-synonym-net`, `q-actor-pair`, `q-actor-cn`, `q-parse-holdout`
- feature: same lexical misses as FTS
- concept: `q-parse-holdout` only
- actor: every query that does not name a participant (plus the held-out)
- sparse: `q-parse-holdout` only
- fused: `q-parse-holdout` only

Interpretation:

- **FTS / feature** are lexical: strong for paths, error codes, structured fields; weak for Chinese synonyms.
- **concept** is the synonym layer. It is deterministic and auditable, but coverage is exactly the alias table.
- **actor** is a specialized channel: it answers "who took part", not "what was said". A low average recall is expected.
- **sparse** is the union of concept + lexical atoms. Production also writes `semantic` atoms from the embedding encoder; this baseline seeds it without atoms so the channel stays deterministic.
- **fused** is the safety net: exact code + structured field + synonym + participant each cover a different miss.

### Honest caveat: the concept score is partly circular

Most fixture queries use terms that are in `DEFAULT_CONCEPT_ALIASES` by design (they were added to demonstrate the channel). That measures wiring, not open-world synonym coverage.

`q-parse-holdout` (`解码失败`) is deliberately **not** in the alias table, the raw fixture text, or the synthetic embedding concepts. It is the one fused miss, and it marks the current boundary:

> curated aliases cover known synonyms; unseen paraphrase still needs `semantic` atoms from the embedding encoder (or a dense fallback).

Do not treat the synthetic numbers as production retrieval quality. Replace `synthetic-concept-v1` with a real local embedding model only when the eval can run deterministically offline.

## Adding cases

1. Add a turn to `FIXTURE_TURNS` (or a query to `BASELINE_QUERIES`).
2. Bump `fixtureVersion` in `src/run.ts`.
3. Run `npm run eval:t1`.
4. Review the diff in `baseline.json`.

A fixture may declare `events: [{ agent, toolName }]`; the seed writes them to
`trajectory_events` so actor extraction exercises the real `(session_id,
turn_id)` join.
