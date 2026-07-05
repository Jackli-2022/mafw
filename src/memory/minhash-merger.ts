import * as fs from 'fs';
import * as path from 'path';
import { HarmonicUnit } from './harmonic-types';
import { HarmonicIndexManager } from './harmonic-index';

export class MinHashMerger {
  private signatureSize: number = 4;
  private threshold: number = 0.6;

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

  async merge(
    unit: HarmonicUnit,
    tier: string,
    indexManager: HarmonicIndexManager,
    baseDir: string
  ): Promise<HarmonicUnit> {
    const sig = this.generateSignature(unit.primary_abstraction);
    const index = indexManager.getIndex();
    const mergedFrom: string[] = [];
    let result = { ...unit };

    for (const entry of index.entries) {
      const entrySig = this.generateSignature(entry.primary_abstraction);
      const sim = this.similarity(sig, entrySig);
      if (sim > this.threshold) {
        const tierDir = path.join(baseDir, 'memory', entry.tier);
        const filePath = path.join(tierDir, `${entry.id}.json`);
        let existingUnit: HarmonicUnit;
        try {
          existingUnit = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
          continue;
        }

        result.primary_abstraction = this.dedupMerge(
          result.primary_abstraction,
          existingUnit.primary_abstraction
        );
        result.cue_anchors = this.dedupAnchors([
          ...result.cue_anchors,
          ...existingUnit.cue_anchors,
        ]);
        result.memory_value = result.memory_value + '\n---\n' + existingUnit.memory_value;
        result.energy = Math.min(1.0, result.energy + 0.15);
        mergedFrom.push(existingUnit.id);
        indexManager.removeEntry(existingUnit.id);
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

  private dedupMerge(a: string, b: string): string {
    const parts = [a, b];
    return parts.join(' | ');
  }

  private dedupAnchors(anchors: string[]): string[] {
    return [...new Set(anchors)];
  }
}
