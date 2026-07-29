import * as fs from 'fs';
import * as path from 'path';
import { HarmonicUnit } from '../core/memory/harmonic-types';
import { HarmonicIndexManager } from '../core/memory/harmonic-index';
import { CognitiveGraphManager } from '../core/memory/cognitive-graph';
import { writeOKFFile } from './okf-writer';
import { readOKFFile } from './okf-parser';
import { EventLog } from './event-log';
import { WriteQueue } from './write-queue';
import { AnchorGraph } from '../graph/anchor-graph';
import { tokenize, extractDerivedTerms } from './derived-terms';

export class HarmonicUnitFileStore {
  private indexManager: HarmonicIndexManager;
  private graphManager: CognitiveGraphManager;
  private eventLog: EventLog;
  private writeQueue: WriteQueue;
  private anchorGraph: AnchorGraph;

  constructor(private baseDir: string, indexManager?: HarmonicIndexManager) {
    this.indexManager = indexManager || new HarmonicIndexManager(baseDir);
    this.graphManager = new CognitiveGraphManager(baseDir);
    this.eventLog = new EventLog(baseDir);
    this.writeQueue = new WriteQueue();
    this.anchorGraph = new AnchorGraph();
  }

  async write(unit: HarmonicUnit, tier?: string): Promise<string> {
    let fileName = '';
    await this.writeQueue.enqueue(async () => {
      fileName = writeOKFFile(this.baseDir, unit);

      const entryTier = tier || (unit.type === 'semantic' && unit.granularity ? 'knowledge'
        : unit.type === 'procedural' ? 'procedural'
        : unit.type === 'episodic' ? 'episodic' : 'semantic');

      this.indexManager.addEntry({
        id: unit.id,
        type: unit.type,
        primary_abstraction: unit.primary_abstraction,
        cue_anchors: unit.cue_anchors,
        tier: entryTier,
        energy: unit.energy,
        filePath: path.join('memory', 'concepts', entryTier, fileName).replace(/\\/g, '/'),
      } as any, entryTier);

      const linkRegex = /\[\[([^\]]+)\]\]/g;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(unit.memory_value)) !== null) {
        this.graphManager.addConnection(unit.id, match[1]);
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
