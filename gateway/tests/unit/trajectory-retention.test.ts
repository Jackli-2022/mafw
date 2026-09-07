import { resolveRetentionDays } from '../../src/trajectory/collector';

describe('resolveRetentionDays', () => {
  test('valid positive passes through (floored)', () => {
    expect(resolveRetentionDays(30)).toBe(30);
    expect(resolveRetentionDays(30.9)).toBe(30);
  });
  test('zero means keep forever', () => {
    expect(resolveRetentionDays(0)).toBe(0);
  });
  test('invalid falls back to 365', () => {
    expect(resolveRetentionDays(-5)).toBe(365);
    expect(resolveRetentionDays(NaN)).toBe(365);
    expect(resolveRetentionDays(undefined)).toBe(365);
    expect(resolveRetentionDays(Infinity)).toBe(365);
  });
});
