# Auto Recall Exact Evidence Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make automatic recall admit deterministic exact memories and preserve snapshot context after T1 archival, without weakening low-confidence suppression or the 100ms boundary contract.

**Architecture:** Establish a fixed 40-query live baseline first. Add a small pure exact-evidence module used only by the live boundary route, then replace the snapshot's hot-table-only turn reader with the existing active+archive timeline primitives. Tail-neighbor presentation and endpoint performance are measured but not redesigned in this slice.

**Tech Stack:** TypeScript, Node.js, Jest, GatewayDatabase, existing BM25/FOK/snapshot modules.

**Spec:** `docs/research/2026-11-18-auto-recall-fok-divergence.md`

## Global Constraints

- Main checkout only; no worktree, branch, or push.
- Do not modify or revert other sessions' uncommitted files.
- `no-memory` and ordinary `low-confidence` recall bodies remain suppressed.
- Do not lower FOK thresholds, increase top-k globally, add recency ranking, gate note-board, or add a memory producer.
- Exact admission only uses active, deterministic title/cue/identifier evidence; superseded and legacy-episodic entries are ineligible.
- Do not add a reranker or LLM to the live boundary path; preserve the 100ms contract.
- TDD: every production change starts with a test actually observed failing, then passing.
- Use `gateway/volcengine/deepseek-v4.1-flash` for implementation/review subagents.
- Subagents do not call `mafw_add_memory`, `mafw_search_hybrid`, or `mafw_topic_set`.

## Review Focus

- Flat BM25 score distributions must not hide an active exact identifier match (Task 2 test).
- Generic/high-frequency cues and partial lexical overlap must not grant admission (Task 2 test).
- Superseded or retracted-looking exact text must not resurrect old facts (Task 2 test).
- Negative queries must keep an empty recall body (Tasks 1 and 2 tests).
- Archiving older turns must not collapse the rolling snapshot query to the newest short instruction (Task 3 test).
- note-board remains independent and must not count as related-recall success (Task 1 runner metric).

---

### Task 1: Fixed 40-query personal-recall evaluation

**Files:**
- Create: `evaluation/personal-recall/queries.json`
- Create: `evaluation/personal-recall/run.js`
- Create: `evaluation/personal-recall/README.md`
- Create: `gateway/tests/unit/eval/personal-recall-runner.test.ts`

**Interfaces:**
- Fixture item: `{ id, category, query, sessionID?, must_include: string[], must_exclude: string[], note }`.
- Categories contain exactly 10 each: `current-state`, `exact`, `implicit`, `negative`.
- Runner: `node evaluation/personal-recall/run.js --out <absolute-json-path>`; read-only HTTP, defaults to `http://127.0.0.1:3000`.
- Output: per-entry REST hit@1/3, auto-recall included/excluded ids, entrypoint agreement, latency; summary includes hit rates, false-injection, stale-injection, p50/p95. Note-board and pinned blocks are excluded from auto target/false-injection parsing.

- [ ] **Step 1: Write runner schema/metric tests first**

Test a tiny two-query fixture and mocked fetch: target at REST rank 1 vs rank 3, `#mem-xxxxxx` pointer matching by the last 6 id chars, negative false injection, must_exclude stale injection, and note-board exclusion. The real fixture validator must reject duplicate ids, unknown memory ids, category counts other than 10/10/10/10, and empty `must_include` outside `negative`/`implicit` cases explicitly marked no-answer.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx jest --runInBand --forceExit tests/unit/eval/personal-recall-runner.test.ts` from `gateway`.
Expected: FAIL because the runner module does not exist.

- [ ] **Step 3: Implement the runner and fixture**

Reuse the LongMemEval metric style where practical, but keep this probe dependency-free Node. Select 40 real queries from the current corpus; freeze expected memory ids in `queries.json` rather than deriving expectations during the run. Include the known `5cd9885f5`, both exact-title cases, implicit continuation queries, and 10 true no-answer/negative controls. Document corpus dependence and that this is a personal regression set, not a public benchmark.

- [ ] **Step 4: Run tests and capture the pre-change baseline**

Run the Jest test (PASS), then run the probe against live gateway and save JSON under `C:\Users\15524\AppData\Local\Temp\opencode\personal-recall-before.json`. Verify exactly 40 rows and record summary metrics for later comparison. Do not tune production code before this artifact exists.

- [ ] **Step 5: Commit**

```bash
git add evaluation/personal-recall gateway/tests/unit/eval/personal-recall-runner.test.ts
git commit -m "test(memory): add personal recall evaluation set"
```

### Task 2: Deterministic exact-evidence admission

**Files:**
- Create: `gateway/src/recall/exact-evidence.ts`
- Create: `gateway/tests/unit/recall/exact-evidence.test.ts`
- Modify: `gateway/src/routes/recall.ts:231-327`
- Modify: `gateway/tests/unit/recall/topic-recall.test.ts` only if a new route-independent contract test belongs there; do not reverse existing suppression tests.

**Interfaces:**
- `findExactRecallEvidence(entries: readonly any[], query: string, limit = 3): ExactRecallEvidence[]`.
- `ExactRecallEvidence = { entry: any; kind: 'title' | 'identifier' | 'cue'; specificity: number }`.
- `applyExactRecallEvidence(memories: RecallMemory[], evidence: ExactRecallEvidence[], status: FokZone, topK = 3): { memories: RecallMemory[]; status: FokZone; exactIds: string[] }`.
- Route consumes both helpers only on the live path after the existing FOK calculation; snapshot serving is unchanged.

- [ ] **Step 1: Write failing pure-function and route tests**

Pin all of these cases:
1. Three flat-score candidates plus an active exact `5cd9885f5` cue → exact id is admitted and status becomes `inject` even when the input status is `no-memory`.
2. Full normalized title equality → admitted.
3. A distinctive contained cue such as `Proactive Topic Recall` → admitted only when normalized phrase length is at least 12 ASCII chars or 6 CJK chars, document frequency is at most 5, and it covers at least 50% of the query's non-space characters.
4. Generic cue with document frequency >5, short cue, and partial token overlap → unchanged status and candidates.
5. `superseded_by` entries and unpinned/unsticky legacy `episodic` entries → ineligible; active semantic replacement remains eligible.
6. Iceland-style no-answer query → unchanged `no-memory`; existing ordinary `low-confidence` without exact evidence remains suppressed by `hasRelatedRecallBody`.
7. Exact matches are merged ahead of other candidates, deduplicated, and bounded to topK=3; ties are deterministic by specificity and id, never recency.
8. Route-level `5cd9885f5` shape produces a body containing the exact target; negative route shape still produces the no-related header only.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx jest --runInBand --forceExit tests/unit/recall/exact-evidence.test.ts` from `gateway`.
Expected: FAIL because exact-evidence admission does not exist; existing suppression tests must remain green.

- [ ] **Step 3: Implement conservative exact evidence**

Normalize with NFKC, lowercase, and whitespace collapsing. Support full title equality, whole-query camel/snake/path identifiers, and 7–40 char hexadecimal commit ids. Contained title/cue evidence must meet the length, document-frequency, and 50% coverage rules above. Use only index `primary_abstraction` and `cue_anchors`; do not read bodies or add embeddings. Merge exact entries ahead of existing candidates without changing global BM25 scoring or FOK thresholds.

- [ ] **Step 4: Run focused regressions**

Run exact-evidence, topic-recall, recall route/render, FOK, and snapshot tests. Expected: all pass, including unchanged no-memory/low-confidence suppression and note-board behavior. Measure the added synchronous scan cost on the real 16k-entry index; if it materially threatens 100ms, reduce work without weakening evidence rules rather than hiding the regression.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/exact-evidence.ts gateway/src/routes/recall.ts gateway/tests/unit/recall/exact-evidence.test.ts gateway/tests/unit/recall/topic-recall.test.ts
git commit -m "fix(recall): admit deterministic exact evidence"
```

### Task 3: Snapshot rolling window includes archived turns

**Files:**
- Modify: `gateway/src/recall/snapshot-builder.ts`
- Modify: `gateway/src/kernel.ts:2662-2687`
- Create: `gateway/tests/unit/recall/snapshot-recent-turns.test.ts`

**Interfaces:**
- `recentTurnTextsFromDb(db: { listSessionTurns(sessionID: string): Array<{ turn_id: number }>; readTurnRows(sessionID: string, turnID: number): Array<{ source: string; content: string }> }, sessionID: string, maxTurns: number): string[]`.
- Returns user/assistant texts oldest→newest from the last `maxTurns` logical turns, using active+archive rows.
- Kernel's `buildSnapshot({ recentTurnTexts })` delegates to this helper.

- [ ] **Step 1: Write the failing archival test**

Create real temporary GatewayDatabase turns, archive the older turns, leave only the newest short instruction hot, and assert `recentTurnTextsFromDb(sid, 4)` still returns the latest four logical turns in chronological order. Include user/assistant filtering, empty turns, stable ordering, and `maxTurns=0`.

- [ ] **Step 2: Run test and verify failure**

Run: `npx jest --runInBand --forceExit tests/unit/recall/snapshot-recent-turns.test.ts` from `gateway`.
Expected: FAIL because the helper does not exist; demonstrate the old hot-only closure shape would return only the short instruction.

- [ ] **Step 3: Implement the helper and wire kernel**

Use `listSessionTurns(sessionID).slice(-maxTurns)` and `readTurnRows(sessionID, turn_id)`. Do not query `listTurns/readTurn` in the new path and do not change snapshot TTL/containment thresholds.

- [ ] **Step 4: Run snapshot and T1 regressions**

Run snapshot-builder, recall-snapshot, snapshot-t1, session-timeline, and gateway-db archive identity tests. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/snapshot-builder.ts gateway/src/kernel.ts gateway/tests/unit/recall/snapshot-recent-turns.test.ts
git commit -m "fix(recall): retain archived turns in snapshots"
```

### Task 4: Full verification and live before/after

**Files:**
- Modify: `docs/architecture/memory.md`
- Create: `docs/releases/2026-11-18-auto-recall-exact-evidence.md`

- [ ] **Step 1: Run focused suites and typecheck**

Run all new/affected suites and `npx tsc --noEmit -p tsconfig.json` from `gateway`; expected 0 failures.

- [ ] **Step 2: Run full gateway suite**

Run `npm test -- --forceExit`; expected 0 failed. Report new tests and full counts.

- [ ] **Step 3: Build and hot-restart**

Run `npm run build`, write the atomic restart token with `action=restart`, and verify a new pid plus health `ok`.

- [ ] **Step 4: Repeat the identical evaluation**

Run the 40-query probe to `personal-recall-after.json`, plus the original four scenarios. Compare hit@1/3, false/stale injection, entrypoint agreement, latency, snapshot query text/zone, and exact-target auto inclusion. Do not claim quality improvement unless negative controls remain clean and target cases improve. Record remaining tail-neighbor and >100ms issues separately.

- [ ] **Step 5: Document and commit**

Update architecture current behavior and release notes with commits, test counts, baseline/after metrics, review results, and unresolved items. Commit only this slice's files; do not push.
