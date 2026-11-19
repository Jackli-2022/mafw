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

### P1 shadow extension (live + topic)

Each case may additionally freeze (all optional, never required by P0):

| field | meaning |
|---|---|
| `liveCapture` | `{ capturedAt, block, query? }` — the live boundary-path output captured from a real turn, frozen verbatim. `capturedAt` is an ordering token: the seed recorded no wall clock. `query` records the capture's own input when it differs from the case's `currentQuery`. |
| `liveAnnotations` | the live block's judgement, registered **independently** of `annotations` (the capture printed only 6-char pointer tails, so live ids are those tails while snapshot ids stay full). |
| `liveExpectedAnswerFamilies` | answer families for the live ids; the validator rejects a live `answer` label outside them. |
| `topicState` | the audited `TopicState` (topic/summary/entities/aliases/openLoops/retrievalKeys) plus `audit.staleRisk`. |

The file's top-level `topicAudit` freezes the audit's corpus-level numbers
(9 sessions, 5 active; summary/entities/openLoops/retrievalKeys in 4 of 5,
aliases in 0 of 5). They are recorded, never re-derived: only the current
session's `TopicState` is frozen verbatim, and it predates the three 2026-11-19
cases — that is exactly what `topicState.audit.staleRisk` records.

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
  regression gate;
- `gateway/tests/unit/recall/session-quality-shadow.test.ts` — four-arm shadow
  evaluator + shadow runner API;
- `gateway/tests/unit/recall/session-quality-shadow-runner.test.ts` — shadow
  fixture → baseline consistency gate (import contract, stale-baseline failure,
  literal pilot numbers, config-override sensitivity).

## Baseline 2026-11-19 (bootstrap)

Artifact: `evaluation/session-recall/baseline.json` (`generatedAt`
`2026-11-19T09:23:37.940Z`; baseline file SHA256
`c56b4b029bb05ec739409a39f27c74ffd906b5a5c5b728db66dacc261bc0dbb3`). Re-running
the generation command is byte-identical.

The metrics below are unchanged since the first run: the only thing the P1
shadow fixture extension moved is `fixture.notes` (the live/topic provenance
notes). All six numbers, every per-case row, the snapshot config and the code
fingerprint are byte-identical to the pre-extension baseline.

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

## P1 shadow: four frozen arms (2026-11-19, still bootstrap)

Artifact: `evaluation/session-recall/shadow-baseline.json` (`generatedAt`
`2026-11-19T10:00:00.000Z`; file SHA256
`801fb6fd824c3fbea199e70f6a76fab8cc210a9ed1c81a43e25315013b0558dc`; code
fingerprint `e3bc628a389ee54ff360b8aa23f022fcf466abae7db3bc1ef0385f1810578e7f`
over 9 files: the P0 six serve-path sources, **`exact-evidence.ts`** (the facet
arm calls it directly), `session-quality-shadow.ts` and `run-shadow.ts` itself).

That list is fixed and reviewable, **not** a transitive-closure guarantee: a
dependency reached through an already-listed file only changes the digest when
the listed file itself changes, so a new module that can move these numbers must
be added to `SHADOW_FINGERPRINT_SOURCES` explicitly. Because `run-shadow.ts` is
in the list, **editing the runner itself invalidates this baseline** — regenerate
it in the same change (the gate fails otherwise, and says which fields moved).

The consistency gate is `gateway/tests/unit/recall/session-quality-shadow-runner.test.ts`.
It imports the runner (asserting the import does not execute `main`), re-runs the
frozen fixtures at the baseline's `generatedAt`, and requires `arms`,
`configSource`, `snapshotConfig`, `fixture`, `summary`, `cases` and
`codeFingerprint` to match the checked-in baseline via `diffShadowBaseline` /
`assertShadowBaselineConsistent`. `command` and `generatedAt` are invocation
metadata and are excluded from that comparison (a relocated regeneration is the
same measurement); the suite pins their checked-in values separately. Every
top-level report field must be classified: the eight measurement fields, the two
contract flags and the two excluded invocation fields. An **unknown key on either
side is a mismatch**, so a future measurement field cannot bypass the gate, and
the two flags are compared rather than copied from the baseline. The gate also
proves it is a gate: a baseline with a different fingerprint, config, metric or
case set must fail, and an explicit `--snapshot-config` override must move the
measured decision.

`gateway/src/recall/session-quality-shadow.ts` evaluates the SAME frozen case
along four arms so a mis-display can be attributed to a layer instead of a
guess. It changes no production route, admission rule, FOK gate or block.

| arm | what it measures | replay? |
|---|---|---|
| `snapshot-current` | the real P0 evaluator output, delegated verbatim (no re-scoring, no copied rules) | `false` (P0 provenance) |
| `current-query-off` | the SAME `decideSnapshotUse` + FOK gate, then the **stored** snapshot block served verbatim | `false` |
| `live-frozen` | the frozen `liveCapture.block`, scored with its own ids/annotations; the runner never calls Gateway | `false` |
| `topic-facet` | one offline candidate rule that replaces ONLY the Harmonic support selection (T1 still runs through the real adapter) | `true` (`blockSource: facet-render`) |

`current-query-off` switches off **only** the snapshot current-query adapter
(`adaptSnapshotToCurrentQuery`). It does not model the live lexical veto — that
veto is not part of the snapshot serve path and this evaluator never measures it,
so calling this arm "lexical veto off" would be wrong.

`live-frozen` has no pre-admission pool (the live path was never snapshotted), so
legitimate suppression is `0/0 → null` — explicitly not measured, never 0%. A
case without a frozen capture is **unmeasured**: it is excluded from
`serve.notServed` / `serve.fallback` and from every rate denominator, and is
listed in `unmeasuredCaseIds` (counting it as a fallback would report a failure
nobody observed). A capture whose block printed no memory/T1 pointer (a bare
`<topic-recall>` shell) is a different thing: it is **not served**
(`served: false`, `fallbackReason: 'no-memory-pointers'`, no synthetic `use`
decision) and it does count in `serve.notServed`. Suppression stays `null` for
both. The arm also reports `liveCapture.query` (the live call's own input) as its
`currentQuery`, never the snapshot-side stand-in.

`topic-facet` rules (all evaluated offline):

- exact evidence (`findExactRecallEvidence` over title/cue metadata) **bypasses**
  the domain requirement;
- every other candidate needs domain support from `entities` / `aliases` /
  `retrievalKeys` **AND** raw `currentQuery` support (the adapter's own
  `selectLexicallySupportedCandidates`);
- a neighbour still needs its anchor retained;
- no topic / inactive topic / empty domain list /
  `snapshotContainment(topic + summary, rawQuery) < 0.25` falls back to the
  current adapter, and the reason is recorded as `facetFallback`.

`topic` and `summary` are used for the containment/uncertainty gate only — they
are never domain evidence, so a word like 「质量」cannot become a domain
shortcut. TopicState is a possibly-stale attention state: `audit.staleRisk` is
frozen data carried into the result, not re-derived from text.

Every arm keeps P0's per-case `displayed` / `suppressed` / `families` /
`unannotatedDisplayed` / `measurementComplete` fields, plus `arm`, `available`,
`replay`, `blockSource`, `facetFallback`, `topicProvided`, `topicStaleRisk`.
`summarizeSessionShadow` groups results per arm through P0's own summarizer
(numerators/denominators summed, never averaged) and adds the measured split
(`measuredCases` / `unmeasuredCases` / `unmeasuredCaseIds` — only measured rows
feed the summarizer) plus `casesWithTopic` / `facetsApplied` / `facetFallbacks` /
`staleRisk`.

Run:

```bash
npx ts-node --project gateway/tsconfig.json \
  evaluation/session-recall/run-shadow.ts \
  --out evaluation/session-recall/shadow-baseline.json \
  --generated-at 2026-11-19T10:00:00.000Z
# optional: --fixtures <path>  --snapshot-config '<json>'  --help
```

| arm | serve | precision | coverage | false display | suppression | neighbour | t1 repeat |
|---|---|---|---|---|---|---|---|
| `snapshot-current` | 3/3 (filtered 2) | 25.0% (2/8) | 100.0% (1/1) | 100.0% (2/2) | 0.0% (0/2) | 0.0% (0/2) | 100.0% (3/3) |
| `current-query-off` | 3/3 (filtered 0) | 25.0% (2/8) | 100.0% (1/1) | 100.0% (2/2) | 0.0% (0/2) | 0.0% (0/4) | 100.0% (4/4) |
| `live-frozen` | 1/3 (2 topic shells) | 66.7% (2/3) | 100.0% (1/1) | 0.0% (0/2) | n/a (0/0) | 0.0% (0/4) | n/a (0/0) |
| `topic-facet` | 3/3 (filtered 2) | 33.3% (2/6) | 100.0% (1/1) | 100.0% (2/2) | 0.0% (0/2) | 0.0% (0/2) | 100.0% (3/3) |

Reading the pilot (3 cases — a decision input, not a benchmark):

- **The two negatives came from the snapshot layer, and the comparison is not a
  same-turn one.** A **later** live call for the same query text returned no
  memory pointer at all (`live-frozen` served 1/3: two bare topic shells, false
  display `0/2`), while the snapshot path displayed 5 noise bodies. The live
  captures are frozen at `2026-11-19T09:04:00.000Z` — 42 and 32 minutes after
  those two snapshots were built, past the 10-min TTL — so they say "a later live
  call for this text returned nothing", not "the live path would have returned
  nothing on that turn".
- **`current-query-off` does not excuse the adapter.** Serving the stored blocks
  verbatim is not better here: same precision denominator, two extra neighbours
  and one extra T1 line. The adapter is removing something; it is not creating
  the noise.
- **`topic-facet` removes one process-note noise per negative** (`q15k2p`, whose
  only tie to the query is the word 质量) and loses no answer
  (suppression `0/2`, coverage `1/1`). The third case falls back with
  `low-containment`: its frozen topic is 个人记忆质量治理 while the query asks
  what to delegate, so the facet correctly refuses to filter on a stale topic.
- **The ceiling is visible.** Two noise anchors survive the facet because they
  share a real domain term (`相似记忆合并` ↔ 记忆质量), and `xqjlsn` still survives
  the current adapter through `v4`. That is the honest limit of a
  metadata-domain rule on 3 cases; it is not evidence of generalisation.

The shadow baseline also carries the frozen TopicState audit: 3/3 cases have a
topic, the facet applied on 2, and every case reports the three stale-risk
reasons recorded with the capture (summary says the mis-injection was cleared;
`retrievalKeys` still holds `implicit 2/10`; the state predates every snapshot
build here).

Reproducibility: same fixtures + same snapshot config + same code fingerprint
reproduce every count; only `generatedAt` and the recorded `command` (which
contains `--out`) vary between runs.

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
- The **shadow** baseline has the same rule and one extra edge: `run-shadow.ts`
  is itself fingerprinted, so any runner edit must regenerate
  `shadow-baseline.json` in the same change; the shadow gate then fails on the
  file hash and the digest until it is regenerated.
- The P1 pilot verdict and its caveats are in
  `docs/research/2026-11-19-session-recall-p1-shadow-results.md`. Read it before
  quoting a number from this page: the arms have different denominators, the
  live captures are later same-text calls, and `falseDisplay` is still 2/2.
- The shadow set is a **pilot**, not an admission proposal: `topic-facet` wins
  nothing in production until a dev/hold-out set says so. A `topic-facet` change
  that drops an `answer|context` candidate must show up as a worse
  `legitimateSuppression` in `shadow-baseline.json` — never relabel the fixture
  to hide it.
- `live-frozen` must stay a frozen artifact. Do not make the runner request a
  live block: a capture is evidence with a timestamp, a live call is not
  reproducible.
