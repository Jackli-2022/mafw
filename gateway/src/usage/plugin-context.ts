import { config } from '../config';
import { log } from '../core/utils/logger';
import { getProviderApiKey } from './auth-helpers';
import { ExternalAdapter } from './types';
import { UsageProvider, Severity } from './types';
import type { RuntimeCredentials } from '../runtime/contract';

export interface PluginContext {
  apiKey: (name: string) => string | null;
  cookie: (name: string) => string | null;
  fetch: (url: string, opts?: RequestInit) => Promise<Response>;
  pluginConfig: (name: string) => any;
  log: typeof log;
}

export function createPluginContext(
  pluginName: string,
  credentials?: RuntimeCredentials,
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
  };
}

function severityFromPct(pct: number): Severity {
  if (pct >= 90) return 'critical';
  if (pct >= 75) return 'high';
  if (pct >= 50) return 'mid';
  return 'low';
}

export function makeAdapter(mod: any, file: string): ExternalAdapter {
  return {
    name: mod.name,
    type: mod.type === 'token-plan' ? 'token-plan' : 'api',
    async fetch(): Promise<UsageProvider | null> {
      const ctx = createPluginContext(mod.name);
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
