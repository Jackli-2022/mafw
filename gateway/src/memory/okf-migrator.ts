import { log } from '../core/utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import { HarmonicUnit } from '../core/memory/harmonic-types';
import { HarmonicUnitFileStore } from './harmonic-file-store';
import { renderIndexMd } from './okf-index-renderer';

export async function migrateFromJson(mafwDir: string): Promise<{ migrated: number; skipped: number }> {
  const memPath = path.join(mafwDir, 'memory', 'memories.json');
  if (!fs.existsSync(memPath)) return { migrated: 0, skipped: 0 };

  const units: HarmonicUnit[] = JSON.parse(fs.readFileSync(memPath, 'utf-8'));
  const store = new HarmonicUnitFileStore(mafwDir);
  let migrated = 0;
  let skipped = 0;

  for (const unit of units) {
    if (unit.type === 'episodic') {
      skipped++;
      continue;
    }
    try {
      await store.write(unit);
      migrated++;
    } catch (err) {
      log.warn(`[migrate] Failed to migrate ${unit.id}: ${err}`);
      skipped++;
    }
  }

  // Backup old file
  fs.renameSync(memPath, memPath + '.bak');

  // Render index.md
  const { HarmonicIndexManager } = require('../core/memory/harmonic-index');
  const indexManager = new HarmonicIndexManager(mafwDir);
  renderIndexMd(mafwDir, indexManager);

  return { migrated, skipped };
}



