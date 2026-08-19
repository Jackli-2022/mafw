import { EnergySystem, EnergyEvent } from '../../gateway/src/core/memory/energy-system';

function makeSystem(config?: { decayRatePerDay?: number; cleanupThreshold?: number; criticalThreshold?: number }) {
  return new EnergySystem(config);
}

describe('EnergySystem', () => {
  describe('calculateEnergy', () => {
    it('decays over days', () => {
      const es = makeSystem({ decayRatePerDay: 0.01 });
      const result = es.calculateEnergy(0.5, { type: 'retrieved' }, 10);
      expect(result).toBeCloseTo(0.42, 5);
    });

    it.each<[string, EnergyEvent, number]>([
      ['useful_feedback', { type: 'useful_feedback' }, 0.1],
      ['useless_feedback', { type: 'useless_feedback' }, -0.05],
      ['retrieved', { type: 'retrieved' }, 0.02],
      ['referenced', { type: 'referenced' }, 0.05],
      ['merged', { type: 'merged' }, 0.03],
    ])('produces correct delta for %s', (_, event, expectedDelta) => {
      const es = makeSystem({ decayRatePerDay: 0 });
      const result = es.calculateEnergy(0.5, event, 0);
      expect(result).toBeCloseTo(0.5 + expectedDelta, 5);
    });

    it('clamps negative to 0', () => {
      const es = makeSystem({ decayRatePerDay: 1 });
      const result = es.calculateEnergy(0.5, { type: 'useless_feedback' }, 1);
      expect(result).toBe(0);
    });

    it('clamps above 1 to 1', () => {
      const es = makeSystem({ decayRatePerDay: 0 });
      const result = es.calculateEnergy(0.95, { type: 'useful_feedback' }, 0);
      expect(result).toBe(1);
    });
  });

  describe('shouldCleanup', () => {
    it('returns true for energy below threshold (0.3)', () => {
      const es = makeSystem();
      expect(es.shouldCleanup(0.29)).toBe(true);
    });

    it('returns false for energy at threshold', () => {
      const es = makeSystem();
      expect(es.shouldCleanup(0.3)).toBe(false);
    });

    it('returns false for high energy', () => {
      const es = makeSystem();
      expect(es.shouldCleanup(0.8)).toBe(false);
    });
  });

  describe('isCritical', () => {
    it('returns true for energy above threshold (0.8)', () => {
      const es = makeSystem();
      expect(es.isCritical(0.81)).toBe(true);
    });

    it('returns false for energy at threshold', () => {
      const es = makeSystem();
      expect(es.isCritical(0.8)).toBe(false);
    });

    it('returns false for low energy', () => {
      const es = makeSystem();
      expect(es.isCritical(0.3)).toBe(false);
    });
  });

  describe('calculateDistribution', () => {
    it('counts correctly across categories', () => {
      const es = makeSystem();
      const memories = [
        { energy: 0.9 },   // critical
        { energy: 0.7 },   // high
        { energy: 0.5 },   // medium
        { energy: 0.2 },   // low
        { energy: 0.85 },  // critical
      ];
      const dist = es.calculateDistribution(memories);
      expect(dist).toEqual({ critical: 2, high: 1, medium: 1, low: 1, total: 5 });
    });

    it('handles empty array', () => {
      const es = makeSystem();
      const dist = es.calculateDistribution([]);
      expect(dist).toEqual({ critical: 0, high: 0, medium: 0, low: 0, total: 0 });
    });
  });

  describe('constructor defaults', () => {
    it('uses default values when no config provided', () => {
      const es = makeSystem();
      expect(es.calculateEnergy(0.5, { type: 'retrieved' }, 10)).toBeCloseTo(0.47, 5);
      expect(es.shouldCleanup(0.29)).toBe(true);
      expect(es.isCritical(0.81)).toBe(true);
    });
  });

  describe('custom constructor values', () => {
    it('uses custom decay rate', () => {
      const es = makeSystem({ decayRatePerDay: 0.1 });
      const result = es.calculateEnergy(0.5, { type: 'retrieved' }, 1);
      expect(result).toBeCloseTo(0.42, 5);
    });

    it('uses custom thresholds', () => {
      const es = makeSystem({ cleanupThreshold: 0.5, criticalThreshold: 0.9 });
      expect(es.shouldCleanup(0.4)).toBe(true);
      expect(es.shouldCleanup(0.5)).toBe(false);
      expect(es.isCritical(0.91)).toBe(true);
      expect(es.isCritical(0.89)).toBe(false);
    });
  });
});
