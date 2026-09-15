import { UsagePoller } from '../../src/usage/usage-poller';

const fakeStore = {
  getDistinctProviders: () => [] as string[],
  getProviderTotalCost: () => 0,
  getProviderTotalTokens: () => ({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }),
} as any;

function makePoller(adapterWindows: any[], budgets: Record<string, number>) {
  const loader = {
    getAdapters: () => [{
      name: 'gateway',
      type: 'token-plan',
      fetch: async () => ({ name: 'gateway', type: 'token-plan', plan: '蓝区统一网关', windows: adapterWindows, severity: 'low' }),
    }],
  } as any;
  return new UsagePoller(fakeStore, () => ({} as any), () => budgets, loader);
}

describe('UsagePoller budget collapse guard', () => {
  it('collapses to budget window when plugin result is all-balance (existing behavior)', async () => {
    const poller = makePoller(
      [{ window: 'balance', used: 12, limit: 1000, unit: 'credit', pct: 1, remaining: 988 }],
      { gateway: 100 },
    );
    const res = await poller.poll();
    const p = res.providers.find(x => x.name === 'gateway')!;
    expect(p.plan).toBe('budget');
    expect(p.windows).toHaveLength(1);
    expect(p.windows[0].limit).toBe(100);
    expect(p.windows[0].window).toBe('balance');
  });

  it('passes windows through when plugin result has non-balance windows, even with budget configured', async () => {
    const poller = makePoller(
      [
        { window: 'balance', used: 2, limit: 1000, unit: 'credit', pct: 0 },
        { window: 'day', used: 1, limit: 50, unit: 'credit', pct: 2 },
        { window: '7d', used: 1, limit: 200, unit: 'credit', pct: 1 },
      ],
      { gateway: 100 },
    );
    const res = await poller.poll();
    const p = res.providers.find(x => x.name === 'gateway')!;
    expect(p.plan).toBe('蓝区统一网关'); // 未被折叠成 'budget'
    expect(p.windows.map((w: any) => w.window)).toEqual(['balance', 'day', '7d']);
  });
});
