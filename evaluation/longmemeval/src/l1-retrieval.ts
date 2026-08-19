/**
 * L1 LongMemEval benchmark: retrieval-only layer.
 *
 * For each question we spin up an isolated HarmonicUnitFileStore (tmpDir),
 * deterministically ingest the haystack (round or session granularity), run
 * HarmonicIndexManager.searchScored(question, k) for k∈{1,3,5,10}, optionally
 * rerank, map retrieved memory units back to session ids, and compute
 * Recall@k / NDCG@k against answer_session_ids.
 *
 * Outputs:
 *   results/<timestamp>/l1-run.jsonl   — per-question raw scores
 *   results/<timestamp>/l1-summary.json — per-type + overall aggregation
 *   terminal markdown table
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { HarmonicIndexManager, SearchOptions } from '../../../gateway/src/core/memory/harmonic-index';
import { createReranker, Reranker, applyReranker } from '../../../gateway/src/core/memory/reranker';
import { config } from '../../../gateway/src/config';
import { loadDataset, sampleStratified, LmeQuestion } from './dataset';
import { ingestQuestion, IngestOptions } from './ingest';
import { recallAtK, ndcgAtK, aggregateByType, mean } from './metrics';
import { L1QuestionResult, L1Summary } from './types';

const KS = [1, 3, 5, 10];

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i];
    const v = args[i + 1];
    if (k?.startsWith('--')) flags.set(k, v);
  }
  return {
    sample: parseInt(flags.get('--sample') ?? '8', 10),
    seed: parseInt(flags.get('--seed') ?? '42', 10),
    granularity: flags.get('--granularity') ?? 'round',
    energyMode: flags.get('--energyMode') ?? 'frozen',
    retriever: flags.get('--retriever') ?? 'token',
    reranker: (flags.get('--reranker') ?? 'off') as 'off' | 'heuristic' | 'cross-encoder',
    recallK: parseInt(flags.get('--recallK') ?? String(config.search.recallK), 10),
    cutoffRatio: parseFloat(flags.get('--cutoffRatio') ?? String(config.search.cutoffRatio)),
    keep: flags.has('--keep'),
    data: flags.get('--data'),
  };
}

function help() {
  console.log('Usage:');
  console.log('  npx ts-node --project evaluation/longmemeval/tsconfig.json evaluation/longmemeval/src/l1-retrieval.ts [options]');
  console.log('Options:');
  console.log('  --sample N      per-type sample size (default 8)');
  console.log('  --seed N        deterministic seed (default 42)');
  console.log('  --granularity round|session');
  console.log('  --energyMode frozen|realistic');
  console.log('  --retriever token|bm25');
  console.log('  --reranker off|heuristic|cross-encoder');
  console.log('  --recallK N     candidates before rerank');
  console.log('  --cutoffRatio N drop results below topScore × ratio (0 = off)');
  console.log('  --data PATH     override dataset path');
  console.log('  --keep          keep per-question tmp dirs');
}

async function runOne(
  question: LmeQuestion,
  ingestOpts: IngestOptions,
  keep: boolean,
  searchOptions: SearchOptions,
  reranker: Reranker | undefined,
  recallK: number,
  cutoffRatio: number,
): Promise<L1QuestionResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `lme-l1-${question.question_id}-`));
  let store: HarmonicUnitFileStore | null = null;
  let result: L1QuestionResult;
  try {
    store = new HarmonicUnitFileStore(tmpDir);
    const { unitCount, sessionOfUnit } = await ingestQuestion(store, question, ingestOpts);
    const index = new HarmonicIndexManager(tmpDir);

    let entries = index.searchScored(question.question, reranker ? recallK : Math.max(...KS), searchOptions);
    if (reranker && entries.length > 0) {
      entries = await applyReranker(question.question, entries, reranker, Math.max(...KS), cutoffRatio);
    }

    const topSessions = entries.map(e => sessionOfUnit.get(e.entry.id)!);

    const recall: Record<number, number> = {};
    const ndcg: Record<number, number> = {};
    for (const k of KS) {
      recall[k] = recallAtK(topSessions, question.answer_session_ids, k);
      ndcg[k] = ndcgAtK(topSessions, question.answer_session_ids, k);
    }
    result = {
      question_id: question.question_id,
      question_type: question.question_type,
      question: question.question,
      answer: question.answer,
      is_abstention: question.question_id.endsWith('_abs'),
      unit_count: unitCount,
      recall,
      ndcg,
      top_sessions: topSessions.slice(0, 10),
      top_contexts: entries.slice(0, 10).map(e => e.entry.primary_abstraction),
      top_scores: entries.slice(0, 10).map(e => e.score),
    };
  } finally {
    if (store && !keep) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } else if (store) {
      console.error(`[keep] tmpDir ${tmpDir}`);
    }
  }
  return result;
}

async function createRerankerForRun(
  name: 'off' | 'heuristic' | 'cross-encoder',
): Promise<Reranker | undefined> {
  if (name === 'off') return undefined;
  const reranker = createReranker(name, config.search.rerankWeights);
  if (!reranker) return undefined;
  if (reranker.name === 'cross-encoder') {
    // Force async pipeline init so the first query does not pay full cold-start.
    await (reranker as any).ensurePipeline?.();
  }
  return reranker;
}

async function main() {
  const args = parseArgs();
  if (args.sample <= 0 || !['round', 'session'].includes(args.granularity)) {
    help();
    process.exit(1);
  }
  const dataPath = args.data ?? undefined;
  const all = loadDataset(dataPath);
  const questions = sampleStratified(all, args.sample, args.seed);
  const ingestOpts: IngestOptions = {
    granularity: args.granularity as 'round' | 'session',
    energyMode: args.energyMode as 'frozen' | 'realistic',
  };
  const retriever = (args.retriever === 'bm25' ? 'bm25' : 'token') as 'token' | 'bm25';
  const reranker = await createRerankerForRun(args.reranker);
  const searchOptions: SearchOptions = {
    retriever,
    cutoffRatio: reranker ? 0 : args.cutoffRatio,
  };

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = path.join(__dirname, '..', 'results', ts);
  fs.mkdirSync(resultsDir, { recursive: true });
  const runPath = path.join(resultsDir, 'l1-run.jsonl');
  const summaryPath = path.join(resultsDir, 'l1-summary.json');

  console.log(`L1 retrieval: ${questions.length} questions, granularity=${ingestOpts.granularity}, energyMode=${ingestOpts.energyMode}, retriever=${retriever}, reranker=${args.reranker}`);
  const results: L1QuestionResult[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    process.stdout.write(`[${i + 1}/${questions.length}] ${q.question_id} ${q.question_type} ... `);
    const res = await runOne(q, ingestOpts, args.keep, searchOptions, reranker, args.recallK, args.cutoffRatio);
    results.push(res);
    fs.appendFileSync(runPath, JSON.stringify(res) + '\n', 'utf-8');
    process.stdout.write(`R@1=${res.recall[1].toFixed(2)} R@10=${res.recall[10].toFixed(2)}\n`);
  }

  const byType = aggregateByType(
    results.map(r => ({ questionType: r.question_type, recall: r.recall, ndcg: r.ndcg })),
    KS,
  );
  const overallRecall: Record<number, number> = {};
  const overallNdcg: Record<number, number> = {};
  for (const k of KS) {
    overallRecall[k] = mean(results.map(r => r.recall[k]));
    overallNdcg[k] = mean(results.map(r => r.ndcg[k]));
  }

  const summary: L1Summary = {
    timestamp: ts,
    config: {
      samplePerType: args.sample,
      seed: args.seed,
      granularity: args.granularity,
      energyMode: args.energyMode,
      retriever,
      ks: KS,
    },
    overall: {
      count: results.length,
      ...Object.fromEntries(KS.map(k => [`recall@${k}`, overallRecall[k]])),
      ...Object.fromEntries(KS.map(k => [`ndcg@${k}`, overallNdcg[k]])),
    },
    by_type: Object.fromEntries(
      Object.entries(byType).map(([type, m]) => [
        type,
        {
          count: m.count,
          recall: Object.fromEntries(KS.map(k => [String(k), Number(m.recall[k].toFixed(4))])),
          ndcg: Object.fromEntries(KS.map(k => [String(k), Number(m.ndcg[k].toFixed(4))])),
        },
      ]),
    ),
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

  // Markdown table to console
  console.log('\n## Overall');
  console.log(`| N=${results.length} | ${KS.map(k => `R@${k}`).join(' | ')} | ${KS.map(k => `NDCG@${k}`).join(' | ')} |`);
  console.log(`|${'---|'.repeat(KS.length * 2 + 1)}`);
  console.log(`| overall | ${KS.map(k => overallRecall[k].toFixed(3)).join(' | ')} | ${KS.map(k => overallNdcg[k].toFixed(3)).join(' | ')} |`);
  console.log('\n## Per type');
  console.log(`| type | count | ${KS.map(k => `R@${k}`).join(' | ')} | ${KS.map(k => `NDCG@${k}`).join(' | ')} |`);
  console.log(`|${'---|'.repeat(KS.length * 2 + 2)}`);
  for (const [type, m] of Object.entries(byType)) {
    console.log(`| ${type} | ${m.count} | ${KS.map(k => (m.recall[k] ?? 0).toFixed(3)).join(' | ')} | ${KS.map(k => (m.ndcg[k] ?? 0).toFixed(3)).join(' | ')} |`);
  }
  console.log(`\nSaved: ${runPath}`);
  console.log(`Saved: ${summaryPath}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
