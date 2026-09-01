/* Diff knowledge-update per-question ranks: E1 (bm25 baseline) vs E3v3 (hybrid). */
import * as fs from 'fs';

const E1 = 'C:/work/work-loop/opencode-plugin-mafw/evaluation/longmemeval/results/2026-09-01T13-41-03-830Z/l1-run.jsonl';
const E3 = 'C:/work/work-loop/opencode-plugin-mafw/evaluation/longmemeval/results/2026-09-01T17-18-08-136Z/l1-run.jsonl';
const parse = (p: string) => fs.readFileSync(p, 'utf8').trim().split('\n').map((line: string) => JSON.parse(line));
const A = parse(E1);
const B = parse(E3);

for (const b of B.filter((x: any) => x.question_type === 'knowledge-update')) {
  const a: any = A.find((x: any) => x.question_id === b.question_id);
  const diff = a.recall[3] !== b.recall[3] || a.recall[10] !== b.recall[10];
  console.log(
    b.question_id,
    `E1 R@3=${a.recall[3]} R@10=${a.recall[10]}`,
    `E3 R@3=${b.recall[3]} R@10=${b.recall[10]}`,
    diff ? '<-- DIFF' : '',
  );
  if (diff) {
    console.log('  Q:', b.question.slice(0, 130).replace(/\n/g, ' '));
    const rankIn = (ctxs: string[], id: string) => {
      const idx = ctxs.findIndex(c => c.slice(0, 40) === id.slice(0, 40));
      return idx;
    };
    // find answer session's date prefix in each run's top list
    const answerDate = (b.top_contexts as string[]).length ? (a as any).top_sessions : null;
    console.log('  answer_sessions:', b.answer_session_ids);
    console.log('  E1 top_sessions:', a.top_sessions.slice(0, 6));
    console.log('  E3 top_sessions:', b.top_sessions.slice(0, 6));
    console.log('  E3 top_scores:', b.top_scores.slice(0, 6).map((s: number) => s.toFixed(2)));
    console.log('  E1 top_scores:', a.top_scores.slice(0, 6).map((s: number) => s.toFixed(2)));
  }
}
