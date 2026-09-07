import { HarmonicUnit } from './harmonic-types';
import { HarmonicIndexManager } from './harmonic-index';

export class MinHashMerger {
  private signatureSize: number = 32;
  private threshold: number = 0.7;
  private maxMergeChars: number = 500;
  private maxMergeDepth: number = 10;
  private maxMergedValueChars: number = 2000;

  static normalizeForDedup(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Split a (possibly merged) abstraction into its ' | ' segments. */
  static segmentsOf(text: string): string[] {
    return text.split(' | ');
  }

  /** FNV-1a 32-bit. */
  private static hashForward(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** FNV-1a over the reversed string, forced odd (second independent hash). */
  private static hashReverse(s: string): number {
    let h = 0x811c9dc5;
    for (let i = s.length - 1; i >= 0; i--) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h | 1) >>> 0;
  }

  /**
   * MinHash signature via double hashing (Kirsch–Mitzenmacher): two
   * independent FNV-1a hashes per shingle generate signatureSize values
   * h_k = (h1 + k*h2) mod 2^32. Replaces the old `hash*31 + charCode + seed`
   * scheme whose in-loop seed was negligible next to char codepoints — all
   * "independent" hashes degenerated to picking the same lowest-codepoint
   * shingle, so any two memories sharing one English token (e.g. "gateway")
   * scored similarity 1.0 and were wrongly merged.
   */
  generateSignature(text: string): number[] {
    const normalized = MinHashMerger.normalizeForDedup(text);
    const sig = new Array<number>(this.signatureSize).fill(Number.MAX_SAFE_INTEGER);
    let found = false;
    for (let i = 0; i + 3 <= normalized.length; i++) {
      const shingle = normalized.slice(i, i + 3);
      const h1 = MinHashMerger.hashForward(shingle);
      const h2 = MinHashMerger.hashReverse(shingle);
      found = true;
      for (let k = 0; k < this.signatureSize; k++) {
        const hk = (h1 + Math.imul(k, h2)) >>> 0;
        if (hk < sig[k]) sig[k] = hk;
      }
    }
    return found ? sig : sig.fill(0);
  }

  similarity(sigA: number[], sigB: number[]): number {
    let matches = 0;
    for (let i = 0; i < this.signatureSize; i++) {
      if (sigA[i] === sigB[i]) {
        matches++;
      }
    }
    return matches / this.signatureSize;
  }

  /**
   * Max similarity of a signature against each ' | ' segment of a (possibly
   * merged) text. Merged blobs concatenate segments, which dilutes whole-text
   * Jaccard (a true duplicate of one segment scores ~1/segments against the
   * blob); taking the per-segment max preserves duplicate detection.
   */
  maxSimilarityToText(sig: number[], text: string): number {
    let best = 0;
    for (const seg of MinHashMerger.segmentsOf(text)) {
      const s = this.similarity(sig, this.generateSignature(seg));
      if (s > best) best = s;
    }
    return best;
  }

  /**
   * Cross-tier merge check. `read` resolves an id to its unit; `deleteSync`
   * removes an id WITHOUT going through a write queue (the caller must already
   * be inside its serialized write path). If `markSuperseded` is provided, old
   * entries are kept but marked as superseded and energetically demoted instead
   * of being physically deleted — this preserves old facts for knowledge-update
   * queries while letting newer versions outrank them. If `unit` already
   * carries merged_from it is the product of an earlier merge — skip to avoid
   * recursive loops.
   */
  async merge(
    unit: HarmonicUnit,
    indexManager: HarmonicIndexManager,
    store: {
      read(id: string): Promise<HarmonicUnit | null>;
      deleteSync(id: string): boolean;
      markSuperseded?(id: string, byId: string): boolean;
    },
  ): Promise<HarmonicUnit> {
    if (unit.merged_from?.length) return unit;

    const normalizedNew = MinHashMerger.normalizeForDedup(unit.primary_abstraction);
    if (normalizedNew.length < 3) return unit;
    const sig = this.generateSignature(unit.primary_abstraction);
    const index = indexManager.getIndex();
    const mergedFrom: string[] = [];
    let result = { ...unit };

    for (const entry of index.entries) {
      if (entry.id === unit.id) continue;
      if (entry.superseded_by) continue;
      if ((entry.merged_from?.length ?? 0) >= this.maxMergeDepth) continue;

      const exactMatch = normalizedNew.length > 0
        && MinHashMerger.segmentsOf(entry.primary_abstraction)
          .some(seg => MinHashMerger.normalizeForDedup(seg) === normalizedNew);

      const sim = exactMatch ? 1.0 : this.maxSimilarityToText(sig, entry.primary_abstraction);
      if (sim > this.threshold) {
        const existingUnit = await store.read(entry.id);
        if (!existingUnit) continue;
        if (existingUnit.pinned) result.pinned = true;

        // B4: don't grow beyond the length cap — a mega blob pollutes retrieval.
        const combinedLen =
          (result.primary_abstraction?.length || 0) +
          (existingUnit.primary_abstraction?.length || 0);
        if (combinedLen > this.maxMergeChars) continue;

        result.primary_abstraction = this.dedupMerge(
          result.primary_abstraction,
          existingUnit.primary_abstraction,
        );
        result.cue_anchors = this.dedupAnchors([
          ...result.cue_anchors,
          ...existingUnit.cue_anchors,
        ]);
        result.memory_value = this.mergeValues(result.memory_value, existingUnit.memory_value, result.updated_at);
        mergedFrom.push(existingUnit.id);
        if (existingUnit.merged_from?.length) {
          for (const ancestorId of existingUnit.merged_from) {
            if (!mergedFrom.includes(ancestorId)) mergedFrom.push(ancestorId);
          }
        }

        if (store.markSuperseded) {
          store.markSuperseded(existingUnit.id, unit.id);
        } else {
          store.deleteSync(existingUnit.id);
        }
      }
    }

    if (mergedFrom.length > 0) {
      result.merged_from = [
        ...(result.merged_from || []),
        ...mergedFrom,
      ];
      result.updated_at = new Date().toISOString();
    }

    return result;
  }

  private mergeValues(newerValue: string, olderValue: string, updatedAt?: string): string {
    if (newerValue === olderValue) return newerValue;
    const header = updatedAt ? `[Updated ${updatedAt}] ` : '[Updated] ';
    const sep = `\n---\n${header}`;
    const budget = this.maxMergedValueChars - newerValue.length - sep.length;
    if (budget <= 0) return newerValue;
    let kept = olderValue.length <= budget ? olderValue : olderValue.slice(0, budget);
    if (kept.length < olderValue.length) {
      // Cut at the last section boundary so we never leave a truncated section.
      const lastBoundary = kept.lastIndexOf('\n---\n');
      if (lastBoundary > 0) kept = kept.slice(0, lastBoundary);
    }
    return `${newerValue}${sep}${kept}`;
  }

  private dedupMerge(a: string, b: string): string {
    const normA = MinHashMerger.normalizeForDedup(a);
    const normB = MinHashMerger.normalizeForDedup(b);
    if (normA === normB) return a;
    // If a is already one of b's segments, keep b unchanged (prevents
    // identical-duplicate writes from growing the blob with repeat segments).
    for (const seg of MinHashMerger.segmentsOf(b)) {
      if (MinHashMerger.normalizeForDedup(seg) === normA) return b;
    }
    return `${a} | ${b}`;
  }

  private dedupAnchors(anchors: string[]): string[] {
    return [...new Set(anchors)];
  }
}
