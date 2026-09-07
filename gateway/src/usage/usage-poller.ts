import { TrajectoryStore } from '../trajectory/trajectory-store';
import { UsageProvider, UsageResponse, UsageWindow, QuotaLimits, Severity, Pacing, WindowType } from './types';
import { PluginLoader } from './plugin-loader';

const WINDOW_MS: Record<string, number> = {
  '5h': 5 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  'month': 30 * 24 * 60 * 60 * 1000,
};

export class UsagePoller {
  private lastGood: UsageResponse | null = null;
  private pluginLoader?: PluginLoader;

  constructor(
    private store: TrajectoryStore,
    private limitsGetter: () => QuotaLimits,
    private budgetsGetter: () => Record<string, number> = () => ({}),
    pluginLoader?: PluginLoader,
  ) {
    this.pluginLoader = pluginLoader;
  }

  private get limits(): QuotaLimits { return this.limitsGetter(); }
  private get budgets(): Record<string, number> { return this.budgetsGetter(); }

  async poll(): Promise<UsageResponse> {
    try {
      const providers: UsageProvider[] = [];
      const seen = new Set<string>();

      const configuredProviders = Object.keys(this.limits) as Array<keyof typeof this.limits>;
      for (const name of configuredProviders) {
        const p = this.aggregateProvider(name, this.limits[name] as Record<string, number>);
        if (p.windows.length > 0) {
          providers.push(p);
          seen.add(name);
        }
      }

      const dbProviders = this.store.getDistinctProviders();
      const providerMap = new Map<string, UsageProvider>();
      for (const name of dbProviders) {
        if (seen.has(name)) continue;
        const totalCost = this.store.getProviderTotalCost(name);
        const totalTokens = this.store.getProviderTotalTokens(name);
        const tokenTotal = totalTokens.input + totalTokens.output + totalTokens.reasoning + totalTokens.cache.read + totalTokens.cache.write;
        if (totalCost <= 0 && tokenTotal <= 0) continue;
        const budget = this.budgets[name];
        const used = Math.round(totalCost * 100) / 100;
        if (budget && budget > 0) {
          const pct = Math.round((used / budget) * 100);
          providerMap.set(name, {
            name,
            type: 'api',
            plan: 'budget',
            windows: [{
              window: 'balance',
              used,
              limit: budget,
              unit: '$',
              pct,
              tokens: tokenTotal,
            }],
            severity: pct >= 90 ? 'critical' : pct >= 75 ? 'high' : pct >= 50 ? 'mid' : 'low',
          });
        } else {
          providerMap.set(name, {
            name,
            type: 'api',
            windows: [{
              window: 'balance',
              used,
              limit: 0,
              unit: '$',
              pct: 0,
              tokens: tokenTotal,
              projectedCost: used,
            }],
            severity: 'low',
          });
        }
      }

      const pluginAdapters = this.pluginLoader?.getAdapters() ?? [];
      const allExternal = pluginAdapters;

      const externalResults = await Promise.allSettled(
        allExternal.map(a => a.fetch()),
      );
      for (const result of externalResults) {
        if (result.status === 'fulfilled' && result.value) {
          const name = result.value.name;
          const budget = this.budgets[name];
          // If a budget is configured for this provider, use it as the limit
          // (remaining from the balance API gives us used = budget - remaining).
          if (budget && budget > 0) {
            const balWindow = result.value.windows.find(w => w.window === 'balance');
            const remaining = balWindow?.remaining;
            const used = remaining !== undefined
              ? Math.max(0, budget - remaining)
              : this.store.getProviderTotalCost(name);
            const tokens = this.store.getProviderTotalTokens(name);
            const tokenTotal = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
            const pct = Math.round((used / budget) * 100);
            providerMap.set(name, {
              ...result.value,
              plan: 'budget',
              windows: [{
                window: 'balance',
                used: Math.round(used * 100) / 100,
                limit: budget,
                unit: '$',
                pct,
                tokens: tokenTotal,
                remaining: remaining !== undefined ? Math.round(remaining * 100) / 100 : undefined,
              }],
              severity: pct >= 90 ? 'critical' : pct >= 75 ? 'high' : pct >= 50 ? 'mid' : 'low',
            });
          } else {
            const tokens = this.store.getProviderTotalTokens(name);
            const tokenTotal = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
            const windows = result.value.windows.map(w =>
              w.limit === 0
                ? { ...w, tokens: tokenTotal, projectedCost: w.used }
                : w,
            );
            providerMap.set(result.value.name, { ...result.value, windows });
          }
        }
      }

      providers.push(...providerMap.values());

      const result: UsageResponse = { providers, updatedAt: Date.now() };
      this.lastGood = result;
      return result;
    } catch {
      if (this.lastGood) return this.lastGood;
      return { providers: [], updatedAt: Date.now() };
    }
  }

  private aggregateProvider(name: string, limits: Record<string, number>): UsageProvider {
    const now = Date.now();
    const windows: UsageWindow[] = [];

    for (const [windowKey, limit] of Object.entries(limits)) {
      if (windowKey === 'balance') {
        const totalCost = this.store.getProviderTotalCost(name);
        if (totalCost > 0) {
          const pct = Math.round((totalCost / limit) * 100);
          windows.push({
            window: 'balance',
            used: Math.round(totalCost * 100) / 100,
            limit,
            unit: '$',
            pct,
          });
        }
        continue;
      }

      const windowType = windowKey as WindowType;
      const windowMs = WINDOW_MS[windowType];
      if (!windowMs) continue;

      const cutoff = now - windowMs;
      const cost = this.store.getProviderCostInWindow(name, cutoff);

      if (cost > 0) {
        const pct = Math.round((cost / limit) * 100);
        const earliest = this.store.getProviderEarliestTurnInWindow(name, cutoff);
        const resetAt = earliest ? earliest + windowMs : now + windowMs;
        const pacing = this.calculatePacing(pct, cutoff, now, windowMs);
        const projected = this.calculateProjected(pct, cutoff, now, windowMs);

        windows.push({
          window: windowType,
          used: Math.round(cost * 100) / 100,
          limit,
          unit: '$',
          resetAt,
          pct,
          pacing,
          projected,
        });
      }
    }

    const severity = this.calculateSeverity(windows);
    return { name, windows, severity };
  }

  private calculatePacing(pctUsed: number, cutoff: number, now: number, windowMs: number): Pacing {
    const elapsed = now - cutoff;
    const pctElapsed = Math.round((elapsed / windowMs) * 100);
    const diff = pctUsed - pctElapsed;

    if (diff > 10) return 'ahead';
    if (diff < -10) return 'under';
    return 'on-track';
  }

  private calculateProjected(pctUsed: number, cutoff: number, now: number, windowMs: number): number {
    const elapsed = now - cutoff;
    if (elapsed <= 0) return pctUsed;
    const rate = pctUsed / elapsed;
    const projected = Math.round(rate * windowMs);
    return Math.min(projected, 999);
  }

  private calculateSeverity(windows: UsageWindow[]): Severity {
    if (windows.length === 0) return 'low';
    const maxPct = Math.max(...windows.map(w => w.pct));

    if (maxPct >= 90) return 'critical';
    if (maxPct >= 75) return 'high';
    if (maxPct >= 50) return 'mid';
    return 'low';
  }
}
