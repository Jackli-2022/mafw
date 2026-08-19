import * as fs from 'fs';
import * as path from 'path';
import { HarmonicUnit } from '../core/memory/harmonic-types';
import { HarmonicIndexManager } from '../core/memory/harmonic-index';
import { CognitiveGraphManager } from '../core/memory/cognitive-graph';
import { writeOKFFile, getOKFDirectory } from './okf-writer';
import { readOKFFile } from './okf-parser';
import { EventLog } from './event-log';
import { WriteQueue } from './write-queue';
import { AnchorGraph } from '../graph/anchor-graph';
import { tokenize, extractDerivedTerms } from './derived-terms';
import { MinHashMerger } from '../core/memory/minhash-merger';

export class HarmonicUnitFileStore {
  private indexManager: HarmonicIndexManager;
  private graphManager: CognitiveGraphManager;
  private eventLog: EventLog;
  private writeQueue: WriteQueue;
  private anchorGraph: AnchorGraph;
  private minHashMerger: MinHashMerger;

  constructor(private baseDir: string, indexManager?: HarmonicIndexManager) {
    this.indexManager = indexManager || new HarmonicIndexManager(baseDir);
    this.graphManager = new CognitiveGraphManager(baseDir);
    this.eventLog = new EventLog(baseDir);
    this.writeQueue = new WriteQueue();
    this.anchorGraph = new AnchorGraph();
    this.minHashMerger = new MinHashMerger();
  }

  async write(unit: HarmonicUnit, tier?: string, opts?: { skipMerge?: boolean }): Promise<string> {
    let fileName = '';
    // C: auto-fill missing cue_anchors from the abstraction so every memory
    // has retrievable anchors (only 13% of entries had them previously).
    if (!unit.cue_anchors || unit.cue_anchors.length === 0) {
      unit.cue_anchors = extractAnchors(unit.primary_abstraction);
    }
    await this.writeQueue.enqueue(async () => {
      // Cross-tier merge check: if the incoming unit is highly similar to an
      // existing memory, fold the existing one into it (skipped when the unit
      // is itself the product of a merge, or the caller opts out — e.g. the
      // LongMemEval benchmark ingests one deterministic unit per round and must
      // not be collapsed).
      let targetUnit = unit;
      if (!opts?.skipMerge) {
        const merged = await this.minHashMerger.merge(unit, this.indexManager, {
          read: (id) => this.read(id),
          deleteSync: (id) => this.deleteSync(id),
          markSuperseded: (id, byId) => this.markSuperseded(id, byId),
        });
        targetUnit = merged.merged_from?.length ? merged : unit;
      }

      fileName = writeOKFFile(this.baseDir, targetUnit);

      const entryTier = tier || (targetUnit.type === 'semantic' && targetUnit.granularity ? 'knowledge'
        : targetUnit.type === 'procedural' ? 'procedural'
        : targetUnit.type === 'episodic' ? 'episodic'
        : targetUnit.type === 'global' ? 'global'
        : 'semantic');

      this.indexManager.addEntry({
        id: targetUnit.id,
        type: targetUnit.type,
        primary_abstraction: targetUnit.primary_abstraction,
        cue_anchors: targetUnit.cue_anchors,
        tier: entryTier,
        energy: targetUnit.energy,
      salience: targetUnit.salience,
      superseded_by: targetUnit.superseded_by,
      // filePath must reflect the ACTUAL on-disk directory (getOKFDirectory
        // keys off unit.type), not the tier label — a tier arg such as 'tier3'
        // does not relocate the file. read() resolves via this path.
        filePath: path.join('memory', getOKFDirectory(targetUnit), fileName).replace(/\\/g, '/'),
        source_session_id: targetUnit.source_session_id,
      } as any, entryTier);

      const linkRegex = /\[\[([^\]]+)\]\]/g;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(targetUnit.memory_value)) !== null) {
        this.graphManager.addConnection(targetUnit.id, match[1]);
      }
    });

    // Extract derived terms (index-only, not written to frontmatter)
    const derivedTerms = extractDerivedTerms(unit.memory_value);

    // Add to anchor graph for implicit edge computation
    this.anchorGraph.addUnit(unit.id, unit.cue_anchors);

    // Log via event log
    this.eventLog.appendWrite(unit.id, {
      primary: unit.primary_abstraction,
      anchors: unit.cue_anchors,
      terms: tokenize(unit.primary_abstraction + ' ' + unit.cue_anchors.join(' ')),
      derived: derivedTerms,
    });

    return fileName;
  }

  async read(id: string): Promise<HarmonicUnit | null> {
    const index = this.indexManager.getIndex();
    const entry = index.entries.find(e => e.id === id);
    if (!entry || !(entry as any).filePath) return null;

    const fullPath = path.join(this.baseDir, (entry as any).filePath);
    if (!fs.existsSync(fullPath)) return null;

    const { unit, body } = readOKFFile(fullPath);
    return {
      ...unit as any,
      memory_value: body,
      updated_at: new Date().toISOString(),
    };
  }

  public indexManager_(): HarmonicIndexManager {
    return this.indexManager;
  }

  /**
   * Mark an existing memory as superseded by a newer unit instead of deleting
   * it. Lowers its energy and writes `superseded_by` into the OKF frontmatter.
   * Called from inside the serialized write path (MinHash merge).
   */
  markSuperseded(id: string, byId: string): boolean {
    const entry = this.indexManager.getIndex().entries.find(e => e.id === id);
    if (!entry || !(entry as any).filePath) return false;
    const fullPath = path.join(this.baseDir, (entry as any).filePath);
    if (!fs.existsSync(fullPath)) return false;

    const { unit, body } = readOKFFile(fullPath);
    unit.superseded_by = byId;
    unit.energy = Math.max(0.1, (unit.energy ?? entry.energy) * 0.5);
    unit.updated_at = new Date().toISOString();

    const yaml = require('js-yaml');
    const yamlStr = yaml.dump(unit, { lineWidth: -1, quotingType: '"' });
    const tmpPath = fullPath + '.tmp';
    fs.writeFileSync(tmpPath, `---\n${yamlStr}---\n${body}\n`, 'utf-8');
    fs.renameSync(tmpPath, fullPath);

    entry.energy = unit.energy;
    (entry as any).superseded_by = byId;
    this.indexManager.save();
    return true;
  }

  /**
   * Synchronous delete used inside the serialized write path (merge) and
   * exposed for tests. Removes the index entry and the OKF file.
   */
  deleteSync(id: string): boolean {
    const entry = this.indexManager.getIndex().entries.find(e => e.id === id);
    if (!entry) return false;
    if ((entry as any).filePath) {
      const fullPath = path.join(this.baseDir, (entry as any).filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    this.indexManager.removeEntry(id);
    return true;
  }

  async delete(id: string): Promise<boolean> {
    let removed = false;
    await this.writeQueue.enqueue(async () => {
      const index = this.indexManager.getIndex();
      const entry = index.entries.find(e => e.id === id);
      if (!entry) return;
      removed = true;
      if ((entry as any).filePath) {
        const fullPath = path.join(this.baseDir, (entry as any).filePath);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      }
      this.indexManager.removeEntry(id);
    });
    return removed;
  }

  async archive(id: string): Promise<void> {
    const index = this.indexManager.getIndex();
    const entry = index.entries.find(e => e.id === id);
    if (!entry || !(entry as any).filePath) return;

    const fullPath = path.join(this.baseDir, (entry as any).filePath);
    if (!fs.existsSync(fullPath)) return;

    const { unit, body } = readOKFFile(fullPath);
    unit.archived = true;
    unit.updated_at = new Date().toISOString();

    const yaml = require('js-yaml');
    const yamlStr = yaml.dump(unit, { lineWidth: -1, quotingType: '"' });
    const tmpPath = fullPath + '.tmp';
    fs.writeFileSync(tmpPath, `---\n${yamlStr}---\n${body}\n`, 'utf-8');
    fs.renameSync(tmpPath, fullPath);
  }
}

/** Extract 2-5 cue anchors from a primary_abstraction when none were provided.
 *  Picks the most frequent lowercase words (len>=4) plus notable tokens. */
function extractAnchors(abstraction: string): string[] {
  if (!abstraction) return [];
  const words = abstraction.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const stop = new Set(['with', 'this', 'that', 'from', 'have', 'must', 'should', 'when', 'into', 'will', 'also', 'they', 'them', 'then', 'than', 'which', 'their', 'there']);
  const anchors = sorted.filter(([w]) => !stop.has(w)).map(([w]) => w);
  // ensure coverage: pick first 5 distinct tokens (word-level), fall back to CJK
  if (anchors.length < 2) {
    const cjk = abstraction.match(/[\u4e00-\u9fff]/g) || [];
    for (const c of [...new Set(cjk)].slice(0, 3)) anchors.push(c);
  }
  return anchors.slice(0, 5);
}
