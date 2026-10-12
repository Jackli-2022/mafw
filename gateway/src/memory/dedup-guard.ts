// V2 ①b L1: exact-content guard at the write boundary. An LRU of content
// hashes (in-memory only — a restart window is acceptable, read-time collapse
// backstops) catches worker double-submits with zero LLM cost.
import * as crypto from 'crypto';
import { ScoredEntry } from '../core/memory/harmonic-index';

export interface CollapseOpts {
  /** Collapse window size on the ranked list (default 30). */
  maxCandidates?: number;
  tokenJaccardThreshold?: number; // default 0.8
  vectorCosineThreshold?: number; // default 0.92
  /** Embedding lookup — production resolves via getEmbeddingRuntime().vectors. */
  vectorFor?: (id: string) => number[] | null;
}

function tokensOf(entry: ScoredEntry['entry']): Set<string> {
  const raw = `${entry.primary_abstraction} ${(entry.cue_anchors ?? []).join(' ')}`.toLowerCase();
  const ascii = raw.match(/[a-z0-9_]{2,}/g) ?? [];
  const cjk = raw.match(/[\u4e00-\u9fff]/g) ?? [];
  return new Set([...ascii, ...cjk]);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

/** Presentation-layer dedup among the top candidates: near-duplicates (cos
 * ≥ 0.92 when vectors resolve for BOTH ids, else token-Jaccard ≥ 0.8 on
 * abstraction+anchors) fold into the entry ranked higher (kept first).
 * No data mutation; O(k²) on the first k ≤ 30 kept entries only. */
export function collapseNearDuplicates(scored: ScoredEntry[], opts?: CollapseOpts): ScoredEntry[] {
  const k = Math.min(scored.length, opts?.maxCandidates ?? 30);
  const jt = opts?.tokenJaccardThreshold ?? 0.8;
  const ct = opts?.vectorCosineThreshold ?? 0.92;
  const vecFor = opts?.vectorFor ?? (() => null);
  const out: ScoredEntry[] = [];
  const outTokens: Set<string>[] = [];
  for (const s of scored) {
    let folded = false;
    if (out.length < k) {
      for (let i = 0; i < out.length; i++) {
        const va = vecFor(s.entry.id);
        const vb = vecFor(out[i].entry.id);
        const similar = (va && vb && va.length === vb.length)
          ? cosine(va, vb) >= ct
          : jaccard(tokensOf(s.entry), outTokens[i]) >= jt;
        if (similar) { dedupStats.collapsed++; folded = true; break; }
      }
    }
    if (!folded) { out.push(s); outTokens.push(tokensOf(s.entry)); }
  }
  return out;
}

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
