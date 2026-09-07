// Undo MinHash merge blobs in ~/.mafw/memory (see src/memory/unmerge-cleanup.ts).
//
//   npx ts-node scripts/unmerge-blobs.ts          # dry-run: print plan
//   npx ts-node scripts/unmerge-blobs.ts --apply  # backup + execute
//   npx ts-node scripts/unmerge-blobs.ts --apply --force  # skip gateway-running guard
//
// MUST run with the gateway stopped (it holds the harmonic index in memory
// and would overwrite our edits on the next save).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { planUnmerge, CleanupEntry } from '../src/memory/unmerge-cleanup';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const MEM_DIR = path.join(os.homedir(), '.mafw', 'memory');
const INDEX_PATH = path.join(MEM_DIR, '.harmonic_index.json');
// Index entry filePath values are relative to the gateway data root
// (~/.mafw) —e.g. 'memory/concepts/semantic/<file>.md' —NOT to MEM_DIR.
const FILE_ROOT = path.join(os.homedir(), '.mafw');
const CONCEPTS_DIR = path.join(FILE_ROOT, 'concepts');

async function gatewayRunning(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const resp = await fetch('http://127.0.0.1:3000/health', { signal: ctrl.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

function splitOKF(raw: string): { frontmatter: any; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { frontmatter: {}, body: raw };
  return { frontmatter: yaml.load(m[1]) ?? {}, body: raw.slice(m[0].length) };
}

function writeOKF(fullPath: string, frontmatter: any, body: string): void {
  const yamlStr = yaml.dump(frontmatter, { lineWidth: -1, quotingType: '"' });
  const tmpPath = fullPath + '.tmp';
  fs.writeFileSync(tmpPath, `---\n${yamlStr}---\n${body.replace(/\n*$/, '\n')}`, 'utf-8');
  fs.renameSync(tmpPath, fullPath);
}

async function main(): Promise<void> {
  if (!fs.existsSync(INDEX_PATH)) {
    console.log(`[unmerge] index not found: ${INDEX_PATH}`);
    process.exit(1);
  }
  if (!FORCE && (await gatewayRunning())) {
    console.log('[unmerge] gateway is RUNNING (port 3000 responds). Stop it first (mafw stop), or pass --force.');
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  const entries: any[] = index.entries ?? [];
  const fileExists = (id: string): boolean => {
    const e = entries.find((x: any) => x.id === id);
    return !!e?.filePath && fs.existsSync(path.join(FILE_ROOT, e.filePath));
  };
  const plan = planUnmerge(entries as CleanupEntry[], fileExists);

  console.log(`[unmerge] entries=${entries.length}`);
  console.log(`[unmerge] blobs to delete: ${plan.deleteBlobs.length}`);
  console.log(`[unmerge] sources to restore: ${plan.restore.length}`);
  console.log(`[unmerge] blobs kept: ${plan.keepBlobs.length}`);
  for (const k of plan.keepBlobs.slice(0, 10)) console.log(`  keep ${k.id}: ${k.reason}`);
  if (plan.missingSources.length > 0) {
    console.log(`[unmerge] missing sources: ${plan.missingSources.length}`);
  }

  if (!APPLY) {
    console.log('[unmerge] dry-run. Re-run with --apply to execute (a backup is made first).');
    return;
  }

  // Backup
  const backupDir = path.join(MEM_DIR, `backup-unmerge-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(INDEX_PATH, path.join(backupDir, '.harmonic_index.json'));
  if (fs.existsSync(CONCEPTS_DIR)) {
    fs.cpSync(CONCEPTS_DIR, path.join(backupDir, 'concepts'), { recursive: true });
  }
  console.log(`[unmerge] backup: ${backupDir}`);

  // Restore sources: rewrite OKF frontmatter + update index entry.
  let restored = 0;
  for (const r of plan.restore) {
    const entry = entries.find((x: any) => x.id === r.id);
    const fullPath = path.join(FILE_ROOT, entry.filePath);
    const { frontmatter, body } = splitOKF(fs.readFileSync(fullPath, 'utf-8'));
    delete frontmatter.superseded_by;
    frontmatter.energy = r.energy;
    frontmatter.updated_at = new Date().toISOString();
    writeOKF(fullPath, frontmatter, body);
    delete entry.superseded_by;
    entry.energy = r.energy;
    restored++;
  }

  // Delete blobs: unlink OKF file + drop index entry.
  let deleted = 0;
  const deleteSet = new Set(plan.deleteBlobs);
  for (const id of plan.deleteBlobs) {
    const entry = entries.find((x: any) => x.id === id);
    if (entry?.filePath) {
      const fullPath = path.join(FILE_ROOT, entry.filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    deleted++;
  }
  index.entries = entries.filter((x: any) => !deleteSet.has(x.id));
  index.updated_at = new Date().toISOString();
  fs.writeFileSync(INDEX_PATH + '.tmp', JSON.stringify(index, null, 2), 'utf-8');
  fs.renameSync(INDEX_PATH + '.tmp', INDEX_PATH);

  console.log(`[unmerge] applied: restored=${restored} deleted=${deleted}`);
}

main().catch((err) => {
  console.error(`[unmerge] failed: ${err?.message || err}`);
  process.exit(1);
});
