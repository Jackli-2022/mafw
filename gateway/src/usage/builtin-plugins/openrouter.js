// Builtin usage plugin: OpenRouter (api type — credit balance)
// Uses /api/v1/credits (totalCredits - totalUsage) for accurate prepaid balance.
// Reference: songquanpeng/one-api channel-billing.go updateChannelOpenRouterBalance
module.exports = {
  name: 'openrouter',
  type: 'api',
  plan: 'prepaid',
  async fetch(ctx) {
    const key = ctx.apiKey('openrouter');
    if (!key) return null;
    try {
      const res = await ctx.fetch('https://openrouter.ai/api/v1/credits', {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      if (!res.ok) {
        ctx.log.warn('[OpenRouterPlugin] HTTP ' + res.status);
        return null;
      }
      const data = await res.json();
      const d = data?.data;
      if (!d) return null;

      const totalCredits = d.total_credits || 0;
      const totalUsage = d.total_usage || 0;
      const remaining = Math.max(0, totalCredits - totalUsage);
      const used = Math.round(totalUsage * 100) / 100;
      const limit = Math.round(totalCredits * 100) / 100;
      const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;

      return {
        name: 'openrouter',
        type: 'api',
        plan: 'prepaid',
        windows: [{
          window: 'balance',
          used,
          limit,
          unit: '$',
          pct,
          remaining: Math.round(remaining * 100) / 100,
        }],
      };
    } catch (err) {
      ctx.log.warn('[OpenRouterPlugin] fetch failed: ' + (err.message || err));
      return null;
    }
  },
};
