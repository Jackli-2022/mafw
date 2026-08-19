import { HarmonicUnit } from './harmonic-types';
import { HarmonicIndexManager } from './harmonic-index';

export class MinHashMerger {
  private signatureSize: number = 4;
  private threshold: number = 0.75;
  /** Max chars of a merged primary_abstraction; longer combinations are skipped. */
  private maxMergeChars: number = 500;
  /** Entries already merged this many times are no longer merge targets. */
  private maxMergeDepth: number = 3;

  generateSignature(text: string): number[] {
    const lowercase = text.toLowerCase();
    const shingles: string[] = [];
    for (let i = 0; i + 3 <= lowercase.length; i++) {
      shingles.push(lowercase.slice(i, i + 3));
    }
    const seeds = [0, 1, 2, 3];
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

    const sig = this.generateSignature(unit.primary_abstraction);
    const index = indexManager.getIndex();
    const mergedFrom: string[] = [];
    let result = { ...unit };

    for (const entry of index.entries) {
      if (entry.id === unit.id) continue; // don't self-merge
      if (entry.superseded_by) continue; // already superseded entries are not merge targets
      if ((entry.merged_from?.length ?? 0) >= this.maxMergeDepth) continue; // deeply merged: stop growing
      const entrySig = this.generateSignature(entry.primary_abstraction);
      const sim = this.similarity(sig, entrySig);
      if (sim > this.threshold) {
        const existingUnit = await store.read(entry.id);
        if (!existingUnit) continue;

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
    const header = updatedAt ? `[Updated ${updatedAt}] ` : '[Updated] ';
    return `${newerValue}\n---\n${header}${olderValue}`;
  }

  private dedupMerge(a: string, b: string): string {
    const parts = [a, b];
    return parts.join(' | ');
  }

  private dedupAnchors(anchors: string[]): string[] {
    return [...new Set(anchors)];
  }
}
