// V2 ①b L1: exact-content guard at the write boundary. An LRU of content
// hashes (in-memory only — a restart window is acceptable, read-time collapse
// backstops) catches worker double-submits with zero LLM cost.
import * as crypto from 'crypto';

const LRU_CAPACITY = 10_000;
const seen = new Map<string, true>(); // Map preserves insertion order → LRU via delete+re-set

export const dedupStats = { exactHashSkips: 0, collapsed: 0 };

export function resetDedupStatsForTest(): void {
  dedupStats.exactHashSkips = 0;
  dedupStats.collapsed = 0;
  seen.clear();
}

export function exactHashOf(content: string): string {
  return crypto.createHash('sha1').update(content, 'utf-8').digest('hex');
}

/** Record + test in one call: true when the exact content was already written. */
export function seenExactHash(hash: string): boolean {
  const hit = seen.has(hash);
  if (hit) {
    dedupStats.exactHashSkips++;
    // refresh LRU recency
    seen.delete(hash);
    seen.set(hash, true);
    return true;
  }
  seen.set(hash, true);
  if (seen.size > LRU_CAPACITY) {
    const oldest = seen.keys().next().value as string;
    seen.delete(oldest);
  }
  return false;
}

export function getDedupStats(): { exactHashSkips: number; collapsed: number } {
  return { exactHashSkips: dedupStats.exactHashSkips, collapsed: dedupStats.collapsed };
}
