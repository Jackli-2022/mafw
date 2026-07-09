import * as fs from 'fs';
import * as path from 'path';
import { HarmonicUnit, generateHarmonicId } from './harmonic-types';
import { HarmonicIndexManager } from './harmonic-index';
import { L5Store } from './l5-store';

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

function loadTierUnits(baseDir: string, tier: string): HarmonicUnit[] {
  const filePath = path.join(baseDir, 'memory', `${tier}.json`);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function saveTierUnits(baseDir: string, tier: string, units: HarmonicUnit[]): void {
  const memoryDir = path.join(baseDir, 'memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  fs.writeFileSync(path.join(memoryDir, `${tier}.json`), JSON.stringify(units, null, 2), 'utf-8');
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
    const key = getSimilarityKey(entry.primary_abstraction);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(entry);
  }

  for (const [, entries] of groups) {
    if (entries.length < 3) continue;

    const oldIds = entries.map(e => e.id);

    // Load full unit data from tier2 files
    const tier2Units = loadTierUnits(baseDir, 'tier2');
    const matchedUnits = tier2Units.filter(u => oldIds.includes(u.id));

    if (matchedUnits.length < 3) {
      result.errors.push(`Found ${entries.length} index entries but only ${matchedUnits.length} full units`);
      continue;
    }

    // Merge
    const mergedAnchors = [...new Set(matchedUnits.flatMap(u => u.cue_anchors))];
    const mergedValue = matchedUnits.map(u => u.memory_value).join('\n');

    const newUnit: HarmonicUnit = {
      id: generateHarmonicId(),
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
    const existingT3 = loadTierUnits(baseDir, 'tier3');
    existingT3.push(newUnit);
    saveTierUnits(baseDir, 'tier3', existingT3);

    indexManager.addEntry(newUnit, 'tier3');
    result.created++;

    // Lock old T2 units
    for (const oldId of oldIds) {
      indexManager.updateEnergy(oldId, -0.5);
      result.locked++;
    }
  }

  // Rule 2: T4 Procedural → L5 Global
  const l5Store = new L5Store();
  const t4Created = distillT4toL5(indexManager, baseDir, l5Store);
  result.created += t4Created;

  return result;
}

export function distillT4toL5(
  indexManager: HarmonicIndexManager,
  baseDir: string,
  l5Store: L5Store,
): number {
  const index = indexManager.getIndex();
  const t4Entries = index.entries.filter(e => e.tier === 'tier4' && e.memory_type === 'procedural');

  if (t4Entries.length < 5) return 0;

  // Group by similar patterns (first 3 sorted words)
  const groups = new Map<string, typeof t4Entries>();
  for (const entry of t4Entries) {
    const key = entry.primary_abstraction
      .toLowerCase()
      .split(/\s+/)
      .sort()
      .slice(0, 3)
      .join(' ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  let created = 0;
  for (const [key, entries] of groups) {
    if (entries.length < 5) continue;

    const triggerContext = [...new Set(entries.flatMap(e => e.cue_anchors))];
    const sourceGoalIds = entries
      .map(e => e.goal_id)
      .filter((id): id is string => !!id);

    const heuristic = l5Store.addHeuristic(
      key,
      triggerContext.slice(0, 8),
      [...new Set(sourceGoalIds)]
    );
    created++;

    // Lock old T4 entries (reduce energy)
    for (const entry of entries) {
      indexManager.updateEnergy(entry.id, -0.3);
    }
  }

  return created;
}
