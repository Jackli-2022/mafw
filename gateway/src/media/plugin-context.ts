import { config } from '../config';
import { log } from '../core/utils/logger';
import { getProviderApiKey } from '../usage/auth-helpers';

export interface MediaPluginContext {
  apiKey: (name: string) => string | null;
  fetch: (url: string, opts?: RequestInit) => Promise<Response>;
  pluginConfig: (name: string) => any;
  log: typeof log;
}

export function createMediaPluginContext(pluginName: string): MediaPluginContext {
  return {
    apiKey: (name: string) => getProviderApiKey(name) ?? null,
    fetch: (url: string, opts?: RequestInit) =>
      fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(60_000) }),
    pluginConfig: (name: string) => config.raw.media?.pluginConfig?.[name] ?? null,
    log,
  };
}
