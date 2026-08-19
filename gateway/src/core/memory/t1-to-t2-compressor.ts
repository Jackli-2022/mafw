import { T1Store, T1Observation } from './t1-store';
import { CompressionPipeline } from '../compression/compression-pipeline';
import { HarmonicUnit, generateHarmonicId } from './harmonic-types';
import { HarmonicIndexManager } from './harmonic-index';
import { HarmonicUnitFileStore } from '../../memory/harmonic-file-store';
import { calculateSalience } from './salience-perceptor';

export interface T1ToT2Result {
  readFromT1: number;
  compressed: number;
  persisted: number;
  skippedDuplicates: number;
  goalId?: string;
  sessionID?: string;
}

export interface SessionTurnGroup {
  sessionID: string;
  turnID: number;
  observations: T1Observation[];
}

export class T1ToT2Compressor {
  private t1Store: T1Store;
  private pipeline: CompressionPipeline;
  private index: HarmonicIndexManager;
  private baseDir: string;

  constructor(
    t1Store: T1Store,
    pipeline: CompressionPipeline,
    index: HarmonicIndexManager,
    baseDir: string
  ) {
    this.t1Store = t1Store;
    this.pipeline = pipeline;
    this.index = index;
    this.baseDir = baseDir;
  }

  /**
   * Compress all observations for a completed session into T2 units.
   * Groups observations by turn (user_input + tool_results + assistant_reply).
   */
  async compressSession(sessionID: string, goalId?: string): Promise<T1ToT2Result> {
    const gid = goalId || 'default';
    const observations = this.t1Store.readBySession(sessionID, gid);
    if (observations.length === 0) {
      return { readFromT1: 0, compressed: 0, persisted: 0, skippedDuplicates: 0, goalId: gid, sessionID };
    }

    // Group observations by turnID, preserving order
    const turns = new Map<number, T1Observation[]>();
    for (const obs of observations) {
      const tid = obs.turnID || 0;
      if (!turns.has(tid)) turns.set(tid, []);
      turns.get(tid)!.push(obs);
    }

    // Sort turns
    const sortedTurnIds = Array.from(turns.keys()).sort((a, b) => a - b);

    let totalPersisted = 0;
    let totalSkipped = 0;
    let totalRead = observations.length;

    for (const tid of sortedTurnIds) {
      const turnObs = turns.get(tid)!;
      const { compressed, stats } = await this.pipeline.process(turnObs);

      for (const item of compressed) {
        const unit = this.toHarmonicUnit(item, gid, sessionID);
        if (this.isAlreadyIndexed(unit.id)) {
          totalSkipped++;
          continue;
        }
        await this.appendToMemories(unit);
        totalPersisted++;
      }
    }

    this.t1Store.clearSession(sessionID, gid);

    return {
      readFromT1: totalRead,
      compressed: totalPersisted + totalSkipped,
      persisted: totalPersisted,
      skippedDuplicates: totalSkipped,
      goalId: gid,
      sessionID,
    };
  }

  /** Compress all observations for a goal (legacy, ungrouped) */
  async run(goalId?: string): Promise<T1ToT2Result> {
    const gid = goalId || 'default';
    const observations = this.t1Store.readAll(gid);
    if (observations.length === 0) {
      return { readFromT1: 0, compressed: 0, persisted: 0, skippedDuplicates: 0, goalId: gid };
    }
    const { compressed, stats } = await this.pipeline.process(observations);
    let persisted = 0;
    let skipped = 0;
    for (const item of compressed) {
      const unit = this.toHarmonicUnit(item, gid);
      if (this.isAlreadyIndexed(unit.id)) { skipped++; continue; }
      await this.appendToMemories(unit);
      persisted++;
    }
    this.t1Store.clear(gid);
    return { readFromT1: observations.length, compressed: stats.compressed || compressed.length, persisted, skippedDuplicates: skipped, goalId: gid };
  }

  private toHarmonicUnit(item: any, goalId: string, sessionID?: string): HarmonicUnit {
    const memoryValue = item.facts
      ? (Array.isArray(item.facts) ? item.facts.join('\n') : String(item.facts))
      : item.fact || '';

    const anchors = item.concepts
      ? (Array.isArray(item.concepts) ? item.concepts : [item.concepts])
      : item.concept
        ? [item.concept]
        : [];

    const energy = typeof item.energy === 'number' ? item.energy : 0.5;

    return {
      id: generateHarmonicId(),
      type: 'episodic',
      primary_abstraction: memoryValue.slice(0, 50),
      cue_anchors: anchors.slice(0, 8),
      memory_value: memoryValue,
      energy: Math.max(0, Math.min(1, energy)),
      salience: calculateSalience(memoryValue),
      abstraction_level: 1,
      goal_id: goalId !== 'default' ? goalId : undefined,
      source_session_id: sessionID,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  private isAlreadyIndexed(id: string): boolean {
    return this.index.getIndex().entries.some(e => e.id === id);
  }

  private async appendToMemories(unit: HarmonicUnit): Promise<void> {
    const store = new HarmonicUnitFileStore(this.baseDir, this.index);
    await store.write(unit);
  }
}
