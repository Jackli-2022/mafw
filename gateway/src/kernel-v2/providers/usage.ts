import type { CapabilityRegistry, CapabilityScope } from '../capability-registry';
import type { ExternalAdapter } from '../../usage/types';

/**
 * Usage capability adapter over the kernel-v2 registry.
 *
 * `adapters()` returns one visible winner per provider name; `resolve()`
 * follows the registry's default/fallback semantics. No live network here.
 */
export interface UsageCapability {
  resolve(name?: string, scope?: CapabilityScope): ExternalAdapter;
  adapters(scope?: CapabilityScope): ExternalAdapter[];
}

export function createUsageCapability(registry: CapabilityRegistry<ExternalAdapter>): UsageCapability {
  return {
    resolve(name?: string, scope?: CapabilityScope): ExternalAdapter {
      return registry.resolve(name, scope);
    },
    adapters(scope?: CapabilityScope): ExternalAdapter[] {
      return registry.list(scope).map(({ value }) => value);
    },
  };
}
