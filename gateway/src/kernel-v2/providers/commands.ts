/**
 * Command source capability (kernel-v2 Phase 2).
 *
 * A command source contributes a set of `CustomCommandSpec`s. Sources are
 * merged by tier (builtin → legacy → package), with later tiers overriding
 * the same command name. A source that throws is skipped; its failure never
 * erases commands from other sources.
 *
 * Watchers stay source-owned (`watch()`); the capability is pull-based and
 * the consumer re-lists after a watch callback.
 */

import type {
  CapabilityRegistry,
  CapabilityScope,
  CapabilityTier,
} from '../capability-registry';
import type { CustomCommandSpec } from '../../commands/custom-commands';

export interface CommandSource {
  id: string;
  scan(scope?: CapabilityScope): Promise<CustomCommandSpec[]>;
  watch?(onChange: () => void): () => void;
  dispose?(): void | Promise<void>;
}

export interface CommandCapability {
  list(scope?: CapabilityScope): Promise<CustomCommandSpec[]>;
  sources(scope?: CapabilityScope): Array<{ id: string; tier: CapabilityTier }>;
  dispose(): Promise<void>;
}

const TIER_ORDER: Record<CapabilityTier, number> = {
  builtin: 0,
  legacy: 1,
  package: 2,
};

export function createCommandCapability(
  registry: CapabilityRegistry<CommandSource>,
): CommandCapability {
  let disposed = false;

  return {
    async list(scope?: CapabilityScope): Promise<CustomCommandSpec[]> {
      if (disposed) return [];
      const merged = new Map<string, CustomCommandSpec>();
      const ordered = registry
        .list(scope)
        .map((entry, index) => ({ entry, index }))
        .sort(
          (a, b) =>
            TIER_ORDER[a.entry.tier] - TIER_ORDER[b.entry.tier] || a.index - b.index,
        );

      for (const { entry } of ordered) {
        try {
          const specs = await entry.value.scan(scope);
          for (const spec of specs) merged.set(spec.name, spec);
        } catch {
          /* fail-open: one bad source must not erase the rest */
        }
      }
      return [...merged.values()];
    },

    sources(scope?: CapabilityScope) {
      return registry.list(scope).map(({ id, tier }) => ({ id, tier }));
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await registry.dispose();
    },
  };
}

export function registerCommandSource(
  registry: CapabilityRegistry<CommandSource>,
  source: CommandSource,
  tier: CapabilityTier = 'builtin',
  scope?: CapabilityScope,
): void {
  registry.register(
    tier,
    {
      id: source.id,
      value: source,
      ...(source.dispose ? { dispose: () => source.dispose!() } : {}),
    },
    scope,
  );
}
