/**
 * L2 LongMemEval benchmark: QA accuracy with a reader LLM and an LLM judge.
 *
 * Reads an L1 run JSONL (retrieved memories per question), prompts a reader
 * model to answer, then prompts a judge model to score 0/1 against the
 * reference answer. Outputs a JSONL result file and a per-type accuracy table.
 *
 * This is the "reading" stage of the unified LongMemEval framework, layered on
 * top of the L1 retrieval stage.
 */

import * as fs from 'fs';
import * as path from 'path';
import { L1QuestionResult, L2QuestionResult } from './types';
import { chatCompletion, chatCompletionFull, ChatMessage, loadAuthKey } from './llm';
import { buildJudgePrompt, parseJudgeScore } from './judge-prompts';
import { aggregateByType } from './metrics';
import { computeFokFeatures, classifyFok, FokZone } from '../../../gateway/src/recall/fok-gate';

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i];
    const v = args[i + 1];
    if (k?.startsWith('--')) flags.set(k, v);
  }
  return {
    l1Run: flags.get('--l1Run'),
    readerModel: flags.get('--reader') ?? 'meta-llama/llama-3.1-8b-instruct',
    judgeModel: flags.get('--judge') ?? 'meta-llama/llama-3.1-70b-instruct',
    apiUrl: flags.get('--apiUrl') ?? 'https://openrouter.ai/api/v1/chat/completions',
    apiKeyProvider: flags.get('--apiKeyProvider') ?? 'openrouter',
    topK: parseInt(flags.get('--topK') ?? '10', 10),
    maxTokens: parseInt(flags.get('--maxTokens') ?? '2048', 10),
    order: (flags.get('--order') ?? 'date') as 'date' | 'rank',
    cot: flags.get('--cot') === 'true',
    enumerate: flags.get('--enumerate') === 'true',
    readerMode: (flags.get('--readerMode') ?? 'plain') as 'plain' | 'chain-of-note',
    scoreThreshold: parseFloat(flags.get('--scoreThreshold') ?? '0'),
    // R5 FOK gate: apply the three-zone gate to the reader prompt. Both
    // thresholds must be > 0 to enable (0 = off, the default).
    fokLow: parseFloat(flags.get('--fokLow') ?? '0'),
    fokHigh: parseFloat(flags.get('--fokHigh') ?? '0'),
    // R5 FOK via reranker probability: JSONL with per-question `top1prob`
    // (produced by probe-fok-rerank.ts). Overrides the score-based feature —
    // the cross-encoder probability discriminates answerable vs unanswerable
    // (AUROC 0.78) while the BM25 score ratio does not (0.58).
    fokProbs: flags.get('--fokProbs'),
    // Production-faithful abstention measurement: the production pipeline does
    // NOT know a question is unanswerable, so the official abstention hint
    // (which the benchmark hands the reader for `_abs` items) inflates the
    // baseline. Set true to withhold that hint (judge semantics unchanged).
    noAbstentionHint: flags.get('--noAbstentionHint') === 'true',
    // Variant B (production default): in the no-memory zone KEEP the retrieved
    // contexts and state the caution. Measured best on both sides (abstention
    // 0.967 vs 0.933 withhold vs 0.867 baseline; answerable subset 0.523 vs
    // 0.386 vs 0.500). Pass `--fokKeepContexts false` for the withholding
    // ablation.
    fokKeepContexts: flags.get('--fokKeepContexts') !== 'false',
  };
}

/** R5 zone from a reranker top-1 probability (higher = more trustworthy). */
export function zoneFromProbability(prob: number | undefined, low: number, high: number): FokZone {
  if (prob === undefined || Number.isNaN(prob)) return 'inject';
  if (prob >= high) return 'inject';
  if (prob >= low) return 'low-confidence';
  return 'no-memory';
}

/** Load question_id → top1prob from a probe dump (fail-open → empty map). */
export function loadFokProbs(file: string | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!file) return map;
  try {
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (row?.question_id !== undefined && typeof row.top1prob === 'number') {
        map.set(String(row.question_id), row.top1prob);
      }
    }
  } catch { /* fail-open: no probs → all inject */ }
  return map;
}

/** R5 zone for one item, from its raw top-k scores (top1/mean feature). */
export function fokZoneFor(topScores: number[] | undefined, low: number, high: number): FokZone {
  if (!(low > 0) || !(high > 0)) return 'inject';
  return classifyFok(computeFokFeatures(topScores ?? []), { low, high });
}

/** Reader-visible context count: the no-memory zone withholds candidates. */
export function noMemoryCtx(item: L1QuestionResult, zone: FokZone, topK: number): number {
  return zone === 'no-memory' ? 0 : item.top_contexts.length;
}

function help() {
  console.log('Usage:');
  console.log('  npx ts-node --project evaluation/longmemeval/tsconfig.json evaluation/longmemeval/src/l2-qa.ts --l1Run <path> [options]');
  console.log('Options:');
  console.log('  --reader MODEL         reader LLM (default meta-llama/llama-3.1-8b-instruct)');
  console.log('  --judge MODEL          judge LLM (default meta-llama/llama-3.1-70b-instruct)');
  console.log('  --apiUrl URL           OpenAI-compatible endpoint');
  console.log('  --apiKeyProvider NAME  auth.json provider name to use (default openrouter)');
  console.log('  --topK N               number of retrieved memories fed to reader');
  console.log('  --maxTokens N          reader max_tokens');
  console.log('  --order date|rank      order of memories in reader prompt (default date)');
  console.log('  --cot true|false       official step-by-step reasoning (default false)');
  console.log('  --enumerate true|false enumerate-then-aggregate for aggregation questions (default false)');
  console.log('  --scoreThreshold N     if top-1 retrieval score < N, add a low-confidence hint');
  console.log('  --fokLow N --fokHigh N R5 FOK gate: top1/mean thresholds (0 = off); no-memory withholds contexts');
  console.log('  --fokProbs PATH        R5 FOK from reranker top-1 probability (probe-fok-rerank dump)');
  console.log('  --noAbstentionHint true  production-faithful: withhold the official abstention hint');
  console.log('  --fokKeepContexts false no-memory withholds contexts (ablation; default keeps them)');
}

function sortByDatePrefix(contexts: string[]): string[] {
  // Contexts begin with '[2023/05/20 (Sat) 02:21] ...'; sort chronologically.
  return [...contexts].sort((a, b) => {
    const da = a.match(/^\[(\d{4}\/\d{2}\/\d{2})\s+\(\w+\)\s+(\d{2}:\d{2})\]/)?.[0] ?? '';
    const db = b.match(/^\[(\d{4}\/\d{2}\/\d{2})\s+\(\w+\)\s+(\d{2}:\d{2})\]/)?.[0] ?? '';
    return da.localeCompare(db);
  });
}

function extractSessionMarker(context: string): string {
  const m = context.match(/lmesid:([^\s\]]+)/);
  return m ? `Session#${m[1].slice(-4)}` : '';
}

function sortContexts(contexts: string[], order: 'date' | 'rank'): string[] {
  if (order === 'rank') return contexts.slice();
  return sortByDatePrefix(contexts);
}

function weeksSince(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('/');
  if (parts.length !== 3) return '';
  const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffWeeks = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7));
  return diffWeeks > 0 ? ` (${diffWeeks} weeks ago)` : '';
}

export function buildReaderMessages(
  question: string,
  contexts: string[],
  isAbstention: boolean,
  order: 'date' | 'rank' = 'date',
  lowConfidence = false,
  cot = false,
  enumerate = false,
  questionDate?: string,
  readerMode: 'plain' | 'chain-of-note' = 'plain',
  fokZone: 'inject' | 'low-confidence' | 'no-memory' = 'inject',
  keepContextsOnNoMemory = false,
): ChatMessage[] {
  // R5 FOK gate: the no-memory zone deliberately withholds candidates and says
  // so — silence is what invites confabulation. `keepContextsOnNoMemory`
  // (variant B) keeps them for measurement of the withholding cost.
  const noMemory = fokZone === 'no-memory';
  const withhold = noMemory && !keepContextsOnNoMemory;
  const effectiveLowConfidence = lowConfidence || fokZone === 'low-confidence';
  const sorted = withhold ? [] : sortContexts(contexts.slice(0, 20), order); // cap reader context
  // Official LongMemEval reader template (run_generation.py): numbered
  // sessions with explicit dates, then Current Date + Question.
  const ctxBlock = sorted.length
    ? sorted.map((c, i) => {
        const date = c.match(/^\[(\d{4}\/\d{2}\/\d{2})\s+\(\w+\)\s+\d{2}:\d{2}\]/)?.[1] ?? '';
        const body = c.replace(/^\[[^\]]*\]\s*/, '');
        const weeksAgo = weeksSince(date);
        return `### Session ${i + 1}:\nSession Date: ${date}${weeksAgo}\nSession Content:\n${body}`;
      }).join('\n\n')
    : '(no relevant history chats retrieved)';
  const abstentionHint = isAbstention
    ? 'If the history chats do not contain the requested information, say that the information is incomplete, but you may mention related facts that ARE in the chats.'
    : 'If the history chats do not contain the answer, say "I don\'t know".';
  const noMemoryHint = noMemory
    ? '\n\nNo reliable memory was retrieved for this question. Do NOT invent details. If the history chats contain no relevant information, state plainly that the information is unavailable.'
    : '';
  const cotHint = cot
    ? 'Answer the question step by step: first extract all the relevant information, and then reason over the information to get the answer.'
    : '';
  const enumerateHint = enumerate
    ? 'Before answering, you MUST: (1) Scan all sessions and list EVERY relevant fact with its session number, e.g. "Session 3: earned $225 from jam sales. Session 5: earned $120 from plant sales." (2) For counting/summing/comparing questions, compute the answer by explicitly iterating over your list. (3) Every conclusion must cite the session numbers that support it. (4) Only say "no record" if your enumerated list is empty. (5) For preference/suggestion questions (e.g., "Can you suggest X for Y?"), infer the user\'s preferences from past discussions of similar topics and apply them to the new context — e.g., if the user discussed Seattle hotels and expressed preferences for great views and rooftop pools, apply those same preferences when suggesting Miami hotels.'
    : '';
  const confidenceHint = effectiveLowConfidence
    ? '\n\nNote: retrieval confidence is LOW. Treat the memories as uncertain and abstain if they do not clearly answer the question.'
    : '';
  // Chain-of-Note (arXiv:2311.04889): per-session relevance notes + facts, then
  // answer strictly from the notes. Official error analysis: 15-19% of failures
  // are "retrieved right, read wrong" — notes force evidence extraction.
  const chainOfNoteHint = readerMode === 'chain-of-note'
    ? 'Before answering, write a note for EVERY session above, in this exact format:\nNote S# (relevant: yes/no): <one or two facts the session states that bear on the question, quoting specifics; if not relevant, write "no bearing".>\nThen give "Answer:" using ONLY what your notes established. If your notes contain no relevant fact, say you don\'t know.'
    : '';
  const system = `You are a helpful assistant answering a user based only on their past conversation history. ${abstentionHint}${confidenceHint}${noMemoryHint}`;
  const questionDateStr = questionDate ? `Question Date: ${questionDate}\n` : '';
  const temporalHint = questionDate
    ? 'IMPORTANT: Temporal references in the question (e.g., "last month", "two weeks ago", "two months ago") should be interpreted relative to the Question Date provided below, not the current date or session dates.'
    : 'IMPORTANT: Temporal references in the question (e.g., "last month", "two weeks ago") should be interpreted relative to the session dates, not the current date.';
  const user = `I will give you several history chats between you and a user. Please answer the question based on the relevant chat history. ${temporalHint}${cotHint ? ' ' + cotHint : ''}${enumerateHint ? ' ' + enumerateHint : ''}${chainOfNoteHint ? '\n\n' + chainOfNoteHint : ''}\n\n\nHistory Chats:\n\n${ctxBlock}\n\n${questionDateStr}Question: ${question}\nAnswer:`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

async function judgeOne(
  item: L1QuestionResult,
  readerAnswer: string,
  judgeModel: string,
  apiUrl: string,
  apiKeyProvider: string,
): Promise<{ score: number; reason: string }> {
  const { system, user } = buildJudgePrompt(
    item.question_type,
    item.question,
    item.answer,
    readerAnswer,
    item.is_abstention,
  );
  const raw = await chatCompletion({
    model: judgeModel,
    apiUrl,
    apiKey: loadAuthKey(apiKeyProvider),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0,
    // mimo is a reasoning model: reasoning_content consumes tokens before the
    // final answer. max_tokens must comfortably exceed the reasoning budget or
    // content comes back empty (finish_reason=length). Official repo uses 10
    // for GPT-4o which is NOT a reasoning model; for reasoning models 800.
    max_tokens: 800,
  });
  if (!raw || !raw.trim()) {
    // Retry once — some providers occasionally return empty on transient load.
    const retry = await chatCompletion({
      model: judgeModel,
      apiUrl,
      apiKey: loadAuthKey(apiKeyProvider),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      max_tokens: 800,
    });
    return parseJudgeScore(retry || '');
  }
  return parseJudgeScore(raw);
}

/** accuracy for a subset (null when empty). */
function accuracyFor(rows: Array<{ judge_score: number }>): { count: number; accuracy: number | null } {
  return {
    count: rows.length,
    accuracy: rows.length ? Number((rows.reduce((a, r) => a + r.judge_score, 0) / rows.length).toFixed(4)) : null,
  };
}

async function main() {
  const args = parseArgs();
  if (!args.l1Run) {
    help();
    process.exit(1);
  }
  if (!fs.existsSync(args.l1Run)) {
    console.error(`L1 run file not found: ${args.l1Run}`);
    process.exit(1);
  }

  const l1Items: L1QuestionResult[] = fs.readFileSync(args.l1Run, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));

  const resultsDir = path.dirname(args.l1Run);
  const runPath = path.join(resultsDir, 'l2-qa.jsonl');
  const summaryPath = path.join(resultsDir, 'l2-summary.json');
  const hardNegativesPath = path.join(resultsDir, 'hard-negatives.jsonl');
  // Clear previous outputs for this run (idempotent re-run).
  if (fs.existsSync(runPath)) fs.unlinkSync(runPath);
  if (fs.existsSync(summaryPath)) fs.unlinkSync(summaryPath);
  if (fs.existsSync(hardNegativesPath)) fs.unlinkSync(hardNegativesPath);

  console.log(`L2 QA: ${l1Items.length} questions, topK=${args.topK}, reader=${args.readerModel}, judge=${args.judgeModel}, order=${args.order}`);
  const fokProbMap = loadFokProbs(args.fokProbs);
  if (fokProbMap.size > 0) console.log(`R5 FOK gate: probability-driven (${fokProbMap.size} probs), low=${args.fokLow} high=${args.fokHigh}`);
  const results: L2QuestionResult[] = [];

  for (let i = 0; i < l1Items.length; i++) {
    const item = l1Items[i];
    process.stdout.write(`[${i + 1}/${l1Items.length}] ${item.question_id} ... `);
    try {
      const lowConfidence = args.scoreThreshold > 0 && (item.top_scores?.[0] ?? Infinity) < args.scoreThreshold;
      const fokZone = fokProbMap.size > 0
        ? zoneFromProbability(fokProbMap.get(item.question_id), args.fokLow, args.fokHigh)
        : fokZoneFor(item.top_scores, args.fokLow, args.fokHigh);
      const readerMessages = buildReaderMessages(
        item.question,
        item.top_contexts.slice(0, args.topK),
        args.noAbstentionHint ? false : item.is_abstention,
        args.order,
        lowConfidence,
        args.cot,
        args.enumerate,
        item.question_date,
        args.readerMode,
        fokZone,
        args.fokKeepContexts,
      );
      const readerResult = await chatCompletionFull({
        model: args.readerModel,
        apiUrl: args.apiUrl,
        apiKey: loadAuthKey(args.apiKeyProvider),
        messages: readerMessages,
        temperature: 0,
        max_tokens: args.maxTokens,
      });
      let readerAnswer = readerResult.content;
      // Truncation detection: if finish_reason=length, retry with continuation
      if (readerResult.truncated) {
        const continuationMessages: ChatMessage[] = [
          ...readerMessages,
          { role: 'assistant', content: readerAnswer },
          { role: 'user', content: 'Your previous response was cut off. Please continue from where you left off.' },
        ];
        try {
          const continuationResult = await chatCompletionFull({
            model: args.readerModel,
            apiUrl: args.apiUrl,
            apiKey: loadAuthKey(args.apiKeyProvider),
            messages: continuationMessages,
            temperature: 0,
            max_tokens: args.maxTokens,
          });
          readerAnswer = readerAnswer + '\n' + continuationResult.content;
        } catch (err: any) {
          // Continuation failed, use partial answer
          console.error(`[truncation retry failed: ${err.message}]`);
        }
      }
      const { score, reason } = await judgeOne(item, readerAnswer, args.judgeModel, args.apiUrl, args.apiKeyProvider);
      if (score === 0) {
        const hardNegative = {
          question_id: item.question_id,
          question_type: item.question_type,
          question: item.question,
          reference_answer: item.answer,
          reader_answer: readerAnswer,
          top_1_context: item.top_contexts[0] ?? null,
          top_1_score: item.top_scores?.[0] ?? null,
          judge_reason: reason,
        };
        fs.appendFileSync(hardNegativesPath, JSON.stringify(hardNegative) + '\n', 'utf-8');
      }
      const res: L2QuestionResult = {
        question_id: item.question_id,
        question_type: item.question_type,
        is_abstention: item.is_abstention,
        question: item.question,
        reference_answer: item.answer,
        reader_answer: readerAnswer,
        judge_score: score,
        judge_reason: reason,
        top_k_used: Math.min(args.topK, noMemoryCtx(item, fokZone, args.topK)),
      };
      (res as any).fok_zone = fokZone;
      results.push(res);
      fs.appendFileSync(runPath, JSON.stringify(res) + '\n', 'utf-8');
      process.stdout.write(`score=${score}\n`);
    } catch (err: any) {
      console.error(`FAILED: ${err.message}`);
      // continue with others
    }
  }

  const judged = results.filter(r => r.judge_reason !== undefined);
  const overallAcc = judged.length ? judged.reduce((a, r) => a + r.judge_score, 0) / judged.length : 0;
  const byType = aggregateByType(
    judged.map(r => ({ questionType: r.question_type, recall: {}, ndcg: {}, qaCorrect: r.judge_score === 1 })),
    [],
  );

  const summary = {
    overall: { count: judged.length, accuracy: Number(overallAcc.toFixed(4)) },
    by_type: Object.fromEntries(
      Object.entries(byType).map(([type, m]) => [type, { count: m.count, accuracy: m.qaAccuracy }]),
    ),
    // R5 gate breakdown: accuracy by zone, and the answerable/abstention split
    // (abstention accuracy = did the reader correctly identify unanswerable Qs).
    fok: args.fokLow > 0 && args.fokHigh > 0 ? {
      low: args.fokLow,
      high: args.fokHigh,
      by_zone: Object.fromEntries(
        (['inject', 'low-confidence', 'no-memory'] as const).map(zone => {
          const zs = judged.filter(r => (r as any).fok_zone === zone);
          return [zone, {
            count: zs.length,
            accuracy: zs.length ? Number((zs.reduce((a, r) => a + r.judge_score, 0) / zs.length).toFixed(4)) : null,
            abstention_count: zs.filter(r => r.is_abstention).length,
          }];
        }),
      ),
      answerable: accuracyFor(judged.filter(r => !r.is_abstention)),
      abstention: accuracyFor(judged.filter(r => r.is_abstention)),
    } : null,
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

  console.log('\n## L2 QA Accuracy');
  console.log(`| overall | N=${judged.length} | acc=${overallAcc.toFixed(3)} |`);
  console.log('| type | count | accuracy |');
  console.log('|---|---|---|');
  for (const [type, m] of Object.entries(byType)) {
    console.log(`| ${type} | ${m.count} | ${(m.qaAccuracy ?? 0).toFixed(3)} |`);
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
