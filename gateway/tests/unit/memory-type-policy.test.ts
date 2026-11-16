import { abstractionLevelFor } from '../../src/core/memory/abstraction-level';
import {
  isKnownMemoryType,
  memoryTypeWarnings,
  normalizeMemoryType,
  RETIRED_EPISODIC_WARNING,
} from '../../src/core/memory/memory-type';

describe('cortex memory type policy', () => {
  test('episodic coerces to semantic with a warning', () => {
    expect(normalizeMemoryType('episodic')).toBe('semantic');
    expect(memoryTypeWarnings('episodic')).toEqual([RETIRED_EPISODIC_WARNING]);
    expect(abstractionLevelFor(normalizeMemoryType('episodic'))).toBe(2);
  });

  test('semantic / procedural / global pass through unchanged', () => {
    for (const type of ['semantic', 'procedural', 'global'] as const) {
      expect(normalizeMemoryType(type)).toBe(type);
      expect(memoryTypeWarnings(type)).toEqual([]);
    }
  });

  test('unknown values are invalid input, not silently coerced', () => {
    expect(isKnownMemoryType('episodic')).toBe(true);
    expect(isKnownMemoryType('narrative')).toBe(false);
    expect(isKnownMemoryType(undefined)).toBe(true); // default is semantic
  });
});
