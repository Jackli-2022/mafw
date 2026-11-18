/**
 * Boundary-recall expansion fan-out: only the live boundary call may skip
 * anchor-graph expansion on the secondary passes. The 4 secondary passes
 * (entity extraction + multi-hop decomposition) each run a full-corpus BM25
 * pass; when graph expansion also runs there, every pass pays the per-seed
 * anchor + coactivation SQL (up to 50 seeds × 2 synchronous queries), and a
 * 538-char query ran 5 passes ≈ 500 graph queries inside the 100ms boundary
 * budget.
 *
 * This is NOT a pure re-rank. Disabling graph expansion on a secondary pass
 * also removes the graph-only neighbours that pass would otherwise pull into
 * its candidate pool, and the in-group BM25/graph blend + maxNormalize then
 * produce different secondary scores. The candidate pool and the graph recall
 * of the *base* pass are unchanged; the secondary contributions are not
 * semantically identical to the previous behaviour. The frozen-40 replay's
 * 0 flips is an empirical result, not a proof of equivalence.
 *
 * Contract under test:
 *  - default options (snapshot builder / any legacy caller): every pass carries
 *    no `graphExpand` key, so the index default (config.search.graph.enabled)
 *    still applies to the secondary passes — identical to the pre-change code;
 *  - `secondaryGraphExpand: false` (live `routes/recall.ts` boundary call only):
 *    secondary passes carry `graphExpand: false`, the base pass still carries
 *    none;
 *  - `secondaryGraphExpand: true` is byte-identical to the default;
 *  - a caller-supplied `graphExpand` is still transported on the base pass;
 *  - expansion candidates still join with the existing relative weights.
 */
import * as fs from 'fs';
import * as path from 'path';

import { searchRecallMemories } from '../../../src/recall/recall-context';

type Scored = { entry: any; score: number };
type Call = { query: string; topK: number; options: any };

function entry(id: string, abstraction: string, over: any = {}) {
  return {
    id,
    primary_abstraction: abstraction,
    memory_value: abstraction,
    energy: 0.8,
    type: 'semantic',
    created_at: '2026-01-01',
    ...over,
  };
}

/**
 * "compare the auth token" hits both secondary strategies while staying inside
 * the 4-search expansion budget:
 *  - entities: auth, token (2 searches);
 *  - multi-hop: "compare" → 2 identical sub-queries "compare auth token".
 * Total: 1 base + 4 secondary = 5 recorded calls.
 */
const QUERY = 'compare the auth token';
const SUBQUERY = 'compare auth token';

function createRecordingIndex(
  calls: Call[],
  byQuery: Record<string, Scored[]>,
  entries: any[],
) {
  return {
    searchScored: (query: string, topK: number, options: any) => {
      calls.push({ query, topK, options });
      return byQuery[query] ?? [];
    },
    getIndex: () => ({ entries }),
  } as any;
}

function recordingFixture() {
  const calls: Call[] = [];
  const entries = [
    entry('base-hit', 'auth token base'),
    entry('entity-hit', 'auth entity'),
  ];
  const index = createRecordingIndex(
    calls,
    {
      [QUERY]: [{ entry: entries[0], score: 6 }],
      auth: [{ entry: entries[1], score: 3 }],
    },
    entries,
  );
  return { calls, index };
}

describe('boundary recall expansion graph fan-out', () => {
  test('default options keep every pass at the index default (legacy/snapshot behaviour)', async () => {
    const { calls, index } = recordingFixture();

    await searchRecallMemories(index, QUERY, new Set(), 5, {});

    expect(calls.length).toBe(5);
    const [base, ...secondary] = calls;

    // Base pass: no explicit flag — the caller's/index's default stands.
    expect(base.query).toBe(QUERY);
    expect(base.options && 'graphExpand' in base.options).toBe(false);

    // Secondary passes: legacy behaviour — no flag either, so the index default
    // (graph ON) still applies there. 92e9ea57c temporarily forced false on
    // every caller (including the snapshot builder); only the live boundary
    // route may opt out.
    expect(secondary).toHaveLength(4);
    for (const call of secondary) {
      expect(call.options && 'graphExpand' in call.options).toBe(false);
    }

    // Both secondary strategies actually ran (entity + multi-hop sub-query).
    const secondaryQueries = secondary.map(c => c.query);
    expect(secondaryQueries).toContain('auth');
    expect(secondaryQueries).toContain('token');
    expect(secondaryQueries.filter(q => q === SUBQUERY)).toHaveLength(2);
  });

  test('secondaryGraphExpand: true is identical to the default', async () => {
    const { calls, index } = recordingFixture();

    await searchRecallMemories(index, QUERY, new Set(), 5, { secondaryGraphExpand: true });

    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.options && 'graphExpand' in call.options).toBe(false);
    }
  });

  test('secondaryGraphExpand: false disables graph expansion on secondary passes only', async () => {
    const { calls, index } = recordingFixture();

    await searchRecallMemories(index, QUERY, new Set(), 5, { secondaryGraphExpand: false });

    expect(calls.length).toBe(5);
    const [base, ...secondary] = calls;

    // Base pass keeps the index default (base candidate pool + graph recall).
    expect(base.options && 'graphExpand' in base.options).toBe(false);

    // Every secondary pass: graph expansion explicitly disabled.
    expect(secondary).toHaveLength(4);
    for (const call of secondary) {
      expect(call.options?.graphExpand).toBe(false);
    }
  });

  test('caller-supplied graphExpand is transported on the base pass', async () => {
    const entries = [entry('base-hit', 'auth token base')];

    const offCalls: Call[] = [];
    await searchRecallMemories(
      createRecordingIndex(offCalls, { [QUERY]: [{ entry: entries[0], score: 6 }] }, entries),
      QUERY,
      new Set(),
      5,
      { graphExpand: false } as any,
    );
    expect(offCalls[0].options.graphExpand).toBe(false);
    // The caller's base flag never leaks into the secondary passes.
    expect(offCalls.slice(1).every(c => !('graphExpand' in (c.options || {})))).toBe(true);

    const onCalls: Call[] = [];
    await searchRecallMemories(
      createRecordingIndex(onCalls, { [QUERY]: [{ entry: entries[0], score: 6 }] }, entries),
      QUERY,
      new Set(),
      5,
      { graphExpand: true } as any,
    );
    expect(onCalls[0].options.graphExpand).toBe(true);
  });

  test('expansion candidates still join with the existing relative weights', async () => {
    const calls: Call[] = [];
    const entries = [
      entry('base-strong', 'base strong'),
      entry('sub-hit', 'multi hop hit'),
      entry('entity-hit', 'entity hit'),
    ];
    const index = createRecordingIndex(
      calls,
      {
        [QUERY]: [{ entry: entries[0], score: 10 }],
        auth: [{ entry: entries[2], score: 1 }],
        token: [],
        [SUBQUERY]: [{ entry: entries[1], score: 1 }],
      },
      entries,
    );

    const res = await searchRecallMemories(index, QUERY, new Set(), 5);

    // Base BM25 norm 1.0 > sub-query 2 × 0.35 = 0.7 > entity 0.4.
    expect(res.map(r => r.id)).toEqual(['base-strong', 'sub-hit', 'entity-hit']);
    expect(res[0].score).toBeCloseTo(1, 6);
    expect(res[1].score).toBeCloseTo(0.7, 6);
    expect(res[2].score).toBeCloseTo(0.4, 6);
    expect(res[0].source).toBe('bm25');
    expect(res[1].source).toBe('expansion');
    expect(res[2].source).toBe('expansion');
  });
});

describe('secondary-graph opt-out wiring', () => {
  const src = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../src', rel), 'utf8');

  test('the live boundary call opts out, the snapshot builder stays on the default', () => {
    const routeSrc = src('routes/recall.ts');
    const callStart = routeSrc.indexOf('memories = await searchRecallMemories(');
    expect(callStart).toBeGreaterThan(-1);
    const callBlock = routeSrc.slice(callStart, routeSrc.indexOf(');', callStart));
    expect(callBlock).toContain('secondaryGraphExpand: false');
    // The base pass must keep the index default on this path.
    expect(callBlock).not.toContain('graphExpand: false');

    // Snapshot builder (kernel) is the legacy path: no opt-out, no base flag —
    // it must keep the pre-92e9ea57c behaviour.
    const kernelSrc = src('kernel.ts');
    const snapStart = kernelSrc.indexOf('searchRecallMemories(this.memoryService!.harmonicIndex, q,');
    expect(snapStart).toBeGreaterThan(-1);
    const snapBlock = kernelSrc.slice(snapStart, kernelSrc.indexOf('} as any);', snapStart));
    expect(snapBlock).not.toContain('secondaryGraphExpand');
    expect(snapBlock).not.toContain('graphExpand');
  });
});
