describe('builtin usage plugin: gateway (蓝区统一网关)', () => {
  const MODELS_PAYLOAD = {
    data: [
      { id: 'm1', credit: 1.0 },
      { id: 'm2', credit: 0.5 },
    ],
  };
  // m1: 1.0M tok × 1.0 = 1.0 credit（全部时间）；m2: 1.0M tok × 0.5 = 0.5 credit（最近窗口）
  const ALL_ROWS = [
    { provider: 'gateway', model: 'm1', turns: 2, tokens: { input: 500000, output: 500000, reasoning: 0, cache: { read: 0, write: 0 } } },
    { provider: 'gateway', model: 'm2', turns: 1, tokens: { input: 1000000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
    { provider: 'other', model: 'm9', turns: 9, tokens: { input: 9000000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
  ];
  const RECENT_ROWS = [ALL_ROWS[1]];

  function mkCtx(over: Record<string, any> = {}) {
    return {
      apiKey: (name: string) => (name === 'gateway' ? 'k' : null),
      fetch: over.fetch ?? (async () => ({ ok: true, json: async () => MODELS_PAYLOAD })),
      pluginConfig: (name: string) => (name === 'gateway' ? { credit: 1000, day: 50, week: 200, month: 500 } : null),
      usage: {
        modelStats: (opts?: { sinceMs?: number; provider?: string }) => {
          const rows = opts?.sinceMs != null ? RECENT_ROWS : ALL_ROWS;
          return opts?.provider ? rows.filter(r => r.provider === opts.provider) : rows;
        },
      },
      log: { warn: () => {}, info: () => {}, error: () => {} },
      ...over,
    };
  }

  function loadPlugin() {
    jest.resetModules(); // 清模块级价格缓存，保证用例独立
    return require('../../src/usage/builtin-plugins/gateway.js');
  }

  it('returns null without api key', async () => {
    const plugin = loadPlugin();
    expect(await plugin.fetch(mkCtx({ apiKey: () => null }))).toBeNull();
  });

  it('returns null when no limits configured', async () => {
    const plugin = loadPlugin();
    expect(await plugin.fetch(mkCtx({ pluginConfig: () => null }))).toBeNull();
  });

  it('computes 4 windows from local stats × per-model credit prices', async () => {
    const plugin = loadPlugin();
    const res = await plugin.fetch(mkCtx());
    expect(res.name).toBe('gateway');
    expect(res.type).toBe('token-plan');
    const byWin = Object.fromEntries(res.windows.map((w: any) => [w.window, w]));

    // balance: 全历史 1.5 / 1000
    expect(byWin.balance.used).toBe(1.5);
    expect(byWin.balance.limit).toBe(1000);
    expect(byWin.balance.unit).toBe('credit');
    expect(byWin.balance.remaining).toBe(998.5);
    expect(byWin.balance.detailLines[0]).toContain('m1');
    expect(byWin.balance.detailLines[0]).toContain('1.0 credits');
    expect(byWin.balance.detailLines[1]).toContain('m2');

    // day/7d/month: 最近窗口仅 m2 → 0.5 credit
    expect(byWin.day.used).toBe(0.5);
    expect(byWin.day.limit).toBe(50);
    expect(byWin.day.pct).toBe(1);
    expect(byWin['7d'].used).toBe(0.5);
    expect(byWin.month.used).toBe(0.5);
    // 无 resetAt（滚动窗 + modelStats 无 earliest 数据）
    expect(byWin.day.resetAt).toBeUndefined();
  });

  it('degrades to zero credits when /models fetch fails and no cache', async () => {
    const plugin = loadPlugin();
    const res = await plugin.fetch(mkCtx({ fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) }));
    const byWin = Object.fromEntries(res.windows.map((w: any) => [w.window, w]));
    expect(byWin.balance.used).toBe(0);
    expect(byWin.day.used).toBe(0);
  });
});
