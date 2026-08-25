// Builtin usage plugin: Command Code GOAT (token-plan type — 5h / 7d $ windows + monthly credits)
module.exports = {
  name: 'commandcode',
  type: 'token-plan',
  plan: 'GOAT',
  async fetch(ctx) {
    const cookie = ctx.cookie('commandcode');
    if (!cookie) return null;
    try {
      const res = await ctx.fetch('https://api.commandcode.ai/internal/billing/credits', {
        headers: { 'Cookie': cookie },
      });
      if (!res.ok) {
        ctx.log.warn('[CommandCodePlugin] HTTP ' + res.status);
        return null;
      }
      const body = await res.json();
      const windowLimits = body?.windowLimits ?? body?.credits?.windowLimits;
      if (!windowLimits) return null;

      const windows = [];
      for (const [key, label] of [['fiveHour', '5h'], ['weekly', '7d']]) {
        const w = windowLimits[key];
        const cap = num(w?.cap);
        if (cap === undefined || cap <= 0) continue;
        const used = num(w?.used) ?? 0;
        const pct = Math.round((used / cap) * 100);
        const resetMs = w?.resetAt ? Date.parse(w.resetAt) : undefined;
        windows.push({
          window: label,
          used: Math.round(used * 100) / 100,
          limit: Math.round(cap * 100) / 100,
          unit: '$',
          pct,
          resetAt: Number.isFinite(resetMs) ? resetMs : undefined,
        });
      }

      const monthlyCredits = num(body?.credits?.monthlyCredits);
      if (monthlyCredits !== undefined) {
        windows.push({
          window: 'month',
          used: monthlyCredits,
          limit: 0,
          unit: '$',
          pct: 0,
        });
      }
      if (windows.length === 0) return null;

      return {
        name: 'commandcode',
        type: 'token-plan',
        plan: 'GOAT',
        windows,
      };
    } catch (err) {
      ctx.log.warn('[CommandCodePlugin] fetch failed: ' + (err.message || err));
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
