import { proposeTauLow, bucketDistribution, proposeTauRedundantHigh, LayaPairRecord } from '../../../src/memory/laya-calibrate';

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

describe('proposeTauRedundantHigh', () => {
  const rec = (p: number | null, verdict: string) => ({
    redundantScores: p === null ? undefined : [{ id: 'c', p }],
    verdict,
    ts: 1,
  });

  it('returns null when fewer than 50 scored records', () => {
    const records = Array.from({ length: 49 }, () => rec(0.5, 'create'));
    expect(proposeTauRedundantHigh(records).proposal).toBeNull();
  });

  it('returns null when fewer than 5 update-verdict records', () => {
    const records = [...Array.from({ length: 50 }, () => rec(0.5, 'create')), ...Array.from({ length: 4 }, () => rec(0.2, 'update'))];
    expect(proposeTauRedundantHigh(records).proposal).toBeNull();
  });

  it('returns null when update band reaches 0.99 (no safe line)', () => {
    const records = [...Array.from({ length: 50 }, () => rec(0.6, 'create')), ...Array.from({ length: 5 }, () => rec(0.99, 'update'))];
    expect(proposeTauRedundantHigh(records).proposal).toBeNull();
  });

  it('proposes T = maxUpdate + 0.01 when separable with >= 3 non-update above', () => {
    const records = [
      ...Array.from({ length: 45 }, () => rec(0.3, 'create')),
      ...Array.from({ length: 5 }, () => rec(0.6, 'update')),
      ...Array.from({ length: 5 }, () => rec(0.95, 'create')),
    ];
    const r = proposeTauRedundantHigh(records);
    expect(r.proposal).not.toBeNull();
    expect(r.proposal!.tauRedundantHigh).toBeCloseTo(0.61, 5);
    expect(r.proposal!.above).toBe(5);
  });

  it('returns null when fewer than 3 non-update records above T', () => {
    const records = [
      ...Array.from({ length: 50 }, () => rec(0.5, 'create')),
      ...Array.from({ length: 5 }, () => rec(0.6, 'update')),
      rec(0.95, 'create'),
    ];
    expect(proposeTauRedundantHigh(records).proposal).toBeNull();
  });

  it('legacy records without redundantScores are skipped, not crashing', () => {
    const records = Array.from({ length: 60 }, () => ({ verdict: 'create', ts: 1 }));
    expect(() => proposeTauRedundantHigh(records as any)).not.toThrow();
  });
});
