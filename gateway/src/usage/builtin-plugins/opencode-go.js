// Builtin usage plugin: OpenCode Go (token-plan type — 5h / 7d / month windows)
module.exports = {
  name: 'opencode-go',
  type: 'token-plan',
  plan: 'Go',
  async fetch(ctx) {
    const key = ctx.apiKey('opencode-go') || ctx.apiKey('opencode');
    if (!key) return null;
    try {
      const res = await ctx.fetch('https://opencode.ai/zen/go/v1/usage', {
        headers: { 'Authorization': `Bearer ${key}`, 'Accept': 'application/json' },
      });
      if (!res.ok) {
        ctx.log.warn('[OpencodeGoPlugin] HTTP ' + res.status);
        return null;
      }
      const data = await res.json();
      const usage = data?.usage;
      if (!usage) return null;

      const windows = [];
      const order = [
        { key: 'rolling', label: '5h' },
        { key: 'weekly', label: '7d' },
        { key: 'monthly', label: 'month' },
      ];
      for (const { key, label } of order) {
        const w = usage[key];
        if (!w || w.status !== 'ok') continue;
        const pct = Math.round(w.percent ?? 0);
        const resetAt = w.resetsAt ? Date.parse(w.resetsAt) : undefined;
        windows.push({
          window: label,
          used: pct,
          limit: 100,
          unit: 'pct',
          pct,
          resetAt: Number.isFinite(resetAt) ? resetAt : undefined,
        });
      }
      if (windows.length === 0) return null;

      return {
        name: 'opencode-go',
        type: 'token-plan',
        plan: 'Go',
        windows,
      };
    } catch (err) {
      ctx.log.warn('[OpencodeGoPlugin] fetch failed: ' + (err.message || err));
      return null;
    }
  },
};
