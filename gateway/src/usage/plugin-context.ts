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
  inlineApiKey?: string,
): PluginContext {
  return {
    apiKey: (name: string) =>
      getProviderApiKey(name, undefined, credentials)
      ?? (inlineApiKey != null && name === pluginName ? inlineApiKey : null),
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

/** 字段级 windows 校验（插件作者可定位：windows[i].<key> must be <type> (got <got>)）。 */
function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function validateWindowsShape(windows: any[]): string | null {
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const at = `windows[${i}]`;
    if (!w || typeof w !== 'object' || Array.isArray(w)) {
      return `${at} must be an object (got ${typeName(w)})`;
    }
    if (typeof w.window !== 'string') return `${at}.window must be string (got ${typeName(w.window)})`;
    for (const key of ['used', 'limit'] as const) {
      if (typeof w[key] !== 'number') return `${at}.${key} must be number (got ${typeName(w[key])})`;
    }
    for (const key of ['pct', 'unit', 'label'] as const) {
      if (w[key] === undefined) continue;
      const expected = key === 'pct' ? 'number' : 'string';
      if (typeof w[key] !== expected) return `${at}.${key} must be ${expected} (got ${typeName(w[key])})`;
    }
  }
  return null;
}

export function makeAdapter(
  mod: any,
  file: string,
  usageStats?: UsageStatsProvider,
  resolveInlineApiKey?: (providerID: string) => Promise<string | null>,
): ExternalAdapter {
  return {
    name: mod.name,
    type: mod.type === 'token-plan' ? 'token-plan' : 'api',
    async fetch(): Promise<UsageProvider | null> {
      // inline provider key（opencode.jsonc provider.<id>.options.apiKey）兜底——
      // auth.json 没有条目的自建 provider（如蓝区统一网关）靠这个拿到 key。
      let inlineApiKey: string | undefined;
      if (resolveInlineApiKey) {
        try { inlineApiKey = (await resolveInlineApiKey(mod.name)) ?? undefined; } catch { /* fail-open */ }
      }
      const ctx = createPluginContext(mod.name, undefined, usageStats, inlineApiKey);
      try {
        const result = await mod.fetch(ctx);
        if (result === null) return null;
        if (!result.name) {
          log.warn(`[PluginLoader] ${file}: result.name must be string (got ${typeName(result.name)})`);
          return null;
        }
        if (!Array.isArray(result.windows)) {
          log.warn(`[PluginLoader] ${file}: result.windows must be array (got ${typeName(result.windows)})`);
          return null;
        }
        const shapeErr = validateWindowsShape(result.windows);
        if (shapeErr) {
          log.warn(`[PluginLoader] ${file}: ${shapeErr}`);
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
