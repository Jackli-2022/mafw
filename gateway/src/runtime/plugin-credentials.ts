/**
 * Credential source for plugin/runtime factory contexts.
 *
 * Phase 4 W4: the gateway no longer reads the adapter's auth.json itself. The
 * active runtime host is the only credential source; an opencode host delegates
 * to the driver's own credentials (which include auth.json) after activation.
 */
import type { RuntimeCredentials } from './contract';

export function createPluginCredentials(active?: RuntimeCredentials): RuntimeCredentials {
  return {
    getApiKey: (provider: string) => active?.getApiKey(provider) ?? null,
  };
}
