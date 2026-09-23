import { abstractionLevelFor, decayRateFor } from '../../src/core/memory/abstraction-level';

describe('abstractionLevelFor', () => {
  test('episodic→1, semantic/procedural→2, global→3', () => {
    expect(abstractionLevelFor('episodic')).toBe(1);
    expect(abstractionLevelFor('semantic')).toBe(2);
    expect(abstractionLevelFor('procedural')).toBe(2);
    expect(abstractionLevelFor('global')).toBe(3);
  });
});

describe('decayRateFor', () => {
  test('episodic 快于 semantic，global 最慢', () => {
    expect(decayRateFor('episodic')).toBeGreaterThan(decayRateFor('semantic'));
    expect(decayRateFor('semantic')).toBeGreaterThan(decayRateFor('procedural'));
    expect(decayRateFor('procedural')).toBeGreaterThan(decayRateFor('global'));
  });
});
