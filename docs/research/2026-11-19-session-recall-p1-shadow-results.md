# Session recall P1 shadow pilot — four-arm results (2026-11-19)

**Status: pilot result + redesign verdict. NOT a production proposal.**

Scope: `evaluation/session-recall/fixtures.json` (3 frozen cases, extended with
live captures and an audited `TopicState`), evaluated along four arms by
`gateway/src/recall/session-quality-shadow.ts` through
`evaluation/session-recall/run-shadow.ts`. No production route, admission rule,
FOK gate or rendered block was changed by this slice.

Reproduce:

```bash
npx ts-node --project gateway/tsconfig.json \
  evaluation/session-recall/run-shadow.ts \
  --out evaluation/session-recall/shadow-baseline.json \
  --generated-at 2026-11-19T10:00:00.000Z
```

Artifact: `evaluation/session-recall/shadow-baseline.json`, SHA256
`801fb6fd824c3fbea199e70f6a76fab8cc210a9ed1c81a43e25315013b0558dc`,
code fingerprint
`e3bc628a389ee54ff360b8aa23f022fcf466abae7db3bc1ef0385f1810578e7f` over 9 fixed
sources (P0's six serve-path modules, `exact-evidence.ts`,
`session-quality-shadow.ts`, `run-shadow.ts`). Regenerating to a different
`--out` is byte-identical apart from the recorded `command` (verified).
The consistency gate is
`gateway/tests/unit/recall/session-quality-shadow-runner.test.ts` (14 tests).

---

## 1. What this pilot can and cannot say

It can say: for these three frozen cases, which layer produced the display that
the user complained about, and whether a metadata-domain facet would have removed
that specific noise without removing an answer.

It cannot say: that any arm is "better" in general. Specifically,

- **3 cases, one annotator, no held-out split, no second rater.** `status:
  bootstrap` is unchanged; the spec still requires 20–50 dev cases plus an
  isolated held-out set.
- **The arms do not share a denominator.** `usefulAnchorPrecision` is 2/8, 2/8,
  2/3 and 2/6; `neighborPrecision` is 0/2, 0/4, 0/4, 0/2; `t1Repeat` is 3/3,
  4/4, `0/0 → null`, 3/3. The percentages are *not* a ranking. Reporting
  "66.7% (live) beats 25.0% (snapshot)" would be an artefact of displaying three
  anchors instead of eight.
- **The live captures are later same-text calls, not a same-turn
  counterfactual.** `liveCapture.capturedAt` is a frozen ordering token
  (`2026-11-19T09:04:00.000Z`) — 42 min / 32 min after the two snapshot builds,
  past the 10-minute TTL — and the capture recorded no serve-time query/topic.
  The live arm answers "what a later live call for this text returned", never
  "what the live path would have returned on that turn".
- **`live-frozen` has no pre-admission pool**, so `legitimateSuppression` is
  `0/0 → null` (not measured), and its answer coverage uses its own live family
  registry (`cc1urw`, `nzi4oy`), so it is not comparable to the snapshot arm's
  coverage.
- **Two of the three cases are replays** (their served block, and for
  `model-preference` the query, were reconstructed from the frozen pool). The
  `current-query-off` arm therefore measures "no adapter applied to a
  reconstructed block" for those two cases.

---

## 2. Results, arm by arm

| arm | serve | precision (useful / displayed anchors) | coverage | false display (controls) | suppression | neighbour | T1 repeat |
|---|---|---|---|---|---|---|---|
| `snapshot-current` | 3/3 served, 2 filtered | 25.0% (2/8) | 1/1 | **100.0% (2/2)** | 0/2 | 0/2 | 3/3 |
| `current-query-off` | 3/3 served, 0 filtered | 25.0% (2/8) | 1/1 | **100.0% (2/2)** | 0/2 | 0/4 | 4/4 |
| `live-frozen` | 1/3 served, 2 bare topic shells | 66.7% (2/3) | 1/1 (live families) | 0.0% (0/2) — vacuous | n/a (0/0) | 0/4 | n/a (0/0) |
| `topic-facet` | 3/3 served, 2 filtered | 33.3% (2/6) | 1/1 | **100.0% (2/2)** | 0/2 | 0/2 | 3/3 |

The `neighbour` column and the neighbour metric denominators count **rendered**
neighbour lines (`displayed` rows with role `neighbor`), never the frozen
candidate pool. The two differ on the mixed case: `current-query-off` keeps 9
neighbour candidates from the snapshot pool but renders 4 (the adapter arm keeps
2 and renders 2). `kept.neighbors` is a pool count; do not quote it as display.

Per case (served state / displayed anchors / useful):

| case | `snapshot-current` | `current-query-off` | `live-frozen` | `topic-facet` |
|---|---|---|---|---|
| `quality-negative` (control) | served, stored verbatim; 2 anchors, 0/2; 2 noise | same block, same 0/2 | **not served** — bare `<topic-recall>` shell, `no-memory-pointers` | served (facet render); 1 anchor, 0/1 (dropped `q15k2p`) |
| `research-negative` (control) | served, adapter-filtered; 3 anchors, 0/3; 3 noise | stored block verbatim; 3 anchors, 0/3; **+ the T1 repeat line** | **not served** — bare shell | served (facet render); 2 anchors, 0/2 (dropped `q15k2p`); 2 noise |
| `model-preference` (answerable) | served, adapter-filtered; 2/3, coverage 1/1, suppression 0/2, 2 neighbours kept / 2 rendered | same 2/3; **9 neighbour candidates kept / 4 rendered** (vs 2/2), 3 T1 lines | served; 2/3, coverage 1/1, 4 neighbours kept / 4 rendered, 0 T1 | **fallback `low-containment`** → identical to `snapshot-current` |

Topic audit: 3/3 cases froze a `TopicState`; the facet applied on 2; one
fallback (`low-containment: 1`); all 3 carry the frozen `staleRisk` reasons.

---

## 3. Did the real negatives disappear?

**No.** Both user-reported cases still display their noise bodies on every arm
that can serve them:

- `quality-negative`: `snapshot-current`, `current-query-off` and `topic-facet`
  all serve, and all still show 2 noise anchors (facet: 1 noise anchor). The
  control's `falseDisplay` is `1/1` on all three.
- `research-negative`: snapshot shows 3 noise anchors, the off arm the same 3
  plus a repeated T1 line, the facet 2. `falseDisplay` is `1/1` on all three.

Aggregate `falseDisplay` stays **2/2 (100%)** for `snapshot-current`,
`current-query-off` and `topic-facet`. The one arm that reports `0/2`
(`live-frozen`) did not find better evidence — neither control printed any
pointer at all, so nothing could be displayed. A control that displays nothing
is not a fixed control; reading that `0/2` as "the live path avoids noise" is
exactly the category error the later-capture provenance warns about.

The facet's precision move from 25.0% (2/8) to 33.3% (2/6) is **not an
improvement in usefulness**: the numerator is the same 2 anchors (both in
`model-preference`). The denominator shrank because one noise anchor per negative
was dropped (`q15k2p`). One fewer noise line with the same useful lines is a
smaller display, not a better one; and 2 noise anchors still survive on the same
displayed block.

---

## 4. Live vs snapshot marginal quality

What was observed:

- The two controls' later live calls returned a bare `<topic-recall>` shell
  ("主题：未设置 / 相关记忆：无 / Agent：理解当前对话后，使用 mafw_topic_set 设置主题").
  Recorded honestly as *not served memory blocks* (`served: false`,
  `decision: 'no-snapshot'`, `fallbackReason: 'no-memory-pointers'`), and they do
  count in `serve.notServed` (1/3 served).
- The mixed case's live capture served a real block: 3 anchors (2 useful, same
  2/3 as the snapshot), 4 noise neighbours (vs 2 after the adapter), no T1 lines
  (vs 3 repeated lines).

What it does **not** license: "the live path would have showed nothing on those
two turns". The capture is a later call for the same text, past the snapshot TTL,
with no topic set at capture time and a different retrieval pool. At least three
confounders (time/TTL, unset topic, pool state) are entangled. The only defensible
readings are:

1. at 09:04 on that session, the live boundary path returned no memory pointer
   for those two query texts — a real observation about that moment;
2. the same-turn counterfactual is **unmeasured** and cannot be produced from
   this seed.

The one clean comparison in the data is `snapshot-current` vs
`current-query-off` (same decision, same pool, same query): dropping only the
adapter moves the mixed case's neighbours from 2 kept / 2 rendered to 9 kept /
4 rendered (7 more candidates kept, 2 more rendered) and leaves both negatives
displaying noise. So the adapter is removing some noise; it is not the layer that
created it, and it is not sufficient to clear it.

---

## 5. TopicState risk (must not be ignored)

The frozen topic is the audited **current** state of
`ses_e7444718cffeVJ3eJOTAReq8F0` (revision 4), replayed against all three
2026-11-19 cases. Its own audit records three stale signals, all carried into
every result row:

1. **The summary is outdated and contradicts this very pilot**: it says
   「误注入已清零」 while both 2026-11-19 cases still display noise bodies.
   Anything that trusts that summary as current state would conclude the
   mis-injection was already resolved.
2. **`retrievalKeys` still contains `implicit 2/10`** — a pre-P1 baseline number,
   not current state.
3. **`updatedAt` is `2026-11-18T10:05:23.261Z`**, before all three snapshot builds,
   and the topic was not captured per serve. Per-case topic freshness is
   therefore *unmeasured* by construction.

The risk is not academic for this arm: `topic-facet` takes its domain vocabulary
from exactly those `entities` / `aliases` / `retrievalKeys` fields. The surviving
noise anchor on both negatives (`7lsgaw`, whose cue anchors are 记忆质量 /
检索效率) is admitted on domain overlap with `相似记忆合并` — an entry that is
itself an old open-loop phrasing in the stale state. A stale-but-on-domain
retrieval key is precisely how a wrong topic makes the facet *more* confident.
The third case avoids this only because the containment gate (`topic+summary` vs
raw query < 0.25) happened to fire: the stale topic is 个人记忆质量治理 while the
query asks what to delegate. One case out of three is not evidence that the gate
generalises; a stale topic that happens to be topically adjacent would pass
containment and filter on the wrong domain silently.

Consequences for the pilot:

- Treat `facetFallback` / `topicStaleRisk` as **mandatory output** of any future
  run; an arm that filters on a stale topic without recording it is not
  interpretable.
- The staleness of the frozen state is a *measurement* limitation of this seed,
  and the summary's "cleared" claim is a *data quality* problem in the topic
  state itself. Both must be fixed before the facet hypothesis can be tested:
  capture the TopicState **at serve time, per serve**.

---

## 6. Verdict: **redesign** (before any expansion; no production)

Not "expand" and not "stop".

Why not **expand**: more cases of the same shape would re-measure the same
ceiling. The failure that matters — noise displayed on both real negatives — is
unchanged (2/2, 100%). The residual noise survives on genuine domain-term overlap
(`相似记忆合并` ↔ 记忆质量), so the metadata-facet rule cannot clear it without a
different signal; and the live comparison cannot be judged until it is captured
same-turn and per-serve. Expanding the sample now would buy precision on numbers
that cannot answer the question.

Why not **stop**: the arm did something specific and cheap in the right
direction — it dropped the process-note anchor whose only tie to the query was
「质量」, in both negatives, with no observed answer/context loss (`suppression
0/2`, coverage `1/1` unchanged, T1 untouched by design), and the containment gate
refused the third case instead of forcing a filter. That is a hypothesis worth
testing properly; the negative result on `falseDisplay` is an argument against
the *current rule*, not against the *layer attribution* the four arms provide.

### What a redesign must change

**Measurement (prerequisite, otherwise no expansion is interpretable).**

1. Capture the live boundary block **on the same turn** as the snapshot (no
   later same-text proxy), and record the serve-time query.
2. Capture `TopicState` **at serve time, per serve**; store its `revision` /
   `updatedAt` next to the case, and re-audit the summary/`retrievalKeys` against
   the served block (the current one claims the opposite of its own cases).
3. Pre-register the decision rule *and* the pass/fail thresholds before capturing
   (e.g. "control `falseDisplay` must fall below 1.0 on ≥N controls while
   `suppression` stays at baseline"; "coverage must not drop on the answerable
   cases").
4. ≥2 annotators with an agreement check on a subset; ids and roles frozen as
   today.

**Rule (so the redesign can actually move `falseDisplay`).**

5. Domain-term overlap is necessary but demonstrably insufficient. The redesign
   must add an answer-level signal (e.g. support for the *specific* question
   asked, not the topic's vocabulary) and state how it treats stale
   `retrievalKeys`.
6. Keep the guard that a stale/low-containment topic falls back, and make the
   fallback reason part of the result contract (it already is).

### Where this becomes "expand" or "stop"

- **Expand** once the same-turn protocol exists and the first pre-registered run
  shows the facet lowering `falseDisplay` on controls without raising
  `suppression` or lowering coverage. Then go to 20–50 dev cases plus an isolated
  held-out set.
- **Stop** the facet line if same-turn captures show the live path serving noise
  at a comparable rate (i.e. the two topic shells were a time/topic artefact),
  or if the only way to clear the residual noise also suppresses `answer|context`
  candidates (`suppression` above the P0 baseline of `0/2`).

### Explicitly not concluded

- No production change, no admission-rule change, no threshold tuning, and no
  claim that `topic-facet` improves recall quality. The current numbers describe
  three incidents on one day and cannot support a generalisation.
- No claim that the live path is cleaner than the snapshot path on the same turn.

---

## 7. Reproducibility and gate

- Re-running the command above reproduces every numerator/denominator; only
  `command` (contains `--out`) and `generatedAt` reflect the invocation.
- The checked-in gate (`session-quality-shadow-runner.test.ts`) re-runs the frozen
  fixtures at `generatedAt` and requires `arms`, `configSource`,
  `snapshotConfig`, `fixture`, `summary`, `cases` and `codeFingerprint` to match
  the checked-in baseline; a stale baseline (different fingerprint, config,
  metric or case set) fails with the exact mismatch paths. The pilot head-line
  numbers and the per-case evidence above are asserted literally, so a silent
  move in any arm breaks the suite.
- `--snapshot-config '{"ttlMs":1}'` is the sensitivity probe: it moves all three
  snapshot decisions to `stale`, leaves `live-frozen` untouched, and is recorded
  as `configSource: "override"` — proof that the gate measures rather than echoes
  a constant.
