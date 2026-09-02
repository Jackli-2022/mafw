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
import { chatCompletion, loadAuthKey } from './llm';
import { formatEntryForIndex, parseScanResponse, resolveShortIds } from '../../../gateway/src/recall/index-scan';
import { createEmbeddingProvider, EmbeddingProvider } from '../../../gateway/src/memory/embedding-provider';
import { MemoryVectorStore, EmbeddingIndexer } from '../../../gateway/src/memory/vector-store';

const KS = [1, 3, 5, 10];

const SCAN_SYSTEM = `You are a memory retrieval system. Given a memory index and a user query, identify the most relevant memory entries.

The index lists memories in this format:
- [id:<short_id>] (<date>) <type> | <summary> | anchors: <keywords>

Return ONLY valid JSON (no markdown):
{"relevant_ids": ["<short_id>", ...], "reasoning": "<one sentence>", "confidence": <0.0-1.0>}

Rules:
- Select at most 8 entries that are most relevant to the query
- Consider semantic relevance, not just keyword matching
- For preference queries (what does the user like/dislike), prioritize entries with "preference" type or "pref:" anchors
- For temporal queries (when/what happened), prioritize entries with matching dates
- For multi-session queries (what did we discuss about X), look for entries sharing topic anchors
- If answering the question requires combining information from multiple memories (e.g., "the restaurant near the hotel I mentioned"), return ALL necessary entry IDs — err on the side of including more rather than fewer
- confidence = how sure you are that the selected entries answer the query (0.0 = guess, 1.0 = certain)
- If nothing is relevant, return {"relevant_ids": [], "reasoning": "no relevant memories", "confidence": 0.0}`;

/**
 * Standalone scan function for benchmark: calls mimo directly via chatCompletion,
 * no MemoryWorker needed. Returns full IDs resolved from the index.
 */
export async function runScan(
  index: HarmonicIndexManager,
  query: string,
  apiUrl: string,
  apiKeyProvider: string,
  model: string,
): Promise<{ ids: string[]; confidence: number }> {
  const entries = index.getIndex().entries.filter((e: any) => !e.superseded_by);
  const lines = entries.map(formatEntryForIndex);
  const indexText = `# Memory Index (${entries.length} entries)\n\n${lines.join('\n')}`;
  const prompt = `${indexText}\n\n---\n\nUser query: ${query}\n\nSelect the most relevant memory entries from the index above.`;

  try {
    const raw = await chatCompletion({
      model,
      apiUrl,
      apiKey: loadAuthKey(apiKeyProvider),
      messages: [
        { role: 'system', content: SCAN_SYSTEM },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_tokens: 512,
    });
    const result = parseScanResponse(raw);
    if (!result) {
      console.error(`[scan] parse failed: ${raw.slice(0, 200)}`);
      return { ids: [], confidence: 0 };
    }
    console.error(`[scan] raw response: ${raw.slice(0, 300)}`);
    console.error(`[scan] short IDs: ${JSON.stringify(result.relevantIds)}`);
    const fullIds = resolveShortIds(result.relevantIds, index);
    console.error(`[scan] short=${result.relevantIds.length} resolved=${fullIds.length} conf=${result.confidence}`);
    return { ids: fullIds, confidence: result.confidence };
  } catch (err: any) {
    console.error(`[scan] failed: ${err.message}`);
    return { ids: [], confidence: 0 };
  }
}

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
    embeddingProvider: (flags.get('--embeddingProvider') ?? 'off') as 'off' | 'local' | 'dashscope',
    embeddingModel: flags.get('--embeddingModel'),
    embeddingEngine: flags.get('--embeddingEngine') as 'onnx' | 'llamacpp' | undefined,
    reranker: (flags.get('--reranker') ?? 'off') as 'off' | 'heuristic' | 'cross-encoder',
    recallK: parseInt(flags.get('--recallK') ?? String(config.search.recallK), 10),
    cutoffRatio: parseFloat(flags.get('--cutoffRatio') ?? String(config.search.cutoffRatio)),
    fusionSparseWeight: parseFloat(flags.get('--fusionSparseWeight') ?? '0.65'),
    graph: flags.get('--graph') === 'true',
    scan: flags.get('--scan') === 'true',
    scanApiUrl: flags.get('--scanApiUrl') ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    scanApiKeyProvider: flags.get('--scanApiKeyProvider') ?? 'alibaba-cn',
    scanModel: flags.get('--scanModel') ?? 'qwen3.7-max',
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
  console.log('  --retriever token|bm25|hybrid');
  console.log('  --embeddingProvider off|local|dashscope  (hybrid mode; default dashscope)');
  console.log('  --reranker off|heuristic|cross-encoder');
  console.log('  --recallK N     candidates before rerank');
  console.log('  --cutoffRatio N drop results below topScore × ratio (0 = off)');
  console.log('  --graph true|false  enable anchor-graph multi-hop expansion (default false)');
  console.log('  --scan true|false   enable mimo index scan + graph expansion (default false)');
  console.log('  --scanApiUrl URL    scan API endpoint (default dashscope)');
  console.log('  --scanApiKeyProvider NAME  auth.json provider for scan (default alibaba-cn)');
  console.log('  --scanModel MODEL   model for scan (default qwen3.7-max)');
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
  graphEnabled: boolean,
  scanEnabled: boolean,
  scanApiUrl: string,
  scanApiKeyProvider: string,
  scanModel: string,
  embeddingProvider?: EmbeddingProvider | null,
): Promise<L1QuestionResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `lme-l1-${question.question_id}-`));
  let store: HarmonicUnitFileStore | null = null;
  let db: any = null;
  let result: L1QuestionResult;
  try {
    if (graphEnabled) {
      const { GatewayDatabase } = require('../../../gateway/src/memory/gateway-db');
      const { AnchorGraphStore } = require('../../../gateway/src/graph/anchor-graph-store');
      db = new GatewayDatabase(path.join(tmpDir, 'graph.db'));
      const graph = new AnchorGraphStore(db);
      store = new HarmonicUnitFileStore(tmpDir, undefined, graph);
    } else {
      store = new HarmonicUnitFileStore(tmpDir);
    }
    const { unitCount, sessionOfUnit } = await ingestQuestion(store, question, ingestOpts);
    const index = new HarmonicIndexManager(tmpDir);
    if (graphEnabled && db) {
      const { AnchorGraphStore } = require('../../../gateway/src/graph/anchor-graph-store');
      const graph = new AnchorGraphStore(db);
      graph.rebuild(index.getIndex());
      index.setAnchorGraphStore(graph);
    }

    let entries = index.searchScored(question.question, reranker ? recallK : Math.max(...KS), searchOptions);
    if (embeddingProvider) {
      // Hybrid: build the dense channel over this question's haystack, then
      // re-run searchScored with fused dense scores.
      const vectors = new MemoryVectorStore(path.join(tmpDir, 'memory', 'vectors-eval.json'), 1024, 'eval');
      const getTextForId = async (id: string) => {
        const entry = index.getIndex().entries.find(e => e.id === id);
        // Dense channel = exact retrieval domain (abstraction + cue_anchors),
        // matching EmbeddingIndexer.documentText. Eval haystacks put the full
        // session text into primary_abstraction — cap at 1200 chars so CPU
        // attention stays cheap (BM25 retains full-text coverage).
        return entry
          ? (entry.primary_abstraction.slice(0, 1200) + ' ' + (entry.cue_anchors || []).join(' ')).trim()
          : null;
      };
      const indexer = new EmbeddingIndexer({ vectors, provider: embeddingProvider, getTextForId, batchSize: 4 });
      const ids = index.getIndex().entries.map(e => e.id);
      const backfill = await indexer.backfill(ids);
      const [queryVector] = await embeddingProvider.embed([question.question], 'query');
      if (queryVector && vectors.size() > 0) {
        const hits = vectors.searchByCosine(queryVector, recallK);
        const denseMap = new Map(hits.map(h => [h.id, h.cosine]));
        // Near-duplicate suppression needs entry dates — apply via the shared
        // runtime helper by inlining the same filter (eval has no runtime).
        const createdAt = new Map(index.getIndex().entries.map(e => [e.id as string, (e as any).created_at as string | undefined]));
        const suppressed = new Set<string>();
        for (let i = 0; i < hits.length; i++) {
          for (let j = i + 1; j < hits.length; j++) {
            const a = hits[i], b = hits[j];
            if (suppressed.has(a.id) || suppressed.has(b.id)) continue;
            const va = vectors.get(a.id), vb = vectors.get(b.id);
            if (!va || !vb || va.length !== vb.length) continue;
            let dot = 0, na = 0, nb = 0;
            for (let k = 0; k < va.length; k++) { dot += va[k] * vb[k]; na += va[k] * va[k]; nb += vb[k] * vb[k]; }
            if (na === 0 || nb === 0 || dot / Math.sqrt(na * nb) < 0.92) continue;
            const ta = Date.parse(createdAt.get(a.id) ?? ''), tb = Date.parse(createdAt.get(b.id) ?? '');
            if (Number.isNaN(ta) || Number.isNaN(tb)) continue;
            suppressed.add(ta < tb ? a.id : b.id);
          }
        }
        for (const id of suppressed) denseMap.delete(id);
        searchOptions.denseScores = denseMap;
        entries = index.searchScored(question.question, reranker ? recallK : Math.max(...KS), searchOptions);
        console.error(`[hybrid] indexed=${backfill.indexed} denseHits=${hits.length} suppressed=${suppressed.size}`);
      }
    }
    if (reranker && entries.length > 0) {
      entries = await applyReranker(question.question, entries, reranker, Math.max(...KS), cutoffRatio);
    }

    // ── Scan + graph expansion (if enabled) ──
    if (scanEnabled) {
      const indexEntries = index.getIndex().entries;
      const scanResult = await runScan(index, question.question, scanApiUrl, scanApiKeyProvider, scanModel);
      if (scanResult.ids.length > 0) {
        // Graph 1-hop expansion on scan-selected IDs
        const graphStore = index.getAnchorGraphStore();
        const expandedIds = new Set<string>(scanResult.ids);
        if (graphStore) {
          for (const id of scanResult.ids) {
            try {
              const neighbors = graphStore.getNeighbors([id], 3, new Set(scanResult.ids));
              for (const [nbId] of neighbors) {
                expandedIds.add(nbId);
              }
            } catch { /* non-fatal */ }
          }
        }

        // Union: add scan+graph entries not already in BM25 results
        const existingIds = new Set(entries.map(e => e.entry.id));
        let addedCount = 0;
        for (const id of expandedIds) {
          if (existingIds.has(id)) continue;
          const entry = indexEntries.find((e: any) => e.id === id);
          if (!entry || entry.superseded_by) continue;
          entries.push({ entry, score: entry.energy ?? 0.5 });
          addedCount++;
        }

        console.error(`[scan] bm25=${entries.length - addedCount} scan=${scanResult.ids.length} graph=${expandedIds.size - scanResult.ids.length} added=${addedCount} total=${entries.length}`);

        // Re-sort by score descending
        entries.sort((a, b) => b.score - a.score);
      }
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
      question_date: question.question_date,
      is_abstention: question.question_id.endsWith('_abs'),
      unit_count: unitCount,
      recall,
      ndcg,
      top_sessions: topSessions.slice(0, 10),
      top_contexts: entries.slice(0, 10).map(e => e.entry.primary_abstraction),
      top_scores: entries.slice(0, 10).map(e => e.score),
    };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
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
  const retriever = args.retriever as 'token' | 'bm25' | 'hybrid';
  const embeddingProvider: EmbeddingProvider | null = retriever === 'hybrid'
    ? createEmbeddingProvider({
        provider: args.embeddingProvider === 'off' ? 'dashscope' : args.embeddingProvider,
        model: args.embeddingModel
          ?? (args.embeddingProvider === 'local' ? 'onnx-community/Qwen3-Embedding-0.6B-ONNX' : 'text-embedding-v4'),
        dimensions: args.embeddingProvider === 'local' ? undefined : 1024,
        engine: args.embeddingEngine,
      })
    : null;
  if (retriever === 'hybrid' && !embeddingProvider) {
    console.error('hybrid retriever requires an embedding provider (--embeddingProvider dashscope|local)');
    process.exit(1);
  }
  const reranker = await createRerankerForRun(args.reranker);
  // Scan implies graph (needs anchor graph for 1-hop expansion on scan results)
  const graphEnabled = args.graph || args.scan;
  const searchOptions: SearchOptions = {
    retriever: retriever === 'hybrid' ? 'bm25' : retriever,
    cutoffRatio: reranker ? 0 : args.cutoffRatio,
    fusionSparseWeight: args.fusionSparseWeight,
  };

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsDir = path.join(__dirname, '..', 'results', ts);
  fs.mkdirSync(resultsDir, { recursive: true });
  const runPath = path.join(resultsDir, 'l1-run.jsonl');
  const summaryPath = path.join(resultsDir, 'l1-summary.json');

  console.log(`L1 retrieval: ${questions.length} questions, granularity=${ingestOpts.granularity}, energyMode=${ingestOpts.energyMode}, retriever=${retriever}, embedding=${embeddingProvider?.name ?? 'n/a'}, reranker=${args.reranker}, graph=${args.graph}, scan=${args.scan}, timeAnchor=true`);
  const results: L1QuestionResult[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    process.stdout.write(`[${i + 1}/${questions.length}] ${q.question_id} ${q.question_type} ... `);
    // Per-question options: time anchoring is relative to the question date.
    const perQuestionOptions: SearchOptions = { ...searchOptions, now: q.question_date };
    const res = await runOne(q, ingestOpts, args.keep, perQuestionOptions, reranker, args.recallK, args.cutoffRatio, args.graph, args.scan, args.scanApiUrl, args.scanApiKeyProvider, args.scanModel, embeddingProvider);
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
