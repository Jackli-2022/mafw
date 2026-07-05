import * as fs from 'fs';
import * as path from 'path';
import { HarmonicUnit, generateHarmonicId } from './harmonic-types';
import { HarmonicIndexManager } from './harmonic-index';

export interface DistillationResult {
  created: number;
  locked: number;
  errors: string[];
}

function getSimilarityKey(abstraction: string): string {
  return abstraction
    .toLowerCase()
    .split(/\s+/)
    .sort()
    .slice(0, 3)
    .join(' ');
}

function loadTierUnits(baseDir: string, tier: string, goalId: string): HarmonicUnit[] {
  const filePath = path.join(baseDir, 'memory', tier, `${goalId}.json`);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function saveTierUnits(baseDir: string, tier: string, goalId: string, units: HarmonicUnit[]): void {
  const dirPath = path.join(baseDir, 'memory', tier);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  fs.writeFileSync(path.join(dirPath, `${goalId}.json`), JSON.stringify(units, null, 2), 'utf-8');
}

export async function runDistillation(
  indexManager: HarmonicIndexManager,
  baseDir: string
): Promise<DistillationResult> {
  const result: DistillationResult = { created: 0, locked: 0, errors: [] };
  const index = indexManager.getIndex();

  // Rule 1: T2 Episodic → T3 Semantic
  const t2Entries = index.entries.filter(e => e.tier === 'tier2' && e.memory_type === 'episodic');

  const groups = new Map<string, typeof t2Entries>();
  for (const entry of t2Entries) {
    const goalKey = entry.goal_id || '__global__';
    const key = `${goalKey}::${getSimilarityKey(entry.primary_abstraction)}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(entry);
  }

  for (const [, entries] of groups) {
    if (entries.length < 3) continue;

    const goalId = entries[0].goal_id || '__global__';
    const oldIds = entries.map(e => e.id);

    // Load full unit data from tier2 files
    const tier2Units = loadTierUnits(baseDir, 'tier2', goalId);
    const matchedUnits = tier2Units.filter(u => oldIds.includes(u.id));

    if (matchedUnits.length < 3) {
      result.errors.push(`Found ${entries.length} index entries but only ${matchedUnits.length} full units for goal ${goalId}`);
      continue;
    }

    // Merge
    const mergedAnchors = [...new Set(matchedUnits.flatMap(u => u.cue_anchors))];
    const mergedValue = matchedUnits.map(u => u.memory_value).join('\n');

    const newUnit: HarmonicUnit = {
      id: generateHarmonicId(),
      goal_id: goalId,
      memory_type: 'semantic',
      primary_abstraction: matchedUnits[0].primary_abstraction,
      cue_anchors: mergedAnchors,
      memory_value: mergedValue,
      energy: 0.8,
      merged_from: oldIds,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Write to tier3 file (append to array)
    const existingT3 = loadTierUnits(baseDir, 'tier3', goalId);
    existingT3.push(newUnit);
    saveTierUnits(baseDir, 'tier3', goalId, existingT3);

    indexManager.addEntry(newUnit, 'tier3');
    result.created++;

    // Lock old T2 units
    for (const oldId of oldIds) {
      indexManager.updateEnergy(oldId, -0.5);
      result.locked++;
    }
  }

  // Rule 2: T4 Procedural → L5 Global (count only)
  const t4Entries = index.entries.filter(e => e.tier === 'tier4' && e.memory_type === 'procedural');
  const t4ByGoal = new Map<string, number>();
  for (const entry of t4Entries) {
    const gid = entry.goal_id || 'null';
    t4ByGoal.set(gid, (t4ByGoal.get(gid) || 0) + 1);
  }
  for (const [gid, count] of t4ByGoal) {
    if (count >= 5) {
      console.log(`[AbstractionDistiller] Goal ${gid} has ${count} T4 entries (threshold: 5). L5 creation not yet implemented.`);
    }
  }

  return result;
}
