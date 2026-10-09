// P2: Memora-style memory consolidation.
//
// After a memory unit is written, recall embedding candidates above a cosine
// threshold; if any exist, an LLM judge decides UPDATE (merge into a single
// canonical entry) vs CREATE (keep separate). UPDATE merges the incoming unit
// with the older target (new content wins), soft-supersedes the target, and
// drops the stale vector — mirroring MinHash merge semantics but at the
// semantic level (cosine 0.8+ recall catches paraphrases char-level MinHash
// cannot see).
//
// The judge is a single OpenAI-compatible chat call reusing the worker-model
// transport (same resolution as IndexScan). All failures are fail-open: the
// unit simply stays as its own entry (never blocks or destroys writes).
//
// update-ratio stats (updated / judged) surface consolidation health — the
// Memora paper's sweet spot is ~16-22% (over-consolidation degrades quality).

import { log } from '../core/utils/logger';
import { HarmonicUnit } from '../core/memory/harmonic-types';
import { MemoryVectorStore, EmbeddingIndexer } from './vector-store';
import { EmbeddingProvider } from './embedding-provider';
import type { CompletionChannel } from '../runtime/contract';
import type { PipelineBudgetLike } from '../recall/pipeline-budget';

export interface ConsolidationLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface ConsolidationDeps {
  store: {
    read(id: string): Promise<HarmonicUnit | null>;
    write(unit: HarmonicUnit, tier?: string, opts?: { skipMerge?: boolean }): Promise<string>;
    markSuperseded(id: string, byId: string): boolean | void | Promise<void>;
  };
  vectors: MemoryVectorStore;
  provider: EmbeddingProvider;
  llm?: ConsolidationLlmConfig;
  /**
   * Runtime stateless-completion channel (thunk, read live so runtime hot-swap
   * is safe). Preferred over `llm`: it resolves inline-defined providers (e.g.
   * "gateway" whose baseURL/apiKey live in opencode provider config) that the
   * sync hardcoded endpoint table cannot see.
   */
  completion?: () => CompletionChannel | undefined;
  /** Model for the completion channel (required when `completion` is used). */
  model?: { providerID: string; modelID: string };
  /** Fired whenever the LLM judge is actually invoked (heartbeat seam). */
  onJudge?: (result: { ok: boolean; error?: string }) => void;
  /** B1: fired once per judge invocation with the (new, candidates, verdict)
   *  triple — the audit data source. Synchronous, fail-open. */
  onPair?: (pair: JudgedPair) => void;
  /** Fired on every consolidate() terminal state (stats persistence seam). */
  onStats?: (s: { judged: number; updates: number; creates: number; skipped: number }) => void;
  /** Restore persisted counters on startup (so stats survive restarts). */
  initialStats?: { judged?: number; updates?: number; creates?: number; skipped?: number };
  /** Cosine threshold for candidate recall (default 0.8). */
  minCosine?: number;
  maxCandidates?: number;
  /** Laya conflict cascade (three-way): p >= tauHigh → adopt UPDATE without
   *  LLM; ALL candidate scores <= tauLow → CREATE without LLM (CREATE is the
   *  judge's fail-open outcome anyway, so this only short-circuits certain
   *  no-conflict cases); middle band → LLM judge unchanged. tauLow 0 = off.
   *  tauHigh stays 0.99 in production (separate-class blindness band). */
  laya?: {
    client: { askConflict(known: string, newInfo: string): Promise<number | null> };
    tauHigh: number;
    tauLow?: number;
    maxTextChars?: number;
  };
  /** Daily USD cap gate for background pipelines (0 = unlimited). */
  budget?: PipelineBudgetLike;
}

export type ConsolidationOutcome =
  | { action: 'create' }
  | { action: 'update'; targetId: string; mergedId: string }
  | { action: 'skip'; reason: string };

/** B1 audit record: one line per actual LLM-judge invocation, so the
 *  zero-update root cause (MinHash preemption vs judge bias vs threshold)
 *  can be decided from data. `verdict: 'skip'` = judge error or invalid target. */
export interface JudgedPair {
  newId: string;
  newAbstraction: string;
  candidates: Array<{ id: string; cosine: number }>;
  verdict: 'update' | 'create' | 'separate' | 'skip';
  ts: number;
  /** Which judge decided: 'laya' = local conflict model adopted UPDATE,
   *  'laya-low' = all candidates below tauLow → CREATE without LLM,
   *  'llm' = worker LLM. */
  decidedBy?: 'laya' | 'laya-low' | 'llm';
  /** Per-candidate laya noul scores (present whenever the cascade ran). */
  layaScores?: Array<{ id: string; p: number }>;
}

interface JudgeVerdict {
  action: 'update' | 'create' | 'separate';
  target_id?: string;
  /** For `separate`: the disambiguating keyword distinguishing this entry. */
  distinction?: string;
}

const JUDGE_SYSTEM = `You are a memory management assistant. Given a NEW memory entry and similar existing entries, decide how the new entry relates to them.

Rules:
- UPDATE when the new entry describes the SAME underlying subject/entity/topic as an existing entry with overlapping or complementary details (e.g. evolving state of the same project, an updated preference value, a new fact about the same person). Pick the single best target.
- SEPARATE when the new entry is highly similar in wording/structure but refers to a DIFFERENT entity or instance (e.g. "deploy to us-east-1" vs "deploy to eu-west-1", two distinct people, two distinct services). Keep both, disambiguated.
- CREATE when the entries are only superficially similar and unrelated in subject.
Respond with ONLY a JSON object:
{"action":"update","target_id":"<id>"} or {"action":"separate","target_id":"<id>","distinction":"<short disambiguating keyword>"} or {"action":"create"}`;

export class ConsolidationService {
  private store: ConsolidationDeps['store'];
  private vectors: MemoryVectorStore;
  private provider: EmbeddingProvider;
  private llm?: ConsolidationLlmConfig;
  private completion?: () => CompletionChannel | undefined;
  private model?: { providerID: string; modelID: string };
  private onJudge?: (result: { ok: boolean; error?: string }) => void;
  private onPair?: (pair: JudgedPair) => void;
  private onStats?: (s: { judged: number; updates: number; creates: number; skipped: number }) => void;
  private laya?: ConsolidationDeps['laya'];
  private budget?: ConsolidationDeps['budget'];
  private minCosine: number;
  private maxCandidates: number;
  private stats = { judged: 0, updates: 0, creates: 0, skipped: 0, layaAdopted: 0, layaEscalated: 0, layaCreated: 0 };

  constructor(deps: ConsolidationDeps) {
    this.store = deps.store;
    this.vectors = deps.vectors;
    this.provider = deps.provider;
    this.llm = deps.llm;
    this.completion = deps.completion;
    this.model = deps.model;
    this.onJudge = deps.onJudge;
    this.onPair = deps.onPair;
    this.onStats = deps.onStats;
    this.laya = deps.laya;
    this.budget = deps.budget;
    if (deps.initialStats) this.stats = { ...this.stats, ...deps.initialStats };
    this.minCosine = deps.minCosine ?? 0.8;
    this.maxCandidates = deps.maxCandidates ?? 3;
  }

  getStats(): { judged: number; updates: number; creates: number; skipped: number; updateRatio: number } {
    const judged = this.stats.updates + this.stats.creates;
    return {
      ...this.stats,
      updateRatio: judged === 0 ? 0 : this.stats.updates / judged,
    };
  }

  /**
   * Serial enqueue wrapper for the write path (onMemoryWritten). Errors are
   * swallowed — consolidation must never break memory writes.
   */
  async enqueue(unit: HarmonicUnit): Promise<void> {
    try {
      await this.consolidate(unit);
    } catch (err: any) {
      log.warn(`[Consolidation] enqueue error for ${unit?.id}: ${err?.message || err}`);
    }
  }

  async consolidate(unit: HarmonicUnit): Promise<ConsolidationOutcome> {
    try {
      const outcome = await this.consolidateInner(unit);
      if (outcome.action === 'skip') this.stats.skipped++;
      return outcome;
    } finally {
      this.onStats?.({ ...this.stats });
    }
  }

  private async consolidateInner(unit: HarmonicUnit): Promise<ConsolidationOutcome> {
    if (!unit?.id) return { action: 'skip', reason: 'no-unit' };
    // Recursion guard: never re-consolidate merge products.
    if (unit.merged_from && unit.merged_from.length > 0) {
      return { action: 'skip', reason: 'merged-product' };
    }

    let vector = this.vectors.get(unit.id);
    if (!vector) {
      // The async indexer may not have flushed yet — embed on demand so the
      // judge sees this unit in vector space immediately.
      try {
        const text = EmbeddingIndexer.documentText(unit);
        if (!text) return { action: 'skip', reason: 'no-vector' };
        const [vec] = await this.provider.embed([text], 'document');
        if (!vec) return { action: 'skip', reason: 'no-vector' };
        this.vectors.upsert(unit.id, vec);
        vector = vec;
      } catch (err: any) {
        log.warn(`[Consolidation] on-demand embed failed for ${unit.id}: ${err?.message || err}`);
        return { action: 'skip', reason: 'embed-failed' };
      }
    }

    const hits = this.vectors.searchByCosine(vector, this.maxCandidates + 1);
    const candidates: Array<{ id: string; cosine: number }> = [];
    for (const h of hits) {
      if (h.id === unit.id) continue;
      if (h.cosine < this.minCosine) continue;
      candidates.push({ id: h.id, cosine: h.cosine });
      if (candidates.length >= this.maxCandidates) break;
    }
    if (candidates.length === 0) return { action: 'create' };

    // Audit H4 fix: only LIVE units may be judged/merged — superseded targets
    // (dead versions) and orphan vectors (unit file gone, index pruned) are
    // filtered before the judge. Merging into a dead entry would resurrect it.
    const liveCandidates: Array<{ id: string; cosine: number }> = [];
    for (const c of candidates) {
      try {
        const u = await this.store.read(c.id);
        if (u && !u.superseded_by) liveCandidates.push(c);
      } catch { /* treat unreadable as dead */ }
    }
    if (liveCandidates.length === 0) return { action: 'create' };

    // Laya conflict cascade (one-sided v1): confident conflicts adopt UPDATE
    // directly; everything else escalates to the LLM judge with scores
    // attached (audit/calibration data on every event).
    let layaScores: Array<{ id: string; p: number }> | undefined;
    if (this.laya) {
      const r = await this.layaCascade(unit, liveCandidates);
      layaScores = r.scores.length > 0 ? r.scores : undefined;
      if (r.adoptedTargetId) {
        this.stats.layaAdopted++;
        this.stats.updates++;
        this.emitPair(unit, liveCandidates, 'update', 'laya', layaScores);
        const merged = await this.mergeIntoNewer(unit, r.adoptedTargetId);
        return { action: 'update', targetId: r.adoptedTargetId, mergedId: merged.id };
      }
      // Three-way gate: laya confident "no conflict" with EVERY live candidate
      // → CREATE directly. Only when scores exist (client null = no opinion).
      const tauLow = this.laya.tauLow ?? 0;
      if (tauLow > 0 && r.scores.length > 0 && r.scores.every((s) => s.p <= tauLow)) {
        this.stats.layaCreated++;
        this.stats.creates++;
        this.emitPair(unit, liveCandidates, 'create', 'laya-low', layaScores);
        return { action: 'create' };
      }
      this.stats.layaEscalated++;
    }

    if (!this.llm && !this.completion?.()) return { action: 'skip', reason: 'no-judge' };

    // Daily budget cap: deny → skip judging (laya cascade above stays
    // ungated — it is local and zero-cost).
    if (this.budget && !this.budget.allow('consolidation')) {
      this.stats.skipped++;
      return { action: 'skip', reason: 'budget-exceeded' };
    }

    this.stats.judged++;
    const candidateIds = liveCandidates.map((c) => c.id);
    const verdict = await this.judge(unit, candidateIds);
    this.onJudge?.(verdict ? { ok: true } : { ok: false, error: 'judge-error' });
    const invalidTarget =
      verdict?.action === 'update' &&
      !(verdict.target_id && candidateIds.includes(verdict.target_id));
    this.emitPair(unit, liveCandidates, !verdict || invalidTarget ? 'skip' : verdict.action, 'llm', layaScores);
    if (!verdict) return { action: 'skip', reason: 'judge-error' };
    if (verdict.action === 'create' || verdict.action === 'separate') {
      // `separate` = keep both (do not merge) — the post-write listener has no
      // disambiguation surface, so it behaves as create here; route-write (S4)
      // handles the distinction anchors.
      this.stats.creates++;
      return { action: 'create' };
    }

    const targetId = verdict.target_id && candidateIds.includes(verdict.target_id)
      ? verdict.target_id
      : undefined;
    if (!targetId) {
      // Judge hallucinated a target — not a valid decision, skip (no stats).
      return { action: 'skip', reason: 'invalid-target' };
    }

    const merged = await this.mergeIntoNewer(unit, targetId);
    this.stats.updates++;
    return { action: 'update', targetId, mergedId: merged.id };
  }

  /** Ask the laya conflict model per live candidate; returns scores and the
   *  adopted target when the best score clears tauHigh. Client failures
   *  (null) are skipped — sidecar-down means "no scores", not a verdict. */
  private async layaCascade(
    unit: HarmonicUnit,
    candidates: Array<{ id: string; cosine: number }>,
  ): Promise<{ scores: Array<{ id: string; p: number }>; adoptedTargetId?: string }> {
    const laya = this.laya!;
    const cap = laya.maxTextChars ?? 800;
    const trunc = (s: string) => String(s ?? '').slice(0, cap);
    const scores: Array<{ id: string; p: number }> = [];
    let best: { id: string; p: number } | null = null;
    for (const c of candidates) {
      const target = await this.store.read(c.id);
      if (!target) continue;
      const p = await laya.client.askConflict(trunc(target.memory_value), trunc(unit.memory_value));
      if (p === null) continue;
      scores.push({ id: c.id, p });
      if (!best || p > best.p) best = { id: c.id, p };
    }
    return { scores, adoptedTargetId: best && best.p >= laya.tauHigh ? best.id : undefined };
  }

  private emitPair(
    unit: HarmonicUnit,
    candidates: Array<{ id: string; cosine: number }>,
    verdict: JudgedPair['verdict'],
    decidedBy: JudgedPair['decidedBy'],
    layaScores?: Array<{ id: string; p: number }>,
  ): void {
    try {
      this.onPair?.({
        newId: unit.id,
        newAbstraction: unit.primary_abstraction,
        candidates: candidates.map((c) => ({ id: c.id, cosine: +c.cosine.toFixed(4) })),
        verdict,
        decidedBy,
        layaScores,
        ts: Date.now(),
      });
    } catch { /* fail-open */ }
  }

  private async mergeIntoNewer(incoming: HarmonicUnit, targetId: string): Promise<HarmonicUnit> {
    const target = await this.store.read(targetId);
    if (!target) {
      // Target vanished mid-flight — nothing to merge.
      return incoming;
    }
    const merged: HarmonicUnit = {
      ...incoming,
      memory_value: `${incoming.memory_value}\n---\n[Updated ${new Date().toISOString()}] ${target.memory_value}`,
      cue_anchors: dedupeCap([...(incoming.cue_anchors || []), ...(target.cue_anchors || [])], 8),
      merged_from: [...(incoming.merged_from || []), target.id],
      energy: Math.min(1, (incoming.energy ?? 0.8) + 0.15),
      updated_at: new Date().toISOString(),
    };
    await this.store.write(merged, undefined, { skipMerge: true });
    await this.store.markSuperseded(targetId, merged.id);
    this.vectors.remove(targetId);
    this.vectors.flush();
    log.info(`[Consolidation] merged ${targetId} into ${merged.id} (cosine candidate)`);
    return merged;
  }

  private async judge(unit: HarmonicUnit, candidateIds: string[]): Promise<JudgeVerdict | null> {
    return consolidationJudge(unit, candidateIds, {
      store: this.store,
      llm: this.llm,
      completion: this.completion,
      model: this.model,
    });
  }
}

/**
 * Reusable identity judge: given a unit and candidate ids, ask the worker-model
 * (via the runtime stateless-completion channel, falling back to direct HTTP)
 * whether the unit UPDATEs one candidate or should be CREATEd separately.
 * Fail-open: returns null on any error.
 */
export interface ConsolidationJudgeDeps {
  store: { read(id: string): Promise<HarmonicUnit | null> };
  llm?: ConsolidationLlmConfig;
  completion?: () => CompletionChannel | undefined;
  model?: { providerID: string; modelID: string };
}

export async function consolidationJudge(
  unit: HarmonicUnit,
  candidateIds: string[],
  deps: ConsolidationJudgeDeps,
): Promise<JudgeVerdict | null> {
  const candidatesBlock: string[] = [];
  for (const id of candidateIds) {
    const target = await deps.store.read(id);
    if (!target) continue;
    candidatesBlock.push(
      `EXISTING ENTRY:\nID: ${target.id}\nIndex: ${target.primary_abstraction}\nValue: ${target.memory_value}`,
    );
  }
  if (candidatesBlock.length === 0) return { action: 'create' };

  const user = `NEW MEMORY ENTRY:\nID: ${unit.id}\nIndex: ${unit.primary_abstraction}\nValue: ${unit.memory_value}\n\n${candidatesBlock.join('\n\n')}\n\nShould the new entry UPDATE one of the existing entries, or be CREATEd separately?`;

  try {
    // Preferred: runtime stateless-completion channel (resolves inline
    // providers like "gateway" via opencode provider config). Falls back to
    // the direct-HTTP llm config when the channel cannot resolve an endpoint.
    const channel = deps.completion?.();
    if (channel && deps.model) {
      try {
        const res = await channel.complete({
          model: deps.model,
          system: [{ text: JUDGE_SYSTEM }],
          user: [{ type: 'text', text: user }],
          temperature: 0,
          maxTokens: 200,
        });
        return parseJudgeVerdict(res?.text ?? '');
      } catch (err: any) {
        if (!deps.llm) throw err;
        log.warn(`[Consolidation] completion judge failed, falling back to direct HTTP: ${err?.message || err}`);
      }
    }

    const llm = deps.llm;
    if (!llm) return null;
    const fetchFn = llm.fetchFn ?? globalThis.fetch.bind(globalThis);
    const timeoutMs = llm.timeoutMs ?? 30_000;
    const resp = await Promise.race([
      fetchFn(llm.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
        body: JSON.stringify({
          model: llm.model,
          messages: [
            { role: 'system', content: JUDGE_SYSTEM },
            { role: 'user', content: user },
          ],
          temperature: 0,
          max_tokens: 200,
        }),
      }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('judge timeout')), timeoutMs);
        timer.unref?.();
      }),
    ]) as Response;
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    return parseJudgeVerdict(content);
  } catch (err: any) {
    log.warn(`[Consolidation] judge failed: ${err?.message || err}`);
    return null;
  }
}

/** Parse a judge reply into a verdict. No braces → create; malformed JSON →
 *  null (judge failure, fail-open skip); unknown action → create. */
export function parseJudgeVerdict(content: string): JudgeVerdict | null {
  const jsonText = String(content ?? '').replace(/```json|```/g, '').trim();
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start === -1 || end === -1) return { action: 'create' };
  const parsed = JSON.parse(jsonText.slice(start, end + 1));
  if (parsed?.action !== 'update' && parsed?.action !== 'create' && parsed?.action !== 'separate') {
    return { action: 'create' };
  }
  return parsed as JudgeVerdict;
}

function dedupeCap(items: string[], cap: number): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item && !out.includes(item)) out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}
