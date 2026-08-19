/**
 * Retrieval + QA metrics for the LongMemEval benchmark.
 *
 * Retrieval relevance is binary at the *session* level: a retrieved item is
 * relevant iff its source session is in answer_session_ids. Pure functions,
 * hand-verifiable, unit-tested in tests/unit/eval/longmemeval-metrics.test.ts.
 */

/** Recall@k = |retrieved[:k] ∩ relevant| / |relevant|. Retrieved may contain dupes; relevant is a set. */
export function recallAtK(retrieved: string[], relevant: string[], k: number): number {
  if (relevant.length === 0) return 0;
  const rel = new Set(relevant);
  const hit = new Set<string>();
  for (const id of retrieved.slice(0, k)) {
    if (rel.has(id)) hit.add(id);
  }
  return hit.size / relevant.length;
}

/** Binary DCG@k over the retrieved list (duplicates count at their rank, as retrieved). */
function dcgAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  let dcg = 0;
  const seen = new Set<string>();
  retrieved.slice(0, k).forEach((id, i) => {
    // A relevant session only gains at its first occurrence; later dupes add nothing.
    if (relevant.has(id) && !seen.has(id)) {
      dcg += 1 / Math.log2(i + 2);
    }
    seen.add(id);
  });
  return dcg;
}

/** NDCG@k with binary relevance against the ideal ordering of min(|relevant|, k) hits. */
export function ndcgAtK(retrieved: string[], relevant: string[], k: number): number {
  if (relevant.length === 0) return 0;
  const rel = new Set(relevant);
  const idealHits = Math.min(rel.size, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2);
  if (idcg === 0) return 0;
  return dcgAtK(retrieved, rel, k) / idcg;
}

export interface TypeMetrics {
  count: number;
  recall: Record<number, number>; // k -> mean recall@k
  ndcg: Record<number, number>;   // k -> mean ndcg@k
  qaAccuracy?: number;            // filled by L2
}

/** Mean of each metric across a group of per-question results. */
export function aggregateMetrics(
  results: Array<{ recall: Record<number, number>; ndcg: Record<number, number>; qaCorrect?: boolean }>,
  ks: number[],
): TypeMetrics {
  const out: TypeMetrics = { count: results.length, recall: {}, ndcg: {} };
  for (const k of ks) {
    out.recall[k] = mean(results.map(r => r.recall[k] ?? 0));
    out.ndcg[k] = mean(results.map(r => r.ndcg[k] ?? 0));
  }
  const judged = results.filter(r => r.qaCorrect !== undefined);
  if (judged.length > 0) {
    out.qaAccuracy = mean(judged.map(r => (r.qaCorrect ? 1 : 0)));
  }
  return out;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Group per-question results by question_type and aggregate each group. */
export function aggregateByType<T extends { questionType: string; recall: Record<number, number>; ndcg: Record<number, number>; qaCorrect?: boolean }>(
  results: T[],
  ks: number[],
): Record<string, TypeMetrics> {
  const groups = new Map<string, T[]>();
  for (const r of results) {
    const list = groups.get(r.questionType) ?? [];
    list.push(r);
    groups.set(r.questionType, list);
  }
  const out: Record<string, TypeMetrics> = {};
  for (const [type, group] of groups) out[type] = aggregateMetrics(group, ks);
  return out;
}
