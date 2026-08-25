// Builtin usage plugin: DeepSeek (api type — prepaid balance)
module.exports = {
  name: 'deepseek',
  type: 'api',
  plan: 'prepaid',
  async fetch(ctx) {
    const key = ctx.apiKey('deepseek');
    if (!key) return null;
    try {
      const res = await ctx.fetch('https://api.deepseek.com/user/balance', {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      if (!res.ok) {
        ctx.log.warn('[DeepSeekPlugin] HTTP ' + res.status);
        return null;
      }
      const data = await res.json();
      const infos = data?.balance_infos;
      if (!Array.isArray(infos) || infos.length === 0) return null;

      const CNY_TO_USD = 0.14;
      let remaining = 0;
      let totalEver = 0;
      for (const info of infos) {
        const bal = parseFloat(info.total_balance) || 0;
        const granted = parseFloat(info.granted_balance) || 0;
        const toppedUp = parseFloat(info.topped_up_balance) || 0;
        const rate = info.currency === 'CNY' ? CNY_TO_USD : 1;
        remaining += bal * rate;
        totalEver += (granted + toppedUp) * rate;
      }
      if (remaining <= 0 && totalEver <= 0) return null;

      const used = Math.max(0, totalEver - remaining);
      const limit = totalEver > 0 ? totalEver : 0;
      const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;

      return {
        name: 'deepseek',
        type: 'api',
        plan: 'prepaid',
        windows: [{
          window: 'balance',
          used: Math.round(used * 100) / 100,
          limit: Math.round(limit * 100) / 100,
          unit: '$',
          pct,
          remaining: Math.round(remaining * 100) / 100,
        }],
      };
    } catch (err) {
      ctx.log.warn('[DeepSeekPlugin] fetch failed: ' + (err.message || err));
      return null;
    }
  },
};
