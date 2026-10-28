import { summarizeBench } from '../../scripts/voice-bench';

test('summarizeBench computes p50 and empty count', () => {
  const r = summarizeBench([
    { firstPartialMs: 100, finalMs: 300, text: 'a' },
    { firstPartialMs: 200, finalMs: 500, text: '' },
    { firstPartialMs: 300, finalMs: 700, text: 'c' },
  ]);
  expect(r.count).toBe(3);
  expect(r.firstPartialP50).toBe(200);
  expect(r.finalP50).toBe(500);
  expect(r.empty).toBe(1);
});
