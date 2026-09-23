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
import { getReconsolidationQueue } from '../recall/reconsolidation';

export type RoutingOutcome =
  | { action: 'skip'; targetId: string }
  | { action: 'create' }
  | { action: 'update'; targetId: string }
  | { action: 'separate'; targetId: string; distinction?: string };

export interface JudgeDecision {
  action: 'create' | 'update' | 'separate';
  targetId?: string;
  distinction?: string;
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
    if (verdict.action === 'separate') {
      return { action: 'separate', targetId: verdict.targetId, distinction: verdict.distinction };
    }
    return { action: 'update', targetId: verdict.targetId };
  }
  return { action: 'create' }; // invalid target → fail-open
}

/** Minimal store surface routeAndWrite needs (matches HarmonicUnitFileStore). */
export interface RouteStore {
  read(id: string): Promise<HarmonicUnit | null>;
  write(unit: HarmonicUnit, tier?: string, opts?: { skipMerge?: boolean }): Promise<string>;
  markSuperseded(id: string, byId: string): boolean | void | Promise<void>;
}

/**
 * Decide + apply in one call: `skip` persists nothing (returns the existing
 * canonical id), `create` writes the unit, `update` merges the new content over
 * the existing target and soft-supersedes it.
 */
export async function routeAndWrite(
  unit: HarmonicUnit,
  store: RouteStore,
  deps: RouteWriteDeps,
): Promise<{ action: 'skip' | 'create' | 'update' | 'separate'; id: string; targetId?: string }> {
  const decision = await decideRouting(unit, deps);
  if (decision.action === 'skip') {
    routeStats.skip++;
    return { action: 'skip', id: decision.targetId, targetId: decision.targetId };
  }
  if (decision.action === 'create') {
    await store.write(unit);
    routeStats.create++;
    return { action: 'create', id: unit.id };
  }
  if (decision.action === 'separate') {
    // Keep both entries: write the new unit with a disambiguating anchor and a
    // distinct_from marker. No merge, no supersede.
    const separated: HarmonicUnit = {
      ...unit,
      cue_anchors: dedupeCap(
        [...(unit.cue_anchors || []), ...(decision.distinction ? [decision.distinction] : [])],
        8,
      ),
      distinct_from: [...(unit.distinct_from || []), decision.targetId],
      updated_at: new Date().toISOString(),
    };
    await store.write(separated);
    routeStats.separate++;
    return { action: 'separate', id: separated.id, targetId: decision.targetId };
  }
  // update: merge new content over the existing target, then supersede the target.
  const target = await store.read(decision.targetId);
  if (!target) {
    await store.write(unit);
    routeStats.create++;
    return { action: 'create', id: unit.id };
  }
  const merged: HarmonicUnit = {
    ...unit,
    memory_value: `${unit.memory_value}\n---\n[Updated ${new Date().toISOString()}] ${target.memory_value}`,
    cue_anchors: dedupeCap([...(unit.cue_anchors || []), ...(target.cue_anchors || [])], 8),
    merged_from: [...(unit.merged_from || []), target.id],
    energy: Math.min(1, (unit.energy ?? 0.8) + 0.15),
    updated_at: new Date().toISOString(),
  };
  await store.write(merged, undefined, { skipMerge: true });
  await store.markSuperseded(target.id, merged.id);
  deps.vectors.remove(target.id);
  deps.vectors.flush();
  // S5: the target was just reconsolidated (updated) — leave the labile window.
  try { getReconsolidationQueue().consume(target.id); } catch { /* fail-open */ }
  routeStats.update++;
  return { action: 'update', id: merged.id, targetId: target.id };
}

/** Route-write counters for /api/memory/stats (skip = duplicates prevented). */
const routeStats = { create: 0, skip: 0, update: 0, separate: 0 };

export function getRouteStats(): { create: number; skip: number; update: number; separate: number } {
  return { ...routeStats };
}

function dedupeCap(items: string[], cap: number): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it && !out.includes(it)) out.push(it);
    if (out.length >= cap) break;
  }
  return out;
}

// Module singleton so write entry points (MCP handler / HTTP / reflection) can
// route without plumbing deps through every call site. Wired by index.ts once
// the embedding runtime + judge are ready; null → callers skip routing.
let routeDeps: RouteWriteDeps | null = null;

export function setRouteWriteDeps(deps: RouteWriteDeps | null): void {
  routeDeps = deps;
}

export function getRouteWriteDeps(): RouteWriteDeps | null {
  return routeDeps;
}
