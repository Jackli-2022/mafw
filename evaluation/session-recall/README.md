# Session-shaped recall quality (P0 bootstrap)

Block-level quality measurement for the **snapshot serve path**: what the
boundary turn would actually show for a frozen session-shaped case, scored
against frozen per-candidate annotations.

> **This is a bootstrap dev set, not a benchmark.** It has 3 cases, one
> annotator and no held-out split. The numbers describe these three real
> incidents on 2026-11-19; they cannot be used to claim general retrieval
> quality, to tune thresholds, or to relax production admission. The research
> spec still requires a 20–50 case dev set plus an isolated held-out set.

## Why it exists

The frozen 40-query set (`evaluation/personal-recall/`) reports an expected id
as a hit even when it only appeared as a bundled neighbour, so it cannot tell
"the block answers the question" from "the block mentions something on topic".
This set measures the rendered block instead: anchor precision, answer-family
coverage, false display on no-answer controls, and legitimate suppression of
answer/context candidates by admission.

It also deliberately keeps the two user-reported 2026-11-19 mis-displays **as
they were**: their noise bodies are still displayed by the current serve path.
Fixing those is out of scope here, and the annotations were not relaxed to
manufacture an improvement.

## Fixtures and provenance

`fixtures.json` was converted once from the read-only seed
`Temp/opencode/session-recall-seed.json` (no live DB read) and is now frozen.
Two of the three cases are **replays**, not captures — their served block (and,
for `model-preference`, the query) had to be reconstructed:

| case | provenance | captured vs replayed | shape |
|---|---|---|---|
| `quality-negative-2026-11-19` | seed `qualityNegative`, snapshot built `2026-11-19T08:22:16.515Z` | **captured** — stored block + query served verbatim (unfiltered) | no-answer control; delivery-process note + generic "research first" note |
| `research-negative-2026-11-19` | seed `researchNegative`, snapshot built `2026-11-19T08:32:14.335Z` | **replayed** — the seed did not capture the rendered block; it is re-rendered from the frozen pool with `formatRecallContext` (+ the recorded T1 line), then the current-query gate re-renders the served block | no-answer control; 4 process/method notes (+1 T1 user-instruction echo) |
| `model-preference-live-2026-11-19` | seed `modelPreferenceSnapshot`, live mixed snapshot captured `2026-11-19T09:03:47.311Z` | **replayed** — `currentQuery` is the turn-212 user text used as a **stand-in** for the (uncaptured) serve-time query; the served block is re-rendered by the adapter | mixed live snapshot: model preference anchors, 8 bundled neighbours, 3 T1 lines |

Details that matter:

- The file's top-level `snapshotConfig` is the **capture-time** serve config
  (`enabled`, `ttlMs`, `topicShiftThreshold`, `t1MaxChars`). It is frozen with
  the cases and is the runner's only default config source — the live gateway
  config is never read, so the baseline cannot drift with local env overrides.
- `research-negative` is a replay: the seed did not capture its rendered block,
  so the block is re-rendered once from the frozen pool with the real
  `formatRecallContext` (plus the recorded T1 line); the current-query gate then
  re-renders the served block anyway. Ids are used verbatim, not re-derived.
- `model-preference-live-2026-11-19` keeps `snapshot.query` as the recorded
  rolling window, but its `currentQuery` is **not** the recorded input of that
  serve: the serve-time query was not captured, so the turn-212 user text
  (`看看怎么做，执行交给子代理，gateway deepseek v4.1 flash`) stands in for it.
  Its numbers describe "this frozen pool replayed against that query", not the
  exact serve that happened.
- Captured vs replayed is stated per case in `fixtures.json` (`origin`), in the
  table above and in the baseline's per-case `origin`.
- Frozen means frozen: do not regenerate a case from the live DB or from
  current ranks. A new case gets a new id and its own provenance line.

## Annotation protocol

The unit is `(memory id, rendered role)` — `anchor` / `neighbor` / `t1` (T1
uses its `traceId`). Labels are:

| label | meaning |
|---|---|
| `answer` | the body answers the current query |
| `context` | useful, on-domain background, but not the answer |
| `noise` | topically supported but does not help answer this query |
| `repeat` | duplicates information already displayed (T1 lines typically) |
| `stale-or-conflict` | superseded / contradictory state |

`expectedAnswerFamilies` freezes a reference statement **and** the equivalent
memory ids; a family counts as covered only when one of its ids is displayed as
an **anchor**.

The validator (`validateSessionSnapshotQualityFixture`) rejects a case instead
of silently skipping it when:

- an annotation has no id, an unknown id, an unknown label, or an unknown role;
- an annotation's role contradicts the snapshot structure (e.g. an anchor
  annotated as a neighbour), or the same `(id, role)` is annotated twice;
- a pre-admission pool entry or a T1 hit has no annotation (nothing displayed
  or dropped may go unmeasured);
- an answerable case labels a candidate `answer` but does not list its id in any
  `expectedAnswerFamilies[].equivalentIds` — coverage could never count it, so the
  case is rejected rather than measured as a silent miss (relabel it or register
  the family);
- two memory ids share a 6-char pointer tail (block parsing would be ambiguous);
- a no-answer control annotates an `answer` or declares answer families.

## Metrics

All metrics are `{ numerator, denominator, value }`. **`value` is `null` when the
denominator is 0** (explicitly "not measured"), never 100%.

| type | metric | definition |
|---|---|---|
| main | `usefulAnchorPrecision` | displayed anchors labelled `answer` or `context` / displayed anchors |
| main | `answerCoverage` | expected answer families covered by a displayed **anchor** / families |
| safety | `falseDisplay` | no-answer controls that displayed ≥1 `noise` body / no-answer controls |
| safety | `legitimateSuppression` | annotated `answer|context` ids in pre-admission `snapshot.memories` that were not displayed / all such candidates, **served cases only** |
| diagnostic | `neighborPrecision` | displayed neighbours labelled `answer|context` / displayed neighbours |
| diagnostic | `t1Repeat` | displayed T1 lines labelled `repeat` / displayed T1 lines |

Scope rules:

- **Answer coverage is anchor-only.** A target shown only on a `↳` neighbour line
  gets `coverage 0` and `neighborPrecision 1`; it was shown, just not as an
  answer anchor. Only a line whose first non-space character is `↳` is a
  neighbour — an anchor line may carry a trailing `↳ gist 已蒸馏…` hint.
- **Suppression is pre-admission pool only, and served-only.** A memory that
  retrieval never put in `snapshot.memories` is a pool miss, not a legitimate
  suppression. A neighbour still counts as displayed (so it is not suppressed).
  `stale` / `topic-shift` / FOK fallbacks show nothing at all: they are counted
  as `serve.notServed` and contribute `0/0 → null` suppression instead of a
  misleading 100% "loss". On a served case the drop can come from the
  current-query admission gate **or** the render budget (`formatRecallContext`
  caps a single-type pool at 3 anchor lines / neighbour budget / T1 budget).
- **False display is control-only.** Non-control cases contribute `0/0`. The
  summary also lists every noise id actually displayed (`falseDisplayIds`).
- **Unannotated displays are measurement gaps, not noise.** A rendered pointer
  outside the fixture pool is listed in `unannotatedDisplayed` (per case and in
  the summary, with `caseId`), sets `measurementComplete: false` and adds a
  `warnings` entry. It is counted as not-proven-useful, never relabelled as
  `noise`; on a control the warning explicitly says `falseDisplay` may
  under-report.
- Aggregation sums numerators/denominators across cases (never averages
  per-case ratios). Per-case rows are preserved in the top-level `cases` array.

## Run

```bash
npx ts-node --project gateway/tsconfig.json \
  evaluation/session-recall/run.ts --out evaluation/session-recall/baseline.json
# optional: --fixtures <path>  --snapshot-config '<json>'  --generated-at <iso>
```

The runner imports the real `decideSnapshotUse` + `adaptSnapshotToCurrentQuery`
from `gateway/src/recall/session-quality.ts`; it does not copy admission logic,
read the DB, call a model, or write anything except `--out`.

It also never reads the live gateway config. The capture-time serve config is
frozen in the fixture file's top-level `snapshotConfig`: `ttlMs` /
`topicShiftThreshold` drive the decision and `t1MaxChars` drives the T1 render
budget, so a baseline cannot drift because the local machine or an env var
tuned `config.search.snapshot`. `enabled` is recorded for information only — the
evaluator measures the serve path itself, so a deployment with snapshots
switched off can still replay these frozen attempts.

For an explicit experiment, `--snapshot-config '<json>'` merges a partial
override over the frozen values (e.g. `--snapshot-config '{"ttlMs":1000}'`); keep
it out of the checked-in baseline. The report records both the effective
`snapshotConfig` and `configSource` (`frozen` or `override`).

### Code fingerprint

`command` alone is not provenance: it says which script ran, not which code it
ran. The report therefore records `codeFingerprint`:

- `files[]`: repo-relative path + SHA256 of each serve-path source the evaluator
  consumes (`FINGERPRINT_SOURCES` in `run.ts`: `session-quality.ts`,
  `snapshot-current-query.ts`, `lexical-support.ts`, `recall-snapshot.ts`,
  `inject-format.ts`, `verbatim-recall.ts`);
- `digest`: SHA256 over the `path:sha256` manifest lines.

Files are read with `fs` (no `git` call) and CRLF is normalised to LF, so a
Windows and a Linux checkout of the same sources produce the same fingerprint.
The file list is fixed and reviewable rather than import-graph-derived: adding a
module that can move the numbers means adding it there.

The checked-in gate is
`gateway/tests/unit/recall/session-quality-runner.test.ts`. It imports the real
runner (asserting the import does not execute `main`), re-runs the frozen
fixtures at the baseline's `generatedAt`, and requires `summary`, `cases`,
`snapshotConfig`, `fixture` and `codeFingerprint` to match the checked-in
baseline. It also asserts the six head-line numbers literally (so regenerating
the baseline cannot silently bless a regression) and checks the gate is
sensitive: a deliberate TTL override must change the summary.

Output: `bootstrap`, `notAPublicBenchmark`, the actual invoked `command`,
`codeFingerprint`, `configSource`, `snapshotConfig`, fixture metadata,
`generatedAt`, the aggregate `summary` and every per-case row in `cases`
(decision, fallback reason, kept anchor/neighbour/T1 ids, the served block,
displayed roles/labels, unannotated displays, suppressed candidates, family
matches, metric numerators/denominators, captured/replayed `origin`). The fixture
file must declare `version: 1`, `status: "bootstrap"` and a complete frozen
`snapshotConfig`; a different version or an invalid config is rejected instead
of silently measured.

The report is reproducible from the frozen fixture file (including its
`snapshotConfig`) **and the recorded code fingerprint**: same fixtures + same
fingerprint reproduce every count. Only `generatedAt` reflects wall-clock time
(pass `--generated-at` to reproduce it byte-for-byte), and the runner test fails
if the fixtures or the fingerprinted sources moved away from the checked-in
baseline.

Unit contracts:

- `gateway/tests/unit/recall/session-quality.test.ts` — evaluator/validator;
- `gateway/tests/unit/recall/session-quality-runner.test.ts` — fixture → baseline
  regression gate.

## Baseline 2026-11-19 (bootstrap)

Artifact: `evaluation/session-recall/baseline.json` (`generatedAt`
`2026-11-19T09:23:37.940Z`; baseline file SHA256
`b9fb5dd7bae0c2f37a5723d620c8d116ab7711a8c2241c4eb806847f9bf935db`). Re-running
the generation command is byte-identical.

| metric | value |
|---|---|
| cases | 3 (answerable 1, no-answer controls 2) |
| serve | 3 served (2 filtered), 0 not served; decisions `use=3` |
| snapshot config | frozen: ttl 600000 ms, topic-shift 0.25, t1MaxChars 600 (`enabled` informational) |
| code fingerprint | `e2c9a0a7d1a1c4b76a7f596f08a2c709ed8dfb0df3d6d878618a0e0f137eb8dc` (6 files) |
| measurement | complete (`unannotatedDisplayed: []`, no warnings) |
| `usefulAnchorPrecision` | 25.0% (2/8) |
| `answerCoverage` | 100.0% (1/1) |
| `falseDisplay` | 100.0% (2/2 controls, 5 noise ids) |
| `legitimateSuppression` | 0.0% (0/2) |
| `neighborPrecision` | 0.0% (0/2) |
| `t1Repeat` | 100.0% (3/3) |
| false-display ids | `q15k2p`, `7lsgaw`, `q15k2p`, `7lsgaw`, `cifyzn` |

Per case (mode is the same captured/replayed distinction as above):

| case | mode | serve | anchors | precision | coverage | suppression | false display |
|---|---|---|---|---|---|---:|---:|---:|---:|
| `quality-negative-2026-11-19` | captured | served, unfiltered (verbatim) | 2 | 0.0% (0/2) | n/a (0/0) | 0/0 | 2 noise (both anchors) |
| `research-negative-2026-11-19` | replayed | served, filtered | 3 of 4 | 0.0% (0/3) | n/a (0/0) | 0/0 | 3 noise |
| `model-preference-live-2026-11-19` | replayed | served, filtered | 3 | 66.7% (2/3) | 100.0% (1/1) | 0/2 | n/a (not a control) |

Reading the baseline:

- **The two real negatives still display.** Both share `质量`/`分析`-type tokens
  with their queries, so the current-query gate keeps them (`filtered=false`
  verbatim in the first case, 3 anchors after dropping `o4tutz` + the T1 echo in
  the second). This is an honest baseline, not a regression of the gate.
- **The mixed snapshot still carries noise.** `xqjlsn` (a 200-char
  uncommitted-changes lesson) survives because its title contains `v4.12.0`,
  which shares the ASCII token `v4` with `deepseek v4.1`. Of the 8 bundled
  neighbours only 2 survive, both noise: `rqgqkh` matches the query through the
  file-path cue `gateway/src/recall/lexical-support.ts`, and `ls3vcr` matches the
  CJK bigram `执行`. `neighborPrecision` is 0/2.
- **T1 repeat is 3/3.** All three T1 lines repeat facts already carried by the
  answer anchors (or by the current user turn) but the identifier-phrase
  redundancy rule does not drop them: the excerpt spells
  `eepseek-v4.1-flash`, not the anchor's `deepseek-v4.1-flash`.
- **`answerCoverage 100%` is 1/1.** One answerable case with a frozen family;
  the two controls have `0/0 → null`. Do not read it as general coverage.
- **`legitimateSuppression 0/2`** means both frozen answer candidates survived
  admission/render in the only case that has them. None of the three cases drops
  a pre-admission answer/context candidate, so the metric has little signal yet.
  All three were served; a future stale/topic-shift/FOK case contributes `0/0 →
  null` and increments `serve.notServed` instead of a misleading 100%.

## Change policy

- Keep the frozen expectations. If a case's ids no longer exist in the corpus,
  record that as a case-level miss or add a new case; do not silently re-select
  a different family.
- Never relabel a negative case to make the baseline look better. A future fix
  should move `falseDisplay`/`t1Repeat` down with the same labels.
- When adding cases, keep the annotation complete and add them with new ids.
  `status: "bootstrap"` stays until the dev/hold-out split required by the spec
  exists.
- Every `answer` label must be registered in some
  `expectedAnswerFamilies[].equivalentIds`; the validator rejects the case
  otherwise (an unregistered answer could never be counted as covered).
- A fixture or evaluator change means regenerating the baseline in the same
  change. `session-quality-runner.test.ts` fails on any mismatch between the
  re-run, the checked-in baseline and the code fingerprint. Regenerate with a
  fixed `--generated-at`, and update the fingerprint digest / baseline SHA in
  this README when the fingerprinted sources moved.
