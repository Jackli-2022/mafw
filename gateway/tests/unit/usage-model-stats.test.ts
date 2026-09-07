import { buildModelStats } from '../../src/usage/model-stats';

const ROW = (model: string, input = 1000, output = 500) => ({
  provider: 'xiaomi',
  model,
  turns: 2,
  tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
});

describe('buildModelStats', () => {
  test('attaches estimatedCost for priced models, null for unknown', () => {
    const store = { getModelUsageStats: () => [ROW('mimo-v2.5'), ROW('totally-unknown-model')] } as any;
    const stats = buildModelStats(store);
    expect(stats.all[0].estimatedCost).toBeCloseTo((1000 / 1e6) * 0.10 + (500 / 1e6) * 0.30, 6);
    expect(stats.all[1].estimatedCost).toBeNull();
  });

  test('four windows computed with correct cutoffs', () => {
    const now = new Date('2026-09-07T15:30:00').getTime(); // local time
    const seen: (number | null)[] = [];
    const store = { getModelUsageStats: (since: number | null) => { seen.push(since); return []; } } as any;
    buildModelStats(store, now);

    const localMidnight = new Date(now);
    localMidnight.setHours(0, 0, 0, 0);
    expect(seen[0]).toBe(Math.floor(localMidnight.getTime() / 1000)); // today = 本地零点
    expect(seen[1]).toBe(Math.floor(now / 1000) - 7 * 86400);
    expect(seen[2]).toBe(Math.floor(now / 1000) - 30 * 86400);
    expect(seen[3]).toBeNull();
  });
});
