import { actrBonus } from '../../../../src/core/memory/retrieval-bonus';
import { RetrievalEvent } from '../../../../src/core/memory/retrieval-events';

const HOUR = 3600_000;
const ev = (id: string, hoursAgo: number, prob = 1): RetrievalEvent => ({
  id,
  prob,
  kind: 'recall',
  ts: Date.now() - hoursAgo * HOUR,
});

describe('actrBonus', () => {
  it('empty events → 0', () => {
    expect(actrBonus([], Date.now())).toBe(0);
    expect(actrBonus(undefined as any, Date.now())).toBe(0);
  });

  it('sublinear growth: 10 events give less than 10x a single event', () => {
    const now = Date.now();
    const one = actrBonus([ev('m', 1)], now);
    const ten = actrBonus(Array.from({ length: 10 }, () => ev('m', 1)), now);
    expect(ten).toBeGreaterThan(one);
    expect(ten).toBeLessThan(one * 10);
  });

  it('older events contribute less than fresh ones (ACT-R power decay)', () => {
    const now = Date.now();
    expect(actrBonus([ev('m', 0.1)], now)).toBeGreaterThan(actrBonus([ev('m', 240)], now));
  });

  it('high-confidence hits weigh more than low-confidence ones', () => {
    const now = Date.now();
    expect(actrBonus([ev('m', 1, 0.95)], now)).toBeGreaterThan(actrBonus([ev('m', 1, 0.05)], now));
  });

  it('respects the cap', () => {
    const now = Date.now();
    const many = Array.from({ length: 500 }, () => ev('m', 0.01));
    expect(actrBonus(many, now)).toBeLessThanOrEqual(0.05);
    expect(actrBonus(many, now, { cap: 0.02 })).toBeLessThanOrEqual(0.02);
  });

  it('never negative', () => {
    const now = Date.now();
    expect(actrBonus([ev('m', 10000, -5)], now)).toBeGreaterThanOrEqual(0);
  });

  it('exposure discount: heavy repetition is discounted beyond the threshold', () => {
    const now = Date.now();
    const mild = Array.from({ length: 3 }, () => ev('m', 1));
    const heavy = Array.from({ length: 30 }, () => ev('m', 1));
    const mildBonus = actrBonus(mild, now, { exposureThreshold: 3, exposureDiscount: 0.5 });
    const heavyBonus = actrBonus(heavy, now, { exposureThreshold: 3, exposureDiscount: 0.5 });
    // 30 events with discount must NOT approach 10x the 3-event bonus
    expect(heavyBonus).toBeLessThan(mildBonus * 4);
  });

  it('no exposure discount below the threshold', () => {
    const now = Date.now();
    const three = Array.from({ length: 3 }, () => ev('m', 1));
    const a = actrBonus(three, now, { exposureThreshold: 5, exposureDiscount: 0.5 });
    const b = actrBonus(three, now, { exposureThreshold: 5, exposureDiscount: 5 });
    expect(a).toBeCloseTo(b, 10);
  });
});
