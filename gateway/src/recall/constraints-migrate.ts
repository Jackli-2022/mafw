// One-time migration of the legacy pinned-constraints channel
// (.mafw/constraints.json) into the harmonic memory system. User constraints
// become ordinary semantic memories (goal-independent, high energy) so there
// is no standalone read-only channel outside the harmonic store.
//
// Idempotent: the renamed backup file (constraints.migrated.json) marks a
// project as already migrated; second runs skip it.
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';

export interface MigrateConstraintsResult {
  migrated: number;
  renamed: number;
  skipped: number;
}

export async function migrateConstraintsFiles(projectDirs: string[]): Promise<MigrateConstraintsResult> {
  const result: MigrateConstraintsResult = { migrated: 0, renamed: 0, skipped: 0 };

  for (const projectDir of projectDirs) {
    const mafwDir = path.join(projectDir, '.mafw');
    const file = path.join(mafwDir, 'constraints.json');
    const backup = path.join(mafwDir, 'constraints.migrated.json');
    // Check the backup marker first: after a successful migration the source
    // file is gone, so a plain `existsSync(file)` skip would never count it.
    if (fs.existsSync(backup)) {
      result.skipped++;
      continue;
    }
    if (!fs.existsSync(file)) continue;

    let texts: string[] = [];
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      texts = Array.isArray(raw) ? raw : Array.isArray(raw?.constraints) ? raw.constraints : [];
      texts = texts.filter((t) => typeof t === 'string' && t.trim().length > 0);
    } catch (err: any) {
      log.warn(`[constraints-migrate] unparseable ${file}: ${err.message}; leaving file`);
      result.skipped++;
      continue;
    }

    if (texts.length === 0) {
      fs.renameSync(file, backup);
      result.renamed++;
      continue;
    }

    try {
      const { HarmonicUnitFileStore } = await import('../memory/harmonic-file-store.js');
      const { generateHarmonicId } = await import('../core/memory/harmonic-types.js');
      const store = new HarmonicUnitFileStore(mafwDir);
      const now = new Date().toISOString();
      for (const text of texts) {
        const unit = {
          id: generateHarmonicId(),
          type: 'semantic' as const,
          primary_abstraction: text.slice(0, 80),
          cue_anchors: [],
          memory_value: text,
          energy: 0.9,
          salience: 1.0,
          abstraction_level: 2,
          created_at: now,
          updated_at: now,
        };
        await store.write(unit);
        result.migrated++;
      }
      fs.renameSync(file, backup);
      result.renamed++;
      log.info(
        `[constraints-migrate] ${texts.length} constraints → harmonic memory; ${file} → constraints.migrated.json`,
      );
    } catch (err: any) {
      log.warn(`[constraints-migrate] failed for ${file}: ${err.message}; keeping file`);
      result.skipped++;
    }
  }

  return result;
}
