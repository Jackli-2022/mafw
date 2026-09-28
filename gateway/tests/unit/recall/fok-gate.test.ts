/**
 * R5 FOK gate (PFC meta-memory monitor): decide whether retrieved candidates
 * are trustworthy enough to inject, or whether the system should say
 * "no reliable memory" instead of staying silent (silence invites confabulation).
 *
 * Feature choice is measurement-driven (LongMemEval AUROC pre-check):
 * scale-free top1/mean dominates; gap/ratio features are weak; the signal must
 * come from the *raw* relevance scores (never energy×salience-weighted).
 */
import { computeFokFeatures, classifyFok, fitFokThresholds, zoneFromProbability, fokSummaryFor } from '../../../src/recall/fok-gate';

describe('computeFokFeatures', () => {
  test('empty candidate set → zeroed features, count 0', () => {
    const f = computeFokFeatures([]);
    expect(f).toEqual({ top1: 0, mean: 0, top1OverMean: 0, count: 0 });
  });

  test('top1 is the best score; ratio is top1/mean', () => {
    const f = computeFokFeatures([10, 5, 5]);
    expect(f.count).toBe(3);
    expect(f.top1).toBe(10);
    expect(f.mean).toBeCloseTo(20 / 3, 6);
    expect(f.top1OverMean).toBeCloseTo(10 / (20 / 3), 6);
  });

  test('non-positive mean → ratio 0 (no divide by zero)', () => {
    const f = computeFokFeatures([0, 0]);
    expect(f.top1OverMean).toBe(0);
  });

  test('unsorted input still reports the max as top1', () => {
    expect(computeFokFeatures([2, 9, 4]).top1).toBe(9);
  });
});

describe('classifyFok three zones', () => {
  const th = { low: 1.2, high: 1.35 };

  test('no candidates → no-memory', () => {
    expect(classifyFok(computeFokFeatures([]), th)).toBe('no-memory');
  });

  test('strong top1 dominance → inject', () => {
    // [30,10,10]: mean 16.67, ratio 1.8 ≥ high
    expect(classifyFok(computeFokFeatures([30, 10, 10]), th)).toBe('inject');
  });

  test('middling dominance → low-confidence', () => {
    // [14,10,10]: mean 11.33, ratio 1.235 sits between low(1.2) and high(1.35)
    expect(classifyFok(computeFokFeatures([14, 10, 10]), th)).toBe('low-confidence');
  });

  test('flat distribution (weak evidence) → no-memory', () => {
    expect(classifyFok(computeFokFeatures([10, 10, 9]), th)).toBe('no-memory');
  });

  test('high threshold is inclusive', () => {
    const f = { top1: 1.35, mean: 1, top1OverMean: 1.35, count: 3 };
    expect(classifyFok(f, th)).toBe('inject');
  });
});

describe('zoneFromProbability (reranker top-1 probability)', () => {
  const th = { low: 0.2, high: 0.5 };

  test('missing / NaN probability → inject (fail-open)', () => {
    expect(zoneFromProbability(undefined, th.low, th.high)).toBe('inject');
    expect(zoneFromProbability(null, th.low, th.high)).toBe('inject');
    expect(zoneFromProbability(NaN, th.low, th.high)).toBe('inject');
  });

  test('confident relevance → inject; middling → low-confidence; near-zero → no-memory', () => {
    expect(zoneFromProbability(0.84, th.low, th.high)).toBe('inject');
    expect(zoneFromProbability(0.3, th.low, th.high)).toBe('low-confidence');
    expect(zoneFromProbability(0.05, th.low, th.high)).toBe('no-memory');
  });

  test('boundaries are inclusive', () => {
    expect(zoneFromProbability(0.5, th.low, th.high)).toBe('inject');
    expect(zoneFromProbability(0.2, th.low, th.high)).toBe('low-confidence');
  });

  test('non-finite thresholds → inject (fail-open, never blanket no-memory)', () => {
    expect(zoneFromProbability(0.95, undefined as any, undefined as any)).toBe('inject');
    expect(zoneFromProbability(0.95, NaN, NaN)).toBe('inject');
  });
});

describe('fokSummaryFor (explicit search path)', () => {
  const th = { low: 0.2, high: 0.5 };
  const candidates = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  test('looks the probability up by id (probs follow INPUT order)', () => {
    // reranked order is c,a,b but probs stay aligned to the input candidates
    const s = fokSummaryFor([0.1, 0.9, 0.05], candidates, 'c', th);
    expect(s).toEqual({ zone: 'no-memory', top1prob: 0.05 });
  });

  test('confident top-1 → inject', () => {
    expect(fokSummaryFor([0.1, 0.9, 0.05], candidates, 'b', th)?.zone).toBe('inject');
  });

  test('missing inputs → undefined (field omitted, no false signal)', () => {
    expect(fokSummaryFor(undefined, candidates, 'a', th)).toBeUndefined();
    expect(fokSummaryFor([0.1], candidates, undefined, th)).toBeUndefined();
    expect(fokSummaryFor([0.1], candidates, 'zzz', th)).toBeUndefined();
  });
});

describe('fitFokThresholds', () => {
  function samples(hits: number[], misses: number[]) {
    return [
      ...hits.map(feature => ({ feature, hit: true })),
      ...misses.map(feature => ({ feature, hit: false })),
    ];
  }

  test('separates a cleanly separable set; high >= low', () => {
    const th = fitFokThresholds(samples([2.0, 1.8, 1.7, 1.6], [1.1, 1.05, 1.0]));
    expect(th).not.toBeNull();
    expect(th!.low).toBeGreaterThan(1.1);
    expect(th!.low).toBeLessThanOrEqual(1.6);
    expect(th!.high).toBeGreaterThanOrEqual(th!.low);
    // the fitted low must send a clear hit to inject and a clear miss to no-memory
    expect(classifyFok(computeFokFeatures([30, 10, 10]), { low: th!.low, high: 1.65 })).toBe('inject');
    expect(classifyFok(computeFokFeatures([10, 10, 9]), { low: th!.low, high: 1.65 })).toBe('no-memory');
  });

  test('unfittable sets (empty / no positives / no negatives) → null', () => {
    expect(fitFokThresholds([])).toBeNull();
    expect(fitFokThresholds(samples([], [1, 2]))).toBeNull();
    expect(fitFokThresholds(samples([1, 2], []))).toBeNull();
  });

  test('respects the precision target for the inject zone', () => {
    // one miss at a high feature value drags precision down; high must clear it
    const th = fitFokThresholds(samples([2.0, 1.9, 1.8, 1.7, 1.6], [1.65]), { highPrecision: 0.95 });
    expect(th).not.toBeNull();
    expect(th!.high).toBeGreaterThan(1.65);
  });
});
