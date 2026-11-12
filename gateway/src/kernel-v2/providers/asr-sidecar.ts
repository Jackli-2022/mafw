/**
 * Bind an S3 sidecar provider into the ASR capability registry.
 *
 * The registry's health callback is synchronous; the sidecar readiness probe
 * is asynchronous. The provider caches the last observed health during
 * activate()/health(), and the registry callback reads that cache.
 */

import type {
  CapabilityHealth,
  CapabilityRegistry,
  CapabilityScope,
  CapabilityTier,
} from '../capability-registry';
import { assertAsrCapabilities, type AsrEngine } from '../../voice/types';
import type { AsrSidecarProvider } from '../probes/asr-subprocess';

export interface BindAsrSidecarOptions {
  registry: CapabilityRegistry<AsrEngine>;
  provider: AsrSidecarProvider;
  tier?: CapabilityTier;
  scope?: CapabilityScope;
}

export interface BoundAsrSidecar {
  providerId: string;
  engine: AsrEngine;
  health(): CapabilityHealth;
  dispose(): Promise<void>;
}

export function bindAsrSidecar(options: BindAsrSidecarOptions): BoundAsrSidecar {
  const { registry, provider, tier = 'builtin', scope } = options;
  const providerId = provider.engine.name;
  assertAsrCapabilities(provider.engine.capabilities);

  const health = (): CapabilityHealth =>
    provider.cachedHealth === 'failed' || provider.cachedHealth === 'degraded'
      ? provider.cachedHealth
      : 'healthy';

  registry.register(
    tier,
    { id: providerId, value: provider.engine, health },
    scope,
  );

  let disposed = false;
  return {
    providerId,
    engine: provider.engine,
    health,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      registry.remove(tier, providerId, scope);
      await provider.dispose();
    },
  };
}
