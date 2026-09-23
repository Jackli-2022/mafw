// S1: write-time routing. Before a memory is persisted, decide whether it is a
// duplicate of an existing entry (skip / non-write), an evolution of one
// (update / integrate), or genuinely new (create). This turns consolidation
// from a post-write side-effect into a write-time gate — the brain integrates
// (replay → gist), it does not append.
//
// Thresholds: cosine >= dupCosine → skip (near-exact duplicate, never persisted);
// candidateCosine <= cosine < dupCosine → ask the LLM judge (create vs update);
// cosine < candidateCosine → create without an LLM call (fast path). All
// failures are fail-open to `create` so routing never blocks or loses a write.
import { HarmonicUnit } from '../core/memory/harmonic-types';
import { MemoryVectorStore, EmbeddingIndexer } from './vector-store';
import { EmbeddingProvider } from './embedding-provider';

export type RoutingOutcome =
  | { action: 'skip'; targetId: string }
  | { action: 'create' }
  | { action: 'update'; targetId: string };

export interface JudgeDecision {
  action: 'create' | 'update';
  targetId?: string;
}

export interface RouteWriteDeps {
  vectors: MemoryVectorStore;
  provider: EmbeddingProvider;
  /** LLM identity judge: given the new unit and candidate ids, decide create/update. */
  judge: (unit: HarmonicUnit, candidateIds: string[]) => Promise<JudgeDecision | null>;
  /** θ_cand — candidate recall threshold (default 0.8). */
  candidateCosine?: number;
  /** θ_dup — near-exact duplicate threshold → non-write (default 0.95). */
  dupCosine?: number;
  /** Max candidates sent to the judge (default 3). */
  maxCandidates?: number;
  /** Exclude revoked (superseded) entries from candidates. */
  isSuperseded?: (id: string) => boolean;
}

export async function decideRouting(unit: HarmonicUnit, deps: RouteWriteDeps): Promise<RoutingOutcome> {
  const thetaCand = deps.candidateCosine ?? 0.8;
  const thetaDup = deps.dupCosine ?? 0.95;
  const maxCand = deps.maxCandidates ?? 3;

  let vector = deps.vectors.get(unit.id);
  if (!vector) {
    // The async indexer may not have flushed yet — embed on demand so routing
    // sees this unit in vector space immediately.
    try {
      const text = EmbeddingIndexer.documentText(unit);
      if (!text) return { action: 'create' };
      const [vec] = await deps.provider.embed([text], 'document');
      if (!vec) return { action: 'create' };
      deps.vectors.upsert(unit.id, vec);
      vector = vec;
    } catch {
      return { action: 'create' }; // fail-open
    }
  }

  const hits = deps.vectors
    .searchByCosine(vector, maxCand + 1)
    .filter((h) => h.id !== unit.id && !deps.isSuperseded?.(h.id) && h.cosine >= thetaCand);
  if (hits.length === 0) return { action: 'create' };

  const top = hits[0];
  if (top.cosine >= thetaDup) return { action: 'skip', targetId: top.id };

  const candidateIds = hits.slice(0, maxCand).map((h) => h.id);
  let verdict: JudgeDecision | null = null;
  try {
    verdict = await deps.judge(unit, candidateIds);
  } catch {
    return { action: 'create' }; // fail-open
  }
  if (!verdict || verdict.action === 'create') return { action: 'create' };
  if (verdict.targetId && candidateIds.includes(verdict.targetId)) {
    return { action: 'update', targetId: verdict.targetId };
  }
  return { action: 'create' }; // invalid target → fail-open
}
