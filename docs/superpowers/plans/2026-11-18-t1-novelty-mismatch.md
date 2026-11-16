# T1 novelty / mismatch (E2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score every encoded T1 turn for novelty (distance to active cortex memory) and mismatch (familiar cue, unfamiliar content), store both as scalars, and expose their distribution — without changing replay behavior.

**Out of scope:** replay/reflection consumption (Phase 2) and consolidation dedupe pre-filter (Phase 3); both are separate approvals in the spec.

**Architecture:** A pure scoring module (`t1-signals.ts`) embeds two views of each turn (full text, cue text), searches the existing cortex vector store, filters by active/live/not-self/earlier-than-turn, and returns two floats. `TurnPipeline` calls it after the per-turn encode pass and writes the scalars back onto `t1_turn_features`. Stats report the distribution; replay keeps the constant `0.5` until a separate flag is turned on.

**Tech Stack:** TypeScript, better-sqlite3, Jest, existing `SemanticEmbedder` + `MemoryVectorStore`.

**Spec:** `docs/superpowers/specs/2026-11-18-t1-novelty-mismatch-design.md`

## Global Constraints

- Raw T1 is immutable; signals are derived scalars and never gate ingestion.
- Fail-open: any embed/search/DB error yields `null` signals, never a failed archive.
- Do not block capture: signals run only in the hourly `TurnPipeline`, never in the obs write path.
- No LLM calls and no new embedding model; use the configured embedder.
- `novelty`/`mismatch` are `null` when unscored; `0` means scored-and-minimal.
- Phase 1 does not change `replayPriority` (still `novelty: 0.5`), reflection order, or consolidation.
- Execute natively on `main`; do not create a worktree or branch; do not stage other sessions' files.
- TDD: each task writes the failing test first, then the implementation, then commits.
- Report new-test count and full-suite counts at delivery.

## Review Focus

- Re-encoding an existing turn must not erase previously computed signals (upsert merge).
- Embedder unavailable/misconfigured must still archive the turn and leave signals `null` (no NaN, no 0/1 defaults).
- A fresh install with zero cortex memories must produce `null`, not `novelty = 1`.
- Superseded and legacy `episodic` units must never seed similarity.
- Reference memories created after the turn must be excluded (no future leakage during backfill).

---

### Task 1: Persist signal columns with merge-on-upsert

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts` (`T1TurnFeature` ~line 86; migration block after the `t1_archive` column migrations ~line 845; `upsertTurnFeature` ~line 1282)
- Test: `gateway/tests/unit/memory/t1-feature-signals.test.ts`

**Interfaces:**
- Consumes: existing `GatewayDatabase` schema/migrations.
- Produces: `T1TurnFeature.novelty?: number | null`, `T1TurnFeature.mismatch?: number | null`; `upsertTurnFeature` preserves them when the incoming object omits them; `getTurnFeature` returns them.

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';

describe('t1 turn signal columns', () => {
  let dir: string;
  let db: GatewayDatabase;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-signal-cols-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const feature = (over: Record<string, unknown> = {}) => ({
    traceId: 't1t_a', sessionId: 's1', turnSeq: 1, entities: [], outcome: 'pass' as const, confidence: 0.6, ...over,
  });

  test('roundtrips novelty and mismatch', () => {
    db.upsertTurnFeature(feature({ novelty: 0.42, mismatch: 0.11 }) as any);
    const row = db.getTurnFeature('t1t_a')!;
    expect(row.novelty).toBeCloseTo(0.42);
    expect(row.mismatch).toBeCloseTo(0.11);
  });

  test('re-upsert without signals preserves the previous values', () => {
    db.upsertTurnFeature(feature({ novelty: 0.42, mismatch: 0.11 }) as any);
    db.upsertTurnFeature(feature({ intent: 're-encoded' }) as any);
    const row = db.getTurnFeature('t1t_a')!;
    expect(row.intent).toBe('re-encoded');
    expect(row.novelty).toBeCloseTo(0.42);
    expect(row.mismatch).toBeCloseTo(0.11);
  });

  test('explicit new signals overwrite', () => {
    db.upsertTurnFeature(feature({ novelty: 0.42, mismatch: 0.11 }) as any);
    db.upsertTurnFeature(feature({ novelty: 0.9, mismatch: 0.3 }) as any);
    const row = db.getTurnFeature('t1t_a')!;
    expect(row.novelty).toBeCloseTo(0.9);
    expect(row.mismatch).toBeCloseTo(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand --forceExit tests/unit/memory/t1-feature-signals.test.ts`
Expected: FAIL — `novelty`/`mismatch` undefined (columns absent).

- [ ] **Step 3: Implement**

In `T1TurnFeature`, add:
```ts
/** DG pattern-separation score vs active cortex memory; null = unscored. */
novelty?: number | null;
/** CA1 comparator: familiar cue + unfamiliar content; null = unscored. */
mismatch?: number | null;
```
In the migration block (after the `t1_archive` column migrations), add two `try { this.db.exec('ALTER TABLE t1_turn_features ADD COLUMN novelty REAL') } catch {}` entries with the same comment style (one for `novelty`, one for `mismatch`).

In `upsertTurnFeature`:
- add `novelty, mismatch` to the column list and to `VALUES` (two more `?`);
- in `ON CONFLICT ... DO UPDATE SET`, use `novelty = COALESCE(excluded.novelty, novelty)` and the same for `mismatch`;
- append `feature.novelty ?? null, feature.mismatch ?? null` to `.run(...)` in column order.

Also ensure `getTurnFeature` maps the two columns (`rowToTurnFeature`-style mapper if one exists; otherwise the `T1TurnFeature` object built from the row).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand --forceExit tests/unit/memory/t1-feature-signals.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/tests/unit/memory/t1-feature-signals.test.ts
git commit -m "feat(memory): store t1 novelty and mismatch signals"
```

---

### Task 2: Pure signal scorer

**Files:**
- Create: `gateway/src/recall/t1-signals.ts`
- Test: `gateway/tests/unit/recall/t1-signals.test.ts`

**Interfaces:**
- Consumes: `SemanticEmbedder` shape from `t1-semantic-atoms.ts` (`embed(texts, kind)`), `VectorStoreLike.searchByCosine(query, topK)`.
- Produces:
  ```ts
  export interface TurnSignalInput { traceId: string; text: string; cue: string; lastTs?: number; anchorCount: number }
  export interface TurnSignals { novelty: number; mismatch: number }
  export interface TurnSignalUnit { createdAt?: string; type?: string; supersededBy?: string; traceIds?: string[] }
  export function isInformativeTurn(text: string, anchorCount: number): boolean
  export function scoreTurnSignals(contentSim: number | null, cueSim: number | null): TurnSignals | null
  export async function computeTurnSignals(
    inputs: TurnSignalInput[],
    deps: {
      embedder: { embed(texts: string[], kind: 'query' | 'document'): Promise<number[][]> };
      vectors: { searchByCosine(q: number[], k: number): Array<{ id: string; cosine: number }> };
      unitFor: (id: string) => TurnSignalUnit | undefined;
    },
  ): Promise<Map<string, TurnSignals>>
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { computeTurnSignals, isInformativeTurn, scoreTurnSignals } from '../../../src/recall/t1-signals';

const units: Record<string, any> = {
  m1: { createdAt: '2026-01-01T00:00:00.000Z', type: 'semantic' },
};

function deps(cosByText: Record<string, number>) {
  return {
    // content and cue texts are distinct strings, each maps to a marker vector.
    embedder: { embed: async (texts: string[]) => texts.map((t) => [t.length, t.charCodeAt(0)]) },
    vectors: {
      searchByCosine: (q: number[]) => {
        const text = Object.keys(cosByText).find((t) => t.length === q[0] && t.charCodeAt(0) === q[1]);
        if (!text) return [];
        const cos = cosByText[text];
        return cos == null ? [] : [{ id: 'm1', cosine: cos }];
      },
    },
    unitFor: (id: string) => units[id],
  };
}

const input = (over: Record<string, unknown> = {}) => ({
  traceId: 't1t_a',
  text: 'a long enough turn body that passes the informative gate',
  cue: 'fix reflection',
  lastTs: Date.parse('2026-02-01T00:00:00.000Z') / 1000,
  anchorCount: 2,
  ...over,
});

describe('t1 signals', () => {
  test('paraphrase of a known memory is low novelty and low mismatch', async () => {
    const map = await computeTurnSignals([input()], deps({
      'a long enough turn body that passes the informative gate': 0.95,
      'fix reflection': 0.9,
    }));
    expect(map.get('t1t_a')!.novelty).toBeCloseTo(0.05);
    expect(map.get('t1t_a')!.mismatch).toBe(0);
  });

  test('familiar cue with unfamiliar body is a mismatch', async () => {
    const map = await computeTurnSignals([input()], deps({
      'a long enough turn body that passes the informative gate': 0.4,
      'fix reflection': 0.9,
    }));
    expect(map.get('t1t_a')!.novelty).toBeCloseTo(0.6);
    expect(map.get('t1t_a')!.mismatch).toBeCloseTo(0.5);
  });

  test('unrelated content is novel but not mismatched', async () => {
    const map = await computeTurnSignals([input()], deps({
      'a long enough turn body that passes the informative gate': 0.1,
      'fix reflection': 0.12,
    }));
    expect(map.get('t1t_a')!.novelty).toBeCloseTo(0.9);
    expect(map.get('t1t_a')!.mismatch).toBe(0);
  });

  test('short turns with no anchors are not scored', async () => {
    const map = await computeTurnSignals([input({ text: '可以', cue: '', anchorCount: 0 })], deps({}));
    expect(map.size).toBe(0);
    expect(isInformativeTurn('可以', 0)).toBe(false);
  });

  test('superseded units are ignored', async () => {
    units.m1 = { ...units.m1, supersededBy: 'm2' };
    const map = await computeTurnSignals([input()], deps({ 'a long enough turn body that passes the informative gate': 0.99 }));
    expect(map.has('t1t_a')).toBe(false);
    units.m1 = { createdAt: '2026-01-01T00:00:00.000Z', type: 'semantic' };
  });

  test('memories created after the turn are ignored', async () => {
    units.m1 = { ...units.m1, createdAt: '2027-01-01T00:00:00.000Z' };
    const map = await computeTurnSignals([input()], deps({ 'a long enough turn body that passes the informative gate': 0.99 }));
    expect(map.has('t1t_a')).toBe(false);
    units.m1 = { createdAt: '2026-01-01T00:00:00.000Z', type: 'semantic' };
  });

  test('an empty memory pool yields no score, not novelty 1', async () => {
    const d = deps({});
    d.vectors.searchByCosine = () => [];
    const map = await computeTurnSignals([input()], d);
    expect(map.size).toBe(0);
  });

  test('legacy episodic units are ignored', async () => {
    units.m1 = { createdAt: '2026-01-01T00:00:00.000Z', type: 'episodic' };
    const map = await computeTurnSignals([input()], deps({ 'a long enough turn body that passes the informative gate': 0.99 }));
    expect(map.has('t1t_a')).toBe(false);
    units.m1 = { createdAt: '2026-01-01T00:00:00.000Z', type: 'semantic' };
  });

  test('embedder failure yields an empty map, not an exception', async () => {
    const d = deps({});
    d.embedder.embed = async () => { throw new Error('embed down'); };
    await expect(computeTurnSignals([input()], d)).resolves.toEqual(new Map());
  });

  test('scoring clamps to [0,1] and never returns negative mismatch', () => {
    expect(scoreTurnSignals(0.4, 0.2)!.mismatch).toBe(0);
    expect(scoreTurnSignals(1.2, 0.5)!.novelty).toBe(0);
    expect(scoreTurnSignals(-0.3, 0.2)!.novelty).toBe(1);
    expect(scoreTurnSignals(null, 0.5)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand --forceExit tests/unit/recall/t1-signals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `gateway/src/recall/t1-signals.ts`**

Rules:
- `isInformativeTurn(text, anchorCount)` → `text.trim().length >= 120 || anchorCount > 0`.
- `scoreTurnSignals(contentSim, cueSim)` → `null` when `contentSim == null`; `novelty = clamp01(1 − contentSim)`; `mismatch = cueSim == null ? 0 : clamp01(cueSim − contentSim)`.
- `computeTurnSignals`:
  1. keep inputs where `isInformativeTurn`;
  2. `embedder.embed(texts, 'document')` and `embedder.embed(cues, 'document')` — **same kind for both** so cue/content live in the memory vector space; batched (one call each);
  3. for each turn, take `searchByCosine(vector, 200)` and keep the first candidate whose `unitFor(id)` is defined, `!supersededBy`, `type !== 'episodic'`, `traceIds` does not include the turn's traceId, and `Date.parse(createdAt) <= lastTs * 1000` when both exist;
  4. if no candidate survives, skip the turn (no entry in the map);
  5. wrap steps 2–4 in `try/catch` and return `new Map()` on error.
- `cue === ''` → treat `cueSim` as `null` (mismatch 0), but still score novelty.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand --forceExit tests/unit/recall/t1-signals.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/t1-signals.ts gateway/tests/unit/recall/t1-signals.test.ts
git commit -m "feat(memory): score turn novelty and mismatch"
```

---

### Task 3: Wire signals into the turn pipeline

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts` (`TurnPipelineOptions` ~line 28; `runSession` feature loop ~lines 370–399)
- Modify: `gateway/src/kernel.ts` (turn pipeline construction ~line 3510)
- Modify: `gateway/src/config.ts` (type ~line 358, defaults ~line 731)
- Test: `gateway/tests/unit/recall/turn-pipeline-signals.test.ts`

**Interfaces:**
- Consumes: `computeTurnSignals`, `TurnSignalInput`, `TurnSignals` from Task 2; `T1TurnFeature` fields from Task 1.
- Produces: `TurnPipelineOptions.signalsFor?: (turns: TurnSignalInput[]) => Promise<Map<string, TurnSignals>>`; kernel wiring using `getEmbeddingRuntime()` + `harmonicIndex` entries; `config.recall.t1Signals: 'on' | 'off'` (default `'on'`), `config.recall.t1SignalThresholds: { highNovelty: number; highMismatch: number; redundant: number; dup: number }` (defaults `0.8 / 0.2 / 0.05 / 0.95`, provisional until the live dry-run).

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { TurnPipeline } from '../../../src/recall/turn-pipeline';
import type { TurnSignalInput } from '../../../src/recall/t1-signals';

describe('TurnPipeline signals wiring', () => {
  let dir: string;
  let db: GatewayDatabase;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-pipeline-signals-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  function seed() {
    const turn = db.beginTurn('s1');
    db.append({ session_id: 's1', turn_id: turn.turn_seq, trace_id: turn.trace_id, source: 'user_input', content: '修一下 reflection 的边界 recall', failure: 0 });
    db.append({ session_id: 's1', turn_id: turn.turn_seq, trace_id: turn.trace_id, source: 'tool_result', content: 'read reflection.ts', failure: 0 });
    return turn;
  }

  function pipeline(signalsFor: any) {
    return new TurnPipeline({
      t1db: db,
      index: { getIndex: () => ({ entries: [] }) } as any,
      workerFor: () => ({ prompt: async () => '[EXTRACTED: 0]' }) as any,
      staleMs: 60_000,
      signalsFor,
    });
  }

  test('writes computed signals onto the turn feature', async () => {
    const turn = seed();
    let seen: TurnSignalInput[] = [];
    await pipeline(async (turns: TurnSignalInput[]) => {
      seen = turns;
      return new Map([[turn.trace_id, { novelty: 0.7, mismatch: 0.2 }]]);
    }).runSession('s1');

    const feature = db.getTurnFeature(turn.trace_id)!;
    expect(feature.novelty).toBeCloseTo(0.7);
    expect(feature.mismatch).toBeCloseTo(0.2);
    expect(seen[0].traceId).toBe(turn.trace_id);
    expect(seen[0].text).toContain('reflection');
    expect(typeof seen[0].cue).toBe('string');
  });

  test('a failing scorer does not fail the run', async () => {
    const turn = seed();
    const result = await pipeline(async () => { throw new Error('scorer down'); }).runSession('s1');
    expect(result.archived).toBe(1);
    expect(result.failed).toBe(0);
    expect(db.getTurnFeature(turn.trace_id)!.novelty ?? null).toBeNull();
  });

  test('signals are on by default', () => {
    expect(config.recall.t1Signals).toBe('on');
  });
});
```

Add `import { config } from '../../../src/config';` to the test imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand --forceExit tests/unit/recall/turn-pipeline-signals.test.ts`
Expected: FAIL — `signalsFor` is not an option / signals never written.

- [ ] **Step 3: Implement**

`turn-pipeline.ts`:
- add `signalsFor?` to `TurnPipelineOptions` with the Task 2 types.
- inside the per-turn loop, collect `{ feature, traceId, text, cue, lastTs, anchorCount }` for turns that produced a feature (do not change the existing first `upsertTurnFeature`).
  - `text` = observations joined by `\n` (same string used for atom encoding);
  - `cue` = `[feature.intent, ...(feature.entities ?? []), feature.tool, feature.target].filter(Boolean).join(' ')`;
  - `lastTs` = `turn.last_ts`;
  - `anchorCount` = `feature.entities?.length ?? 0`.
- after the loop, if `signalsFor` exists and collected inputs exist: `try { const signals = await this.opts.signalsFor(inputs); for (const item of collected) { const s = signals.get(item.traceId); if (!s) continue; this.opts.t1db.upsertTurnFeature({ ...item.feature, novelty: s.novelty, mismatch: s.mismatch }); } } catch { /* fail-open */ }`.

`kernel.ts` (inside the `new TurnPipeline({...})`):
```ts
signalsFor: async (turns) => {
  if (config.recall.t1Signals === 'off') return new Map();
  const rt = getEmbeddingRuntime();
  if (!rt?.provider) return new Map();
  const entries = new Map(this.memoryService.harmonicIndex.getIndex().entries.map((e) => [e.id, e]));
  return computeTurnSignals(turns, {
    embedder: rt.provider,
    vectors: rt.vectors,
    unitFor: (id) => {
      const e = entries.get(id);
      if (!e) return undefined;
      return { createdAt: e.created_at, type: e.type, supersededBy: e.superseded_by, traceIds: (e as any).source_trace_ids };
    },
  });
},
```
Import `computeTurnSignals` in kernel; add `t1Signals: 'on' | 'off'` and
`t1SignalThresholds: { highNovelty: number; highMismatch: number; redundant: number; dup: number }`
to the `recall` type, defaulting to `'on'` and `{ highNovelty: 0.8, highMismatch: 0.2, redundant: 0.05, dup: 0.95 }`
in the defaults object.

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest --runInBand --forceExit tests/unit/recall/turn-pipeline-signals.test.ts tests/unit/recall/turn-pipeline-episodes.test.ts`
Expected: PASS; existing episode test still green.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/turn-pipeline.ts gateway/src/kernel.ts gateway/src/config.ts gateway/tests/unit/recall/turn-pipeline-signals.test.ts
git commit -m "feat(memory): wire turn signals into the pipeline"
```

---

### Task 4: Signal distribution stats

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts` (new `t1SignalStats()` next to `t1CodeStats` ~line 2482)
- Modify: `gateway/src/routes/memory.ts` (`t1` stats object ~line 187)
- Modify: `gateway/src/routes/schemas/memory.ts` if `t1` response is typed there
- Test: `gateway/tests/unit/routes/memory-wiring.test.ts`

**Interfaces:**
- Consumes: columns from Task 1; thresholds from `config.recall.t1SignalThresholds` (Task 3).
- Produces: `t1SignalStats(thresholds: { highNovelty: number; highMismatch: number; redundant: number }): { scored: number; unscored: number; novelty: Percentiles; mismatch: Percentiles; highNovelty: number; highMismatch: number; redundant: number }` where `Percentiles = { p50: number; p90: number; p99: number; max: number }`; response `t1.signals`.

- [ ] **Step 1: Write the failing test**

Extend both existing expect blocks in `memory-wiring.test.ts` with:
```ts
expect(body.t1.signals).toEqual({
  scored: 2,
  unscored: 1,
  novelty: { p50: 0.4, p90: 0.55, p99: 0.58, max: 0.6 },
  mismatch: { p50: 0.1, p90: 0.18, p99: 0.19, max: 0.2 },
  highNovelty: 0,
  highMismatch: 0,
  redundant: 0,
});
```
Add a second case where the fake db omits `t1SignalStats` and expect the zero shape:
```ts
expect(body.t1.signals).toEqual({
  scored: 0, unscored: 0,
  novelty: { p50: 0, p90: 0, p99: 0, max: 0 },
  mismatch: { p50: 0, p90: 0, p99: 0, max: 0 },
  highNovelty: 0, highMismatch: 0, redundant: 0,
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand --forceExit tests/unit/routes/memory-wiring.test.ts`
Expected: FAIL — `body.t1.signals` undefined.

- [ ] **Step 3: Implement**

`gateway-db.ts`:
- `t1SignalStats()`: count `scored` (`novelty IS NOT NULL`), `unscored` (`novelty IS NULL`), percentile helper:
  ```ts
  const pct = (col: 'novelty' | 'mismatch', p: number): number => {
    const n = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM t1_turn_features WHERE ${col} IS NOT NULL`).get() as any)?.n ?? 0);
    if (n === 0) return 0;
    const offset = Math.min(n - 1, Math.max(0, Math.floor((n - 1) * p)));
    const row = this.db.prepare(`SELECT ${col} AS v FROM t1_turn_features WHERE ${col} IS NOT NULL ORDER BY ${col} LIMIT 1 OFFSET ?`).get(offset) as any;
    return Number(row?.v ?? 0);
  };
  ```
  plus `max` via `SELECT MAX(col)`; `highNovelty` / `highMismatch` / `redundant` count rows above/below
  the thresholds passed in by the route (defaults `0.8 / 0.2 / 0.05` until the live dry-run re-tunes them).

`routes/memory.ts`:
- default `signals` zero object; merge `(deps.getGatewayDb() as any).t1SignalStats?.(config.recall.t1SignalThresholds)` in the existing try/catch style; include `signals` in the returned `t1` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand --forceExit tests/unit/routes/memory-wiring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/src/routes/memory.ts gateway/src/routes/schemas/memory.ts gateway/tests/unit/routes/memory-wiring.test.ts
git commit -m "feat(memory): report turn signal distribution"
```

---

### Task 5: Backfill script and live measurement

**Files:**
- Create: `gateway/scripts/backfill-t1-signals.ts`
- Modify: none (script-only)

**Interfaces:**
- Consumes: Task 1 columns, Task 2 `computeTurnSignals`, `config`, `GatewayDatabase`, `getEmbeddingRuntime`.
- Produces: `node --project tsconfig.json scripts/backfill-t1-signals.ts` (dry-run) and `--apply`.

- [ ] **Step 1: Write the script**

- Read all features: `SELECT f.*, t.last_ts FROM t1_turn_features f JOIN t1_turns t ON t.trace_id = f.trace_id`.
- Rebuild `text` from `readTurn(session_id, turn_seq)` observations joined by `\n`; skip empty.
- Build `cue` from `intent/entities/tool/target`; `anchorCount = entities.length`.
- Process in batches of 32 through `computeTurnSignals` with `rt.provider`, `rt.vectors`, and an index-entry map (same `unitFor` as kernel).
- Dry-run prints `{ dryRun, model, eligible, scored, novelty: {p50,p90,p99,max}, mismatch: {...} }`.
- `--apply` updates only rows with a computed score via `upsertTurnFeature({ ...existingFeature, novelty, mismatch })`, counts `applied`/`failed`, prints the same distribution.
- Any per-turn error increments `failed`; never aborts the whole run.

- [ ] **Step 2: Run dry-run**

Run: `cd gateway && npx ts-node --transpile-only --project tsconfig.json scripts/backfill-t1-signals.ts`
Expected: JSON with `scored > 0`; record the percentiles for the release note.

- [ ] **Step 3: Apply**

Run the same with `--apply`.
Expected: `applied === dry-run scored`, `failed: 0`.

- [ ] **Step 4: Verify live**

```bash
# restart via ~/.mafw/pending-restart.json, then:
curl -s http://127.0.0.1:3000/api/memory/stats | jq '.t1.signals'
```
Expected: `scored` matches the apply count; percentiles match the dry-run.

- [ ] **Step 5: Commit**

```bash
git add gateway/scripts/backfill-t1-signals.ts
git commit -m "feat(memory): backfill turn novelty and mismatch"
```

---

### Task 6: Audit, release note, full gate

**Files:**
- Create: `docs/releases/2026-11-18-t1-novelty-mismatch.md`
- Modify: `docs/superpowers/specs/2026-11-18-t1-novelty-mismatch-design.md` (status → delivered, final numbers)

- [ ] **Step 1: Audit 20 novelty + 20 mismatch samples**

Query the top and a random sample of scored turns; print `{ traceId, novelty, mismatch, intent, excerpt }`. Judge each against the original text: novelty = genuinely new topic; mismatch = familiar cue with different details. Record false-positive counts.

- [ ] **Step 2: Proxy validity**

Compute AUC for `novelty` against the label "a unit derived from this turn (`source_trace_ids` contains the trace) was retrieved at least once (`t1_retrieval_events`)". If `< 0.55`, record that Phase 2 is not justified.

- [ ] **Step 3: Full gate**

```bash
cd gateway && npx jest --runInBand --forceExit        # full suite
npx tsc --noEmit -p tsconfig.json
npm run build
npx jest --runInBand --forceExit tests/unit/api-contract.test.ts tests/unit/architecture/schema-coverage.test.ts
```
Expected: all green; record suites/tests/new-test counts.

- [ ] **Step 4: Write the release note**

Include: commits, formulas, storage, distribution percentiles, audit results, AUC, coverage, flags (all Phase 2/3 off), rollback, and the new/full test counts.

- [ ] **Step 5: Commit**

```bash
git add docs/releases/2026-11-18-t1-novelty-mismatch.md docs/superpowers/specs/2026-11-18-t1-novelty-mismatch-design.md
git commit -m "docs(release): T1 novelty and mismatch"
```
