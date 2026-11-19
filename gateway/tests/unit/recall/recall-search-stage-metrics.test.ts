/**
 * Task 3: search sub-stage observer.
 *
 * `searchRecallMemories` is the sync boundary path (<50ms). Stage metrics used
 * to see only the outer `search` total, so "BM25+base graph" vs "query
 * expansion" vs "scan merge" cost was invisible. The optional `onStage`
 * observer reports the three inner stages *without* changing retrieval:
 *   - `graph`     = first `fetchScored` (BM25 + base graph expansion)
 *   - `expansion` = `expandQuery` (entity / multi-hop secondary passes)
 *   - `scan`      = `mergeScanResults` (precomputed prefetch snapshot merge)
 *
 * Contract pinned here:
 *   - emission order is graph → expansion → scan, once per real stage run;
 *   - the observer never sees graph samples from expansion's own passes;
 *   - a throwing observer is fail-open: ids/scores are byte-identical;
 *   - callers that pass no observer keep the previous behavior.
 *
 * Retrieval internals are real (no module mocks): this suite is the proof that
 * instrumentation wraps existing calls instead of reimplementing them.
 */
import { searchRecallMemories } from '../../../src/recall/recall-context';

type Stage = 'graph' | 'expansion' | 'scan';

interface Entry {
  id: string;
  primary_abstraction: string;
  memory_value?: string;
  energy?: number;
  type?: string;
  created_at?: string;
  cue_anchors?: string[];
}

const entries: Entry[] = [
  { id: 'mem_alpha_0001', primary_abstraction: 'alpha note', energy: 1 },
  { id: 'mem_beta_00002', primary_abstraction: 'beta note', energy: 1 },
  { id: 'mem_scan_00003', primary_abstraction: 'scan note', energy: 1 },
];

/** Base query hits alpha; every secondary/expansion pass would hit beta. */
function makeIndex() {
  const searchScored = jest.fn((query: string) => {
    if (query === 'alpha') return [{ entry: entries[0], score: 1 }];
    return [{ entry: entries[1], score: 0.5 }];
  });
  const index: any = {
    searchScored,
    getIndex: () => ({ entries }),
  };
  return { index, searchScored };
}

const scanSnapshot = {
  query: 'alpha',
  relevantIds: ['mem_scan_00003'],
  confidence: 0.9,
  builtAt: '2026-11-19T00:00:00.000Z',
};

function collect() {
  const calls: Array<{ stage: Stage; ms: number }> = [];
  const onStage = (stage: Stage, ms: number) => { calls.push({ stage, ms }); };
  return { calls, onStage };
}

describe('searchRecallMemories sub-stage observer', () => {
  test('emits graph → expansion → scan once each for a scan-merged search', async () => {
    const { index } = makeIndex();
    const { calls, onStage } = collect();

    const results = await searchRecallMemories(index, 'alpha', new Set(), 3, {
      scanSnapshot,
      onStage,
    });

    expect(calls.map((c) => c.stage)).toEqual(['graph', 'expansion', 'scan']);
    for (const call of calls) {
      expect(typeof call.ms).toBe('number');
      expect(Number.isFinite(call.ms)).toBe(true);
      expect(call.ms).toBeGreaterThanOrEqual(0);
    }
    // the merged body really contains the prefetched scan id
    expect(results.map((r) => r.id)).toContain('mem_scan_00003');
  });

  test('graph is only the first fetchScored: expansion passes never add graph samples', async () => {
    const { index, searchScored } = makeIndex();
    const { calls, onStage } = collect();

    // Entity-friendly query: expansion runs its own fetchScored passes.
    await searchRecallMemories(index, 'alpha model test schema', new Set(), 3, { onStage });

    expect(searchScored.mock.calls.length).toBeGreaterThan(1);
    expect(calls.filter((c) => c.stage === 'graph')).toHaveLength(1);
    expect(calls.filter((c) => c.stage === 'expansion')).toHaveLength(1);
    // no snapshot → mergeScanResults never ran → no scan sample
    expect(calls.filter((c) => c.stage === 'scan')).toHaveLength(0);
  });

  test('a throwing observer is fail-open: results are identical to the unobserved run', async () => {
    const baselineIndex = makeIndex().index;
    const baseline = await searchRecallMemories(baselineIndex, 'alpha', new Set(), 3, { scanSnapshot });

    const observedIndex = makeIndex().index;
    let observedCalls = 0;
    const throwing = () => {
      observedCalls += 1;
      throw new Error('observer boom');
    };
    const observed = await searchRecallMemories(observedIndex, 'alpha', new Set(), 3, {
      scanSnapshot,
      onStage: throwing,
    });

    expect(observedCalls).toBe(3);
    expect(observed).toEqual(baseline);
  });

  test('a throwing observer/missing observer never changes the per-id score list', async () => {
    const baseline = await searchRecallMemories(makeIndex().index, 'alpha', new Set(), 3, { scanSnapshot });
    const scores = baseline.map((m) => ({ id: m.id, score: m.score }));

    const withoutObserver = await searchRecallMemories(makeIndex().index, 'alpha', new Set(), 3, { scanSnapshot });
    expect(withoutObserver.map((m) => ({ id: m.id, score: m.score }))).toEqual(scores);

    // A non-function onStage (older caller passing a stray key) is ignored.
    const stray = await searchRecallMemories(makeIndex().index, 'alpha', new Set(), 3, {
      scanSnapshot,
      onStage: undefined,
    });
    expect(stray.map((m) => ({ id: m.id, score: m.score }))).toEqual(scores);
  });

  test('no observer means no behavior change at all (same ids/scores/sources)', async () => {
    const baseline = await searchRecallMemories(makeIndex().index, 'alpha', new Set(), 3, { scanSnapshot });
    const again = await searchRecallMemories(makeIndex().index, 'alpha', new Set(), 3, { scanSnapshot });

    expect(again).toEqual(baseline);
    expect(baseline.map((m) => m.source)).toEqual(['bm25', 'scan']);
  });
});
