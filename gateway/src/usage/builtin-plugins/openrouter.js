// Builtin usage plugin: OpenRouter (api type — credit balance / key limit)
module.exports = {
  name: 'openrouter',
  type: 'api',
  plan: 'prepaid',
  async fetch(ctx) {
    const key = ctx.apiKey('openrouter');
    if (!key) return null;
    try {
      const res = await ctx.fetch('https://openrouter.ai/api/v1/key', {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      if (!res.ok) {
        ctx.log.warn('[OpenRouterPlugin] HTTP ' + res.status);
        return null;
      }
      const data = await res.json();
      const d = data?.data;
      if (!d) return null;

      const limitRemaining = d.limit_remaining;
      const limit = d.limit;
      const usage = d.usage || 0;

      if (limit == null && limitRemaining == null) {
        return {
          name: 'openrouter',
          type: 'api',
          plan: 'prepaid',
          windows: [{
            window: 'balance',
            used: Math.round(usage * 100) / 100,
            limit: 0,
            unit: '$',
            pct: 0,
            remaining: limitRemaining != null ? Math.round(limitRemaining * 100) / 100 : undefined,
          }],
        };
      }

      const remaining = limitRemaining ?? 0;
      const totalLimit = limit ?? (remaining + usage);
      const used = totalLimit - remaining;
      const pct = totalLimit > 0 ? Math.round((used / totalLimit) * 100) : 0;

      return {
        name: 'openrouter',
        type: 'api',
        plan: 'prepaid',
        windows: [{
          window: 'balance',
          used: Math.round(used * 100) / 100,
          limit: Math.round(totalLimit * 100) / 100,
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
