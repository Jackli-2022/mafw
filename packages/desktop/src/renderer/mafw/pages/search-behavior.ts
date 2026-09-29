// Search behavior draft for the Config page Memory section (P1).
// Pure module — no Solid imports — unit-tested with bun:test next to it.
// The card edits four user-visible retrieval knobs through the generic
// config.get/set channel (PUT is whole-file; the SDK merges sections).

export interface SearchBehaviorDraft {
  fokEnabled: boolean
  /** string on purpose — free-form typing must not block the input */
  probLow: string
  probHigh: string
  snapshotEnabled: boolean
  neighborsPresentation: boolean
  /** off | heuristic | llamacpp */
  reranker: string
}

export const RERANKER_OPTIONS = ['off', 'heuristic', 'llamacpp'] as const

const num = (v: string): number | null => {
  if (!v.trim()) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Error message for the FOK threshold inputs, or null when valid. */
export function validateFokThresholds(low: string, high: string): string | null {
  const lo = num(low)
  const hi = num(high)
  if (lo === null) return '拒答阈值必须是 0–1 之间的数字'
  if (hi === null) return '注入阈值必须是 0–1 之间的数字'
  if (lo <= 0 || lo >= 1) return '拒答阈值需在 0–1 开区间内'
  if (hi <= 0 || hi >= 1) return '注入阈值需在 0–1 开区间内'
  if (lo >= hi) return '拒答阈值必须小于注入阈值'
  return null
}

/** Build a draft from the effective config (absent keys → sane defaults). */
export function draftFromConfig(cfg: any): SearchBehaviorDraft {
  const search = cfg?.search ?? {}
  const fok = search.fok ?? {}
  const snap = search.snapshot ?? {}
  const tn = search.temporalNeighbors ?? {}
  return {
    fokEnabled: fok.enabled === true,
    probLow: fok.probLow !== undefined ? String(fok.probLow) : '0.2',
    probHigh: fok.probHigh !== undefined ? String(fok.probHigh) : '0.6',
    snapshotEnabled: snap.enabled === true,
    neighborsPresentation: tn.presentation === true,
    reranker: RERANKER_OPTIONS.includes(search.reranker) ? search.reranker : 'llamacpp',
  }
}

/**
 * The `search` section override to PUT. Only writes the keys this card owns —
 * untouched keys (expansion, boundaryDense, graph, ...) are read from the
 * current config by the caller and merged, never dropped here.
 */
export function toSearchOverrides(d: SearchBehaviorDraft): {
  search: {
    fok?: { enabled: boolean; probLow: number; probHigh: number }
    snapshot?: { enabled: boolean }
    temporalNeighbors?: { enabled: boolean; presentation: boolean }
    reranker?: string
  }
} {
  const lo = num(d.probLow) ?? 0.2
  const hi = num(d.probHigh) ?? 0.6
  return {
    search: {
      fok: { enabled: d.fokEnabled, probLow: lo, probHigh: hi },
      snapshot: { enabled: d.snapshotEnabled },
      temporalNeighbors: { enabled: d.neighborsPresentation, presentation: d.neighborsPresentation },
      reranker: d.reranker,
    },
  }
}

/** Merge the card's overrides into the CURRENT search section (PUT is
 *  whole-file — the SDK merges top-level sections, nested keys are on us). */
export function mergeSearchSection(current: any, overrides: any): any {
  return { ...(current ?? {}), ...(overrides ?? {}) }
}
