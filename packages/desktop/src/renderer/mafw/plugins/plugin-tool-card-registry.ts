// Task 10: unified tool-card registration/restore/claim controller.
//
// Solid-free and injectable: the JSX proxy binding lives in `PluginToolCard.tsx`
// and is supplied through `bind`. Everything here is deterministic plan/execute
// over the committed descriptor snapshot:
//   - occupancy accounts for the *previous* revision's fallback card, so an
//     `override: true` card that becomes non-override (or a package swap) sees
//     the built-in it previously covered as still occupied;
//   - first claimant wins; later duplicates are rejected by the model;
//   - removed descriptors restore the original card and release claims;
//   - legacy cards released by `override: true` are re-listed afterwards.
import type { PluginClientDescriptor } from "@mafw/plugin-contract"
import type { PluginGeneration } from "./plugin-client"
import {
  effectiveToolCardTargets,
  type EffectiveToolCardTarget,
  type LegacyToolCardEntry,
} from "./plugin-tool-card-model"

/** Minimal registry surface (ToolRegistry in production, a Map in tests). */
export interface UnifiedToolCardRegistryPort<TCard> {
  render(target: string): TCard | undefined
  register(target: string, card: TCard | undefined): void
}

export interface UnifiedToolCardControllerDeps<TCard> {
  /** Committed package descriptors (snapshot order). */
  descriptors: () => readonly PluginClientDescriptor[]
  /** Plugin generation captured before the legacy list await. */
  generation: () => PluginGeneration
  /** Stale-response guard evaluated after the await. */
  isGenerationCurrent: (generation: PluginGeneration) => boolean
  /** Legacy `~/.mafw/ui-plugins` entries (async IPC in production). */
  listLegacy: () => Promise<readonly LegacyToolCardEntry[]>
  registry: UnifiedToolCardRegistryPort<TCard>
  /** Restore-or-remove a legacy card, returning the card underneath. */
  releaseLegacy: (target: string) => TCard | undefined
  /** Re-run the legacy scan after slots change hands. */
  reapplyLegacy: () => void
  /** Publish the current unified target set (legacy registration skips them). */
  setClaims: (targets: readonly string[]) => void
  /** Register the JSX proxy for one target with its restore fallback. */
  bind: (entry: EffectiveToolCardTarget, fallback: TCard | undefined) => void
}

export interface UnifiedToolCardController<TCard> {
  /** Targets currently bound to unified proxies (previous successful apply). */
  targets: () => string[]
  /** Apply one committed snapshot. Returns false when the snapshot is stale. */
  apply: () => Promise<boolean>
  /** Restore every proxy, drop all claims (tests / teardown). */
  reset: () => void
}

export function createUnifiedToolCardController<TCard>(
  deps: UnifiedToolCardControllerDeps<TCard>,
): UnifiedToolCardController<TCard> {
  // target → fallback card captured before the unified proxy replaced it.
  const previous = new Map<string, TCard | undefined>()
  let appliedTargets: string[] = []

  const restoreAll = () => {
    for (const [target, fallback] of previous) deps.registry.register(target, fallback)
    previous.clear()
    appliedTargets = []
  }

  return {
    targets: () => [...appliedTargets],

    async apply(): Promise<boolean> {
      const generation = deps.generation()
      const descriptors = deps.descriptors()
      let legacyEntries: readonly LegacyToolCardEntry[] = []
      try {
        legacyEntries = await deps.listLegacy()
      } catch {
        legacyEntries = []
      }
      if (!deps.isGenerationCurrent(generation)) return false

      const next = effectiveToolCardTargets(descriptors, legacyEntries, {
        // A key owned by the previous revision is occupied when the card it
        // replaced still exists. This is what makes `override` revocable: the
        // fallback (built-in/legacy) is already registered underneath.
        isOccupied: (target) => {
          if (previous.has(target)) return previous.get(target) !== undefined
          return deps.registry.render(target) !== undefined
        },
      })
      const claims = next.map((entry) => entry.target)
      deps.setClaims(claims)

      // Restore the previous revision before registering the new one.
      restoreAll()

      for (const entry of next) {
        // `override: true` takes the slot from a legacy card; releasing it
        // prevents a later legacy rescan from reclaiming the tool.
        if (entry.card.override === true) deps.releaseLegacy(entry.target)
        const fallback = deps.registry.render(entry.target)
        previous.set(entry.target, fallback)
        deps.bind(entry, fallback)
      }
      appliedTargets = claims

      // Bring back legacy cards on tools no longer claimed.
      deps.reapplyLegacy()
      return true
    },

    reset(): void {
      restoreAll()
      deps.setClaims([])
    },
  }
}
