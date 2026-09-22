// Re-derive legacy cue_anchors that were auto-filled as single CJK chars
// (pre-2026-09 extractAnchors). See src/memory/anchor-backfill.ts.
//
//   npx ts-node scripts/backfill-cjk-anchors.ts          # dry-run: print plan
//   npx ts-node scripts/backfill-cjk-anchors.ts --apply  # backup + execute
//   npx ts-node scripts/backfill-cjk-anchors.ts --apply --force  # skip gateway guard
//
// MUST run with the gateway stopped (it holds the harmonic index in memory and
// would overwrite our edits on the next save). The anchor graph rebuilds from
// the index on the next gateway start.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { planAnchorBackfill } from '../src/memory/anchor-backfill';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const MEM_DIR = path.join(os.homedir(), '.mafw', 'memory');
const INDEX_PATH = path.join(MEM_DIR, '.harmonic_index.json');
// Index entry filePath values are relative to the gateway data root (~/.mafw).
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
    console.log(`[anchors] index not found: ${INDEX_PATH}`);
    process.exit(1);
  }
  if (!FORCE && (await gatewayRunning())) {
    console.log('[anchors] gateway is RUNNING (port 3000 responds). Stop it first (mafw stop), or pass --force.');
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  const entries: any[] = index.entries ?? [];
  const plan = planAnchorBackfill(entries);

  console.log(`[anchors] entries=${entries.length}`);
  console.log(`[anchors] entries to fix: ${plan.length}`);
  for (const p of plan.slice(0, 10)) {
    console.log(`  ${p.id}\n    - ${JSON.stringify(p.before)}\n    + ${JSON.stringify(p.after)}`);
  }

  if (!APPLY) {
    console.log('[anchors] dry-run. Re-run with --apply to execute (a backup is made first).');
    return;
  }

  const backupDir = path.join(MEM_DIR, `backup-anchors-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(INDEX_PATH, path.join(backupDir, '.harmonic_index.json'));
  if (fs.existsSync(CONCEPTS_DIR)) {
    fs.cpSync(CONCEPTS_DIR, path.join(backupDir, 'concepts'), { recursive: true });
  }
  console.log(`[anchors] backup: ${backupDir}`);

  let updated = 0;
  let missing = 0;
  const byId = new Map(plan.map(p => [p.id, p]));
  for (const entry of entries) {
    const p = byId.get(entry.id);
    if (!p) continue;
    entry.cue_anchors = p.after;
    if (entry.filePath) {
      const fullPath = path.join(FILE_ROOT, entry.filePath);
      if (fs.existsSync(fullPath)) {
        const { frontmatter, body } = splitOKF(fs.readFileSync(fullPath, 'utf-8'));
        frontmatter.cue_anchors = p.after;
        frontmatter.updated_at = new Date().toISOString();
        writeOKF(fullPath, frontmatter, body);
      } else {
        missing++;
      }
    }
    updated++;
  }
  index.updated_at = new Date().toISOString();
  fs.writeFileSync(INDEX_PATH + '.tmp', JSON.stringify(index, null, 2), 'utf-8');
  fs.renameSync(INDEX_PATH + '.tmp', INDEX_PATH);

  console.log(`[anchors] applied: updated=${updated} missingFile=${missing}`);
}

main().catch((err) => {
  console.error(`[anchors] failed: ${err?.message || err}`);
  process.exit(1);
});
