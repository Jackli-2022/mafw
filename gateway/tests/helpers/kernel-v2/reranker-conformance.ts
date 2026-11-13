import type { ScoredEntry } from '../../../src/core/memory/harmonic-index';
import type { Reranker } from '../../../src/core/memory/reranker';

const HEALTH = new Set(['healthy', 'degraded', 'failed']);

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runRerankerConformance(
  reranker: Reranker,
  candidates: ScoredEntry[],
): Promise<string[]> {
  const errors: string[] = [];
  if (typeof reranker.name !== 'string' || reranker.name.trim() === '') {
    errors.push('name is required');
  }
  if (typeof reranker.strategy !== 'string' || reranker.strategy.trim() === '') {
    errors.push('strategy is required');
  }

  let result: ScoredEntry[];
  try {
    result = await reranker.rerank('query', candidates, 2);
  } catch (err) {
    return [...errors, `rerank threw: ${messageOf(err)}`];
  }

  if (!Array.isArray(result)) {
    errors.push('rerank must return an array');
    return errors;
  }
  if (result.length > 2) errors.push('rerank must respect topK');
  if (candidates.length > 0 && result.length === 0) {
    errors.push('rerank returned no candidates for a non-empty input');
  }

  const known = new Set(candidates.map((candidate) => candidate.entry.id));
  const seen = new Set<string>();
  for (const item of result) {
    const id = item?.entry?.id;
    if (typeof id !== 'string' || !known.has(id)) {
      errors.push(`rerank returned an unknown candidate "${String(id)}"`);
      continue;
    }
    if (seen.has(id)) errors.push(`rerank returned duplicate candidate "${id}"`);
    seen.add(id);
    if (!Number.isFinite(item.score)) errors.push(`rerank score for "${id}" is not finite`);
  }

  if (typeof reranker.health === 'function') {
    try {
      const health = reranker.health();
      if (!HEALTH.has(health)) errors.push(`health returned "${health}"`);
    } catch (err) {
      errors.push(`health threw: ${messageOf(err)}`);
    }
  }

  return errors;
}
