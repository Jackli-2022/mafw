# Session Surprise (Novelty v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score every encoded T1 turn with session-local surprise (`1 − cos(turn, previous turn)`), store it beside `novelty`, and report whether it predicts memorability better.

**Architecture:** Extend `t1-signals.ts` with a pure `scoreSurprise` plus `computeTurnSurprise` (embeds the turn and its previous turn, fails open). `TurnPipeline` resolves the previous trace from `t1_turns`, reads its text, and writes a `surprise` scalar onto `t1_turn_features`. Phase 1 measures only; no consumer changes.

**Tech Stack:** TypeScript, better-sqlite3, Jest, existing `SemanticEmbedder`.

**Spec:** `docs/superpowers/specs/2026-11-19-session-surprise-design.md`

## Global Constraints

- Raw T1 immutable; surprise is a derived scalar and never gates ingestion.
- Fail-open: embed/DB errors yield `null`, never a failed archive.
- No LLM, no new embedding model, no new HTTP route.
- Phase 1 does not change `replayPriority`, reflection order, or consolidation.
- Execute natively on `main`; no worktree; do not stage other sessions' files.
- TDD: failing test first, then implementation, then commit.
- Report new-test count and full-suite counts at delivery.

## Review Focus

- Re-encoding must not erase an existing `surprise` (upsert merge).
- No previous turn / previous turn unreadable must yield `null`, not `0` or `1`.
- A non-informative previous turn (telemetry/system/short) must yield `null` instead of a huge surprise.
- Embedder failure must still archive the turn.
- Backfill must use the same previous-turn rule as the live pipeline (same session, `turn_seq − 1`).

---

### Task 1: Persist `surprise`

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts` (`T1TurnFeature`; migration block after the `novelty`/`mismatch` migrations; `upsertTurnFeature`; `getTurnFeature`)
- Test: `gateway/tests/unit/memory/t1-feature-signals.test.ts`

**Interfaces:**
- Produces: `T1TurnFeature.surprise?: number | null`; `upsertTurnFeature` preserves it when omitted; `getTurnFeature` returns it.

- [ ] **Step 1: Write the failing test** — add to the existing describe:

```ts
test('roundtrips surprise and preserves it on re-upsert', () => {
  db.upsertTurnFeature(feature({ surprise: 0.37 }) as any);
  expect(db.getTurnFeature('t1t_a')!.surprise).toBeCloseTo(0.37);
  db.upsertTurnFeature(feature({ intent: 're-encoded' }) as any);
  expect(db.getTurnFeature('t1t_a')!.surprise).toBeCloseTo(0.37);
});
```

- [ ] **Step 2: Run it** — `cd gateway && npx jest --runInBand --forceExit tests/unit/memory/t1-feature-signals.test.ts`
  Expected: FAIL (undefined, then undefined after re-upsert).

- [ ] **Step 3: Implement** — add the optional field, `ALTER TABLE t1_turn_features ADD COLUMN surprise REAL` (same try/catch style), include `surprise` in the INSERT/`COALESCE`, and map it in `getTurnFeature`.

- [ ] **Step 4: Run it** — Expected: PASS (4 tests).

- [ ] **Step 5: Commit** — `git add gateway/src/memory/gateway-db.ts gateway/tests/unit/memory/t1-feature-signals.test.ts && git commit -m "feat(memory): store session surprise"`

---

### Task 2: Pure surprise scorer

**Files:**
- Modify: `gateway/src/recall/t1-signals.ts`
- Test: `gateway/tests/unit/recall/t1-signals.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface SurpriseInput { traceId: string; text: string; prevText?: string }
  export function scoreSurprise(cosine: number | null): number | null
  export async function computeTurnSurprise(
    inputs: SurpriseInput[],
    deps: Pick<TurnSignalDeps, 'embedder'>,
  ): Promise<Map<string, number>>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test('identical consecutive turns have zero surprise', async () => {
  const d = deps({});
  const map = await computeTurnSurprise(
    [{ traceId: 't', text: 'same body', prevText: 'same body' }],
    { ...d, embedder: { embed: async (texts) => texts.map(() => [1, 0]) } } as any,
  );
  expect(map.get('t')!).toBeCloseTo(0);
});

test('different consecutive turns have positive surprise', async () => {
  const d = deps({});
  const map = await computeTurnSurprise(
    [{ traceId: 't', text: 'new body', prevText: 'old body' }],
    { ...d, embedder: { embed: async (texts) => texts.map((t) => (t === 'new body' ? [1, 0] : [0, 1])) } } as any,
  );
  expect(map.get('t')!).toBeCloseTo(1);
});

test('no previous text or an uninformative previous turn yields no score', async () => {
  const d = deps({});
  const map = await computeTurnSurprise(
    [
      { traceId: 'a', text: BODY },
      { traceId: 'b', text: BODY, prevText: 'You are a subagent spawned by another session.' },
    ],
    { embedder: d.embedder } as any,
  );
  expect(map.size).toBe(0);
});

test('embed failure yields an empty map', async () => {
  const d = deps({});
  d.embedder.embed = async () => { throw new Error('down'); };
  await expect(
    computeTurnSurprise([{ traceId: 't', text: BODY, prevText: BODY }], d as any),
  ).resolves.toEqual(new Map());
});

test('scoreSurprise clamps and rejects null', () => {
  expect(scoreSurprise(1)).toBe(0);
  expect(scoreSurprise(-0.2)).toBe(1);
  expect(scoreSurprise(null)).toBeNull();
});
```

- [ ] **Step 2: Run** — Expected: FAIL (not exported).

- [ ] **Step 3: Implement**
  - `scoreSurprise(cosine)` → `clamp01(1 − cosine)`, `null` for non-finite/null.
  - `computeTurnSurprise`: filter inputs where both `text` and `prevText` pass `isInformativeTurn(_, 0)`; batch-embed current and previous texts (`document`); cosine per pair; skip pairs with mismatched dimensions; wrap all in try/catch returning empty map.
- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(memory): score session surprise"`

---

### Task 3: Pipeline wiring

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts` (`TurnPipelineOptions`; after the existing signals block)
- Modify: `gateway/src/kernel.ts` (turn pipeline construction)
- Modify: `gateway/src/config.ts` (`t1Surprise: 'on' | 'off'`, default `'on'`)
- Test: `gateway/tests/unit/recall/turn-pipeline-signals.test.ts`

**Interfaces:**
- Produces: `TurnPipelineOptions.surpriseFor?: (turns: SurpriseInput[]) => Promise<Map<string, number>>`.

- [ ] **Step 1: Write the failing test** — seed two turns in one session, stub `surpriseFor` with `{ [secondTrace]: 0.42 }`, run `runSession`, assert `db.getTurnFeature(secondTrace).surprise ≈ 0.42` and `firstTrace.surprise` is null; a throwing stub keeps `archived = 1` and leaves `null`.
  Build the second seeded turn with `db.beginTurn('s1')` after the first, and pass `prevText`/`prevTraceId` through the stub arguments.

- [ ] **Step 2: Run** — Expected: FAIL (option unknown / no write).

- [ ] **Step 3: Implement**
  - In the per-turn loop, after the existing signals collection, resolve the previous trace:
    `SELECT trace_id FROM t1_turns WHERE session_id = ? AND turn_seq = ?` via a new `db.getPrevTurnTrace?.(sessionId, turnSeq)` helper (add to `GatewayDatabase` in this task) and read it with `db.readTrace`.
  - Collect `{ traceId, text, prevText }` only when the previous trace exists.
  - After the signals block, `await this.opts.surpriseFor?.(inputs)`; for each score `upsertTurnFeature({ ...feature, surprise })`; try/catch.
  - Kernel: `surpriseFor: createTurnSurpriseScorer({ enabled: config.recall.t1Surprise !== 'off', embedder: rt?.provider })` (add the small factory to `t1-signals.ts`, tested in Task 2 file if desired).
  - Config type + default.
- [ ] **Step 4: Run** — `npx jest --runInBand --forceExit tests/unit/recall/turn-pipeline-signals.test.ts tests/unit/recall/turn-pipeline-episodes.test.ts`; Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(memory): wire session surprise into the pipeline"`

---

### Task 4: Stats

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts` (`t1SignalStats`)
- Modify: `gateway/src/routes/memory.ts`
- Test: `gateway/tests/unit/routes/memory-wiring.test.ts`

**Interfaces:**
- Produces: `signals.surprise: { p50, p90, p99, max }`, `signals.surpriseScored`, `signals.highSurprise` (threshold from `t1SignalThresholds.highSurprise`, default `0.6` until the backfill re-tunes).

- [ ] **Step 1: Write the failing test** — extend both `t1.signals` expectations with the zero shape, and add a case where the fake `t1SignalStats` returns `surprise`/`surpriseScored`/`highSurprise`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** — reuse the percentile helper on `surprise`; count `surpriseScored` (`surprise IS NOT NULL`), `highSurprise` (`surprise >= threshold`); route default + merge; type `t1SignalThresholds.highSurprise`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(memory): report session surprise distribution"`

---

### Task 5: Backfill + comparison

**Files:**
- Modify: `gateway/scripts/backfill-t1-signals.ts`
- Modify: `gateway/scripts/backfill-t1-signals.ts` imports (`computeTurnSurprise`, `normalizeObservationText` already imported)

**Interfaces:**
- Consumes: Task 2 scorer, Task 1 column.
- Produces: the same run writes `surprise` alongside `novelty`/`mismatch`; output adds `surpriseScored`, `surprise` percentiles, and AUCs for both labels.

- [ ] **Step 1: Implement** — for each row also look up `turn_seq − 1` in the same session; read that trace; build `prevText`; run `computeTurnSurprise` in the same 32-row batches; `--apply` writes `surprise` with the other scalars.
- [ ] **Step 2: Add AUC output** — labels: (A) trace appears in any active unit's `source_trace_ids`; (B) additionally appears in `t1_retrieval_events`. Print `{labelA:{novelty,surprise,mismatch},labelB:{...}}`.
- [ ] **Step 3: Dry-run** — `npx ts-node --transpile-only --project tsconfig.json scripts/backfill-t1-signals.ts`; record percentages and AUCs.
- [ ] **Step 4: Apply** — `--reset --apply`; expect `applied === scored`, `failed: 0`.
- [ ] **Step 5: Commit** — `git commit -m "feat(memory): backfill session surprise"`

---

### Task 6: Live verify, audit, release note, gate

- [ ] **Step 1: Rebuild + restart**, then `GET /api/memory/stats` → `t1.signals.surprise` matches the apply run.
- [ ] **Step 2: Audit** top 20 `surprise`: confirm the jump is a real change, not formatting/tool output. Record false positives.
- [ ] **Step 3: Decide Phase 2** — only if AUC ≥ 0.60 and positives ≥ 100; otherwise state “not enabled”.
- [ ] **Step 4: Full gate** — gateway jest, tsc, build, contract.
- [ ] **Step 5: Release note** `docs/releases/2026-11-19-session-surprise.md` + spec status; commit.
