// Builtin usage plugin: Kimi / Moonshot (api type — prepaid balance)
module.exports = {
  name: 'kimi',
  type: 'api',
  plan: 'prepaid',
  async fetch(ctx) {
    const key = ctx.apiKey('kimi') || ctx.apiKey('moonshot');
    if (!key) return null;
    try {
      const res = await ctx.fetch('https://api.moonshot.cn/v1/users/me/balance', {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      if (!res.ok) {
        ctx.log.warn('[KimiPlugin] HTTP ' + res.status);
        return null;
      }
      const data = await res.json();
      const d = data?.data;
      if (!d) return null;

      const available = parseFloat(d.available_balance) || 0;
      if (available <= 0) return null;

      return {
        name: 'kimi',
        type: 'api',
        plan: 'prepaid',
        windows: [{
          window: 'balance',
          used: 0,
          limit: 0,
          unit: '$',
          pct: 0,
          remaining: Math.round(available * 100) / 100,
        }],
      };
    } catch (err) {
      ctx.log.warn('[KimiPlugin] fetch failed: ' + (err.message || err));
      return null;
    }
  },
};
