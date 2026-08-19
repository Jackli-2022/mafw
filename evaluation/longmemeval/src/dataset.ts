/**
 * LongMemEval dataset loader + stratified sampler.
 *
 * Dataset: longmemeval_s_cleaned.json (500 questions, ~50 haystack sessions each).
 * Schema per question:
 *   question_id, question_type, question, answer, question_date,
 *   haystack_session_ids[], haystack_dates[], haystack_sessions[][],
 *   answer_session_ids[]
 *
 * Cleaned-S contains 6 question types (no abstention split); the loader
 * validates structural invariants so a malformed file fails fast.
 *
 * CLI:
 *   npx ts-node evaluation/longmemeval/src/dataset.ts --dist
 *   npx ts-node evaluation/longmemeval/src/dataset.ts --sample 8 [--seed 42]
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LmeRound {
  role: 'user' | 'assistant';
  content: string;
}

export interface LmeQuestion {
  question_id: string;
  question_type: string;
  question: string;
  answer: string | string[];
  question_date: string;
  haystack_session_ids: string[];
  haystack_dates: string[];
  haystack_sessions: LmeRound[][];
  answer_session_ids: string[];
}

export const DEFAULT_DATA_PATH = path.join(__dirname, '..', 'data', 'longmemeval_s.json');

export function loadDataset(dataPath: string = DEFAULT_DATA_PATH): LmeQuestion[] {
  if (!fs.existsSync(dataPath)) {
    throw new Error(
      `LongMemEval data not found at ${dataPath}. ` +
      'Download longmemeval_s_cleaned.json from hf-mirror.com/datasets/xiaowu0162/longmemeval-cleaned',
    );
  }
  const raw = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('LongMemEval data must be a non-empty array');
  }
  const questions = raw as LmeQuestion[];
  validateDataset(questions);
  return questions;
}

export function validateDataset(questions: LmeQuestion[]): void {
  const ids = new Set<string>();
  for (const [i, q] of questions.entries()) {
    const where = `question[${i}] (${q?.question_id ?? 'no-id'})`;
    for (const key of [
      'question_id', 'question_type', 'question', 'answer', 'question_date',
      'haystack_session_ids', 'haystack_dates', 'haystack_sessions', 'answer_session_ids',
    ] as const) {
      if (q[key] === undefined || q[key] === null) {
        throw new Error(`${where}: missing field ${key}`);
      }
    }
    if (ids.has(q.question_id)) throw new Error(`${where}: duplicate question_id`);
    ids.add(q.question_id);
    const n = q.haystack_session_ids.length;
    if (q.haystack_dates.length !== n || q.haystack_sessions.length !== n) {
      throw new Error(`${where}: haystack arrays length mismatch`);
    }
    for (const [j, session] of q.haystack_sessions.entries()) {
      for (const [k, round] of session.entries()) {
        if (typeof round?.role !== 'string' || typeof round?.content !== 'string') {
          throw new Error(`${where}: round ${j}/${k} malformed`);
        }
      }
    }
    for (const sid of q.answer_session_ids) {
      if (!q.haystack_session_ids.includes(sid)) {
        throw new Error(`${where}: answer_session_id ${sid} not in haystack_session_ids`);
      }
    }
  }
}

export function typeDistribution(questions: LmeQuestion[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const q of questions) dist[q.question_type] = (dist[q.question_type] ?? 0) + 1;
  return dist;
}

/** Deterministic PRNG (mulberry32) for reproducible sampling. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stratified sample: `perType` questions per question_type (or all if fewer),
 * shuffled with a fixed seed for reproducibility.
 */
export function sampleStratified(
  questions: LmeQuestion[],
  perType: number,
  seed = 42,
): LmeQuestion[] {
  const byType = new Map<string, LmeQuestion[]>();
  for (const q of questions) {
    const list = byType.get(q.question_type) ?? [];
    list.push(q);
    byType.set(q.question_type, list);
  }
  const rand = mulberry32(seed);
  const out: LmeQuestion[] = [];
  for (const list of byType.values()) {
    const shuffled = [...list];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    out.push(...shuffled.slice(0, perType));
  }
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const questions = loadDataset();
  if (args.includes('--dist')) {
    console.log(`total: ${questions.length}`);
    for (const [type, count] of Object.entries(typeDistribution(questions))) {
      console.log(`  ${type}: ${count}`);
    }
  }
  const sampleIdx = args.indexOf('--sample');
  if (sampleIdx !== -1) {
    const perType = parseInt(args[sampleIdx + 1], 10);
    const seedIdx = args.indexOf('--seed');
    const seed = seedIdx !== -1 ? parseInt(args[seedIdx + 1], 10) : 42;
    const sample = sampleStratified(questions, perType, seed);
    console.log(`sampled ${sample.length} questions (perType=${perType}, seed=${seed}):`);
    for (const q of sample) console.log(`  ${q.question_id}  ${q.question_type}`);
  }
}
