// One-time archival of the legacy spiral-*.jsonl T1 observation files (turnID
// era before the SQLite T1 store). Files move into tier1/archive/ (preserving
// the goalId subdirectory structure) so nothing is lost. Idempotent via an
// ARCHIVED marker file.
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/utils/logger';

export function archiveLegacyT1(projectDirs: string[]): { archived: number; projects: number } {
  let archived = 0;
  let projects = 0;
  for (const projectDir of projectDirs) {
    const tier1 = path.join(projectDir, '.mafw', 'memory', 'tier1');
    if (!fs.existsSync(tier1)) continue;
    const archive = path.join(tier1, 'archive');
    if (fs.existsSync(path.join(archive, 'ARCHIVED'))) continue;

    // spiral files live under tier1/<goalId>/ (and legacy flat tier1/).
    const spiralFiles: Array<{ from: string; rel: string }> = [];
    const scan = (dir: string, relDir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'archive') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(full, path.join(relDir, entry.name));
        else if (entry.name.endsWith('.jsonl')) spiralFiles.push({ from: full, rel: path.join(relDir, entry.name) });
      }
    };
    scan(tier1, '');

    if (spiralFiles.length === 0) continue;
    try {
      for (const f of spiralFiles) {
        const dest = path.join(archive, f.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(f.from, dest);
      }
      fs.writeFileSync(path.join(archive, 'ARCHIVED'), new Date().toISOString(), 'utf-8');
      archived += spiralFiles.length;
      projects++;
      log.info(`[t1-archive] moved ${spiralFiles.length} legacy spiral files to ${archive}`);
    } catch (err: any) {
      log.warn(`[t1-archive] failed for ${tier1}: ${err.message}`);
    }
  }
  return { archived, projects };
}
