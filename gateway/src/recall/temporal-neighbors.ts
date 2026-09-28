/**
 * R6: temporal-neighbor bundling (读路径上下文复原).
 *
 * The brain reinstates the temporal context of a retrieved memory, which then
 * cues its chronological neighbors (lag-CRP; Howard & Kahana 2002, PMID 8822162;
 * Manning et al. 2011, PMID 21737744). Multi-session / temporal-reasoning
 * questions in LongMemEval fail precisely because the answer sits in a session
 * adjacent to a hit — this pulls those neighbors back into the candidate set.
 *
 * Same-session neighbors outrank cross-session ones: contiguity attenuates
 * across episode boundaries (MacDonald et al. 2011; CueMem 2609.12354,
 * EdgeMem 2609.05553 use a small symmetric window).
 *
 * Pure function. `entries` must be in chronological order (the index stores
 * them in write order), which is a reliable time proxy even when created_at
 * ties (all rounds of one session share the session date).
 */
import type { HarmonicIndexEntry } from '../core/memory/harmonic-types';

export interface TemporalNeighbor {
  id: string;
  /** Anchor that pulled this neighbor in (max-scoring anchor wins). */
  anchorId: string;
  /** Candidate score = anchorScore × base^distance. */
  score: number;
  /** Neighbor shares the anchor's source_session_id. */
  sameSession: boolean;
}

export interface TemporalNeighborOptions {
  /** ±window in chronological order (default 1). */
  window?: number;
  /** Score multiplier for same-session neighbors (default 0.5). */
  sameSessionWeight?: number;
  /** Score multiplier for cross-session neighbors (default 0.35). */
  crossSessionWeight?: number;
  /** Expand only anchors scoring ≥ topScore × anchorFloor (default 0.3). */
  anchorFloor?: number;
  /** Cap on returned neighbors (default 20). */
  maxNeighbors?: number;
  /** Max anchors expanded (default 5). */
  anchorK?: number;
}

const DEFAULTS: Required<TemporalNeighborOptions> = {
  window: 1,
  sameSessionWeight: 0.5,
  crossSessionWeight: 0.35,
  anchorFloor: 0.3,
  maxNeighbors: 20,
  anchorK: 5,
};

/**
 * Returns a chronologically sorted copy (created_at asc). Entries without a
 * parseable date sort last; ties and missing dates preserve input order, so a
 * session's rounds (all sharing the session date) stay in write order.
 */
export function chronologicalOrder<T extends { created_at?: string }>(entries: T[]): T[] {
  return entries
    .map((e, i) => ({ e, i, t: Date.parse(e.created_at ?? '') }))
    .sort((a, b) => {
      const aNaN = Number.isNaN(a.t);
      const bNaN = Number.isNaN(b.t);
      if (aNaN && bNaN) return a.i - b.i;
      if (aNaN) return 1;
      if (bNaN) return -1;
      return a.t - b.t || a.i - b.i;
    })
    .map(x => x.e);
}

/**
 * Returns the chronological neighbors (±window) of the highest-scoring anchors,
 * excluding entries that are already anchors or superseded. Deterministic:
 * sorted by score desc, then chronological position.
 */
export function computeTemporalNeighbors(
  anchors: Array<{ id: string; score: number }>,
  entries: HarmonicIndexEntry[],
  options: TemporalNeighborOptions = {},
): TemporalNeighbor[] {
  if (anchors.length === 0 || entries.length === 0) return [];
  const o = { ...DEFAULTS, ...options };

  const pos = new Map<string, number>();
  entries.forEach((e, i) => {
    if (e?.id) pos.set(e.id, i);
  });

  const topScore = Math.max(...anchors.map(a => a.score));
  const floor = topScore * o.anchorFloor;
  const anchorIds = new Set(anchors.map(a => a.id));
  const picked = new Map<string, { score: number; anchorId: string; sameSession: boolean }>();

  const selected = anchors
    .filter(a => pos.has(a.id) && a.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, o.anchorK);

  for (const anchor of selected) {
    const anchorPos = pos.get(anchor.id)!;
    const anchorEntry = entries[anchorPos];
    for (let d = 1; d <= o.window; d++) {
      for (const dir of [-d, d]) {
        const i = anchorPos + dir;
        if (i < 0 || i >= entries.length) continue;
        const nb = entries[i];
        if (!nb?.id || anchorIds.has(nb.id) || nb.superseded_by) continue;
        const sameSession = !!anchorEntry.source_session_id && anchorEntry.source_session_id === nb.source_session_id;
        const base = sameSession ? o.sameSessionWeight : o.crossSessionWeight;
        const score = anchor.score * Math.pow(base, d);
        const prev = picked.get(nb.id);
        if (!prev || score > prev.score) picked.set(nb.id, { score, anchorId: anchor.id, sameSession });
      }
    }
  }

  return [...picked.entries()]
    .map(([id, v]) => ({ id, anchorId: v.anchorId, score: v.score, sameSession: v.sameSession }))
    .sort((a, b) => b.score - a.score || (pos.get(a.id)! - pos.get(b.id)!))
    .slice(0, o.maxNeighbors);
}
