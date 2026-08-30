import { HarmonicIndexManager } from '../core/memory/harmonic-index';
import { HarmonicIndexEntry } from '../core/memory/harmonic-types';

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

/** Per-hop decay: first hop full strength, subsequent hops progressively damped. */
const HOP_DECAY = [1.0, 0.9, 0.75];

/** BM25 parameters matching production HarmonicIndexManager. */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

export class GuidedRetriever {
  private indexManager: HarmonicIndexManager;

  constructor(indexManager: HarmonicIndexManager) {
    this.indexManager = indexManager;
  }

  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const policy = options.policy || 'guided';
    const maxRounds = options.maxRounds || 3;
    const results: SearchResult[] = [];
    const index = this.indexManager.getIndex();
    const entries = index.entries;

    if (policy === 'oneshot') {
      return this.bm25Search(query, entries, 0, 1.0).slice(0, 10);
    }

    let currentQuery = query;
    for (let round = 0; round < maxRounds; round++) {
      const hopDecay = HOP_DECAY[round] ?? HOP_DECAY[HOP_DECAY.length - 1];
      const roundResults = this.bm25Search(currentQuery, entries, round, hopDecay);
      results.push(...roundResults);

      // Saturation detection: stop expanding if results are already excellent
      // or if additional rounds aren't surfacing new relevant entries.
      if (roundResults.length > 0 && roundResults[0].score >= 0.8) break;
      if (roundResults.length >= 3) {
        const scores = roundResults.slice(0, 3).map(r => r.score);
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((a, b) => a + (b - avg) ** 2, 0) / scores.length;
        // Only stop early if scores are uniformly high AND low variance
        if (variance < 0.01 && avg > 0.5) break;
      }

      // Query expansion: append top result's cue_anchors to query for next hop
      if (roundResults.length > 0) {
        const topEntry = entries.find((e: HarmonicIndexEntry) => e.id === roundResults[0].id);
        if (topEntry && topEntry.cue_anchors?.length) {
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

  /**
   * Production-quality BM25 scoring: k1=1.2, b=0.75, with energy × salience
   * weighting and superseded/merged_from penalties — matches
   * HarmonicIndexManager.bm25SearchScored() semantics.
   */
  private bm25Search(
    query: string,
    entries: HarmonicIndexEntry[],
    round: number,
    hopDecay: number,
  ): SearchResult[] {
    const N = entries.length;
    if (N === 0) return [];

    const queryTokens = this.tokenizeBM25(query);
    if (queryTokens.length === 0) return [];

    const docs = entries.map(entry => {
      const text = (entry.primary_abstraction + ' ' + (entry.cue_anchors?.join(' ') || '')).toLowerCase();
      return { entry, toks: this.tokenizeBM25(text) };
    });
    const docLengths = docs.map(d => d.toks.length);
    const avgdl = docLengths.reduce((a, c) => a + c, 0) / N;

    // Document frequency for query tokens
    const df = new Map<string, number>();
    for (const d of docs) {
      for (const t of new Set(d.toks)) {
        df.set(t, (df.get(t) || 0) + 1);
      }
    }

    const idf = new Map<string, number>();
    for (const t of queryTokens) {
      const dfT = df.get(t) || 0;
      idf.set(t, Math.log((N - dfT + 0.5) / (dfT + 0.5) + 1));
    }

    const scored: SearchResult[] = [];
    docs.forEach((d, i) => {
      const dl = docLengths[i];
      let score = 0;
      for (const t of queryTokens) {
        let tf = 0;
        for (const tok of d.toks) if (tok === t) tf++;
        if (tf === 0) continue;
        score += (idf.get(t) || 0) * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl)));
      }
      if (score > 0) {
        // Apply energy × salience weighting and superseded/merged penalties
        const energy = d.entry.energy || 0.5;
        const salience = d.entry.salience ?? 1;
        const supersededPenalty = d.entry.superseded_by ? 0.5 : 1;
        const mergedPenalty = (d.entry.merged_from?.length ?? 0) > 0 ? 0.8 : 1;
        score = score * energy * salience * supersededPenalty * mergedPenalty * hopDecay;
        scored.push({
          id: d.entry.id,
          primary_abstraction: d.entry.primary_abstraction,
          score,
          round,
          hopDecay,
        });
      }
    });

    return scored.sort((a, b) => b.score - a.score);
  }

  /**
   * Tokenize text for BM25: lowercase words (len>=2) + CJK unigrams.
   * Matches HarmonicIndexManager.tokenizeBM25() semantics.
   */
  private tokenizeBM25(text: string): string[] {
    const tokens: string[] = [];
    const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 2);
    tokens.push(...words);
    const cjk = text.toLowerCase().match(/[\u4e00-\u9fff]/g) || [];
    tokens.push(...cjk);
    return tokens;
  }
}
