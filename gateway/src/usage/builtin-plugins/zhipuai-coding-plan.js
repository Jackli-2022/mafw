// Builtin usage plugin: GLM Coding Plan (zhipu) (token-plan type — 5h / 7d windows)
module.exports = {
  name: 'zhipuai-coding-plan',
  type: 'token-plan',
  plan: 'GLM',
  async fetch(ctx) {
    const key = ctx.apiKey('zhipuai-coding-plan') || ctx.apiKey('zhipu-coding-plan');
    if (!key) return null;
    try {
      const res = await ctx.fetch('https://bigmodel.cn/api/monitor/usage/quota/limit', {
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        ctx.log.warn('[ZhipuPlugin] HTTP ' + res.status);
        return null;
      }
      const body = await res.json();
      const limits = body?.data?.limits ?? body?.limits;
      if (!Array.isArray(limits)) return null;

      const windows = [];
      for (const limit of limits) {
        if (limit.type !== 'TOKENS_LIMIT' && limit.type !== 'CREDIT_LIMIT') continue;
        const pct = Math.round(limit.percentage ?? 0);
        const resetMs = limit.nextResetTime ? Math.round(limit.nextResetTime) : undefined;
        const resetAt = resetMs && Number.isFinite(resetMs) && resetMs > 0 ? resetMs : undefined;
        const label = limit.unit === 3 ? '5h' : limit.unit === 6 ? '7d' : undefined;
        if (!label) continue;
        windows.push({ window: label, used: pct, limit: 100, unit: 'pct', pct, resetAt });
      }
      if (windows.length === 0) return null;

      return {
        name: 'zhipuai-coding-plan',
        type: 'token-plan',
        plan: body?.data?.planName || 'GLM',
        windows,
      };
    } catch (err) {
      ctx.log.warn('[ZhipuPlugin] fetch failed: ' + (err.message || err));
      return null;
    }
  },
};
