/**
 * R8 predictive prefetch snapshot (pure decision logic).
 *
 * The boundary recall path has a 100ms hard contract, so it cannot await the
 * expensive retrieval (reranker ~115ms, LLM index-scan). Preplay evidence
 * (Dragoi & Tonegawa 2011) and predictive prefetching (−43.5% latency,
 * arXiv:2605.17989) suggest computing the next turn's retrieval *in advance*:
 * a background refresher builds the block after each turn, and the boundary
 * path just reads it (~1ms).
 *
 * Two guards keep it honest:
 *  - the snapshot query is built from a ROLLING WINDOW of recent turns, because
 *    the last turn alone holds only ~36% of the session vocabulary
 *    (arXiv:2607.22392);
 *  - a deterministic topic-shift check drops the snapshot when the new query
 *    does not overlap it, falling back to the cheap live path (LLM topic
 *    detection carries stale context, arXiv:2605.09268 — keep it lexical).
 */

export interface RecallSnapshot {
  /** Query the snapshot was built from (rolling window of recent turns). */
  query: string;
  /** Pre-rendered pointer block served verbatim. */
  block: string;
  /** Memory ids in the block (diagnostics / merge). */
  ids: string[];
  /** ISO timestamp of construction. */
  builtAt: string;
  /**
   * R5 FOK zone decided while building (from the R3 reranker probability — the
   * feature that actually discriminates answerable from unanswerable). The
   * block is rendered with this status baked in.
   */
  fokStatus?: 'inject' | 'low-confidence' | 'no-memory';
}

export interface SnapshotConfig {
  enabled?: boolean;
  /** Snapshot lifetime (default 10 min). */
  ttlMs?: number;
  /** Turns of context folded into the snapshot query (default 4). */
  maxTurns?: number;
  /** Cap on the snapshot query length in chars (default 600). */
  maxChars?: number;
  /** Jaccard overlap below which the snapshot is treated as stale topic (0.25). */
  topicShiftThreshold?: number;
}

export const SNAPSHOT_DEFAULTS = {
  ttlMs: 10 * 60 * 1000,
  maxTurns: 4,
  maxChars: 600,
  topicShiftThreshold: 0.25,
} as const;

/**
 * Build the prefetch query from recent turn texts (oldest → newest). The window
 * keeps the newest turns when the cap is exceeded — the tail is what the next
 * turn most likely continues.
 */
export function snapshotQueryFromTurns(texts: string[], maxChars: number = SNAPSHOT_DEFAULTS.maxChars): string {
  const cleaned = texts.map(t => (t || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (cleaned.length === 0) return '';
  const joined = cleaned.join(' ');
  if (joined.length <= maxChars) return joined;
  // Take whole newest segments first, then top up from the next one's tail.
  const picked: string[] = [];
  let len = 0;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const t = cleaned[i];
    if (len + t.length + 1 <= maxChars) {
      picked.unshift(t);
      len += t.length + 1;
    } else {
      const room = maxChars - len - 1;
      if (room > 20) picked.unshift(t.slice(-room));
      break;
    }
  }
  return picked.join(' ').slice(0, maxChars);
}

/** Token set used for the topic-shift comparison (BM25-ish: words ≥2 + CJK). */
export function snapshotTokens(text: string): Set<string> {
  const lower = (text || '').toLowerCase();
  const words = lower.split(/[^a-z0-9\u4e00-\u9fff]+/).filter(w => w.length >= 2);
  const cjk = lower.match(/[\u4e00-\u9fff]/g) || [];
  return new Set([...words, ...cjk]);
}

/** Jaccard overlap of the two token sets (0 when either side is empty). */
export function snapshotOverlap(a: string, b: string): number {
  const sa = snapshotTokens(a);
  const sb = snapshotTokens(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export type SnapshotDecision = 'use' | 'no-snapshot' | 'stale' | 'topic-shift';

/**
 * Decide whether the boundary path may serve the snapshot instead of running
 * the live (cheap) search. `now` injectable for deterministic tests.
 */
export function decideSnapshotUse(
  snapshot: RecallSnapshot | null | undefined,
  query: string,
  now: Date = new Date(),
  cfg: SnapshotConfig = SNAPSHOT_DEFAULTS,
): SnapshotDecision {
  if (!snapshot || !snapshot.block || snapshot.ids.length === 0) return 'no-snapshot';
  const age = now.getTime() - Date.parse(snapshot.builtAt);
  if (Number.isNaN(age)) return 'no-snapshot';
  if (age > (cfg.ttlMs ?? SNAPSHOT_DEFAULTS.ttlMs)) return 'stale';
  if (!query.trim()) return 'use'; // nothing better to compute
  const threshold = cfg.topicShiftThreshold ?? SNAPSHOT_DEFAULTS.topicShiftThreshold;
  if (snapshotOverlap(snapshot.query, query) < threshold) return 'topic-shift';
  return 'use';
}
