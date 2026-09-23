import { abstractionLevelFor } from '../../src/core/memory/abstraction-level';

describe('abstractionLevelFor', () => {
  test('episodic→1, semantic/procedural→2, global→3', () => {
    expect(abstractionLevelFor('episodic')).toBe(1);
    expect(abstractionLevelFor('semantic')).toBe(2);
    expect(abstractionLevelFor('procedural')).toBe(2);
    expect(abstractionLevelFor('global')).toBe(3);
  });
});
