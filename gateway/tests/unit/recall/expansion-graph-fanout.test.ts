/**
 * Boundary-recall expansion fan-out: only the base pass may run anchor-graph
 * expansion. The 4 secondary passes (entity extraction + multi-hop
 * decomposition) re-rank candidates that the base pass already graph-expanded,
 * so repeating the per-seed graph SQL per pass is pure cost: a 538-char query
 * ran 5 passes × up to 50 seeds × 2 graph queries ≈ 500 synchronous SQLite
 * calls and blew the 100ms boundary budget.
 *
 * Contract under test:
 *  - the first (base) `searchScored` call carries no `graphExpand` key, so the
 *    index default (config.search.graph.enabled) still applies;
 *  - every secondary expansion call carries `graphExpand: false`;
 *  - a caller-supplied `graphExpand` is transported on the base pass;
 *  - expansion candidates still join with the existing relative weights, so
 *    the ranking rules are unchanged.
 */
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

describe('boundary recall expansion graph fan-out', () => {
  test('only the base pass leaves graph expansion at the index default', async () => {
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

    await searchRecallMemories(index, QUERY, new Set(), 5, {});

    expect(calls.length).toBe(5);
    const [base, ...secondary] = calls;

    // Base pass: no explicit flag — the caller's/index's default stands.
    expect(base.query).toBe(QUERY);
    expect(base.options && 'graphExpand' in base.options).toBe(false);

    // Every secondary pass: graph expansion explicitly disabled.
    expect(secondary).toHaveLength(4);
    for (const call of secondary) {
      expect(call.options?.graphExpand).toBe(false);
    }

    // Both secondary strategies actually ran (entity + multi-hop sub-query).
    const secondaryQueries = secondary.map(c => c.query);
    expect(secondaryQueries).toContain('auth');
    expect(secondaryQueries).toContain('token');
    expect(secondaryQueries.filter(q => q === SUBQUERY)).toHaveLength(2);
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
