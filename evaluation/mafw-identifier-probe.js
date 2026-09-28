// R7 live A/B probe (real MAFW corpus, live gateway HTTP search).
// For memories whose *searchable* text (abstraction + cue_anchors) contains an
// identifier cue, ask: can the memory be retrieved by
//   (a) the identifier's exact form      → control (should already work)
//   (b) the identifier's split form      → R7 target (old tokenizer: miss)
// Run before and after deploying the identifier-aware tokenizer, against a
// live gateway (`mafw daemon`) — results are corpus-dependent, not a benchmark.
//
// Usage: node evaluation/mafw-identifier-probe.js [samples]
//
// Measured 2026-09-28 (corpus 3735, 40 samples):
//   before: exact hit@10 93% / split hit@10 38% (19/40 unreachable)
//   after : exact hit@10 90% / split hit@10 90% (0 unreachable)
const fs = require('fs');
const os = require('os');
const path = require('path');

const INDEX = path.join(os.homedir(), '.mafw', 'memory', '.harmonic_index.json');
const API = 'http://127.0.0.1:3000/api/memory/search';
const SAMPLES = Number(process.argv[2] ?? 40);

const ident = (s) => s.match(/\b[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b|\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g) || [];
const splitOf = (w) => w
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .replace(/_/g, ' ')
  .toLowerCase().split(/\s+/).filter(p => p.length >= 3);

async function search(query, topK = 50) {
  const r = await fetch(`${API}?query=${encodeURIComponent(query)}&retriever=bm25&topK=${topK}`);
  const j = await r.json();
  const list = Array.isArray(j) ? j : (j.results || j.units || []);
  return list.map(u => u.id);
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const entries = (raw.entries || []).filter(e => e.primary_abstraction);
  // Corpus frequency of each identifier token → keep distinctive (rare) cues only.
  const freq = new Map();
  for (const e of entries) {
    const text = `${e.primary_abstraction} ${(e.cue_anchors || []).join(' ')}`;
    for (const w of new Set(ident(text))) freq.set(w, (freq.get(w) || 0) + 1);
  }
  const candidates = [];
  for (const e of entries) {
    const text = `${e.primary_abstraction} ${(e.cue_anchors || []).join(' ')}`;
    const found = ident(text).filter(w => w.length >= 6 && splitOf(w).length >= 2 && (freq.get(w) || 0) <= 5);
    if (found.length) candidates.push({ id: e.id, word: found[0], freq: freq.get(found[0]) });
    if (candidates.length >= SAMPLES * 4) break;
  }
  const sample = candidates.slice(0, SAMPLES);
  console.log(`corpus entries=${entries.length}  candidates=${candidates.length}  sampling=${sample.length}`);

  const res = { exact: { 1: 0, 10: 0, 50: 0 }, split: { 1: 0, 10: 0, 50: 0 } };
  const misses = [];
  for (const s of sample) {
    const qExact = s.word;
    const qSplit = splitOf(s.word).join(' ');
    const [ex, sp] = [await search(qExact), await search(qSplit)];
    const rank = (list) => { const i = list.indexOf(s.id); return i < 0 ? Infinity : i + 1; };
    for (const [key, list] of [['exact', ex], ['split', sp]]) {
      const r = rank(list);
      for (const k of [1, 10, 50]) if (r <= k) res[key][k]++;
    }
    const rs = rank(sp);
    if (rs === Infinity) misses.push(`${s.word} -> "${qSplit}"`);
  }
  const n = sample.length;
  console.log(`\nidentifier samples: ${n}`);
  for (const key of ['exact', 'split']) {
    console.log(`  ${key.padEnd(6)} hit@1=${(res[key][1] / n * 100).toFixed(0)}%  hit@10=${(res[key][10] / n * 100).toFixed(0)}%  hit@50=${(res[key][50] / n * 100).toFixed(0)}%`);
  }
  console.log(`\nsplit-form total misses: ${misses.length}`);
  for (const m of misses.slice(0, 8)) console.log('  -', m);
}
main().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
