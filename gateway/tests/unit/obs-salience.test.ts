/**
 * S3: observation salience (scalar integration, deterministic) — encoding-time tag.
 */
import { obsSalience } from '../../src/recall/obs-salience';

test('high novelty + emotion → high score', () => {
  expect(obsSalience({ text: '重大错误！崩溃了', novelty: 1 }).score).toBeGreaterThan(0.7);
});

test('repetition lowers score', () => {
  const a = obsSalience({ text: '普通日志', novelty: 0.2 }).score;
  const b = obsSalience({ text: '普通日志', novelty: 0.2, repetition: 3 }).score;
  expect(b).toBeLessThan(a);
});

test('missing signals → neutral 0.5', () => {
  expect(obsSalience({ text: 'x' }).score).toBeCloseTo(0.5, 1);
});

test('clamped to [0,1]', () => {
  expect(obsSalience({ text: 'x', novelty: 1, reward: 1 }).score).toBeLessThanOrEqual(1);
  expect(obsSalience({ text: 'x', novelty: 0, repetition: 10 }).score).toBeGreaterThanOrEqual(0);
});
