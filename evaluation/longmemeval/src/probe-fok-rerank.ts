/**
 * R5 FOK feature probe: does the R3 cross-encoder's relevance probability
 * discriminate ANSWERABLE from UNANSWERABLE questions?
 *
 * The shipped gate feature (raw BM25 top1/mean) only measures retrieval
 * dominance (answerable-vs-unanswerable AUROC ≈ 0.58). A trained relevance
 * judge ("is this passage relevant to the query?") is the natural alternative
 * FOK signal, so this probe measures its top-1 / mean probability on:
 *   - answerable  : sampleStratified(all, 20, 42), is_abstention === false
 *   - unanswerable: all `_abs` questions (30)
 * and reports AUROC(answerable ≥ unanswerable) per feature.
 *
 * Usage (repo root):
 *   MAFW_RERANKER_GPU=vulkan node node_modules/ts-node/dist/bin.js \
 *     --project evaluation/longmemeval/tsconfig.json \
 *     evaluation/longmemeval/src/probe-fok-rerank.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { HarmonicIndexManager } from '../../../gateway/src/core/memory/harmonic-index';
import { createReranker } from '../../../gateway/src/core/memory/reranker';
import { config } from '../../../gateway/src/config';
import { buildUnitsForQuestion } from './ingest';
import { loadDataset, sampleStratified, LmeQuestion } from './dataset';

const ABS_PATH = path.join(__dirname, '..', 'data', 'longmemeval_s_abs.json');

type FeatureName = 'top1' | 'mean' | 'top1OverMean';

function features(scores: number[]): Record<FeatureName, number> {
  const n = scores.length;
  if (n === 0) return { top1: 0, mean: 0, top1OverMean: 0 };
  const top1 = Math.max(...scores);
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  return { top1, mean, top1OverMean: mean > 0 ? top1 / mean : 0 };
}

function auroc(pairs: Array<{ score: number; label: number }>): number {
  const sorted = [...pairs].sort((a, b) => a.score - b.score);
  const n = sorted.length;
  const ranks = new Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1].score === sorted[i].score) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let sumPos = 0, nPos = 0, nNeg = 0;
  sorted.forEach((p, idx) => { if (p.label === 1) { sumPos += ranks[idx]; nPos++; } else nNeg++; });
  if (!nPos || !nNeg) return NaN;
  return (sumPos - nPos * (nPos + 1) / 2) / (nPos * nNeg);
}

async function measure(
  reranker: any,
  question: LmeQuestion,
): Promise<{ probs: number[]; bm25: number[] }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fok-probe-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  try {
    const store = new HarmonicUnitFileStore(dir);
    const { units } = buildUnitsForQuestion(question, { granularity: 'round', energyMode: 'frozen' });
    for (const u of units) await store.write(u, undefined, { skipMerge: true });
    const index = new HarmonicIndexManager(dir);
    const scored = index.searchScored(question.question, 10, { retriever: 'bm25' });
    const probs = await reranker.scoreCandidates(question.question, scored);
    return { probs, bm25: scored.map((s: any) => s.score) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const all = loadDataset();
  const answerable = sampleStratified(all, 20, 42).filter(q => !q.question_id.endsWith('_abs'));
  const unanswerable: LmeQuestion[] = JSON.parse(fs.readFileSync(ABS_PATH, 'utf-8'));
  console.log(`answerable=${answerable.length} unanswerable=${unanswerable.length}`);

  const reranker = createReranker('llamacpp', config.search.rerankWeights, { gpu: process.env.MAFW_RERANKER_GPU || 'vulkan' });
  if (!reranker) throw new Error('llamacpp reranker unavailable');
  await (reranker as any).ensureServer?.();

  const rows: Array<{ question_id: string; label: number; probs: number[]; bm25: number[] }> = [];
  const todo = [
    ...answerable.map(q => ({ q, label: 1 })),
    ...unanswerable.map(q => ({ q, label: 0 })),
  ];
  for (const [i, t] of todo.entries()) {
    process.stdout.write(`[${i + 1}/${todo.length}] ${t.q.question_id} ... `);
    try {
      const m = await measure(reranker, t.q);
      rows.push({ question_id: t.q.question_id, label: t.label, ...m });
      process.stdout.write(`top1prob=${m.probs[0]?.toFixed(3) ?? '-'}\n`);
    } catch (err: any) {
      process.stdout.write(`FAILED: ${err.message}\n`);
    }
  }

  const names: FeatureName[] = ['top1', 'mean', 'top1OverMean'];
  // Dump per-question probabilities for downstream L2 gate experiments.
  const dumpPath = path.join(__dirname, '..', 'results', 'fok-probs.jsonl');
  fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
  fs.writeFileSync(dumpPath, rows.map(r => JSON.stringify({
    question_id: r.question_id,
    label: r.label,
    top1prob: features(r.probs).top1,
    meanProb: features(r.probs).mean,
    bm25Top1: features(r.bm25).top1,
  })).join('\n') + '\n', 'utf-8');
  console.log(`\ndumped ${rows.length} rows → ${dumpPath}`);
  console.log(`\n=== AUROC(answerable >= unanswerable), n=${rows.length} ===`);
  for (const name of names) {
    const pairs = rows.map(r => ({ score: features(r.probs)[name], label: r.label }));
    console.log(`reranker prob ${name.padEnd(13)} = ${auroc(pairs).toFixed(3)}`);
  }
  for (const name of names) {
    const pairs = rows.map(r => ({ score: features(r.bm25)[name], label: r.label }));
    console.log(`bm25          ${name.padEnd(13)} = ${auroc(pairs).toFixed(3)}`);
  }
  // also: top1 prob alone (most direct FOK reading)
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  console.log(`median top1prob answerable=${median(rows.filter(r => r.label === 1).map(r => r.probs[0])).toFixed(3)}  unanswerable=${median(rows.filter(r => r.label === 0).map(r => r.probs[0])).toFixed(3)}`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
