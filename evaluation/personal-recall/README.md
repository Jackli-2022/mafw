# Personal recall evaluation set

Fixed 40-query regression set for **personal memory recall**, measured against a
running gateway over read-only HTTP. It exists to decide whether a recall
admission change actually helps: the same queries, the same frozen expected
memory ids, two entrypoints, one table.

This is **not** a benchmark. It is a personal regression set over one user's
live corpus (`~/.mafw/memory`); the numbers describe this corpus at freeze time,
not general retrieval quality.

## Corpus dependence

- Expectations were selected from the live harmonic index on **2026-11-18**
  (`16732` index entries, `11510` active at selection time) and are frozen in
  `queries.json`. The runner never derives expectations from live ranks.
- The corpus keeps growing and decaying. Before measuring, the runner resolves
  every frozen id through `GET /api/memory/get?id=<6-char tail>` and fails fast
  with `unknown memory id(s)` if a target no longer exists.
- Re-select a case only when its target was legitimately superseded or deleted.
  Prefer replacing the id over relaxing the query; a renamed expectation turns
  the set into a moving target.
- `must_exclude` ids are the superseded predecessors of `current-state`
  targets. They are the stale-injection controls.

## Categories (10 each, 40 total)

| category | what it asks | expectation |
|---|---|---|
| `current-state` | "what is the current rule/state now?" | active supersede-chain head; predecessor in `must_exclude` |
| `exact` | identifier, code symbol or verbatim title | the memory that owns that identifier/title |
| `implicit` | natural paraphrase / continuation, no exact identifier | the single best semantic target |
| `negative` | true no-answer control (topic absent from corpus) | empty `must_include`; any injected pointer is a false injection |

`exact` includes the known divergence cases `5cd9885f5` and
`Proactive Topic Recall 主题工具设计`, plus the working comparison
`检索路径 parity 修复上线与质量缺口`.

`negative` controls were verified against the frozen index with a keyword scan
(no memory mentions the topic, e.g. 冰岛 / 企鹅 / sourdough / cert-manager).

## Entrypoints

- **REST** — `GET /api/memory/search?query=<q>&topK=3`. Raw index surface: no
  reranker, no graph expansion. This is what "REST rank" means elsewhere.
- **AUTO** — `GET /api/recall/context?query=<q>`, no `sessionID` (so snapshot,
  topic state and goal snapshot are inert). This is the live boundary path
  including the FOK outlet that can suppress the recall body.

Note-board, pinned (`<user-profile>`) and `<agent-priors>` blocks are
**stripped** before parsing auto ids. They are must-surface layers, not related
recall; a sticky reminder must never score as a hit or as a false injection.

`#mem-xxxxxx` pointers are matched by the **last 6 id chars**, exactly as
`formatRecallContext` renders them. Neighbour lines (`↳`) are injected
evidence and count toward inclusion, but they never compete for ranking
(`auto.anchors` records the ranked lines separately).

## Run

```bash
node evaluation/personal-recall/run.js --out C:\path\to\personal-recall-before.json
# optional: --base-url http://127.0.0.1:3000  --fixture <path>  --timeout-ms 20000
```

`--out` must be absolute. The report contains per-entry REST/AUTO ids, ranks,
hit flags, entrypoint agreement, latency, the raw auto `pointers`, per-category
rollups and the summary. Exit code is 0 for a completed measurement even when
cases miss; fixture/transport errors exit non-zero.

Unit contract: `gateway/tests/unit/eval/personal-recall-runner.test.ts`
(`npx jest --runInBand --forceExit tests/unit/eval/personal-recall-runner.test.ts`
from `gateway/`).

## Baseline 2026-11-18 (before admission change)

Artifact: `%TEMP%\opencode\personal-recall-before.json` (40 rows).

| metric | value |
|---|---|
| REST hit@1 | 43.3% |
| REST hit@3 | 53.3% |
| REST MRR | 0.472 |
| AUTO hit (injected evidence) | 40.0% (12/30) |
| AUTO rank@1 | 10/30 |
| False injection (negatives) | 20.0% (2/10) |
| Stale injection (`must_exclude`) | 0 / 40 |
| Entrypoint agreement | 86.7% (26/30) |
| REST latency p50 / p95 | 89 ms / 98 ms |
| AUTO latency p50 / p95 | 252 ms / 406 ms |

By category:

| category | REST hit@3 | AUTO hit | false injection |
|---|---:|---:|---:|
| current-state | 60% | 60% | 0% |
| exact | 80% | 50% | 0% |
| implicit | 20% | 10% | 0% |
| negative | n/a | n/a | 20% |

Reading the baseline:

- **The divergence signature is visible.** All 4 disagreements are
  `REST hit@3 && AUTO miss`: `5cd9885f5`, the topic-tool design title, the graph
  release commit, and the multi-session LongMemEval paraphrase. No case exists
  where AUTO injects a target REST cannot find.
- **Stale injection is already structurally 0** because retrieval rewrites
  superseded hits to their chain head (`resolveSupersededHeads`). Keep it at 0.
- **False injection is not 0**: two negatives (`堪培拉降雨量`, `牛仔裤腰围`)
  inject 7 unrelated pointers each. This is the noise cost a broader admission
  rule must not increase.
- **AUTO latency already violates the 100 ms contract** (p50 252 ms, p95
  406 ms; 40/40 calls over 100 ms). The client aborts at 100 ms, so a correctness
  fix can still be invisible in real turns; this needs its own performance slice.
- **Implicit retrieval is the floor, not admission**: only 2/10 implicit targets
  reach REST top 3 at all, so admission alone cannot move this category much.
  Keep the set unchanged anyway; it is the honest before-state.
