// Builtin usage plugin: Kimi Code (token-plan type — 5h / 7d / month windows)
module.exports = {
  name: 'kimi-for-coding',
  type: 'token-plan',
  plan: 'Kimi Code',
  async fetch(ctx) {
    const key = ctx.apiKey('kimi-for-coding') || ctx.apiKey('kimi-code');
    if (!key) return null;
    try {
      const res = await ctx.fetch('https://api.kimi.com/coding/v1/usages', {
        headers: { 'Authorization': `Bearer ${key}` },
      });
      if (!res.ok) {
        ctx.log.warn('[KimiCodePlugin] HTTP ' + res.status);
        return null;
      }
      const payload = await res.json();
      const root = payload?.data ?? payload;

      const windows = [];
      const durationToWindow = { 300: '5h', 10080: '7d', 43200: 'month' };
      const limits = root?.limits ?? [];
      let hasMonthly = false;
      for (const item of limits) {
        const detail = item?.detail ?? item;
        const win = item?.window ?? {};
        const limitVal = num(detail.limit);
        if (limitVal === undefined || limitVal <= 0) continue;
        const usedVal = num(detail.used) ?? (num(detail.remaining) !== undefined && num(detail.limit) !== undefined ? num(detail.limit) - num(detail.remaining) : 0);
        const pct = Math.round((usedVal / limitVal) * 100);
        const resetMs = parseResetMs(detail);
        const durationMin = num(win.duration);
        const windowType = (durationMin !== undefined ? durationToWindow[durationMin] : undefined) ?? '5h';
        if (windowType === 'month') hasMonthly = true;
        windows.push({
          window: windowType,
          used: Math.round(usedVal * 100) / 100,
          limit: limitVal,
          unit: 'pct',
          pct,
          resetAt: resetMs,
        });
      }

      if (!hasMonthly) {
        const usageLimit = num(root?.usage?.limit);
        const usageUsed = num(root?.usage?.used);
        if (usageLimit !== undefined && usageLimit > 0) {
          const pct = Math.round(((usageUsed ?? 0) / usageLimit) * 100);
          windows.push({
            window: 'month',
            used: Math.round((usageUsed ?? 0) * 100) / 100,
            limit: usageLimit,
            unit: 'pct',
            pct,
            resetAt: parseResetMs(root?.usage),
          });
        }
      }
      if (windows.length === 0) return null;

      return {
        name: 'kimi-for-coding',
        type: 'token-plan',
        plan: 'Kimi Code',
        windows,
      };
    } catch (err) {
      ctx.log.warn('[KimiCodePlugin] fetch failed: ' + (err.message || err));
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

function parseResetMs(detail) {
  for (const key of ['reset_at', 'resetAt', 'reset_time', 'resetTime']) {
    const v = detail?.[key];
    if (typeof v === 'string' && v.trim()) {
      const ms = Date.parse(v);
      if (Number.isFinite(ms)) return ms;
    }
  }
  return undefined;
}
