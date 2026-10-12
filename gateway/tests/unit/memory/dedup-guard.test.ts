import { exactHashOf, seenExactHash, getDedupStats, resetDedupStatsForTest, collapseNearDuplicates } from '../../../src/memory/dedup-guard';
import { ScoredEntry } from '../../../src/core/memory/harmonic-index';

function mkEntry(id: string, abs: string, energy = 0.8, cues: string[] = []): ScoredEntry['entry'] {
  return { id, type: 'semantic', primary_abstraction: abs, cue_anchors: cues, tier: 'semantic', energy } as any;
}

describe('L2 read-time near-duplicate collapse', () => {
  beforeEach(() => resetDedupStatsForTest());

  it('collapses high token-Jaccard pairs, keeping the highest-scored first (resolveSupersededHeads semantics)', () => {
    const scored: ScoredEntry[] = [
      { entry: mkEntry('a', 'BM25 token cache memoize harmonic index for speed', 0.6, ['bm25', 'cache']), score: 1 },
      { entry: mkEntry('b', 'BM25 token cache memoize harmonic index speed', 0.9, ['bm25', 'cache']), score: 0.95 },
      { entry: mkEntry('c', 'Completely different topic about desktop UI', 0.8, ['desktop']), score: 0.9 },
    ];
    const out = collapseNearDuplicates(scored, { vectorFor: () => null });
    expect(out.map(s => s.entry.id)).toEqual(['a', 'c']); // 'b' folds into 'a' (first kept)
  });

  it('collapses by vector cosine when available (abstractions differ lexically)', () => {
    const scored: ScoredEntry[] = [
      { entry: mkEntry('x', 'totally different words alpha', 0.5), score: 1 },
      { entry: mkEntry('y', 'other words beta', 0.9), score: 0.9 },
    ];
    const vecs: Record<string, number[]> = { x: [1, 0], y: [1, 0.01] }; // cos ≈ 0.99995
    const out = collapseNearDuplicates(scored, { vectorFor: (id) => vecs[id] ?? null });
    expect(out.map(s => s.entry.id)).toEqual(['x']); // 'y' folds into 'x' (first kept)
  });

  it('keeps lexically-shallow pairs that share only one anchor word', () => {
    const scored: ScoredEntry[] = [
      { entry: mkEntry('p', 'deploy gateway with docker compose stack', 0.8, ['deploy']), score: 1 },
      { entry: mkEntry('q', 'deploy failed because of port conflict windows', 0.8, ['deploy']), score: 0.9 },
    ];
    const out = collapseNearDuplicates(scored, { vectorFor: () => null });
    expect(out.map(s => s.entry.id)).toEqual(['p', 'q']); // below threshold → both kept
  });

  it('counts collapsed and only folds within the candidate window', () => {
    const many: ScoredEntry[] = [];
    for (let i = 0; i < 40; i++) {
      many.push({ entry: mkEntry(`e${i}`, `unique topic batch${i} about thing${i}`, 0.8), score: 1 - i * 0.01 });
    }
    const out = collapseNearDuplicates(many, { vectorFor: () => null, maxCandidates: 30 });
    expect(out.length).toBe(40); // all unique → nothing folded, nothing lost
    expect(getDedupStats().collapsed).toBe(0);
    // duplicates folded:
    resetDedupStatsForTest();
    const dupPair: ScoredEntry[] = [
      { entry: mkEntry('m', 'same same words here', 0.5), score: 1 },
      { entry: mkEntry('n', 'same same words here', 0.9), score: 0.9 },
    ];
    collapseNearDuplicates(dupPair, { vectorFor: () => null });
    expect(getDedupStats().collapsed).toBe(1);
  });
});

describe('L1 exact-hash guard', () => {
  beforeEach(() => resetDedupStatsForTest());

  it('same content → same hash, different content → different hash', () => {
    expect(exactHashOf('用户偏好 TDD')).toBe(exactHashOf('用户偏好 TDD'));
    expect(exactHashOf('用户偏好 TDD')).not.toBe(exactHashOf('用户偏好 lint'));
  });

  it('first sight returns false, second sight returns true', () => {
    const h = exactHashOf('记忆内容 A');
    expect(seenExactHash(h)).toBe(false);
    expect(seenExactHash(h)).toBe(true);
  });

  it('LRU bounded: evicting old hashes makes them unseen again', () => {
    const first = exactHashOf('old');
    for (let i = 0; i < 10_100; i++) seenExactHash(exactHashOf(`bulk-${i}`));
    expect(seenExactHash(first)).toBe(false); // evicted
  });

  it('counts exactHashSkips', () => {
    const h = exactHashOf('x');
    seenExactHash(h); seenExactHash(h);
    expect(getDedupStats().exactHashSkips).toBe(1);
  });
});
