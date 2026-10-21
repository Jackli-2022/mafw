import { config } from '../config';
import { log } from '../core/utils/logger';
import type { UsageStatsProvider } from '../usage/plugin-context';
import type { PluginPackageContext } from './package-types';

export interface PackageContextDeps {
  /** thunk 惰性求值（host 初始化时 runtime/trajStore 可能尚未就绪） */
  getApiKey?: (provider: string) => string | null;
  usageStats?: () => UsageStatsProvider | undefined;
  projectDir: string;
  gatewayPort: number;
  /** gateway 全通道广播（缺省 no-op——测试/独立宿主场景） */
  emit?: (event: { type: string; [key: string]: any }) => void;
}

const EMPTY_USAGE: UsageStatsProvider = { modelStats: () => [] };

export function createPluginPackageContext(name: string, deps: PackageContextDeps): PluginPackageContext {
  return {
    log,
    fetch: (url, opts) => fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(60_000) }),
    apiKey: (provider) => deps.getApiKey?.(provider) ?? null,
    pluginConfig: () =>
      (config.raw as any)?.plugins?.[name]?.config
      ?? (config.raw as any)?.usage?.pluginConfig?.[name]
      ?? (config.raw as any)?.media?.pluginConfig?.[name]
      ?? (config.raw as any)?.runtime?.pluginConfig?.[name]
      ?? {},
    credentials: undefined,
    projectDir: deps.projectDir,
    gatewayPort: deps.gatewayPort,
    usage: deps.usageStats?.() ?? EMPTY_USAGE,
    emit: (event) => deps.emit?.(event),
  };
}
