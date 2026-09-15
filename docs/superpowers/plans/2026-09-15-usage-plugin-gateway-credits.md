# Usage 插件 ctx.usage 扩展 + 蓝区统一网关 credit 配额插件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 usage 插件体系加一等通用 `ctx.usage`（本地 trajectory 分模型 token 统计），并新增 builtin `gateway.js` 插件展示蓝区统一网关的 credit/day/7d/month 配额窗口。

**Architecture:** 限额用户手配（`usage.pluginConfig.gateway`），消耗 = 本地 trajectory tokens × per-model credit 价格（`GET {baseURL}/models`，5min 模块级缓存）。插件输出 4 窗口（balance=credit 总量 + day/7d/month 滚动窗），QuotaDock tooltip 支持 `detailLines` 分模型明细。

**Tech Stack:** gateway TS（jest 单测）、builtin usage 插件（CJS JS）、桌面 SolidJS QuotaDock。

**Spec:** `docs/superpowers/specs/2026-09-15-usage-plugin-gateway-credits-design.md`

## Global Constraints

- 插件身份权威 = providerID `gateway`（**不是**中文显示名「蓝区统一网关」）
- 窗口语义为滚动窗口：cutoff = now − 24h/7d/30d；不带 resetAt（modelStats 无 earliest-turn 数据）
- tokens 口径 = input+output+reasoning+cache.read+cache.write
- 价格缺失（models 拉取失败且无缓存）→ 该模型消耗按 0 计 + warn，不阻塞
- 测试命令：`cd gateway && npx jest tests/unit/<file>.test.ts`；全量：`cd gateway && npm test`
- 构建：`npm run build`（root；gateway build 自动拷贝 `src/usage/builtin-plugins` → `dist/usage/builtin-plugins`）

---

### Task 1: ctx.usage 一等通用 API（plugin-context + plugin-loader + index 接线 + README 模板）

**Files:**
- Modify: `gateway/src/usage/plugin-context.ts`
- Modify: `gateway/src/usage/plugin-loader.ts`（options + scan 透传 + README_CONTENT）
- Modify: `gateway/src/index.ts:1911-1919`（构造注入）
- Test: `gateway/tests/unit/usage-plugin-ctx-usage.test.ts`（新建）

**Interfaces:**
- Produces（后续 Task 3 的插件与所有用户插件消费）:
  - `interface UsageStatsQuery { sinceMs?: number; provider?: string }`
  - `interface UsageStatsProvider { modelStats(opts?: UsageStatsQuery): ModelUsageRow[] }`
  - `createUsageStatsProvider(store: Pick<TrajectoryStore, 'getModelUsageStats'>): UsageStatsProvider`
  - `PluginContext.usage: UsageStatsProvider`（恒定存在；缺省注入时 `modelStats()` 返回 `[]`）
  - `createPluginContext(pluginName: string, credentials?: RuntimeCredentials, usageStats?: UsageStatsProvider)`
  - `makeAdapter(mod: any, file: string, usageStats?: UsageStatsProvider)`
  - `PluginLoaderOptions.usageStats?: UsageStatsProvider`

- [ ] **Step 1: Write the failing test**

新建 `gateway/tests/unit/usage-plugin-ctx-usage.test.ts`：

```typescript
import { createUsageStatsProvider, makeAdapter } from '../../src/usage/plugin-context';

const ROWS = [
  { provider: 'gateway', model: 'm1', turns: 2, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } },
  { provider: 'other', model: 'm9', turns: 1, tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
];

describe('ctx.usage (UsageStatsProvider)', () => {
  it('converts sinceMs to epoch seconds and filters by provider', () => {
    const calls: Array<number | null> = [];
    const store = { getModelUsageStats: (since: number | null) => { calls.push(since); return ROWS as any; } };
    const usage = createUsageStatsProvider(store);

    const all = usage.modelStats();
    expect(calls[0]).toBeNull();
    expect(all).toHaveLength(2);

    const filtered = usage.modelStats({ sinceMs: 1_700_000_000_123, provider: 'gateway' });
    expect(calls[1]).toBe(1_700_000_000); // ms → epoch 秒（floor）
    expect(filtered).toHaveLength(1);
    expect(filtered[0].model).toBe('m1');
  });

  it('makeAdapter injects ctx.usage into plugin fetch', async () => {
    const store = { getModelUsageStats: () => ROWS as any };
    const usage = createUsageStatsProvider(store);
    const adapter = makeAdapter(
      { name: 'p1', type: 'api', fetch: async (ctx: any) => ({ name: 'p1', windows: [], rows: ctx.usage.modelStats({ provider: 'gateway' }) }) },
      'p1.js',
      usage,
    );
    const result: any = await adapter.fetch();
    expect(result.rows).toHaveLength(1);
  });

  it('ctx.usage.modelStats returns [] when no usageStats injected (fail-open)', async () => {
    const adapter = makeAdapter(
      { name: 'p2', type: 'api', fetch: async (ctx: any) => ({ name: 'p2', windows: [], rows: ctx.usage.modelStats() }) },
      'p2.js',
    );
    const result: any = await adapter.fetch();
    expect(result.rows).toEqual([]);
  });
});
```

注意：`makeAdapter` 现实现对非标准返回（无 `windows` 数组）会 warn 并返回 null——测试中返回 `windows: []` 保持合法，额外字段 `rows` 透传在 result 上。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/usage-plugin-ctx-usage.test.ts`
Expected: FAIL（`createUsageStatsProvider is not a function` / not exported）

- [ ] **Step 3: Implement plugin-context.ts changes**

在 `gateway/src/usage/plugin-context.ts` 中：

1. 顶部 import 区追加：
```typescript
import type { ModelUsageRow } from '../trajectory/types';
import type { TrajectoryStore } from '../trajectory/trajectory-store';
```

2. `PluginContext` 接口前新增：
```typescript
export interface UsageStatsQuery {
  sinceMs?: number;
  provider?: string;
}

export interface UsageStatsProvider {
  modelStats(opts?: UsageStatsQuery): ModelUsageRow[];
}

const EMPTY_USAGE_STATS: UsageStatsProvider = { modelStats: () => [] };

/** TrajectoryStore → 插件 ctx.usage 薄封装（sinceMs→epoch 秒换算 + provider 过滤）。 */
export function createUsageStatsProvider(store: Pick<TrajectoryStore, 'getModelUsageStats'>): UsageStatsProvider {
  return {
    modelStats(opts?: UsageStatsQuery): ModelUsageRow[] {
      const sinceSec = opts?.sinceMs != null ? Math.floor(opts.sinceMs / 1000) : null;
      const rows = store.getModelUsageStats(sinceSec);
      return opts?.provider ? rows.filter(r => r.provider === opts.provider) : rows;
    },
  };
}
```

3. `PluginContext` 接口加字段：
```typescript
  usage: UsageStatsProvider;
```

4. `createPluginContext` 改为：
```typescript
export function createPluginContext(
  pluginName: string,
  credentials?: RuntimeCredentials,
  usageStats?: UsageStatsProvider,
): PluginContext {
  return {
    apiKey: (name: string) => getProviderApiKey(name, undefined, credentials) ?? null,
    cookie: (name: string) => {
      const c = config.usage?.cookies?.[name];
      return typeof c === 'string' && c.trim() ? c.trim() : null;
    },
    fetch: (url: string, opts?: RequestInit) =>
      fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(10_000) }),
    pluginConfig: (name: string) => config.usage?.pluginConfig?.[name] ?? null,
    log,
    usage: usageStats ?? EMPTY_USAGE_STATS,
  };
}
```

5. `makeAdapter` 签名与 ctx 构造改为：
```typescript
export function makeAdapter(mod: any, file: string, usageStats?: UsageStatsProvider): ExternalAdapter {
  return {
    name: mod.name,
    type: mod.type === 'token-plan' ? 'token-plan' : 'api',
    async fetch(): Promise<UsageProvider | null> {
      const ctx = createPluginContext(mod.name, undefined, usageStats);
      // ...其余不变
```

- [ ] **Step 4: plugin-loader.ts 透传 + README 模板更新**

`gateway/src/usage/plugin-loader.ts`：

1. import 改为 `import { makeAdapter, UsageStatsProvider } from './plugin-context';`
2. `PluginLoaderOptions` 加 `usageStats?: UsageStatsProvider;`
3. 类加字段与构造赋值：
```typescript
  private usageStats?: UsageStatsProvider;
  // constructor 内：
  this.usageStats = opts?.usageStats;
```
4. `scan()` 内 `makeAdapter(entry.mod, entry.file)` 改为 `makeAdapter(entry.mod, entry.file, this.usageStats);`
5. `README_CONTENT` 的 ctx methods 清单（`- \`ctx.pluginConfig(name)\`...` 行后）追加一行：
```
- \`ctx.usage.modelStats({ sinceMs?, provider? })\` — local trajectory per-model token stats
  (rolling window; filter by providerID; returns [])
```

- [ ] **Step 5: index.ts 接线**

`gateway/src/index.ts` 第 1911-1915 行区域，改为：
```typescript
      const { PluginLoader } = require('./usage/plugin-loader');
      const { createUsageStatsProvider } = require('./usage/plugin-context');
      const pluginsDir = path.join(os.homedir(), '.mafw', 'usage-plugins');
      const builtinPluginsDir = path.join(__dirname, 'usage', 'builtin-plugins');
      const disabledPlugins = Array.isArray(config.usage?.disabledPlugins) ? config.usage.disabledPlugins : [];
      const pluginLoader = new PluginLoader(pluginsDir, [], { builtinPluginsDir, disabledPlugins, usageStats: createUsageStatsProvider(trajStore) });
```
（`trajStore` 在该作用域已存在——第 1919 行 UsagePoller 构造同一变量。）

- [ ] **Step 6: Run tests**

Run: `cd gateway && npx jest tests/unit/usage-plugin-ctx-usage.test.ts tests/unit/usage-plugin-schema.test.ts tests/unit/usage-plugin-disabled.test.ts tests/unit/usage-plugin-builtin-discovery.test.ts`
Expected: 全 PASS（含既有插件测试无回归）

- [ ] **Step 7: Commit**

```bash
git add gateway/src/usage/plugin-context.ts gateway/src/usage/plugin-loader.ts gateway/src/index.ts gateway/tests/unit/usage-plugin-ctx-usage.test.ts
git commit -m "feat(usage): first-class ctx.usage modelStats API for usage plugins"
```

---

### Task 2: usage-poller budget 折叠守卫

**Files:**
- Modify: `gateway/src/usage/usage-poller.ts:97-119`
- Test: `gateway/tests/unit/usage-poller-budget-guard.test.ts`（新建）

**Interfaces:**
- Consumes: 现有 `UsagePoller(store, limitsGetter, budgetsGetter, pluginLoader)` 签名不变
- Produces: 行为契约——插件结果含非 `balance` 窗口时 budget 折叠跳过（warn 日志），窗口原样透传

- [ ] **Step 1: Write the failing test**

新建 `gateway/tests/unit/usage-poller-budget-guard.test.ts`：

```typescript
import { UsagePoller } from '../../src/usage/usage-poller';

const fakeStore = {
  getDistinctProviders: () => [] as string[],
  getProviderTotalCost: () => 0,
  getProviderTotalTokens: () => ({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }),
} as any;

function makePoller(adapterWindows: any[], budgets: Record<string, number>) {
  const loader = {
    getAdapters: () => [{
      name: 'gateway',
      type: 'token-plan',
      fetch: async () => ({ name: 'gateway', type: 'token-plan', plan: '蓝区统一网关', windows: adapterWindows, severity: 'low' }),
    }],
  } as any;
  return new UsagePoller(fakeStore, () => ({} as any), () => budgets, loader);
}

describe('UsagePoller budget collapse guard', () => {
  it('collapses to budget window when plugin result is all-balance (existing behavior)', async () => {
    const poller = makePoller(
      [{ window: 'balance', used: 12, limit: 1000, unit: 'credit', pct: 1, remaining: 988 }],
      { gateway: 100 },
    );
    const res = await poller.poll();
    const p = res.providers.find(x => x.name === 'gateway')!;
    expect(p.plan).toBe('budget');
    expect(p.windows).toHaveLength(1);
    expect(p.windows[0].limit).toBe(100);
    expect(p.windows[0].window).toBe('balance');
  });

  it('passes windows through when plugin result has non-balance windows, even with budget configured', async () => {
    const poller = makePoller(
      [
        { window: 'balance', used: 2, limit: 1000, unit: 'credit', pct: 0 },
        { window: 'day', used: 1, limit: 50, unit: 'credit', pct: 2 },
        { window: '7d', used: 1, limit: 200, unit: 'credit', pct: 1 },
      ],
      { gateway: 100 },
    );
    const res = await poller.poll();
    const p = res.providers.find(x => x.name === 'gateway')!;
    expect(p.plan).toBe('蓝区统一网关'); // 未被折叠成 'budget'
    expect(p.windows.map((w: any) => w.window)).toEqual(['balance', 'day', '7d']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/usage-poller-budget-guard.test.ts`
Expected: 第二个用例 FAIL（现状含 day 窗口也会被折叠成单 budget 窗口）

- [ ] **Step 3: Implement guard**

`gateway/src/usage/usage-poller.ts`：

1. 顶部 import 追加 `import { log } from '../core/utils/logger';`
2. 第 97 行 `if (budget && budget > 0) {` 改为：
```typescript
          const name = result.value.name;
          const budget = this.budgets[name];
          // Budget 折叠只适用于纯 balance 插件；含 day/7d/month 等窗口的插件
          // 折叠会静默吞掉窗口，故跳过并 warn。
          const allBalance = result.value.windows.every(w => w.window === 'balance');
          if (budget && budget > 0 && allBalance) {
```
3. `else` 分支（原 121-129 行）开头加：
```typescript
          } else {
            if (budget && budget > 0 && !allBalance) {
              log.warn(`[UsagePoller] budgets.${name} configured but plugin has non-balance windows; skipping budget collapse`);
            }
```
（else 内其余逻辑不变。）

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/usage-poller-budget-guard.test.ts tests/unit/usage-model-stats.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/usage/usage-poller.ts gateway/tests/unit/usage-poller-budget-guard.test.ts
git commit -m "fix(usage): skip budget collapse when plugin reports non-balance windows"
```

---

### Task 3: types 扩展 + builtin gateway.js 插件

**Files:**
- Modify: `gateway/src/usage/types.ts:1,6-18`
- Create: `gateway/src/usage/builtin-plugins/gateway.js`
- Test: `gateway/tests/unit/usage-plugin-gateway.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的 `ctx.usage.modelStats({ sinceMs?, provider? })` → `ModelUsageRow[]`（`{ provider, model, turns, tokens: { input, output, reasoning, cache: { read, write } } }`）
- Produces: 插件 `name: 'gateway'`，返回 `{ name, type: 'token-plan', plan: '蓝区统一网关', windows: UsageWindow[] }`；窗口 `unit: 'credit'`，balance 窗口带 `detailLines: string[]`

- [ ] **Step 1: types.ts 扩展**

`gateway/src/usage/types.ts`：
- 第 1 行：`export type WindowType = '5h' | 'day' | '7d' | 'month' | 'balance';`
- 第 9 行：`unit: '$' | 'tokens' | 'requests' | 'pct' | 'credit';`
- `UsageWindow` 接口加字段（`projectedCost?` 行后）：
```typescript
  /** 附加明细行（如分模型消耗），UI tooltip 逐行展示。 */
  detailLines?: string[];
```

- [ ] **Step 2: Write the failing test**

新建 `gateway/tests/unit/usage-plugin-gateway.test.ts`：

```typescript
describe('builtin usage plugin: gateway (蓝区统一网关)', () => {
  const MODELS_PAYLOAD = {
    data: [
      { id: 'm1', credit: 1.0 },
      { id: 'm2', credit: 0.5 },
    ],
  };
  // m1: 1.0M tok × 1.0 = 1.0 credit（全部时间）；m2: 1.0M tok × 0.5 = 0.5 credit（最近 1h）
  const ALL_ROWS = [
    { provider: 'gateway', model: 'm1', turns: 2, tokens: { input: 500000, output: 500000, reasoning: 0, cache: { read: 0, write: 0 } } },
    { provider: 'gateway', model: 'm2', turns: 1, tokens: { input: 1000000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
    { provider: 'other', model: 'm9', turns: 9, tokens: { input: 9000000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } },
  ];
  const RECENT_ROWS = [ALL_ROWS[1]];

  function mkCtx(over: Record<string, any> = {}) {
    return {
      apiKey: (name: string) => (name === 'gateway' ? 'k' : null),
      fetch: over.fetch ?? (async () => ({ ok: true, json: async () => MODELS_PAYLOAD })),
      pluginConfig: (name: string) => (name === 'gateway' ? { credit: 1000, day: 50, week: 200, month: 500 } : null),
      usage: {
        modelStats: (opts?: { sinceMs?: number; provider?: string }) => {
          const rows = opts?.sinceMs != null ? RECENT_ROWS : ALL_ROWS;
          return opts?.provider ? rows.filter(r => r.provider === opts.provider) : rows;
        },
      },
      log: { warn: () => {}, info: () => {}, error: () => {} },
      ...over,
    };
  }

  function loadPlugin() {
    jest.resetModules(); // 清模块级价格缓存，保证用例独立
    return require('../../src/usage/builtin-plugins/gateway.js');
  }

  it('returns null without api key', async () => {
    const plugin = loadPlugin();
    expect(await plugin.fetch(mkCtx({ apiKey: () => null }))).toBeNull();
  });

  it('returns null when no limits configured', async () => {
    const plugin = loadPlugin();
    expect(await plugin.fetch(mkCtx({ pluginConfig: () => null }))).toBeNull();
  });

  it('computes 4 windows from local stats × per-model credit prices', async () => {
    const plugin = loadPlugin();
    const res = await plugin.fetch(mkCtx());
    expect(res.name).toBe('gateway');
    expect(res.type).toBe('token-plan');
    const byWin = Object.fromEntries(res.windows.map((w: any) => [w.window, w]));

    // balance: 全历史 1.5 / 1000
    expect(byWin.balance.used).toBe(1.5);
    expect(byWin.balance.limit).toBe(1000);
    expect(byWin.balance.unit).toBe('credit');
    expect(byWin.balance.remaining).toBe(998.5);
    expect(byWin.balance.detailLines[0]).toContain('m1');
    expect(byWin.balance.detailLines[0]).toContain('1.0 credits');
    expect(byWin.balance.detailLines[1]).toContain('m2');

    // day/7d/month: 最近窗口仅 m2 → 0.5 credit
    expect(byWin.day.used).toBe(0.5);
    expect(byWin.day.limit).toBe(50);
    expect(byWin.day.pct).toBe(1);
    expect(byWin['7d'].used).toBe(0.5);
    expect(byWin.month.used).toBe(0.5);
    // 无 resetAt（滚动窗 + modelStats 无 earliest 数据）
    expect(byWin.day.resetAt).toBeUndefined();
  });

  it('degrades to zero credits when /models fetch fails and no cache', async () => {
    const plugin = loadPlugin();
    const res = await plugin.fetch(mkCtx({ fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) }));
    const byWin = Object.fromEntries(res.windows.map((w: any) => [w.window, w]));
    expect(byWin.balance.used).toBe(0);
    expect(byWin.day.used).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/usage-plugin-gateway.test.ts`
Expected: FAIL（`Cannot find module '../../src/usage/builtin-plugins/gateway.js'`）

- [ ] **Step 4: Implement gateway.js**

新建 `gateway/src/usage/builtin-plugins/gateway.js`：

```javascript
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
    ctx.log.warn('[GatewayPlugin] /models failed: ' + (err && err.message || err));
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
  ['month', 'month', 30 * 24 * 3600e3],
];

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
        pct: Math.round((used / lim.credit) * 100),
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
        pct: Math.round((used / lim[cfgKey]) * 100),
      });
    }
    if (windows.length === 0) return null;
    return { name: 'gateway', type: 'token-plan', plan: '蓝区统一网关', windows };
  },
};
```

- [ ] **Step 5: Run tests**

Run: `cd gateway && npx jest tests/unit/usage-plugin-gateway.test.ts tests/unit/usage-plugin-builtin-discovery.test.ts`
Expected: PASS（discovery 测试顺带覆盖新 builtin 可加载）

- [ ] **Step 6: Commit**

```bash
git add gateway/src/usage/types.ts gateway/src/usage/builtin-plugins/gateway.js gateway/tests/unit/usage-plugin-gateway.test.ts
git commit -m "feat(usage): builtin gateway plugin — credit quota windows from local trajectory × /v1/models prices"
```

---

### Task 4: QuotaDock tooltip detailLines + credit 单位展示

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/QuotaDock.tsx:74-101`

**Interfaces:**
- Consumes: Task 3 插件输出的 `w.detailLines: string[]`、`w.unit: 'credit'`
- Produces: tooltip 首行基础信息 + 明细逐行（`white-space: pre-line`）

- [ ] **Step 1: 修改 tooltip 组装**

`QuotaDock.tsx` 第 75-84 行 `tooltip` 函数改为：

```tsx
              const tooltip = () => {
                const parts = [
                  w.unit === '$' ? `已用 $${w.used} / $${w.limit}` : w.unit === 'pct' ? `已用 ${w.pct}%` : w.unit === 'credit' ? `已用 ${w.used} / ${w.limit} credits` : `已用 ${w.used} / ${w.limit}`,
                ]
                if (w.tokens) parts.push(`${fmt(w.tokens)} tokens`)
                if (w.remaining !== undefined) parts.push(w.unit === 'credit' ? `剩余 ${w.remaining} credits` : `剩余 $${w.remaining}`)
                if (w.resetAt) parts.push(`重置 ${fmtTime(w.resetAt - Date.now())}`)
                if (w.projected !== undefined && w.projected > w.pct) parts.push(`预计 ${w.projected}%`)
                const base = parts.join(' · ')
                return Array.isArray(w.detailLines) && w.detailLines.length > 0
                  ? base + '\n' + w.detailLines.join('\n')
                  : base
              }
```

第 86 行 `<TooltipV2 value={tooltip()} openDelay={300}>` 改为：

```tsx
                <TooltipV2 value={tooltip()} contentStyle={{ "white-space": "pre-line" }} openDelay={300}>
```

- [ ] **Step 2: 构建验证**

Run: `cd packages/desktop && npx electron-vite build`
Expected: 三段构建成功无错误（desktop 无 test script，构建即验证；QuotaDock 带 `@ts-nocheck`，主要验证 import/JSX 语法）

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/mafw/components/QuotaDock.tsx
git commit -m "feat(desktop): QuotaDock tooltip supports detailLines + credit unit"
```

---

### Task 5: 文档收尾 + 全量验证

**Files:**
- Modify: `AGENTS.md`（§8.3 插件接口 + §8.2 插件表）

- [ ] **Step 1: AGENTS.md 更新**

§8.2 表格 `api` 行后/表格末追加内置插件说明（表格第三列后无表格则加一行说明文字）：

在 §8.3 插件接口的 `ctx` 方法注释块中 `// ctx.pluginConfig(name) - 读取 config.usage.pluginConfig[name]` 行后追加：
```javascript
    // ctx.usage.modelStats({ sinceMs?, provider? }) - 本地 trajectory 分模型 token 统计（滚动窗；缺省返回 []）
```

§8.2 表格后追加一段：
```markdown
**内置插件 `gateway`（蓝区统一网关）**：credit 总量 + day/7d/month 滚动窗口；限额经 Config 页插件参数表单手配（`usage.pluginConfig.gateway: { credit, day, week, month, baseURL? }`），消耗 = 本地 trajectory tokens × `GET {baseURL}/models` 的 per-model credit 价格（5min 缓存）。注意：`usage.budgets.gateway > 0` 仅在插件结果为纯 balance 窗口时才折叠（含 day/7d/month 窗口时跳过并 warn）。
```

- [ ] **Step 2: 全量测试 + 构建**

Run: `cd gateway && npm test`
Expected: 全量 PASS（记录新增/总数）

Run: `npm run build`（root）
Expected: 成功；Run: `Test-Path gateway/dist/usage/builtin-plugins/gateway.js` → True（gateway build 的拷贝步骤把 src/usage/builtin-plugins 复制到 gateway/dist/usage/builtin-plugins）

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: usage plugin ctx.usage API + gateway credits plugin"
```

- [ ] **Step 4: 汇报**

按用户偏好汇报：新增测试数、全量通过数、版本号/commit 哈希列表。gateway 改动需走 `mafw-gateway-restart` skill 流程重启生效（desktop 改动需重新构建桌面端才生效）。

---

## Self-Review 记录

- Spec 覆盖：ctx.usage 通用 API（T1）、gateway.js 四窗口 + detailLines + configSchema（T3）、WindowType/unit/detailLines 类型（T3）、poller 守卫（T2）、QuotaDock tooltip（T4）、README/AGENTS.md（T1/T5）、测试（每任务内）✅
- resetAt：spec 原文为"窗口内最早 turn + 窗口时长"，但 modelStats 无 earliest 数据——计划修正为**不带 resetAt**，与 spec 的偏差已在 T3 测试断言中固化
- 类型一致性：`createUsageStatsProvider`/`UsageStatsProvider`/`modelStats({sinceMs, provider})` 在 T1/T3/测试中一致；`detailLines` 在 types/插件/QuotaDock 三处一致
