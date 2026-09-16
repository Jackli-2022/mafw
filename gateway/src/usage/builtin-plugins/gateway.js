// Builtin usage plugin: 蓝区统一网关（providerID: gateway）
// credit 总量 + day/7d/month 窗口。限额由用户手配（usage.pluginConfig.gateway）。
// day/7d/month 优先走网关权威用量（GET {baseURL}/usage/by-model?window=today|week|month，
// BlueRegionUsage 链路，2026-09-16 实测生产可用）：逐日 tokens × /models credit_history
// 当日生效系数（区间语义 [from, 下一条 from)）÷ 1e6，端点失败逐窗口回退本地 trajectory 估算。
// balance（credit 总量）网关无全历史端点（retention 31 天），始终用本地全历史估算。
// /models 价格 5min 缓存。
const DEFAULT_BASE_URL = 'https://st8tp3ajl0df3n8b8l8qu.apigateway-cn-beijing.volceapi.com/v1';
const PRICE_CACHE_MS = 5 * 60 * 1000;
let priceCache = { at: 0, catalog: null };

async function loadCatalog(ctx, baseURL, key) {
  const now = Date.now();
  if (priceCache.catalog && now - priceCache.at < PRICE_CACHE_MS) return priceCache.catalog;
  try {
    const res = await ctx.fetch(baseURL.replace(/\/+$/, '') + '/models', {
      headers: { Authorization: 'Bearer ' + key },
    });
    if (!res.ok) {
      ctx.log.warn('[GatewayPlugin] /models HTTP ' + res.status);
      return priceCache.catalog;
    }
    const data = await res.json();
    const prices = {};
    const hist = {};
    for (const m of (data && data.data) || []) {
      if (!m || !m.id) continue;
      const c = Number(m.credit);
      if (Number.isFinite(c)) prices[m.id] = c;
      if (Array.isArray(m.credit_history)) hist[m.id] = m.credit_history;
    }
    priceCache = { at: now, catalog: { prices, hist } };
    return priceCache.catalog;
  } catch (err) {
    ctx.log.warn('[GatewayPlugin] /models failed: ' + ((err && err.message) || err));
    return priceCache.catalog;
  }
}

// 网关权威用量：by-model 逐日明细。失败/契约不符返回 null（调用方回退本地估算）。
async function fetchGatewayByModel(ctx, baseURL, key, gwWindow) {
  try {
    const res = await ctx.fetch(baseURL.replace(/\/+$/, '') + '/usage/by-model?window=' + gwWindow, {
      headers: { Authorization: 'Bearer ' + key },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rows = (data && data.data) || [];
    if (!Array.isArray(rows)) return null;
    // 契约校验：by-model 行必须含 model + daily 逐日明细（防 /models 形状误入）
    if (rows.some((r) => !r || typeof r.model !== 'string' || !Array.isArray(r.daily))) return null;
    return rows;
  } catch (err) {
    return null;
  }
}

// date 当日生效系数：取 from <= date 的最后一条；date 早于首条时用首条系数
function creditForDate(hist, date) {
  if (!Array.isArray(hist) || hist.length === 0) return null;
  let cur = null;
  let first = null;
  for (const e of hist) {
    if (!e || typeof e.credit !== 'number') continue;
    if (first === null) first = e.credit;
    if (typeof e.from === 'string' && e.from <= date) cur = e.credit;
  }
  return cur !== null ? cur : first;
}

function gatewayCredits(rows, hist, prices) {
  let credits = 0;
  for (const r of rows) {
    const h = hist ? hist[r.model] : null;
    for (const d of r.daily) {
      if (!d) continue;
      const tok = Number(d.total_tokens != null ? d.total_tokens : (Number(d.req_tokens) || 0) + (Number(d.rsp_tokens) || 0));
      if (!Number.isFinite(tok) || tok <= 0) continue;
      // 无 credit_history 的模型回退 /models 当前系数（官方面板同款降级）
      const coef = creditForDate(h, d.date) ?? (prices ? prices[r.model] : null);
      if (coef != null) credits += (tok * coef) / 1e6;
    }
  }
  return credits;
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

// day/week/month 窗口表：gw = 网关权威窗口（UTC+8 日历对齐），localSince = 回退本地估算起点。
// day 本地回退为滚动 24h，week 为滚动 7d，month 为自然月——仅网关端点不可达时生效。
const WINDOWS = [
  { cfg: 'day', label: 'day', gw: 'today', localSince: (now) => now - 24 * 3600e3, resetAt: null },
  { cfg: 'week', label: '7d', gw: 'week', localSince: (now) => now - 7 * 24 * 3600e3, resetAt: null },
  { cfg: 'month', label: 'month', gw: 'month', localSince: () => calendarMonthStart(Date.now()), resetAt: () => calendarMonthEnd(Date.now()) },
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
    const catalog = (await loadCatalog(ctx, baseURL, key)) || { prices: null, hist: {} };
    const prices = catalog.prices;
    const hist = catalog.hist || {};
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
    for (const w of WINDOWS) {
      if (lim[w.cfg] <= 0) continue;
      // 权威路径：网关逐日明细 × credit_history 当日系数；失败逐窗口回退本地估算
      const rows = await fetchGatewayByModel(ctx, baseURL, key, w.gw);
      let used = null;
      if (rows !== null) used = Math.round(gatewayCredits(rows, hist, prices) * 100) / 100;
      if (used === null) {
        const { credits } = creditsInWindow(stats({ provider: 'gateway', sinceMs: w.localSince(Date.now()) }), prices);
        used = Math.round(credits * 100) / 100;
      }
      const win = {
        window: w.label,
        used,
        limit: lim[w.cfg],
        unit: 'credit',
        pct: Math.round((used / lim[w.cfg]) * 10000) / 100,
      };
      if (w.resetAt) win.resetAt = w.resetAt();
      windows.push(win);
    }
    if (windows.length === 0) return null;
    return { name: 'gateway', type: 'token-plan', plan: '蓝区统一网关', windows };
  },
};
