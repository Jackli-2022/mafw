// Write-side fidelity probe: identifiers that live ONLY in a memory's BODY
// (not in abstraction/cue_anchors) were unreachable by search. Measures how
// many of them the live gateway can retrieve by their exact form.
//
// Usage: node evaluation/mafw-fidelity-probe.js [samples]
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = path.join(os.homedir(), '.mafw');
const INDEX = path.join(BASE, 'memory', '.harmonic_index.json');
const API = 'http://127.0.0.1:3000/api/memory/search';
const SAMPLES = Number(process.argv[2] ?? 30);

const IDENT = /\b[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b[\w.-]+\/[\w./-]{2,}\b/g;

function readBody(rel) {
  try {
    const text = fs.readFileSync(path.join(BASE, rel), 'utf8');
    const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
    return m ? m[1] : '';
  } catch { return ''; }
}

async function search(q, topK = 50) {
  const r = await fetch(`${API}?query=${encodeURIComponent(q)}&retriever=bm25&topK=${topK}`);
  const j = await r.json();
  const list = Array.isArray(j) ? j : (j.results || j.units || []);
  return list.map(u => u.id);
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const entries = (raw.entries || []).filter(e => e.filePath);
  const samples = [];
  for (const e of entries) {
    const searchable = `${e.primary_abstraction || ''} ${(e.cue_anchors || []).join(' ')}`.toLowerCase();
    const body = readBody(e.filePath);
    if (!body) continue;
    const idents = (body.match(IDENT) || []).filter(t => t.length >= 6);
    const gap = idents.find(t => !searchable.includes(t.toLowerCase()));
    if (gap) samples.push({ id: e.id, word: gap });
    if (samples.length >= SAMPLES * 3) break;
  }
  const sample = samples.slice(0, SAMPLES);
  console.log(`entries=${entries.length} body-only-identifier samples=${sample.length}`);

  let hit1 = 0, hit10 = 0, hit50 = 0;
  const misses = [];
  for (const s of sample) {
    const list = await search(s.word);
    const rank = list.indexOf(s.id) + 1;
    if (rank === 1) hit1++;
    if (rank > 0 && rank <= 10) hit10++;
    if (rank > 0 && rank <= 50) hit50++;
    if (rank === 0) misses.push(`${s.word} (${s.id})`);
  }
  const n = sample.length;
  console.log(`body-only identifier retrievability: hit@1=${(hit1 / n * 100).toFixed(0)}%  hit@10=${(hit10 / n * 100).toFixed(0)}%  hit@50=${(hit50 / n * 100).toFixed(0)}%`);
  console.log(`misses: ${misses.length}`);
  for (const m of misses.slice(0, 8)) console.log('  -', m);
}
main().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
