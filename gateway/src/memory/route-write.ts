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
import { getRetrievalEventBuffer } from '../core/memory/retrieval-events';

export type RoutingOutcome =
  | { action: 'skip'; targetId: string }
  | { action: 'create' }
  | { action: 'update'; targetId: string }
  | { action: 'separate'; targetId: string; distinction?: string }
  | { action: 'redundant'; targetId: string; pRedundant: number };

export interface RouteAuditRecord {
  newId: string;
  newAbstraction: string;
  candidates: Array<{ id: string; cosine: number }>;
  redundantScores?: Array<{ id: string; p: number }>;
  verdict: 'create' | 'update' | 'separate' | 'skip' | 'redundant';
  decidedBy: 'fast-path' | 'dup' | 'laya-redundant' | 'llm-route';
  ts: number;
}

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
  /**
   * Read an existing entry's index fields (for the near-identical skip check).
   * Without it, a cos≥θ_dup hit is NOT skipped — it routes to the judge, so a
   * small value change ("3" → "5") is never silently dropped.
   */
  readEntry?: (id: string) => { primary_abstraction?: string } | undefined;
  /** G2 laya redundancy gate for the candidate band (tauRedundantHigh 1.0 = observe-only). */
  laya?: {
    client: { askPair(known: string, newInfo: string): Promise<{ pConflict: number | null; pRedundant: number | null } | null> };
    tauRedundantHigh: number;
    maxTextChars?: number;
  };
  /** Read a candidate's full text (laya needs memory_value; readEntry has only the abstraction). */
  readUnit?: (id: string) => Promise<{ memory_value?: string } | null>;
  /** Audit sink for calibration data — one row per contested write. Fail-open. */
  onRoute?: (record: RouteAuditRecord) => void;
}

/** Normalize for exact re-statement comparison (case/whitespace insensitive). */
function normalizeText(s: string | undefined): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * True only when the two abstractions are the SAME text after normalization —
 * a genuine re-statement. Embedding proximity is insufficient (a value change
 * "replicas=3" → "replicas=5" is embedding-close), and token-overlap is too
 * lenient for long strings (one changed value still scores >0.9 Jaccard), so
 * only exact normalized equality triggers the non-write shortcut.
 */
export function isNearIdentical(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  return na.length > 0 && na === nb;
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
  if (top.cosine >= thetaDup) {
    // Non-write ONLY for a genuine lexical re-statement. A value change is
    // embedding-close but must route to the judge (update) — never dropped.
    const cand = deps.readEntry?.(top.id);
    if (cand && isNearIdentical(unit.primary_abstraction, cand.primary_abstraction)) {
      emitRoute(deps, unit, hits, 'skip', 'dup');
      return { action: 'skip', targetId: top.id };
    }
  }

  // G2 laya redundancy gate (write-phase routing): high-confidence "already
  // covered" → redundant outcome, skipping the LLM judge. Observe-only while
  // tauRedundantHigh = 1.0 (scores still flow to the audit for calibration).
  let redundantScores: Array<{ id: string; p: number }> | undefined;
  if (deps.laya && deps.readUnit) {
    const laya = deps.laya;
    const cap = laya.maxTextChars ?? 800;
    const trunc = (s: string) => String(s ?? '').slice(0, cap);
    const scores: Array<{ id: string; p: number }> = [];
    let bestR: { id: string; p: number } | null = null;
    for (const h of hits.slice(0, maxCand)) {
      let targetText: string | undefined;
      try { targetText = (await deps.readUnit(h.id))?.memory_value; } catch { continue; }
      if (!targetText) continue;
      const r = await laya.client.askPair(trunc(targetText), trunc(unit.memory_value));
      if (r?.pRedundant == null) continue;
      scores.push({ id: h.id, p: r.pRedundant });
      if (!bestR || r.pRedundant > bestR.p) bestR = { id: h.id, p: r.pRedundant };
    }
    if (scores.length > 0) redundantScores = scores;
    if (bestR && bestR.p >= laya.tauRedundantHigh) {
      emitRoute(deps, unit, hits, 'redundant', 'laya-redundant', redundantScores);
      return { action: 'redundant', targetId: bestR.id, pRedundant: bestR.p };
    }
  }

  const candidateIds = hits.slice(0, maxCand).map((h) => h.id);
  let verdict: JudgeDecision | null = null;
  try {
    verdict = await deps.judge(unit, candidateIds);
  } catch {
    emitRoute(deps, unit, hits, 'create', 'llm-route', redundantScores);
    return { action: 'create' }; // fail-open
  }
  if (!verdict || verdict.action === 'create') {
    emitRoute(deps, unit, hits, 'create', 'llm-route', redundantScores);
    return { action: 'create' };
  }
  if (verdict.targetId && candidateIds.includes(verdict.targetId)) {
    if (verdict.action === 'separate') {
      emitRoute(deps, unit, hits, 'separate', 'llm-route', redundantScores);
      return { action: 'separate', targetId: verdict.targetId, distinction: verdict.distinction };
    }
    emitRoute(deps, unit, hits, 'update', 'llm-route', redundantScores);
    return { action: 'update', targetId: verdict.targetId };
  }
  emitRoute(deps, unit, hits, 'create', 'llm-route', redundantScores);
  return { action: 'create' }; // invalid target → fail-open
}

function emitRoute(
  deps: RouteWriteDeps,
  unit: HarmonicUnit,
  hits: Array<{ id: string; cosine: number }>,
  verdict: RouteAuditRecord['verdict'],
  decidedBy: RouteAuditRecord['decidedBy'],
  redundantScores?: Array<{ id: string; p: number }>,
): void {
  try {
    deps.onRoute?.({
      newId: unit.id,
      newAbstraction: unit.primary_abstraction,
      candidates: hits.map((h) => ({ id: h.id, cosine: +h.cosine.toFixed(4) })),
      redundantScores,
      verdict,
      decidedBy,
      ts: Date.now(),
    });
  } catch { /* fail-open */ }
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
): Promise<{ action: 'skip' | 'create' | 'update' | 'separate' | 'redundant'; id: string; targetId?: string }> {
  const decision = await decideRouting(unit, deps);
  if (decision.action === 'skip') {
    routeStats.skip++;
    return { action: 'skip', id: decision.targetId, targetId: decision.targetId };
  }
  if (decision.action === 'redundant') {
    // Sink, not drop: energy 0.05 + provenance anchor keeps the entry
    // BM25-recoverable (misjudgment reversible) while decay pushes it below
    // retrieval visibility within days. The covering entry gets a synthetic
    // ACT-R exposure — repetition strengthens the existing trace (Hebbian),
    // settled by the daily decay pass via actrBonus.
    const sunk: HarmonicUnit = {
      ...unit,
      energy: 0.05,
      cue_anchors: dedupeCap([...(unit.cue_anchors || []), `redundant:${decision.targetId}`], 8),
      updated_at: new Date().toISOString(),
    };
    await store.write(sunk, undefined, { skipMerge: true });
    try {
      getRetrievalEventBuffer().record({ id: decision.targetId, prob: decision.pRedundant, kind: 'recall', ts: Date.now() });
    } catch { /* fail-open */ }
    routeStats.redundant++;
    return { action: 'redundant', id: sunk.id, targetId: decision.targetId };
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
const routeStats = { create: 0, skip: 0, update: 0, separate: 0, redundant: 0 };

export function getRouteStats(): { create: number; skip: number; update: number; separate: number; redundant: number } {
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
