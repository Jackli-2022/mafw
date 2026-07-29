import { HarmonicIndexManager } from '../core/memory/harmonic-index';
import { HarmonicIndexEntry } from '../core/memory/harmonic-types';
import { tokenize } from '../memory/derived-terms';

export interface SearchOptions {
  policy?: 'oneshot' | 'guided';
  budgetTokens?: number;
  maxRounds?: number;
}

export interface SearchResult {
  id: string;
  primary_abstraction: string;
  score: number;
  round: number;
  hopDecay: number;
}

const HOP_DECAY = [1.0, 0.9, 0.75];

export class GuidedRetriever {
  private indexManager: HarmonicIndexManager;

  constructor(indexManager: HarmonicIndexManager) {
    this.indexManager = indexManager;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const policy = options.policy || 'guided';
    const maxRounds = options.maxRounds || 3;
    const results: SearchResult[] = [];
    const index = this.indexManager.getIndex();

    if (policy === 'oneshot') {
      return this.bm25Search(query, index.entries, 1, 1.0).slice(0, 10);
    }

    let currentQuery = query;
    for (let round = 0; round < maxRounds; round++) {
      const roundResults = this.bm25Search(currentQuery, index.entries, round, HOP_DECAY[round]);
      results.push(...roundResults);

      // Check saturation
      if (roundResults.length > 0 && roundResults[0].score >= 0.8) break;
      if (roundResults.length >= 3) {
        const scores = roundResults.map(r => r.score);
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((a, b) => a + (b - avg) ** 2, 0) / scores.length;
        if (variance < 0.05) break;
      }

      // Query expansion using top result's anchors
      if (roundResults.length > 0) {
        const topEntry = index.entries.find((e: HarmonicIndexEntry) => e.id === roundResults[0].id);
        if (topEntry) {
          currentQuery = query + ' ' + topEntry.cue_anchors.slice(0, 3).join(' ');
        }
      }
    }

    // Deduplicate by id, keep highest score
    const seen = new Map<string, SearchResult>();
    for (const r of results) {
      if (!seen.has(r.id) || r.score > seen.get(r.id)!.score) {
        seen.set(r.id, r);
      }
    }
    return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 10);
  }

  private bm25Search(query: string, entries: HarmonicIndexEntry[], round: number, hopDecay: number): SearchResult[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    return entries.map((entry: HarmonicIndexEntry) => {
      const text = `${entry.primary_abstraction} ${entry.cue_anchors?.join(' ') || ''}`;
      const docTokens = tokenize(text);
      let score = 0;
      for (const qt of queryTokens) {
        for (const dt of docTokens) {
          if (dt === qt || dt.includes(qt) || qt.includes(dt)) {
            score += qt.length / queryTokens.length;
          }
        }
      }
      const inAbstraction = tokenize(entry.primary_abstraction || '').some((t: string) =>
        queryTokens.some((qt: string) => t === qt)
      );
      score *= inAbstraction ? 1.0 : 0.8;
      const energyEffective = entry.energy || 0.5;
      score = score * (0.5 + 0.5 * energyEffective) * hopDecay;
      return { id: entry.id, primary_abstraction: entry.primary_abstraction, score, round, hopDecay };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
  }
}
