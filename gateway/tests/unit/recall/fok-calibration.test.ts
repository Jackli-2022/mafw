import { fitIsotonic, pickThresholds, FokSample } from '../../../src/recall/fok-calibration';

// Deterministic synthetic sampler: hit probability rises monotonically with
// top1prob (the true calibration curve P(hit|p) = 0.1 + 0.8p).
function synth(n: number, seed = 42): FokSample[] {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: FokSample[] = [];
  for (let i = 0; i < n; i++) {
    const p = rand();
    out.push({ top1prob: p, hit: rand() < 0.1 + 0.8 * p });
  }
  return out;
}

describe('fitIsotonic', () => {
  it('fits a monotone map (PAVA) on 300 samples', () => {
    const { fit, ece, n } = fitIsotonic(synth(300));
    expect(n).toBe(300);
    expect(ece).toBeLessThanOrEqual(0.3);
    let prev = -Infinity;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const v = fit(p);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('is close to the true curve on dense data', () => {
    const { fit } = fitIsotonic(synth(2000));
    // PAVA on 2000 points approximates 0.1 + 0.8p within a coarse tolerance
    expect(Math.abs(fit(0.2) - 0.26)).toBeLessThan(0.12);
    expect(Math.abs(fit(0.8) - 0.74)).toBeLessThan(0.12);
  });

  it('handles degenerate inputs without throwing', () => {
    expect(() => fitIsotonic([])).not.toThrow();
    expect(() => fitIsotonic([{ top1prob: NaN, hit: true } as any])).not.toThrow();
    const one = fitIsotonic([{ top1prob: 0.5, hit: true }]);
    expect(one.n).toBe(1);
    expect(one.fit(0.5)).toBe(1);
  });
});

describe('pickThresholds', () => {
  it('probLow sits where fitted hit-rate crosses the no-memory line', () => {
    const { fit } = fitIsotonic(synth(2000));
    const { probLow, probHigh } = pickThresholds(fit, { noMemoryRate: 0.2, lowConfRate: 0.6 });
    // true curve: fit(p)≈0.1+0.8p → 0.2 at p≈0.125, 0.6 at p≈0.625
    expect(probLow).toBeGreaterThan(0.02);
    expect(probLow).toBeLessThan(0.4);
    expect(probHigh).toBeGreaterThan(probLow);
    expect(probHigh).toBeLessThanOrEqual(1);
  });

  it('never returns probHigh below probLow', () => {
    const flat = () => 0.9;
    const { probLow, probHigh } = pickThresholds(flat, { noMemoryRate: 0.2, lowConfRate: 0.6 });
    expect(probHigh).toBeGreaterThanOrEqual(probLow);
  });
});
