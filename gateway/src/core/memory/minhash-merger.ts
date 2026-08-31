import { HarmonicUnit } from './harmonic-types';
import { HarmonicIndexManager } from './harmonic-index';

export class MinHashMerger {
  private signatureSize: number = 8;
  private threshold: number = 0.625;
  private maxMergeChars: number = 500;
  private maxMergeDepth: number = 10;

  static normalizeForDedup(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  generateSignature(text: string): number[] {
    const normalized = MinHashMerger.normalizeForDedup(text);
    const shingles: string[] = [];
    for (let i = 0; i + 3 <= normalized.length; i++) {
      shingles.push(normalized.slice(i, i + 3));
    }
    const seeds = [0, 1, 2, 3, 4, 5, 6, 7];
    return seeds.map(seed => {
      let minHash = Infinity;
      for (const shingle of shingles) {
        let hash = 0;
        for (let j = 0; j < shingle.length; j++) {
          hash = hash * 31 + shingle.charCodeAt(j) + seed;
        }
        hash = hash >>> 0;
        if (hash < minHash) {
          minHash = hash;
        }
      }
      return minHash === Infinity ? 0 : minHash;
    });
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

      const normalizedExisting = MinHashMerger.normalizeForDedup(entry.primary_abstraction);
      const exactMatch = normalizedNew.length > 0
        && normalizedNew.length === normalizedExisting.length
        && normalizedNew === normalizedExisting;

      const sim = exactMatch ? 1.0 : this.similarity(sig, this.generateSignature(entry.primary_abstraction));
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
        result.energy = Math.min(1.0, result.energy + 0.15);
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
    return `${newerValue}\n---\n${header}${olderValue}`;
  }

  private dedupMerge(a: string, b: string): string {
    const normA = MinHashMerger.normalizeForDedup(a);
    const normB = MinHashMerger.normalizeForDedup(b);
    if (normA === normB) return a;
    return `${a} | ${b}`;
  }

  private dedupAnchors(anchors: string[]): string[] {
    return [...new Set(anchors)];
  }
}
