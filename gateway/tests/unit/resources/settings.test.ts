/**
 * E4 shared config normalization: one place for the "0 = unlimited" /
 * clamped-ratio / sane-interval rules so every provider agrees.
 * Spec: docs/superpowers/specs/2026-11-11-gateway-e4-resource-ledger-design.md §5
 */
import { clampRatio, limitOf, resolveSampleIntervalMs } from '../../../src/resources/settings';

describe('resolveSampleIntervalMs', () => {
  test('keeps configured values >= 1000ms, floored', () => {
    expect(resolveSampleIntervalMs(30000)).toBe(30000);
    expect(resolveSampleIntervalMs(1000)).toBe(1000);
    expect(resolveSampleIntervalMs(1500.9)).toBe(1500);
    expect(resolveSampleIntervalMs(1e9)).toBe(1e9);
  });

  test('falls back to 30000 for too-small, non-finite or non-numeric input', () => {
    for (const bad of [999, 0, -1, NaN, Infinity, -Infinity, null, undefined, '5000']) {
      expect(resolveSampleIntervalMs(bad)).toBe(30000);
    }
  });
});

describe('clampRatio', () => {
  test('passes through ratios inside the open interval (0, 1)', () => {
    expect(clampRatio(0.75, 0.5)).toBe(0.75);
    expect(clampRatio(0.333, 0.5)).toBe(0.333);
    expect(clampRatio(0.01, 0.5)).toBe(0.01);
    expect(clampRatio(0.99, 0.5)).toBe(0.99);
  });

  test('clamps 0/negative up to 0.01 and 1/above down to 0.99', () => {
    expect(clampRatio(0, 0.75)).toBe(0.01);
    expect(clampRatio(-1, 0.75)).toBe(0.01);
    expect(clampRatio(1, 0.75)).toBe(0.99);
    expect(clampRatio(1.5, 0.75)).toBe(0.99);
  });

  test('falls back for non-finite or non-numeric input', () => {
    for (const bad of [NaN, Infinity, -Infinity, null, undefined, '0.8']) {
      expect(clampRatio(bad, 0.42)).toBe(0.42);
    }
  });
});

describe('limitOf', () => {
  test('positive values are floored', () => {
    expect(limitOf(10)).toBe(10);
    expect(limitOf(10.9)).toBe(10);
    expect(limitOf(1e9)).toBe(1e9);
  });

  test('0 / negative / NaN / Infinity / missing mean unlimited', () => {
    for (const unlimited of [0, -1, -0.5, NaN, Infinity, undefined, null, '5']) {
      expect(limitOf(unlimited)).toBe(Infinity);
    }
  });
});
