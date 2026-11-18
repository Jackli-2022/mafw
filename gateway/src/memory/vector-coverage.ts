// Harmonic vector coverage — one shared statistic for every diagnostics exit.
//
// The pre-2026-11-18 formula was `vectors.size() / entries.length` in both
// `routes/memory.ts` and `kernel.ts` runtimeState. The numerator counted every
// vector key (including orphan keys left behind by abandoned write paths) while
// the denominator counted every index row (including superseded units that are
// not expected to have a vector). Mixing those populations made a fully
// indexed live library report coverage > 100%.
//
// The contract here:
//   - `vectors` / `indexEntries` stay raw counts (no filtering, no clamping);
//   - `coverage` is the ACTIVE intersection (active ids present in the vector
//     store / distinct active ids) and can never exceed 1;
//   - `rawCoverage` preserves the old mixed ratio unclamped so anomalies remain
//     visible instead of being hidden by `Math.min`;
//   - `orphanVectors` counts vector keys with no index row at all (a superseded
//     row still owns its vector, so it is not an orphan).
//
// Duplicate index rows for the same id are a data-integrity bug; counting the
// id once keeps the denominator honest. Vector ids are deduped for the same
// reason, while `vectors` still reports the store's own `size()`.

export interface HarmonicCoverageEntry {
  id?: string | null;
  superseded_by?: string | null;
}

export interface HarmonicCoverageVectors {
  size(): number;
  ids(): string[];
}

export interface HarmonicVectorCoverage {
  /** Raw vector-store key count (includes orphans). */
  vectors: number;
  /** Raw Harmonic index row count (includes superseded rows). */
  indexEntries: number;
  /** Distinct active (not superseded) index ids. */
  activeEntries: number;
  /** Distinct active ids that have a vector. */
  activeWithVectors: number;
  /** Vector keys that have no index row at all. */
  orphanVectors: number;
  /** activeWithVectors / activeEntries (0 when there is nothing active). */
  coverage: number;
  /** vectors / indexEntries — the retired mixed ratio, never clamped. */
  rawCoverage: number;
}

export function computeHarmonicVectorCoverage(
  entries: readonly HarmonicCoverageEntry[] | null | undefined,
  vectors: HarmonicCoverageVectors | null | undefined,
): HarmonicVectorCoverage {
  const rows = entries ?? [];

  const vectorIds = new Set<string>();
  const vectorCount = vectors ? vectors.size() : 0;
  for (const id of vectors ? vectors.ids() : []) {
    if (typeof id === 'string' && id) vectorIds.add(id);
  }

  const indexIds = new Set<string>();
  const activeIds = new Set<string>();
  for (const entry of rows) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
    indexIds.add(entry.id);
    if (!entry.superseded_by) activeIds.add(entry.id);
  }

  let activeWithVectors = 0;
  for (const id of activeIds) {
    if (vectorIds.has(id)) activeWithVectors++;
  }

  let orphanVectors = 0;
  for (const id of vectorIds) {
    if (!indexIds.has(id)) orphanVectors++;
  }

  const indexEntries = rows.length;
  const activeEntries = activeIds.size;
  return {
    vectors: vectorCount,
    indexEntries,
    activeEntries,
    activeWithVectors,
    orphanVectors,
    coverage: activeEntries > 0 ? activeWithVectors / activeEntries : 0,
    rawCoverage: indexEntries > 0 ? vectorCount / indexEntries : 0,
  };
}
