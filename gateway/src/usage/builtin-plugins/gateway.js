// Builtin usage plugin: 蓝区统一网关（providerID: gateway）
// credit 总量 + day/7d/month 滚动窗口。限额由用户手配（usage.pluginConfig.gateway），
// 消耗 = 本地 trajectory tokens × per-model credit 价格（GET {baseURL}/models，5min 缓存）。
const DEFAULT_BASE_URL = 'https://st8tp3ajl0df3n8b8l8qu.apigateway-cn-beijing.volceapi.com/v1';
const PRICE_CACHE_MS = 5 * 60 * 1000;
let priceCache = { at: 0, prices: null };

async function loadPrices(ctx, baseURL, key) {
  const now = Date.now();
  if (priceCache.prices && now - priceCache.at < PRICE_CACHE_MS) return priceCache.prices;
  try {
    const res = await ctx.fetch(baseURL.replace(/\/+$/, '') + '/models', {
      headers: { Authorization: 'Bearer ' + key },
    });
    if (!res.ok) {
      ctx.log.warn('[GatewayPlugin] /models HTTP ' + res.status);
      return priceCache.prices;
    }
    const data = await res.json();
    const prices = {};
    for (const m of (data && data.data) || []) {
      const c = Number(m && m.credit);
      if (m && m.id && Number.isFinite(c)) prices[m.id] = c;
    }
    priceCache = { at: now, prices };
    return prices;
  } catch (err) {
    ctx.log.warn('[GatewayPlugin] /models failed: ' + ((err && err.message) || err));
    return priceCache.prices;
  }
}

function rowTokens(r) {
  const t = (r && r.tokens) || {};
  const cache = t.cache || {};
  return (t.input || 0) + (t.output || 0) + (t.reasoning || 0) + (cache.read || 0) + (cache.write || 0);
}

function fmtTok(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

function creditsInWindow(rows, prices) {
  let credits = 0;
  const perModel = [];
  for (const r of rows) {
    const tok = rowTokens(r);
    const price = prices ? (prices[r.model] || 0) : 0;
    const c = (tok * price) / 1e6;
    credits += c;
    if (tok > 0) perModel.push({ model: r.model, tokens: tok, credits: c });
  }
  perModel.sort((a, b) => b.credits - a.credits);
  return { credits, perModel };
}

const ROLLING_WINDOWS = [
  ['day', 'day', 24 * 3600e3],
  ['week', '7d', 7 * 24 * 3600e3],
];

// 月度刷新 = 自然月（每月 1 号 00:00 本地时区重置），非滚动 30 天。
function calendarMonthStart(now) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function calendarMonthEnd(now) {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

module.exports = {
  name: 'gateway',
  type: 'token-plan',
  plan: '蓝区统一网关',
  configSchema: [
    { key: 'credit', label: 'credit 总额度', type: 'number' },
    { key: 'day', label: '每日上限（credit）', type: 'number' },
    { key: 'week', label: '每周上限（credit）', type: 'number' },
    { key: 'month', label: '每月上限（credit）', type: 'number' },
    { key: 'baseURL', label: '网关 baseURL（留空用默认）', type: 'string' },
  ],
  async fetch(ctx) {
    const key = ctx.apiKey('gateway');
    if (!key) return null;
    const cfg = ctx.pluginConfig('gateway') || {};
    const lim = {
      credit: Number(cfg.credit) || 0,
      day: Number(cfg.day) || 0,
      week: Number(cfg.week) || 0,
      month: Number(cfg.month) || 0,
    };
    if (lim.credit <= 0 && lim.day <= 0 && lim.week <= 0 && lim.month <= 0) return null;
    const baseURL = typeof cfg.baseURL === 'string' && cfg.baseURL.trim() ? cfg.baseURL.trim() : DEFAULT_BASE_URL;
    const prices = await loadPrices(ctx, baseURL, key);
    const stats = (opts) => (ctx.usage && ctx.usage.modelStats ? ctx.usage.modelStats(opts) : []);

    const windows = [];
    if (lim.credit > 0) {
      const all = creditsInWindow(stats({ provider: 'gateway' }), prices);
      const used = Math.round(all.credits * 100) / 100;
      const detailLines = all.perModel.slice(0, 5).map((m) => m.model + ': ' + fmtTok(m.tokens) + ' tok · ' + m.credits.toFixed(1) + ' credits');
      const rest = all.perModel.slice(5);
      if (rest.length > 0) {
        const rt = rest.reduce((s, m) => s + m.tokens, 0);
        const rc = rest.reduce((s, m) => s + m.credits, 0);
        detailLines.push('其他 ' + rest.length + ' 模型: ' + fmtTok(rt) + ' tok · ' + rc.toFixed(1) + ' credits');
      }
      windows.push({
        window: 'balance',
        used,
        limit: lim.credit,
        unit: 'credit',
        pct: Math.round((used / lim.credit) * 10000) / 100,
        remaining: Math.max(0, Math.round((lim.credit - used) * 100) / 100),
        detailLines,
      });
    }
    for (const [cfgKey, win, ms] of ROLLING_WINDOWS) {
      if (lim[cfgKey] <= 0) continue;
      const { credits } = creditsInWindow(stats({ provider: 'gateway', sinceMs: Date.now() - ms }), prices);
      const used = Math.round(credits * 100) / 100;
      windows.push({
        window: win,
        used,
        limit: lim[cfgKey],
        unit: 'credit',
        pct: Math.round((used / lim[cfgKey]) * 10000) / 100,
      });
    }
    if (lim.month > 0) {
      const { credits } = creditsInWindow(stats({ provider: 'gateway', sinceMs: calendarMonthStart(Date.now()) }), prices);
      const used = Math.round(credits * 100) / 100;
      windows.push({
        window: 'month',
        used,
        limit: lim.month,
        unit: 'credit',
        pct: Math.round((used / lim.month) * 10000) / 100,
        resetAt: calendarMonthEnd(Date.now()),
      });
    }
    if (windows.length === 0) return null;
    return { name: 'gateway', type: 'token-plan', plan: '蓝区统一网关', windows };
  },
};
