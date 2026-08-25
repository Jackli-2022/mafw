import { importanceToSalience } from '../../../gateway/src/core/memory/salience-perceptor';

test('importanceToSalience maps 1..10 to 0.5..1.5', () => {
  expect(importanceToSalience(1)).toBe(0.5);
  expect(importanceToSalience(5)).toBeCloseTo(0.944, 3);
  expect(importanceToSalience(10)).toBe(1.5);
});

test('importanceToSalience clamps out-of-range to defaults', () => {
  expect(importanceToSalience(0)).toBe(1.0);
  expect(importanceToSalience(11)).toBe(1.0);
  expect(importanceToSalience(undefined as any)).toBe(1.0);
});
