import { classifyMiss } from '../../../gateway/src/feedback/miss-attribution';

test('detects anchor_poor when memories exist but not matched', () => {
  const result = classifyMiss({
    query: 'payment timeout',
    matchedCount: 0,
    relatedMemoryExists: true,
    relatedMemoryAnchors: ['payment', 'order'],
  });
  expect(result.cause).toBe('anchor_poor');
  expect(result.candidates.length).toBeGreaterThan(0);
});

test('detects irrelevant when matched count > 3', () => {
  const result = classifyMiss({
    query: 'deployment',
    matchedCount: 5,
    relatedMemoryExists: true,
    relatedMemoryAnchors: ['deploy'],
  });
  expect(result.cause).toBe('irrelevant_memory');
});

test('returns anchor_poor with empty candidates when no related memory', () => {
  const result = classifyMiss({
    query: 'unknown feature',
    matchedCount: 0,
    relatedMemoryExists: false,
    relatedMemoryAnchors: [],
  });
  expect(result.cause).toBe('anchor_poor');
});
