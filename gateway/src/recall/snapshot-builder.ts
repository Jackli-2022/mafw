/**
 * R8 snapshot builder (side-effecting, dependency-injected for tests).
 *
 * Builds the *expensive* retrieval result for a session in the background —
 * BM25 + expansion (+ dense if configured) + the R3 reranker, rendered with R6
 * neighbour bundling — and stores it in kv so the boundary path can serve it
 * inside the 100ms contract.
 */
import { RecallSnapshot, snapshotQueryFromTurns, SNAPSHOT_DEFAULTS, SnapshotConfig } from './recall-snapshot';
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
   * boundary path cannot afford it, this background path can).
   */
  verify?: (query: string, memories: RecallMemory[]) => Promise<{ memories: RecallMemory[]; fokStatus?: FokZone }>;
  /** Render the pointer block (formatRecallContext + neighbours + status). */
  render: (memories: RecallMemory[], status?: FokZone) => string | null;
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
  if (deps.verify) {
    try {
      const verified = await deps.verify(query, memories);
      if (verified?.memories?.length) memories = verified.memories;
      fokStatus = verified?.fokStatus;
    } catch { /* fail-open: keep the un-reranked ranking, no gate */ }
  }
  const block = deps.render(memories, fokStatus);
  if (!block) return null;

  const snapshot: RecallSnapshot = {
    query,
    block,
    ids: memories.slice(0, topK).map(m => m.id),
    builtAt: (deps.now?.() ?? new Date()).toISOString(),
    fokStatus,
  };
  deps.store(sessionID, snapshot);
  return snapshot;
}
