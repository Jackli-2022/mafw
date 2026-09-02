/**
 * Boundary-recall scoring fix (P0):
 *  - BM25 raw scores (normalized within the candidate set) drive the ranking,
 *    NOT flat `energy` — strong hits must outrank weak ones deterministically.
 *  - Expansion hits carry a relative weight (norm × 0.4), not energy×0.5, and
 *    can enter topK when BM25 is thin.
 *  - Scan direct-hit boost is a fixed 0.35 — no longer unconditionally above
 *    every BM25 hit.
 *  - Multi-topic blob abstractions (≥4 " | " segments) are penalized ×0.5.
 *  - Pointer ids show the LAST 6 chars (ids are mem_<timestamp>_<rand> — the
 *    first 6 chars are constant and useless for verification).
 */
import { searchRecallMemories, searchRecallMemoriesSync } from '../../src/recall/recall-context';
import { formatRecallContext } from '../../src/recall/inject-format';

function entry(id: string, abstraction: string, over: any = {}) {
  return { id, primary_abstraction: abstraction, energy: 0.8, type: 'semantic', created_at: '2026-01-01', ...over };
}

describe('boundary recall scoring', () => {
  test('strong BM25 hit ranks above weak hit (no more random tie on flat energy)', async () => {
    const index: any = {
      searchScored: (_q: string, _k: number) => [
        { entry: entry('weak', 'weakly related note'), score: 0.4 },
        { entry: entry('strong', 'strongly related note'), score: 9.9 },
      ],
    };
    const res = await searchRecallMemories(index, 'q', new Set(), 3);
    expect(res.map(r => r.id)).toEqual(['strong', 'weak']);
    expect(res[0].score).toBeGreaterThan(res[1].score);
  });

  test('scan direct hit (0.35) beats a weak BM25 hit but loses to a strong one', async () => {
    const index: any = {
      searchScored: (_q: string, _k: number) => [
        { entry: entry('weak-bm25', 'weak bm25'), score: 0.2 },
        { entry: entry('strong-bm25', 'strong bm25'), score: 9.9 },
      ],
      getIndex: () => ({
        entries: [entry('scan-hit', 'scan picked this'), entry('weak-bm25', 'weak bm25'), entry('strong-bm25', 'strong bm25')],
      }),
    };
    const snapshot: any = { relevantIds: ['scan-hit'], confidence: 0.9 };
    const res = await searchRecallMemories(index, 'q', new Set(), 3, { scanSnapshot: snapshot });
    expect(res.map(r => r.id)).toEqual(['strong-bm25', 'scan-hit', 'weak-bm25']);
  });

  test('multi-topic blob abstraction is penalized even at near-equal BM25 score', async () => {
    const blob = 'A | B | C | D | E';
    const index: any = {
      searchScored: () => [
        { entry: entry('blob', blob), score: 9.9 },
        { entry: entry('single', 'single topic note'), score: 9.5 },
      ],
    };
    const res = await searchRecallMemories(index, 'q', new Set(), 2);
    expect(res[0].id).toBe('single'); // 0.5 penalty flips the near-tie
  });

  test('sync variant shares the same scoring', () => {
    const index: any = {
      searchScored: () => [
        { entry: entry('weak', 'weak'), score: 0.4 },
        { entry: entry('strong', 'strong'), score: 9.9 },
      ],
    };
    const res = searchRecallMemoriesSync(index, 'q', new Set(), 3);
    expect(res.map(r => r.id)).toEqual(['strong', 'weak']);
  });

  test('fallback: index without searchScored still works (flat score)', async () => {
    const index: any = {
      search: () => [entry('aaaaaaaaaaaa', 'x')],
    };
    const res = await searchRecallMemories(index, 'q', new Set(), 3, {} as any);
    expect(res).toHaveLength(1);
    expect(res[0].source).toBe('bm25');
  });
});

describe('pointer id readability', () => {
  test('pointer uses last 6 chars of the id (mem_<ts>_<rand> format)', () => {
    const res = formatRecallContext([
      { id: 'mem_1788244327931_hfe8a9', primary_abstraction: 'alpha memory', energy: 0.8, type: 'semantic' },
      { id: 'mem_1788244327932_9b2c1d', primary_abstraction: 'beta memory', energy: 0.8, type: 'semantic' },
    ]);
    expect(res.pointers).toContain('#mem-hfe8a9');
    expect(res.pointers).toContain('#mem-9b2c1d');
    expect(res.pointers).not.toContain('#mem-mem_1');
  });
});
