// Probe: run the laya conflict judge on REAL high-cosine pairs from the live
// memory store — the distribution the cascade actually sees (cosine >= 0.8).
// Writes ~/.mafw/laya/probe-real-pairs.jsonl {known,new,cosine,knownId,newId};
// feed it to the laya venv (see diag-real.py) and hand-check the scores.
// Run: npx ts-node scripts/probe-laya-real-pairs.ts   (from gateway/, gateway must be STOPPED or read-only OK)
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HarmonicUnitFileStore } from '../src/memory/harmonic-file-store';

const mafwDir = path.join(os.homedir(), '.mafw');
const memDir = path.join(mafwDir, 'memory');
const outFile = path.join(mafwDir, 'laya', 'probe-real-pairs.jsonl');
const MIN_COSINE = 0.8;
const SAMPLE = 20;

// 1. pick the largest vectors-*.json (the active provider's converged store)
const vecFiles = fs.readdirSync(memDir).filter((f) => /^vectors-.*\.json$/.test(f));
if (vecFiles.length === 0) throw new Error('no vectors-*.json found');
let bestFile = '';
let bestCount = -1;
for (const f of vecFiles) {
  const count = Object.keys((JSON.parse(fs.readFileSync(path.join(memDir, f), 'utf-8')).vectors) || {}).length;
  if (count > bestCount) { bestCount = count; bestFile = f; }
}
console.log(`vector store: ${bestFile} (${bestCount} vectors)`);
const vectors: Record<string, number[]> = JSON.parse(fs.readFileSync(path.join(memDir, bestFile), 'utf-8')).vectors;
const ids = Object.keys(vectors);

// 2. brute-force pairs >= MIN_COSINE (early-capped for speed)
const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const norms = new Map<string, number>();
for (const id of ids) norms.set(id, norm(vectors[id]));
const pairs: Array<{ a: string; b: string; cosine: number }> = [];
outer:
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const va = vectors[ids[i]];
    const vb = vectors[ids[j]];
    let dot = 0;
    for (let k = 0; k < va.length; k++) dot += va[k] * vb[k];
    const c = dot / (norms.get(ids[i])! * norms.get(ids[j])!);
    if (c >= MIN_COSINE) pairs.push({ a: ids[i], b: ids[j], cosine: c });
    if (pairs.length >= 500) break outer;
  }
}
pairs.sort((x, y) => y.cosine - x.cosine);
console.log(`pairs >= ${MIN_COSINE}: ${pairs.length} (showing up to ${SAMPLE})`);

// 3. sample: top 10 + evenly-spread rest
const picked = pairs.slice(0, 10);
if (pairs.length > 10) {
  const rest = pairs.slice(10);
  const step = Math.max(1, Math.floor(rest.length / (SAMPLE - 10)));
  for (let i = 0; i < rest.length && picked.length < SAMPLE; i += step) picked.push(rest[i]);
}

// 4. older = known, newer = new; text = memory_value (what the cascade sends)
async function main(): Promise<void> {
  const store = new HarmonicUnitFileStore(mafwDir);
  const lines: string[] = [];
  for (const p of picked) {
    const ua = await store.read(p.a);
    const ub = await store.read(p.b);
    if (!ua || !ub) continue;
    const [known, newer] = Date.parse(ua.created_at) <= Date.parse(ub.created_at) ? [ua, ub] : [ub, ua];
    lines.push(JSON.stringify({
      knownId: known.id, newId: newer.id, cosine: +p.cosine.toFixed(4),
      known: String(known.memory_value).slice(0, 800),
      new: String(newer.memory_value).slice(0, 800),
    }));
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf-8');
  console.log(`wrote ${lines.length} pairs -> ${outFile}`);
}
void main();
