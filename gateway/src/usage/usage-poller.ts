import { TrajectoryStore } from '../trajectory/trajectory-store';
import { UsageProvider, UsageResponse, UsageWindow, QuotaLimits, Severity, Pacing, WindowType } from './types';
import { ExternalAdapter, DeepSeekAdapter, OpenRouterAdapter } from './external-adapters';

const WINDOW_MS: Record<string, number> = {
  '5h': 5 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  'month': 30 * 24 * 60 * 60 * 1000,
};

export class UsagePoller {
  private lastGood: UsageResponse | null = null;
  private externalAdapters: ExternalAdapter[];

  constructor(
    private store: TrajectoryStore,
    private limits: QuotaLimits,
  ) {
    this.externalAdapters = [
      new DeepSeekAdapter(),
      new OpenRouterAdapter(),
    ];
  }

  async poll(): Promise<UsageResponse> {
    try {
      const providers: UsageProvider[] = [];

      const opencodeGo = this.aggregateProvider('opencode-go', this.limits['opencode-go']);
      if (opencodeGo.windows.length > 0) providers.push(opencodeGo);

      const zen = this.aggregateProvider('zen', this.limits.zen);
      if (zen.windows.length > 0) providers.push(zen);

      const externalResults = await Promise.allSettled(
        this.externalAdapters.map(a => a.fetch()),
      );
      for (const result of externalResults) {
        if (result.status === 'fulfilled' && result.value) {
          providers.push(result.value);
        }
      }

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

        windows.push({
          window: windowType,
          used: Math.round(cost * 100) / 100,
          limit,
          unit: '$',
          resetAt,
          pct,
          pacing,
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

  private calculateSeverity(windows: UsageWindow[]): Severity {
    if (windows.length === 0) return 'low';
    const maxPct = Math.max(...windows.map(w => w.pct));

    if (maxPct >= 90) return 'critical';
    if (maxPct >= 75) return 'high';
    if (maxPct >= 50) return 'mid';
    return 'low';
  }
}
