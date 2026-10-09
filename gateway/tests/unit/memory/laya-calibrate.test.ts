import { proposeTauLow, bucketDistribution, LayaPairRecord } from '../../../src/memory/laya-calibrate';

const rec = (p: number, verdict: 'create' | 'update'): LayaPairRecord => ({
  layaScores: [{ id: 'x', p }], verdict, decidedBy: 'llm', ts: 0,
});

describe('bucketDistribution', () => {
  test('buckets scores by verdict', () => {
    const recs = [rec(0.05, 'create'), rec(0.92, 'update'), rec(0.07, 'create')];
    const d = bucketDistribution(recs);
    expect(d.byVerdict.create['0.0-0.1']).toBe(2);
    expect(d.byVerdict.update['0.9-1.0']).toBe(1);
    expect(d.total).toBe(3);
  });

  test('records without layaScores are counted separately', () => {
    const d = bucketDistribution([{ verdict: 'create', ts: 0 }]);
    expect(d.noScores).toBe(1);
    expect(d.total).toBe(0);
  });
});

describe('proposeTauLow', () => {
  test('null when fewer than 50 scored pairs', () => {
    const recs = Array.from({ length: 49 }, () => rec(0.05, 'create'));
    expect(proposeTauLow(recs).proposal).toBeNull();
    expect(proposeTauLow(recs).reason).toContain('50');
  });

  test('null when fewer than 5 update pairs (no evidence for the boundary)', () => {
    const recs = [...Array.from({ length: 50 }, () => rec(0.05, 'create')), rec(0.9, 'update')];
    expect(proposeTauLow(recs).proposal).toBeNull();
  });

  test('proposes tauLow at the sanity ceiling when update band is high', () => {
    const creates = Array.from({ length: 50 }, () => rec(0.05 + Math.random() * 0.05, 'create'));
    const updates = [rec(0.42, 'update'), rec(0.9, 'update'), rec(0.35, 'update'), rec(0.5, 'update'), rec(0.6, 'update')];
    const r = proposeTauLow([...creates, ...updates]);
    expect(r.proposal).not.toBeNull();
    expect(r.proposal!.tauLow).toBeCloseTo(0.3, 5); // min(update 0.35, ceiling 0.3)
    expect(r.proposal!.minUpdateP).toBeCloseTo(0.35, 5);
    expect(r.proposal!.maxCreateBelow).toBeGreaterThan(0);
  });

  test('caps proposal at 0.3 sanity ceiling', () => {
    const creates = Array.from({ length: 50 }, () => rec(0.05, 'create'));
    const updates = [0.8, 0.85, 0.9, 0.88, 0.95].map((p) => rec(p, 'update'));
    const r = proposeTauLow([...creates, ...updates]);
    expect(r.proposal!.tauLow).toBe(0.3);
  });

  test('null when create scores overlap the update band (no safe line)', () => {
    const creates = Array.from({ length: 50 }, () => rec(0.5, 'create'));
    const updates = [0.42, 0.9, 0.35, 0.5, 0.6].map((p) => rec(p, 'update'));
    expect(proposeTauLow([...creates, ...updates]).proposal).toBeNull();
  });
});
