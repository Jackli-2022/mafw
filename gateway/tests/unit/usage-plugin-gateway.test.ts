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

  it('keeps pct at 0.01% precision (small usage no longer rounds to 0)', async () => {
    const plugin = loadPlugin();
    const ctx = mkCtx({
      pluginConfig: (name: string) => (name === 'gateway' ? { day: 50 } : null),
      usage: {
        modelStats: (opts?: { sinceMs?: number; provider?: string }) => {
          // 20000 tok × 1.0 credit/M = 0.02 credit → 0.02/50 = 0.04%
          const rows = [{ provider: 'gateway', model: 'm1', turns: 1, tokens: { input: 20000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }];
          return opts?.provider ? rows.filter((r: any) => r.provider === opts.provider) : rows;
        },
      },
    });
    const res = await plugin.fetch(ctx);
    const byWin = Object.fromEntries(res.windows.map((w: any) => [w.window, w]));
    expect(byWin.day.used).toBe(0.02);
    expect(byWin.day.pct).toBe(0.04);
  });

  it('month window is calendar-month (resets on the 1st), not rolling 30d', async () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(new Date(2026, 8, 15, 12, 0, 0).getTime());
    try {
      const plugin = loadPlugin();
      const seen: Array<number | undefined> = [];
      const ctx = mkCtx({
        pluginConfig: (name: string) => (name === 'gateway' ? { month: 500 } : null),
        usage: {
          modelStats: (opts?: { sinceMs?: number; provider?: string }) => {
            seen.push(opts?.sinceMs);
            return opts?.sinceMs != null ? RECENT_ROWS : ALL_ROWS;
          },
        },
      });
      const res = await plugin.fetch(ctx);
      const byWin = Object.fromEntries(res.windows.map((w: any) => [w.window, w]));
      expect(byWin.month.used).toBe(0.5);
      // 查询起点 = 本月 1 号 00:00（本地时区），而非 now-30d
      expect(seen).toContain(new Date(2026, 8, 1).getTime());
      // resetAt = 下月 1 号 00:00
      expect(byWin.month.resetAt).toBe(new Date(2026, 9, 1).getTime());
    } finally {
      spy.mockRestore();
    }
  });

  it('degrades to zero credits when /models fetch fails and no cache', async () => {
    const plugin = loadPlugin();
    const res = await plugin.fetch(mkCtx({ fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) }));
    const byWin = Object.fromEntries(res.windows.map((w: any) => [w.window, w]));
    expect(byWin.balance.used).toBe(0);
    expect(byWin.day.used).toBe(0);
  });

  // ---- /v1/usage/by-model 权威路径（BlueRegionUsage 链路，2026-09-16 实测可用）----

  // 路由式 mock：/models 返回 credit_history；/usage/by-model?window=* 返回逐日明细
  function mkRoutedFetch(modelsPayload: any, usagePayloads: Record<string, any>, log: Array<string> = []) {
    return async (url: string, opts?: any) => {
      log.push(url);
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => modelsPayload };
      }
      const m = url.match(/\/usage\/by-model\?window=(\w+)$/);
      if (!m) return { ok: false, status: 404, json: async () => ({}) };
      const payload = usagePayloads[m[1]];
      if (!payload) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, json: async () => payload };
    };
  }

  it('prefers /v1/usage/by-model for day/week/month credits with credit_history segmentation', async () => {
    // m1 系数：08-01 起 1.0，09-10 起 2.0（区间语义 [from, 下一条 from)）
    const modelsPayload = {
      data: [{ id: 'm1', credit: 2.0, credit_history: [{ from: '2026-08-01', credit: 1.0 }, { from: '2026-09-10', credit: 2.0 }] }],
    };
    const usagePayloads = {
      today: { data: [{ model: 'm1', daily: [{ date: '2026-09-16', req_tokens: 300000, rsp_tokens: 200000, total_tokens: 500000 }] }] },
      week: {
        data: [{
          model: 'm1',
          daily: [
            { date: '2026-09-09', req_tokens: 600000, rsp_tokens: 400000, total_tokens: 1000000 }, // × 1.0 = 1.0
            { date: '2026-09-11', req_tokens: 500000, rsp_tokens: 0, total_tokens: 500000 }, // × 2.0 = 1.0
          ],
        }],
      },
      month: { data: [{ model: 'm1', daily: [{ date: '2026-09-16', req_tokens: 1000000, rsp_tokens: 0, total_tokens: 1000000 }] }] },
    };
    const calls: string[] = [];
    const plugin = loadPlugin();
    const res = await plugin.fetch(mkCtx({ fetch: mkRoutedFetch(modelsPayload, usagePayloads, calls) }));
    const byWin = Object.fromEntries(res.windows.map((w: any) => [w.window, w]));
    // today: 0.5M × 2.0 = 1.0（req+rsp 口径，req 含缓存命中）
    expect(byWin.day.used).toBe(1);
    // week: 1.0M × 1.0（09-09）+ 0.5M × 2.0（09-11）= 2.0（跨系数变更按日分段）
    expect(byWin['7d'].used).toBe(2);
    // month: 1.0M × 2.0 = 2.0
    expect(byWin.month.used).toBe(2);
    // 权威路径确实调了三个窗口端点，且全部携带 Bearer key
    expect(calls.filter(u => u.includes('/usage/by-model?window=today')).length).toBe(1);
    expect(calls.filter(u => u.includes('/usage/by-model?window=week')).length).toBe(1);
    expect(calls.filter(u => u.includes('/usage/by-model?window=month')).length).toBe(1);
    expect(calls.length).toBeGreaterThan(0);
    const routed = calls.filter(u => u.includes('/usage/'));
    expect(routed.length).toBe(3);
  });

  it('balance window still uses local all-time trajectory estimate', async () => {
    // /models: m1 当前 2.0（带 history）、m2 0.5 → 本地全历史 balance = 1M×2.0 + 1M×0.5 = 2.5
    const modelsPayload = {
      data: [
        { id: 'm1', credit: 2.0, credit_history: [{ from: '2026-08-01', credit: 2.0 }] },
        { id: 'm2', credit: 0.5 },
      ],
    };
    const usagePayloads = {
      today: { data: [{ model: 'm1', daily: [{ date: '2026-09-16', req_tokens: 500000, rsp_tokens: 0, total_tokens: 500000 }] }] },
    };
    const plugin = loadPlugin();
    const res = await plugin.fetch(mkCtx({ fetch: mkRoutedFetch(modelsPayload, usagePayloads) }));
    const byWin = Object.fromEntries(res.windows.map((w: any) => [w.window, w]));
    expect(byWin.balance.used).toBe(2.5); // 本地 trajectory × /models 价格
    expect(byWin.balance.detailLines[0]).toContain('m1');
    expect(byWin.day.used).toBe(1); // 网关权威：0.5M × 2.0
  });

  it('falls back to local estimation per window when /usage/by-model fails (404/throw)', async () => {
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(url);
      if (url.includes('/usage/by-model?window=week')) throw new Error('boom'); // 网络异常
      if (url.includes('/usage/')) return { ok: false, status: 404, json: async () => ({}) }; // 端点不存在
      return { ok: true, json: async () => MODELS_PAYLOAD };
    };
    const plugin = loadPlugin();
    const res = await plugin.fetch(mkCtx({ fetch }));
    const byWin = Object.fromEntries(res.windows.map((w: any) => [w.window, w]));
    // 三窗口全部回退本地 RECENT_ROWS（m2 0.5M × 0.5 = 0.25? 不——m2 是 1M tok × 0.5 = 0.5）
    expect(byWin.day.used).toBe(0.5);
    expect(byWin['7d'].used).toBe(0.5);
    expect(byWin.month.used).toBe(0.5);
  });

  it('falls back to current /models credit for models without credit_history', async () => {
    const modelsPayload = { data: [{ id: 'm1', credit: 1.5 }] };
    const usagePayloads = {
      today: { data: [{ model: 'm1', daily: [{ date: '2026-09-16', req_tokens: 1000000, rsp_tokens: 0, total_tokens: 1000000 }] }] },
      week: { data: [{ model: 'm1', daily: [{ date: '2026-09-09', req_tokens: 200000, rsp_tokens: 0, total_tokens: 200000 }] }] },
      month: { data: [{ model: 'm1', daily: [{ date: '2026-09-01', req_tokens: 400000, rsp_tokens: 0, total_tokens: 400000 }] }] },
    };
    const plugin = loadPlugin();
    const res = await plugin.fetch(mkCtx({ fetch: mkRoutedFetch(modelsPayload, usagePayloads) }));
    const byWin = Object.fromEntries(res.windows.map((w: any) => [w.window, w]));
    expect(byWin.day.used).toBe(1.5);
    expect(byWin['7d'].used).toBe(0.3);
    expect(byWin.month.used).toBe(0.6);
  });
});
