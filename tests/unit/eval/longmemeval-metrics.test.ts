import { recallAtK, ndcgAtK, aggregateMetrics, aggregateByType } from '../../../evaluation/longmemeval/src/metrics';

describe('longmemeval metrics', () => {
  describe('recallAtK', () => {
    it('returns 1 when all relevant retrieved within k', () => {
      expect(recallAtK(['a', 'b', 'c'], ['a', 'b'], 3)).toBe(1);
    });
    it('counts only hits within k', () => {
      // relevant b at rank 4, outside k=3
      expect(recallAtK(['x', 'y', 'z', 'b'], ['a', 'b'], 3)).toBe(0);
      expect(recallAtK(['x', 'y', 'z', 'b'], ['a', 'b'], 4)).toBe(0.5);
    });
    it('deduplicates retrieved ids', () => {
      expect(recallAtK(['a', 'a', 'a'], ['a', 'b'], 3)).toBe(0.5);
    });
    it('returns 0 for empty relevant', () => {
      expect(recallAtK(['a'], [], 5)).toBe(0);
    });
  });

  describe('ndcgAtK', () => {
    it('is 1 for a perfect ranking', () => {
      // 2 relevant, both at top: DCG = 1/log2(2) + 1/log2(3) = IDCG
      expect(ndcgAtK(['a', 'b', 'c'], ['a', 'b'], 3)).toBeCloseTo(1, 10);
    });
    it('penalizes lower-ranked hits (hand-computed)', () => {
      // relevant = {a}, retrieved = [x, a] @k=2
      // DCG = 1/log2(3) ≈ 0.6309; IDCG = 1/log2(2) = 1
      expect(ndcgAtK(['x', 'a'], ['a'], 2)).toBeCloseTo(1 / Math.log2(3), 10);
    });
    it('penalizes missing hits', () => {
      // relevant = {a, b}, retrieved = [a, x, y] @k=3
      // DCG = 1; IDCG = 1 + 1/log2(3) ≈ 1.6309
      expect(ndcgAtK(['a', 'x', 'y'], ['a', 'b'], 3)).toBeCloseTo(1 / (1 + 1 / Math.log2(3)), 10);
    });
    it('ignores duplicate relevant hits after the first', () => {
      // relevant = {a, b}, retrieved = [a, a, b] @k=3
      // DCG = 1 + 1/log2(4) = 1.5; IDCG = 1 + 1/log2(3) ≈ 1.6309
      expect(ndcgAtK(['a', 'a', 'b'], ['a', 'b'], 3)).toBeCloseTo(1.5 / (1 + 1 / Math.log2(3)), 10);
    });
    it('is 0 when nothing relevant retrieved', () => {
      expect(ndcgAtK(['x', 'y'], ['a'], 2)).toBe(0);
    });
  });

  describe('aggregateMetrics', () => {
    it('means per-k metrics and qa accuracy over judged subset', () => {
      const agg = aggregateMetrics([
        { recall: { 1: 1, 5: 1 }, ndcg: { 1: 1, 5: 1 }, qaCorrect: true },
        { recall: { 1: 0, 5: 1 }, ndcg: { 1: 0, 5: 0.5 }, qaCorrect: false },
        { recall: { 1: 0, 5: 0 }, ndcg: { 1: 0, 5: 0 } }, // unjudged
      ], [1, 5]);
      expect(agg.count).toBe(3);
      expect(agg.recall[1]).toBeCloseTo(1 / 3, 10);
      expect(agg.recall[5]).toBeCloseTo(2 / 3, 10);
      expect(agg.ndcg[5]).toBeCloseTo(0.5, 10);
      expect(agg.qaAccuracy).toBeCloseTo(0.5, 10); // only 2 judged
    });
  });

  describe('aggregateByType', () => {
    it('groups by questionType', () => {
      const byType = aggregateByType([
        { questionType: 'a', recall: { 1: 1 }, ndcg: { 1: 1 } },
        { questionType: 'a', recall: { 1: 0 }, ndcg: { 1: 0 } },
        { questionType: 'b', recall: { 1: 1 }, ndcg: { 1: 1 } },
      ], [1]);
      expect(byType.a.count).toBe(2);
      expect(byType.a.recall[1]).toBeCloseTo(0.5, 10);
      expect(byType.b.recall[1]).toBe(1);
    });
  });
});
