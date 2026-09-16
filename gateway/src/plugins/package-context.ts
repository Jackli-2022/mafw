import { config } from '../config';
import { log } from '../core/utils/logger';
import { getProviderApiKey } from '../runtime/auth';
import type { RuntimeCredentials } from '../runtime/contract';
import type { UsageStatsProvider } from '../usage/plugin-context';
import type { PluginPackageContext } from './package-types';

export interface PackageContextDeps {
  /** thunk 惰性求值（host 初始化时 opencodeClient/trajStore 可能尚未就绪） */
  getCredentials?: () => RuntimeCredentials | undefined;
  usageStats?: () => UsageStatsProvider | undefined;
  projectDir: string;
  gatewayPort: number;
}

const EMPTY_USAGE: UsageStatsProvider = { modelStats: () => [] };

export function createPluginPackageContext(name: string, deps: PackageContextDeps): PluginPackageContext {
  return {
    log,
    fetch: (url, opts) => fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(60_000) }),
    apiKey: (provider) => getProviderApiKey(provider, undefined, deps.getCredentials?.()) ?? null,
    pluginConfig: () =>
      (config.raw as any)?.plugins?.[name]?.config
      ?? (config.raw as any)?.usage?.pluginConfig?.[name]
      ?? (config.raw as any)?.media?.pluginConfig?.[name]
      ?? (config.raw as any)?.runtime?.pluginConfig?.[name]
      ?? {},
    credentials: deps.getCredentials?.(),
    projectDir: deps.projectDir,
    gatewayPort: deps.gatewayPort,
    usage: deps.usageStats?.() ?? EMPTY_USAGE,
  };
}
