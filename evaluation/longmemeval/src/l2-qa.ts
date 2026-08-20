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
import { chatCompletion, ChatMessage, loadAuthKey } from './llm';
import { buildJudgePrompt, parseJudgeScore } from './judge-prompts';
import { aggregateByType } from './metrics';

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
    maxTokens: parseInt(flags.get('--maxTokens') ?? '1024', 10),
    order: (flags.get('--order') ?? 'date') as 'date' | 'rank',
    cot: flags.get('--cot') === 'true',
    enumerate: flags.get('--enumerate') === 'true',
    scoreThreshold: parseFloat(flags.get('--scoreThreshold') ?? '0'),
  };
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

function buildReaderMessages(
  question: string,
  contexts: string[],
  isAbstention: boolean,
  order: 'date' | 'rank' = 'date',
  lowConfidence = false,
  cot = false,
  enumerate = false,
): ChatMessage[] {
  const sorted = sortContexts(contexts.slice(0, 20), order); // cap reader context
  // Official LongMemEval reader template (run_generation.py): numbered
  // sessions with explicit dates, then Current Date + Question.
  const ctxBlock = sorted.length
    ? sorted.map((c, i) => {
        const date = c.match(/^\[(\d{4}\/\d{2}\/\d{2})\s+\(\w+\)\s+\d{2}:\d{2}\]/)?.[1] ?? '';
        const body = c.replace(/^\[[^\]]*\]\s*/, '');
        return `### Session ${i + 1}:\nSession Date: ${date}\nSession Content:\n${body}`;
      }).join('\n\n')
    : '(no relevant history chats retrieved)';
  const abstentionHint = isAbstention
    ? 'If the history chats do not contain the requested information, say that the information is incomplete, but you may mention related facts that ARE in the chats.'
    : 'If the history chats do not contain the answer, say "I don\'t know".';
  const cotHint = cot
    ? 'Answer the question step by step: first extract all the relevant information, and then reason over the information to get the answer.'
    : '';
  const enumerateHint = enumerate
    ? 'Before answering, you MUST: (1) Scan all sessions and list EVERY relevant fact with its session number, e.g. "Session 3: earned $225 from jam sales. Session 5: earned $120 from plant sales." (2) For counting/summing/comparing questions, compute the answer by explicitly iterating over your list. (3) Every conclusion must cite the session numbers that support it. (4) Only say "no record" if your enumerated list is empty.'
    : '';
  const confidenceHint = lowConfidence
    ? '\n\nNote: retrieval confidence is LOW. Treat the memories as uncertain and abstain if they do not clearly answer the question.'
    : '';
  const system = `You are a helpful assistant answering a user based only on their past conversation history. ${abstentionHint}${confidenceHint}`;
  const user = `I will give you several history chats between you and a user. Please answer the question based on the relevant chat history.${cotHint ? ' ' + cotHint : ''}${enumerateHint ? ' ' + enumerateHint : ''}\n\n\nHistory Chats:\n\n${ctxBlock}\n\nCurrent Date: ${new Date().toISOString().slice(0, 10)}\nQuestion: ${question}\nAnswer:`;
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
  const results: L2QuestionResult[] = [];

  for (let i = 0; i < l1Items.length; i++) {
    const item = l1Items[i];
    process.stdout.write(`[${i + 1}/${l1Items.length}] ${item.question_id} ... `);
    try {
      const lowConfidence = args.scoreThreshold > 0 && (item.top_scores?.[0] ?? Infinity) < args.scoreThreshold;
      const readerMessages = buildReaderMessages(
        item.question,
        item.top_contexts.slice(0, args.topK),
        item.is_abstention,
        args.order,
        lowConfidence,
        args.cot,
        args.enumerate,
      );
      const readerAnswer = await chatCompletion({
        model: args.readerModel,
        apiUrl: args.apiUrl,
        apiKey: loadAuthKey(args.apiKeyProvider),
        messages: readerMessages,
        temperature: 0,
        max_tokens: args.maxTokens,
      });
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
        top_k_used: Math.min(args.topK, item.top_contexts.length),
      };
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
