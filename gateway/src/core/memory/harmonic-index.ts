import * as fs from 'fs';
import * as path from 'path';
import { HarmonicUnit, HarmonicIndex, HarmonicIndexEntry } from './harmonic-types';
import { eventBus } from '../../event-bus';

import type { Reranker } from './reranker';

interface HookManagerLike {
  execute(event: string, context: any): Promise<void>;
}

export interface SearchOptions {
  retriever?: 'token' | 'bm25';
  /** Drop results below topScore × cutoffRatio after retrieval (0 = disabled). */
  cutoffRatio?: number;
}

export interface ScoredEntry {
  entry: HarmonicIndexEntry;
  score: number;
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;

export class HarmonicIndexManager {
  private indexPath: string;
  private index: HarmonicIndex;
  private hookManager: HookManagerLike | null;

  constructor(baseDir: string, hookManager?: HookManagerLike | null) {
    const memoryDir = path.join(baseDir, 'memory');
    this.indexPath = path.join(memoryDir, '.harmonic_index.json');
    this.index = this.load();
    this.hookManager = hookManager || null;
  }

  private load(): HarmonicIndex {
    try {
      if (fs.existsSync(this.indexPath)) {
        return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
      }
    } catch {}
    return { version: 1, updated_at: new Date().toISOString(), entries: [] };
  }

  save(): void {
    this.index.updated_at = new Date().toISOString();
    const tmpPath = this.indexPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.index, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.indexPath);
  }

  addEntry(unit: HarmonicUnit, tier: string): void {
    this.index.entries.push({
      id: unit.id,
      type: unit.type || (unit as any).memory_type || 'semantic',
      primary_abstraction: unit.primary_abstraction,
      cue_anchors: unit.cue_anchors,
      tier,
      energy: unit.energy,
      salience: unit.salience,
      superseded_by: unit.superseded_by,
      merged_from: unit.merged_from,
      filePath: (unit as any).filePath,
      created_at: unit.created_at,
      source_session_id: unit.source_session_id,
    });
    this.save();
    this.hookManager?.execute('memory.write', {
      unit,
      tier,
      source: 'HarmonicIndexManager.addEntry'
    });
    eventBus.emit('memory_written', {
      type: 'memory_written',
      id: unit.id,
      memory_type: unit.type || 'semantic',
      primary_abstraction: unit.primary_abstraction,
      energy: unit.energy,
      tier,
    });
  }

  removeEntry(id: string): void {
    this.index.entries = this.index.entries.filter(e => e.id !== id);
    this.save();
  }

  updateEnergy(id: string, delta: number): void {
    const entry = this.index.entries.find(e => e.id === id);
    if (entry) {
      const before = entry.energy;
      entry.energy = Math.max(0, Math.min(1, entry.energy + delta));
      this.save();
      eventBus.emit('memory_energy_changed', {
        type: 'memory_energy_changed',
        id,
        from: before,
        to: entry.energy,
        delta,
      });
    }
  }

  searchScored(query: string, topK: number = 20, options: SearchOptions = {}): ScoredEntry[] {
    let scored: ScoredEntry[];
    if (options.retriever === 'bm25') {
      scored = this.bm25SearchScored(query, topK);
    } else {
      scored = this.tokenSearchScored(query, topK);
    }

    const cutoffRatio = options.cutoffRatio ?? 0;
    if (cutoffRatio > 0 && scored.length > 0) {
      const threshold = scored[0].score * cutoffRatio;
      scored = scored.filter(s => s.score >= threshold);
    }

    scored = scored.slice(0, topK);

    this.hookManager?.execute('memory.recall', {
      query,
      resultIds: scored.map(r => r.entry.id),
      source: options.retriever === 'bm25' ? 'HarmonicIndexManager.bm25Search' : 'HarmonicIndexManager.search'
    });

    return scored;
  }

  private tokenSearchScored(query: string, topK: number = 20): ScoredEntry[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    if (tokens.length === 0) return [];

    const scored = this.index.entries.map(entry => {
      const text = (entry.primary_abstraction + ' ' + entry.cue_anchors.join(' ')).toLowerCase();
      let score = 0;
      for (const token of tokens) {
        const regex = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        const matches = text.match(regex);
        if (matches) score += matches.length;
      }
      return { entry, score: score * entry.energy * (entry.salience ?? 1) * (entry.superseded_by ? 0.5 : 1) * ((entry.merged_from?.length ?? 0) > 0 ? 0.8 : 1) };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  search(query: string, topK: number = 20, options: SearchOptions = {}): HarmonicIndexEntry[] {
    return this.searchScored(query, topK, options).map(s => s.entry);
  }

  /**
   * BM25 retrieval computed on-the-fly over .harmonic_index.json entries at query
   * time (no separate index file persisted). k1=1.2, b=0.75, final score × energy × salience.
   * Tokenization is shared with bm25-index.ts semantics: lowercase words (len>=2)
   * + CJK unigrams.
   */
  bm25SearchScored(query: string, topK: number = 20): ScoredEntry[] {
    const entries = this.index.entries;
    const N = entries.length;
    if (N === 0) return [];

    const queryTokens = this.tokenizeBM25(query);
    if (queryTokens.length === 0) return [];

    // LongMemEval (98% of session transcripts >1000 chars) proved truncating
    // abstractions for retrieval destroys answer recall — BM25's length
    // normalization (b=0.75) already handles long documents. Mega-merge blob
    // pollution is instead handled at write time (B4 length cap) and via the
    // merged_from penalty (A2).
    const docs = entries.map(entry => {
      const text = (entry.primary_abstraction + ' ' + entry.cue_anchors.join(' ')).toLowerCase();
      return { entry, toks: this.tokenizeBM25(text) };
    });
    const docLengths = docs.map(d => d.toks.length);
    const avgdl = docLengths.reduce((a, c) => a + c, 0) / N;

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

    const scored: Array<{ entry: HarmonicIndexEntry; score: number }> = [];
    docs.forEach((d, i) => {
      const dl = docLengths[i];
      let score = 0;
      for (const t of queryTokens) {
        let tf = 0;
        for (const tok of d.toks) if (tok === t) tf++;
        if (tf === 0) continue;
        score += (idf.get(t) || 0) * (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl)));
      }
      if (score > 0) scored.push({ entry: d.entry, score: score * d.entry.energy * (d.entry.salience ?? 1) * (d.entry.superseded_by ? 0.5 : 1) * ((d.entry.merged_from?.length ?? 0) > 0 ? 0.8 : 1) });
    });

    const results = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return results;
  }

  bm25Search(query: string, topK: number = 20): HarmonicIndexEntry[] {
    return this.bm25SearchScored(query, topK).map(s => s.entry);
  }

  private tokenizeBM25(text: string): string[] {
    const tokens: string[] = [];
    const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 2);
    tokens.push(...words);
    const cjk = text.toLowerCase().match(/[\u4e00-\u9fff]/g) || [];
    tokens.push(...cjk);
    return tokens;
  }

  getIndex(): HarmonicIndex {
    return { ...this.index, entries: [...this.index.entries] };
  }
}
