/**
 * ASR capability adapter (kernel-v2 Phase 2).
 *
 * Consumers resolve an engine by name through the scoped registry. The
 * adapter adds a safe async availability probe; resolution itself stays
 * synchronous so it can be used from the voice hot path.
 */

import type {
  CapabilityRegistry,
  CapabilityScope,
  CapabilityTier,
} from '../capability-registry';
import {
  assertAsrCapabilities,
  type AsrCapabilities,
  type AsrEngine,
} from '../../voice/types';

export interface AsrCapability {
  resolve(name?: string, scope?: CapabilityScope): AsrEngine;
  list(scope?: CapabilityScope): Array<{
    id: string;
    capabilities: AsrCapabilities;
    tier: CapabilityTier;
  }>;
  available(
    name?: string,
    scope?: CapabilityScope,
  ): Promise<{ ok: boolean; reason?: string }>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAsrCapability(registry: CapabilityRegistry<AsrEngine>): AsrCapability {
  return {
    resolve(name?: string, scope?: CapabilityScope): AsrEngine {
      return registry.resolve(name, scope);
    },

    list(scope?: CapabilityScope) {
      return registry.list(scope).map(({ id, value, tier }) => ({
        id,
        capabilities: value.capabilities,
        tier,
      }));
    },

    async available(name?: string, scope?: CapabilityScope) {
      try {
        const engine = registry.resolve(name, scope);
        return await engine.isAvailable();
      } catch (error) {
        return { ok: false, reason: messageOf(error) };
      }
    },
  };
}

export function registerAsrEngine(
  registry: CapabilityRegistry<AsrEngine>,
  engine: AsrEngine,
  tier: CapabilityTier = 'builtin',
  scope?: CapabilityScope,
): void {
  assertAsrCapabilities(engine.capabilities);
  registry.register(tier, { id: engine.name, value: engine }, scope);
}
