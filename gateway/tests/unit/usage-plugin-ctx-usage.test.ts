import { createUsageStatsProvider, makeAdapter } from '../../src/usage/plugin-context';

const ROWS = [
  { provider: 'gateway', model: 'm1', turns: 2, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } },
  { provider: 'other', model: 'm9', turns: 1, tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
];

describe('ctx.usage (UsageStatsProvider)', () => {
  it('converts sinceMs to epoch seconds and filters by provider', () => {
    const calls: Array<number | null> = [];
    const store = { getModelUsageStats: (since: number | null) => { calls.push(since); return ROWS as any; } };
    const usage = createUsageStatsProvider(store);

    const all = usage.modelStats();
    expect(calls[0]).toBeNull();
    expect(all).toHaveLength(2);

    const filtered = usage.modelStats({ sinceMs: 1_700_000_000_123, provider: 'gateway' });
    expect(calls[1]).toBe(1_700_000_000); // ms → epoch 秒（floor）
    expect(filtered).toHaveLength(1);
    expect(filtered[0].model).toBe('m1');
  });

  it('makeAdapter injects ctx.usage into plugin fetch', async () => {
    const store = { getModelUsageStats: () => ROWS as any };
    const usage = createUsageStatsProvider(store);
    const adapter = makeAdapter(
      { name: 'p1', type: 'api', fetch: async (ctx: any) => ({ name: 'p1', windows: [], rows: ctx.usage.modelStats({ provider: 'gateway' }) }) },
      'p1.js',
      usage,
    );
    const result: any = await adapter.fetch();
    expect(result.rows).toHaveLength(1);
  });

  it('ctx.usage.modelStats returns [] when no usageStats injected (fail-open)', async () => {
    const adapter = makeAdapter(
      { name: 'p2', type: 'api', fetch: async (ctx: any) => ({ name: 'p2', windows: [], rows: ctx.usage.modelStats() }) },
      'p2.js',
    );
    const result: any = await adapter.fetch();
    expect(result.rows).toEqual([]);
  });
});
