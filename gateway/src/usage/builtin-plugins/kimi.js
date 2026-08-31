// Builtin usage plugin: Kimi / Moonshot (api type — prepaid balance)
// Moonshot balance API returns CNY; converted to USD at ~7.3 rate.
// Reference: QuantumNous/new-api channel-billing.go updateChannelMoonshotBalance
const CNY_TO_USD = 1 / 7.3; // ~0.137
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

      // API returns CNY; available_balance is the spendable amount
      const availableCNY = parseFloat(d.available_balance) || 0;
      if (availableCNY <= 0) return null;

      const remainingUSD = Math.round(availableCNY * CNY_TO_USD * 100) / 100;

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
          remaining: remainingUSD,
        }],
      };
    } catch (err) {
      ctx.log.warn('[KimiPlugin] fetch failed: ' + (err.message || err));
      return null;
    }
  },
};
