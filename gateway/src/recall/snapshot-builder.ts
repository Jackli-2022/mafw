/**
 * R8 snapshot builder (side-effecting, dependency-injected for tests).
 *
 * Builds the *expensive* retrieval result for a session in the background —
 * BM25 + expansion (+ dense if configured) + the R3 reranker, rendered with R6
 * neighbour bundling — and stores it in kv so the boundary path can serve it
 * inside the 100ms contract.
 */
import { RecallSnapshot, snapshotQueryFromTurns, SNAPSHOT_DEFAULTS, SnapshotConfig } from './recall-snapshot';
import { renderT1Lines, T1Hit } from './verbatim-recall';
import type { RecallMemory } from './recall-context';
import type { FokZone } from './fok-gate';

export const SNAPSHOT_SCOPE = 'recall-snapshot';

export interface SnapshotDeps {
  /** Recent turn texts, oldest → newest (from T1 observations). */
  recentTurnTexts: (sessionID: string, maxTurns: number) => string[];
  /** Cheap in-memory BM25 + expansion search (sync path); may be async when
   *  the dense channel (R2) needs a query embedding. */
  search: (query: string, topK: number) => RecallMemory[] | Promise<RecallMemory[]>;
  /**
   * Verification layer + R5 FOK in ONE step: returns the reranked memories and
   * the FOK zone derived from the same scoring pass (the reranker probability
   * is the feature that actually discriminates unanswerable questions; the
   * boundary path cannot afford it, this background path can). `top1prob` is
   * carried through for the hit-proxy calibration samples.
   */
  verify?: (query: string, memories: RecallMemory[]) => Promise<{ memories: RecallMemory[]; fokStatus?: FokZone; top1prob?: number }>;
  /** Render the pointer block (formatRecallContext + neighbours + status). */
  render: (memories: RecallMemory[], status?: FokZone) => string | null;
  /** V1 verbatim layer: dense search over t1 rounds (fail-open — absence
   *  keeps the snapshot harmonic-only). */
  searchT1?: (query: string, k: number) => Promise<T1Hit[]> | T1Hit[];
  /** kv write (fail-open by the caller). */
  store: (sessionID: string, snapshot: RecallSnapshot) => void;
  now?: () => Date;
}

/**
 * Build + store one snapshot. Returns null when there is nothing to build
 * (no recent turns, no hits, empty render) — the boundary path then falls back
 * to its live search.
 */
export async function buildSnapshot(
  deps: SnapshotDeps,
  sessionID: string,
  cfg: SnapshotConfig = SNAPSHOT_DEFAULTS,
  topK = 3,
): Promise<RecallSnapshot | null> {
  const maxTurns = cfg.maxTurns ?? SNAPSHOT_DEFAULTS.maxTurns;
  const texts = deps.recentTurnTexts(sessionID, maxTurns);
  const query = snapshotQueryFromTurns(texts, cfg.maxChars ?? SNAPSHOT_DEFAULTS.maxChars);
  if (!query.trim()) return null;

  let memories = await deps.search(query, topK * 2);
  if (memories.length === 0) return null;
  // R3 + R5 in one scoring pass; fail-open to the un-reranked ranking.
  let fokStatus: FokZone | undefined;
  let top1prob: number | undefined;
  if (deps.verify) {
    try {
      const verified = await deps.verify(query, memories);
      if (verified?.memories?.length) memories = verified.memories;
      fokStatus = verified?.fokStatus;
      top1prob = verified?.top1prob;
    } catch { /* fail-open: keep the un-reranked ranking, no gate */ }
  }
  let block = deps.render(memories, fokStatus);
  if (!block) return null;

  // V1: verbatim fusion — append t1 round hits after the pointer block.
  let t1Hits: T1Hit[] | undefined;
  if (deps.searchT1) {
    const t1K = cfg.t1K ?? SNAPSHOT_DEFAULTS.t1K ?? 3;
    try {
      const hits = await deps.searchT1(query, t1K);
      if (hits && hits.length > 0) {
        const lines = renderT1Lines(hits, { k: t1K, maxChars: cfg.t1MaxChars ?? SNAPSHOT_DEFAULTS.t1MaxChars ?? 600 });
        if (lines) {
          block = `${block}\n${lines}`;
          t1Hits = hits.slice(0, t1K);
        }
      }
    } catch { /* fail-open: harmonic-only snapshot */ }
  }

  const snapshot: RecallSnapshot = {
    query,
    block,
    ids: memories.slice(0, topK).map(m => m.id),
    builtAt: (deps.now?.() ?? new Date()).toISOString(),
    fokStatus,
    top1prob,
    t1Hits,
  };
  deps.store(sessionID, snapshot);
  return snapshot;
}
