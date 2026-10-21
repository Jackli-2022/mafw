import { config } from '../config';
import { log } from '../core/utils/logger';

export interface MediaPluginContext {
  apiKey: (name: string) => string | null;
  fetch: (url: string, opts?: RequestInit) => Promise<Response>;
  pluginConfig: (name: string) => any;
  log: typeof log;
}

/**
 * 注入式凭据 seam（Plan 3 Task 5）：消费方只见 getApiKey 动词，auth.json
 * 解析（active runtime credentials → legacy 兜底）由调用方（index.ts 单点）
 * 闭包接线；缺省恒 null（fail-open，不静默回退）。
 */
export function createMediaPluginContext(
  pluginName: string,
  getApiKey?: (name: string) => string | null,
): MediaPluginContext {
  void pluginName;
  return {
    apiKey: (name: string) => getApiKey?.(name) ?? null,
    fetch: (url: string, opts?: RequestInit) =>
      fetch(url, { ...opts, signal: opts?.signal ?? AbortSignal.timeout(60_000) } as any),
    pluginConfig: (name: string) => config.raw.media?.pluginConfig?.[name] ?? null,
    log,
  };
}
