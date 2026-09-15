import { config } from '../config';
import { log } from '../core/utils/logger';
import { getProviderApiKey } from '../runtime/auth';
import { ExternalAdapter } from './types';
import { UsageProvider, Severity } from './types';
import type { RuntimeCredentials } from '../runtime/contract';
import type { ModelUsageRow } from '../trajectory/types';
import type { TrajectoryStore } from '../trajectory/trajectory-store';

export interface UsageStatsQuery {
  sinceMs?: number;
  provider?: string;
}

export interface UsageStatsProvider {
  modelStats(opts?: UsageStatsQuery): ModelUsageRow[];
}

const EMPTY_USAGE_STATS: UsageStatsProvider = { modelStats: () => [] };

/** TrajectoryStore → 插件 ctx.usage 薄封装（sinceMs→epoch 秒换算 + provider 过滤）。 */
export function createUsageStatsProvider(
  store: Pick<TrajectoryStore, 'getModelUsageStats'>,
): UsageStatsProvider {
  return {
    modelStats(opts?: UsageStatsQuery): ModelUsageRow[] {
      const sinceSec = opts?.sinceMs != null ? Math.floor(opts.sinceMs / 1000) : null;
      const rows = store.getModelUsageStats(sinceSec);
      return opts?.provider ? rows.filter(r => r.provider === opts.provider) : rows;
    },
  };
}

export interface PluginContext {
  apiKey: (name: string) => string | null;
  cookie: (name: string) => string | null;
  fetch: (url: string, opts?: RequestInit) => Promise<Response>;
  pluginConfig: (name: string) => any;
  log: typeof log;
  usage: UsageStatsProvider;
}

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

function severityFromPct(pct: number): Severity {
  if (pct >= 90) return 'critical';
  if (pct >= 75) return 'high';
  if (pct >= 50) return 'mid';
  return 'low';
}

export function makeAdapter(mod: any, file: string, usageStats?: UsageStatsProvider): ExternalAdapter {
  return {
    name: mod.name,
    type: mod.type === 'token-plan' ? 'token-plan' : 'api',
    async fetch(): Promise<UsageProvider | null> {
      const ctx = createPluginContext(mod.name, undefined, usageStats);
      try {
        const result = await mod.fetch(ctx);
        if (result === null) return null;
        if (!result.name || !Array.isArray(result.windows)) {
          log.warn(`[PluginLoader] ${file}: invalid return structure`);
          return null;
        }
        const maxPct = result.windows.length > 0 ? Math.max(...result.windows.map((w: any) => w.pct ?? 0)) : 0;
        return {
          ...result,
          type: result.type ?? (mod.type === 'token-plan' ? 'token-plan' : 'api'),
          severity: result.severity ?? severityFromPct(maxPct),
        };
      } catch (err: any) {
        log.warn(`[PluginLoader] ${file} fetch error: ${err.message}`);
        return null;
      }
    },
  };
}
