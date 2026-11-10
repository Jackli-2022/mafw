/**
 * Credential source for plugin/runtime factory contexts.
 *
 * The active runtime host is only a *snapshot* input: after the new runtime is
 * adopted, the live host may expose credentials that delegate back to this
 * same object (pi's definition does exactly that), which would recurse. The
 * opencode auth.json fallback stays authoritative for providers without a
 * runtime credential.
 *
 * Plan 6 Task 7: the reader is reached through the single opencode package shim
 * (`./opencode-adapter`), which fails soft (one warn) when the adapter is not
 * staged. No gateway module imports the driver's auth reader directly.
 */
import type { RuntimeCredentials } from './contract';
import { getProviderApiKey } from './opencode-adapter';

export function createPluginCredentials(active?: RuntimeCredentials): RuntimeCredentials {
  return {
    getApiKey: (provider: string) => getProviderApiKey(provider, undefined, active) ?? null,
  };
}
