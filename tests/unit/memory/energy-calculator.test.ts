import { calculateEnergy } from '../../../gateway/src/memory/energy-calculator';

test('returns base when fresh', () => {
  const result = calculateEnergy(0.8, Date.now(), 0, 0);
  expect(result).toBe(0.8);
});

test('decays over time', () => {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const result = calculateEnergy(0.8, thirtyDaysAgo, 0, 0);
  expect(result).toBeLessThan(0.8);
  expect(result).toBeGreaterThan(0);
});

test('boosts with recent access', () => {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const noAccess = calculateEnergy(0.8, thirtyDaysAgo, 0, 0);
  const withAccess = calculateEnergy(0.8, thirtyDaysAgo, 0, 5);
  expect(withAccess).toBeGreaterThan(noAccess);
});

test('caps at 1.0', () => {
  const result = calculateEnergy(0.95, Date.now(), 0, 100);
  expect(result).toBeLessThanOrEqual(1.0);
});
