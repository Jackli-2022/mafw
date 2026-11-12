import type { CapabilityRegistry, CapabilityScope, CapabilityTier } from '../capability-registry';
import type { TtsEngine, TtsProfile } from '../../tts/types';

/**
 * TTS capability adapter over the kernel-v2 registry.
 *
 * This does not import v1 registry/routes/kernel. Consumers see only the
 * engine interface and the v2 registry's scope resolution.
 */
export interface TtsCapability {
  resolve(id?: string, scope?: CapabilityScope): TtsEngine;
  list(scope?: CapabilityScope): Array<{ id: string; profile: TtsProfile; tier: CapabilityTier }>;
}

export function createTtsCapability(registry: CapabilityRegistry<TtsEngine>): TtsCapability {
  return {
    resolve(id?: string, scope?: CapabilityScope): TtsEngine {
      return registry.resolve(id, scope);
    },
    list(scope?: CapabilityScope): Array<{ id: string; profile: TtsProfile; tier: CapabilityTier }> {
      return registry.list(scope).map(({ id, value, tier }) => ({
        id,
        profile: value.profile,
        tier,
      }));
    },
  };
}
