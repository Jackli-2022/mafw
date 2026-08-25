// Builtin usage plugin: SiliconFlow (api type — prepaid balance)
module.exports = {
  name: 'siliconflow-cn',
  type: 'api',
  plan: 'prepaid',
  async fetch(ctx) {
    const key = ctx.apiKey('siliconflow-cn') || ctx.apiKey('siliconflow');
    if (!key) return null;
    try {
      const res = await ctx.fetch('https://api.siliconflow.cn/v1/user/info', {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      if (!res.ok) {
        ctx.log.warn('[SiliconFlowPlugin] HTTP ' + res.status);
        return null;
      }
      const body = await res.json();
      const d = body?.data ?? body;
      const total = num(d.totalBalance) ?? num(d.total_balance);
      if (total === undefined || total <= 0) return null;

      return {
        name: 'siliconflow-cn',
        type: 'api',
        plan: 'prepaid',
        windows: [{
          window: 'balance',
          used: 0,
          limit: 0,
          unit: '$',
          pct: 0,
          remaining: Math.round(total * 100) / 100,
        }],
      };
    } catch (err) {
      ctx.log.warn('[SiliconFlowPlugin] fetch failed: ' + (err.message || err));
      return null;
    }
  },
};

function num(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
