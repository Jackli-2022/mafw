# Personal recall evaluation set

Fixed 40-query regression set for **personal memory recall**, measured against a
running gateway over read-only HTTP. It exists to decide whether a recall
admission change actually helps: the same queries, frozen expected answer
families, two entrypoints, one table.

This is **not** a benchmark. It is a personal regression set over one user's
live corpus (`~/.mafw/memory`); the numbers describe this corpus at freeze time,
not general retrieval quality.

## Corpus dependence

- Expectations were selected from the live harmonic index on **2026-11-18**
  (`16732` index entries, `11510` active at selection time) and are frozen in
  `queries.json`. The runner never derives expectations from live ranks.
- The corpus keeps growing and decaying. Before measuring, the runner resolves
  every frozen id through `GET /api/memory/get?id=<6-char tail>` and fails fast
  with `unknown memory id(s)` if an answer no longer exists.
- Re-select a case only when every member of its answer family was legitimately
  superseded/deleted. Prefer replacing the family over relaxing the query; a
  renamed expectation turns the set into a moving target.
- `must_exclude` ids are the superseded predecessors of `current-state`
  targets. They are the stale-injection controls.

## Categories (10 each, 40 total)

| category | what it asks | expectation |
|---|---|---|
| `current-state` | "what is the current rule/state now?" | active supersede-chain head; predecessor in `must_exclude` |
| `exact` | identifier, code symbol or verbatim title | the reviewed owner family for that identifier/title |
| `implicit` | natural paraphrase / continuation, no exact identifier | the reviewed equivalent-answer family |
| `negative` | true no-answer control (topic absent from corpus) | empty `must_include`; any injected pointer is a false injection |

`exact` includes the known divergence cases `5cd9885f5` and
`Proactive Topic Recall 主题工具设计`, plus the working comparison
`检索路径 parity 修复上线与质量缺口`.

`negative` controls were verified against the frozen index with a keyword scan
(no memory mentions the topic, e.g. 冰岛 / 企鹅 / sourdough / cert-manager).

## `must_include` semantics: any-of answer families

`must_include` is an **any-of family of frozen, genuinely equivalent correct
answers**, not a ranked gold list. A hit means at least one family member was
returned.

- **Identifier families.** A bare identifier often has several legitimate
  owners. `5cd9885f5` is a cue anchor of three active retrieval-parity
  memories; `MAFW_DEV_ADOPT` is owned by three single-instance design memories;
  `NOTE_BOARD_BUDGET` is owned by four active budget/semantics memories;
  `T1SemanticEncoder` by three encoder memories; `465a97926` by the release and
  the commit-landed note. All reviewed active owners are listed. Superseded
  memories are never listed — they belong in `must_exclude`.
- **Near-duplicate families.** The corpus contains multiple memories stating
  the same fact. `implicit-field-passing` has four equivalent statements of the
  addEntry/whitelist field-drop pit; `implicit-worker-transcript` has three
  statements of the 2026-08-31 transcript-execution conclusion. All are listed.
- **Merely related memories stay out.** Generic whitelist/security memories,
  the file:line-drift counterpoint (`m1euw2`), the read-only-subagent tool-ban
  lesson, and the silent-loss survey that only cites a budget constant are
  *not* answers to their respective queries and are excluded.
- **Duplicate-explosion queries were replaced.** `settle-not-meta` has 142
  active near-duplicates and `pipeline-heartbeat` has 58; any frozen sub-family
  would still score correct duplicates as misses. They were replaced by two
  distinctive single-owner implicit queries (`unattended-background`,
  `live-index-overwrite`) rather than given arbitrary sub-families.
- `DISPATCH_STAGES` was replaced too: 53 owners, mostly one supersede-chain
  lineage plus migration lessons, with no defensible frozen owner set. Its
  replacement `searchRecallMemories` has exactly one active owner.

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
`formatRecallContext` renders them.

**Rank is anchor-relative.** Neighbour lines (`↳`) are injected evidence and
count toward `auto.hit`, but they never compete for ranking: `auto.rank`,
`rank1` and `meanRank` are computed over anchor lines only. A target injected
only as a neighbour therefore has `hit: true, rank: null`. `auto.ids` keeps the
full injected order; `auto.anchors` / `auto.anchorIds` expose the ranked lines.

## Run

```bash
node evaluation/personal-recall/run.js --out C:\path\to\personal-recall-before.json
# optional: --base-url http://127.0.0.1:3000  --fixture <path>  --timeout-ms 20000
```

`--out` must be absolute. The report contains per-entry REST/AUTO ids, ranks,
hit flags, anchor ids, entrypoint agreement, latency, the raw auto `pointers`,
per-category rollups and the summary. Exit code is 0 for a completed measurement
even when cases miss; fixture/transport errors exit non-zero.

Unit contract: `gateway/tests/unit/eval/personal-recall-runner.test.ts`
(`npx jest --runInBand --forceExit tests/unit/eval/personal-recall-runner.test.ts`
from `gateway/`).

## Baseline 2026-11-18 (fix round 1, before admission change)

Artifact: `%TEMP%\opencode\personal-recall-before.json` (40 rows).

| metric | value |
|---|---|
| REST hit@1 | 60.0% |
| REST hit@3 | 73.3% |
| REST MRR | 0.656 |
| AUTO hit (injected evidence) | 46.7% (14/30) |
| AUTO anchor rank@1 | 12/30 |
| AUTO mean anchor rank when ranked | 1.29 |
| False injection (negatives) | 20.0% (2/10) |
| Stale injection (`must_exclude`) | 0 / 40 |
| Entrypoint agreement | 73.3% (22/30) |
| REST latency p50 / p95 | 85 ms / 100 ms |
| AUTO latency p50 / p95 | 242 ms / 404 ms |

By category:

| category | REST hit@1 | REST hit@3 | AUTO hit | false injection |
|---|---:|---:|---:|---:|
| current-state | 60% | 60% | 60% | 0% |
| exact | 90% | 100% | 60% | 0% |
| implicit | 30% | 60% | 20% | 0% |
| negative | n/a | n/a | n/a | 20% |

Reading the baseline:

- **The divergence signature is visible.** 8 of 30 positive entries are
  `REST hit@3 && AUTO miss`: `5cd9885f5`, the topic-tool design title, the graph
  release commit, the note-board budget constant, `implicit-field-passing`,
  `implicit-multisession-gap`, `implicit-unattended-background`, and
  `implicit-live-index-overwrite`. No positive entry is the reverse
  (`AUTO hit && REST miss`).
- **Stale injection is already structurally 0** because retrieval rewrites
  superseded hits to their chain head (`resolveSupersededHeads`). Keep it at 0.
- **False injection is not 0**: two negatives (`堪培拉降雨量`, `牛仔裤腰围`)
  inject 7 unrelated pointers each. This is the noise cost a broader admission
  rule must not increase.
- **AUTO latency already violates the 100 ms contract** (p50 242 ms, p95
  404 ms). The client aborts at 100 ms, so a correctness fix can still be
  invisible in real turns; this needs a separate performance slice.
