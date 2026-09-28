// Rigorous before/after for the write-side fidelity harvest.
//
// Sampling drift made the live probe incomparable (once anchors are filled the
// "gap set" shifts to harder tail identifiers). This probe instead:
//   1. freezes a sample from the CURRENT index — entries whose body contains an
//      identifier that is absent from the ABSTRACTION (a rule independent of
//      cue_anchors, so the sample does not move when anchors are harvested);
//   2. scores that frozen sample against BOTH the current index and the
//      pre-migration backup index, in-process (retrieval reads only
//      abstraction + cue_anchors, so the backup needs no OKF files).
//
// Usage: node evaluation/mafw-fidelity-ab.js [samples]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HarmonicIndexManager } = require('C:/work/work-loop/opencode-plugin-mafw/gateway/dist/core/memory/harmonic-index.js');

const MEM = path.join(os.homedir(), '.mafw', 'memory');
const INDEX = path.join(MEM, '.harmonic_index.json');
const BACKUP = path.join(MEM, '.harmonic_index.json.bak-harvest');
const SAMPLES = Number(process.argv[2] ?? 30);

const IDENT = /\b[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b[\w.-]+\/[\w./-]{2,}\b/g;

function bodyOf(rel) {
  try {
    const text = fs.readFileSync(path.join(os.homedir(), '.mafw', rel), 'utf8');
    const m = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
    return m ? m[1] : '';
  } catch { return ''; }
}

function indexAt(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  fs.copyFileSync(file, path.join(dir, 'memory', '.harmonic_index.json'));
  return new HarmonicIndexManager(dir);
}

/**
 * Build a "no-harvest" index: same corpus, but identifier-shaped anchors are
 * dropped (that is the harvest's signature). Approximates the pre-harvest state
 * reproducibly — the on-disk backup gets overwritten by later migrations, which
 * silently invalidated the first A/B attempt.
 */
function indexWithoutHarvestedAnchors(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const e of raw.entries || []) {
    e.cue_anchors = (e.cue_anchors || []).filter(a => !IDENT.test(a));
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fid-strip-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'memory', '.harmonic_index.json'), JSON.stringify(raw), 'utf8');
  return new HarmonicIndexManager(dir);
}

function hitsFor(index, query, topK = 50) {
  return index.searchScored(query, topK, { retriever: 'bm25' }).map(s => s.entry.id);
}

function main() {
  const raw = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
  const reportOnly = process.argv.includes('--by-month');

  if (reportOnly) {
    // Gap rate by creation month: a baseline for the write-prompt fix (the
    // memory-guide / worker prompt now demand verbatim identifiers in
    // cue_anchors/abstraction, so months after the fix should show a falling
    // rate). Measured against the ABSTRACTION only — cue_anchors are also
    // auto-filled by the harvest, so they are not a signal for the prompt.
    const byMonth = new Map();
    for (const e of raw.entries || []) {
      const month = String(e.created_at || '').slice(0, 7) || 'unknown';
      const abstraction = (e.primary_abstraction || '').toLowerCase();
      const body = bodyOf(e.filePath || '');
      const bucket = byMonth.get(month) || { total: 0, gap: 0 };
      bucket.total++;
      const ident = body ? (body.match(IDENT) || []).find(t => t.length >= 6) : null;
      if (ident && !abstraction.includes(ident.toLowerCase())) bucket.gap++;
      byMonth.set(month, bucket);
    }
    console.log('month     entries  body-identifier-absent-from-abstraction');
    for (const [month, b] of [...byMonth.entries()].sort()) {
      console.log(`${month}  ${String(b.total).padStart(7)}  ${(100 * b.gap / b.total).toFixed(0)}%`);
    }
    return;
  }

  // 1. frozen sample: identifier in BODY but not in the ABSTRACTION
  const frozen = [];
  for (const e of raw.entries || []) {
    const abstraction = (e.primary_abstraction || '').toLowerCase();
    const body = bodyOf(e.filePath || '');
    if (!body) continue;
    const word = (body.match(IDENT) || []).find(t => t.length >= 6 && !abstraction.includes(t.toLowerCase()));
    if (word) frozen.push({ id: e.id, word });
    if (frozen.length >= SAMPLES) break;
  }

  const current = indexAt(INDEX);
  const before = indexWithoutHarvestedAnchors(INDEX);

  const score = (index) => {
    let h1 = 0, h10 = 0, h50 = 0;
    for (const s of frozen) {
      const list = hitsFor(index, s.word);
      const rank = list.indexOf(s.id) + 1;
      if (rank === 1) h1++;
      if (rank > 0 && rank <= 10) h10++;
      if (rank > 0 && rank <= 50) h50++;
    }
    const n = frozen.length || 1;
    return { h1: h1 / n, h10: h10 / n, h50: h50 / n };
  };

  const b = score(before);
  const a = score(current);
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  console.log(`frozen sample: ${frozen.length} (identifier in BODY, absent from ABSTRACTION)`);
  console.log(`                hit@1   hit@10  hit@50`);
  console.log(`before harvest  ${pct(b.h1).padEnd(6)} ${pct(b.h10).padEnd(7)} ${pct(b.h50)}`);
  console.log(`after  harvest  ${pct(a.h1).padEnd(6)} ${pct(a.h10).padEnd(7)} ${pct(a.h50)}`);
}

main();
