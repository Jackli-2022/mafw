/**
 * Media capability adapter (kernel-v2 Phase 2).
 *
 * Wraps the existing media engine vocabulary in the scoped capability
 * registry. Resolution mirrors v1 `resolveMediaPrompt`:
 *
 *   unknown engine        -> builtin pi
 *   builtin engine        -> builtin pi
 *   unsupported modality  -> builtin pi
 *   unhealthy provider    -> builtin pi
 *
 * The adapter never throws: if the builtin pi path is not available it
 * returns `undefined`, and the caller falls back to `MediaService.deps.prompt`.
 */

import type {
  CapabilityHealth,
  CapabilityRegistry,
  CapabilityScope,
  CapabilityTier,
} from '../capability-registry';
import type { MediaConfig, MediaKind, PromptFn } from '../../media/media-service';

export interface MediaProvider {
  id: string;
  modalities: string[];
  prompt: PromptFn;
  /** Builtin providers are resolved through `builtinPi`, not their prompt. */
  builtin?: boolean;
  health?: () => CapabilityHealth;
}

export interface MediaCapability {
  resolve(kind: MediaKind, cfg: MediaConfig, scope?: CapabilityScope): PromptFn | undefined;
  engines(scope?: CapabilityScope): Array<{
    id: string;
    modalities: string[];
    tier: CapabilityTier;
  }>;
}

export interface MediaCapabilityDeps {
  builtinPi: () => PromptFn | undefined;
  onFallback?: (reason: string, engine: string, kind: MediaKind) => void;
}

function healthOf(provider: MediaProvider): CapabilityHealth {
  try {
    return provider.health?.() ?? 'healthy';
  } catch {
    return 'failed';
  }
}

function safeBuiltinPi(deps: MediaCapabilityDeps): PromptFn | undefined {
  try {
    return deps.builtinPi();
  } catch {
    return undefined;
  }
}

function reportFallback(
  deps: MediaCapabilityDeps,
  reason: string,
  engine: string,
  kind: MediaKind,
): void {
  try {
    deps.onFallback?.(reason, engine, kind);
  } catch {
    /* diagnostics callbacks must never break media resolution */
  }
}

export function createMediaCapability(
  registry: CapabilityRegistry<MediaProvider>,
  deps: MediaCapabilityDeps,
): MediaCapability {
  return {
    resolve(kind: MediaKind, cfg: MediaConfig, scope?: CapabilityScope): PromptFn | undefined {
      const engineName = cfg[kind]?.engine ?? cfg.engine ?? 'pi';
      const entry = registry.list(scope).find((item) => item.id === engineName);

      if (!entry) {
        reportFallback(deps, 'unknown-engine', engineName, kind);
        return safeBuiltinPi(deps);
      }
      if (healthOf(entry.value) === 'failed') {
        reportFallback(deps, 'unhealthy', engineName, kind);
        return safeBuiltinPi(deps);
      }
      if (entry.value.builtin) return safeBuiltinPi(deps);
      if (!entry.value.modalities.includes(kind)) {
        reportFallback(deps, 'unsupported-modality', engineName, kind);
        return safeBuiltinPi(deps);
      }
      return entry.value.prompt;
    },

    engines(scope?: CapabilityScope) {
      return registry.list(scope).map(({ id, value, tier }) => ({
        id,
        modalities: [...value.modalities],
        tier,
      }));
    },
  };
}

export function registerMediaProvider(
  registry: CapabilityRegistry<MediaProvider>,
  provider: MediaProvider,
  tier: CapabilityTier = 'builtin',
  scope?: CapabilityScope,
): void {
  registry.register(
    tier,
    {
      id: provider.id,
      value: provider,
      ...(provider.health ? { health: provider.health } : {}),
    },
    scope,
  );
}
