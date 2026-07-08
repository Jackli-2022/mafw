import * as fs from 'fs';
import * as path from 'path';
import { HarmonicUnit, HarmonicIndex, HarmonicIndexEntry } from './harmonic-types';

interface HookManagerLike {
  execute(event: string, context: any): Promise<void>;
}

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

  private save(): void {
    this.index.updated_at = new Date().toISOString();
    const tmpPath = this.indexPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.index, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.indexPath);
  }

  addEntry(unit: HarmonicUnit, tier: string): void {
    this.index.entries.push({
      id: unit.id,
      primary_abstraction: unit.primary_abstraction,
      cue_anchors: unit.cue_anchors,
      memory_type: unit.memory_type,
      tier,
      energy: unit.energy
    });
    this.save();
    this.hookManager?.execute('memory.write', {
      unit,
      tier,
      source: 'HarmonicIndexManager.addEntry'
    });
  }

  removeEntry(id: string): void {
    this.index.entries = this.index.entries.filter(e => e.id !== id);
    this.save();
  }

  updateEnergy(id: string, delta: number): void {
    const entry = this.index.entries.find(e => e.id === id);
    if (entry) {
      entry.energy = Math.max(0, Math.min(1, entry.energy + delta));
      this.save();
    }
  }

  search(query: string, topK: number = 20): HarmonicIndexEntry[] {
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
      return { entry, score: score * entry.energy };
    });

    const results = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => s.entry);

    this.hookManager?.execute('memory.recall', {
      query,
      resultIds: results.map(r => r.id),
      source: 'HarmonicIndexManager.search'
    });

    return results;
  }

  getIndex(): HarmonicIndex {
    return { ...this.index, entries: [...this.index.entries] };
  }
}
