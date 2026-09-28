/**
 * One-off migration: harvest identifier-like cues from each memory's BODY into
 * its cue_anchors (write-side fidelity). Search only reads
 * primary_abstraction + cue_anchors, so body-only identifiers were unreachable
 * (2270/3722 memories at the time of measurement).
 *
 * Dry-run by default. `--apply` rewrites the OKF frontmatter (atomic .tmp +
 * rename), updates the index entry, backs up .harmonic_index.json first and
 * saves the index at the end.
 *
 *   npx ts-node gateway/scripts/harvest-cue-anchors.ts            # dry-run
 *   npx ts-node gateway/scripts/harvest-cue-anchors.ts --apply    # apply
 *
 * Run with the gateway stopped or restart it afterwards: the running process
 * keeps its own in-memory index.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { config } from '../src/config';
import { HarmonicIndexManager } from '../src/core/memory/harmonic-index';
import { readOKFFile } from '../src/memory/okf-parser';
import { harvestIdentifierCues } from '../src/memory/cue-harvest';

const BASE = path.join(os.homedir(), '.mafw');
const INDEX = path.join(BASE, 'memory', '.harmonic_index.json');

async function main() {
  const apply = process.argv.includes('--apply');
  if (!fs.existsSync(INDEX)) {
    console.error(`index not found: ${INDEX}`);
    process.exit(1);
  }
  const index = new HarmonicIndexManager(BASE);
  const entries = index.getIndex().entries;
  const maxAnchors = config.memory.harvestMaxCues ?? 8;

  let scanned = 0;
  let filesMissing = 0;
  let gained = 0;
  const samples: string[] = [];
  const updates: Array<{ id: string; entry: any; filePath: string; unit: any; body: string; cuess: string[] }> = [];

  for (const entry of entries as any[]) {
    scanned++;
    if (!entry.filePath) continue;
    const fullPath = path.join(BASE, entry.filePath);
    if (!fs.existsSync(fullPath)) { filesMissing++; continue; }
    let parsed: { unit: any; body: string };
    try { parsed = readOKFFile(fullPath); } catch { filesMissing++; continue; }
    const { unit, body } = parsed;
    const current: string[] = entry.cue_anchors ?? [];
    const room = Math.max(0, maxAnchors);
    if (room <= 0) continue;
    // In OKF the memory_value lives in the BODY; frontmatter holds metadata.
    const cues = harvestIdentifierCues(body || unit.memory_value || '', current, { max: room });
    if (cues.length === 0) continue;
    gained++;
    if (samples.length < 6) samples.push(`${entry.id}: +${cues.join(', ')}`);
    updates.push({ id: entry.id, entry, filePath: fullPath, unit, body, cuess: cues });
    if (apply) {
      unit.cue_anchors = [...current, ...cues];
      unit.updated_at = new Date().toISOString();
      const yaml = require('js-yaml');
      const tmp = fullPath + '.tmp';
      fs.writeFileSync(tmp, `---\n${yaml.dump(unit, { lineWidth: -1, quotingType: '"' })}---\n${body}\n`, 'utf-8');
      fs.renameSync(tmp, fullPath);
      entry.cue_anchors = unit.cue_anchors;
    }
  }

  console.log(`scanned=${scanned} missingFiles=${filesMissing} memoriesGainingCues=${gained} (maxAnchors=${maxAnchors})`);
  for (const s of samples) console.log('  e.g.', s);
  if (apply) {
    const backup = INDEX + '.bak-harvest';
    fs.copyFileSync(INDEX, backup);
    index.save();
    console.log(`applied: rewrote ${updates.length} OKF files, saved index (backup: ${backup})`);
  } else {
    console.log('dry-run only 鈥?re-run with --apply to write');
  }
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
