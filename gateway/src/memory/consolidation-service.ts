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
  /** Cosine threshold for candidate recall (default 0.8). */
  minCosine?: number;
  maxCandidates?: number;
}

export type ConsolidationOutcome =
  | { action: 'create' }
  | { action: 'update'; targetId: string; mergedId: string }
  | { action: 'skip'; reason: string };

interface JudgeVerdict {
  action: 'update' | 'create';
  target_id?: string;
}

const JUDGE_SYSTEM = `You are a memory management assistant. Given a NEW memory entry and similar existing entries, decide whether the new entry should UPDATE (merge into) an existing entry or be CREATEd as a separate memory.

Rules:
- UPDATE when both entries describe the same underlying subject/entity/topic with overlapping or complementary details (e.g. evolving state of the same project, updated preferences, new facts about the same person).
- CREATE when the subjects are merely similar in wording but refer to different entities, events, or aspects.
Respond with ONLY a JSON object:
{"action":"update","target_id":"<id of the entry to merge into>"} or {"action":"create"}`;

export class ConsolidationService {
  private store: ConsolidationDeps['store'];
  private vectors: MemoryVectorStore;
  private provider: EmbeddingProvider;
  private llm?: ConsolidationLlmConfig;
  private minCosine: number;
  private maxCandidates: number;
  private stats = { judged: 0, updates: 0, creates: 0 };

  constructor(deps: ConsolidationDeps) {
    this.store = deps.store;
    this.vectors = deps.vectors;
    this.provider = deps.provider;
    this.llm = deps.llm;
    this.minCosine = deps.minCosine ?? 0.8;
    this.maxCandidates = deps.maxCandidates ?? 3;
  }

  getStats(): { judged: number; updates: number; creates: number; updateRatio: number } {
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
    const candidateIds: string[] = [];
    for (const h of hits) {
      if (h.id === unit.id) continue;
      if (h.cosine < this.minCosine) continue;
      candidateIds.push(h.id);
      if (candidateIds.length >= this.maxCandidates) break;
    }
    if (candidateIds.length === 0) return { action: 'create' };

    if (!this.llm) return { action: 'skip', reason: 'no-judge' };

    this.stats.judged++;
    const verdict = await this.judge(unit, candidateIds);
    if (!verdict) return { action: 'skip', reason: 'judge-error' };
    if (verdict.action === 'create') {
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
    const llm = this.llm!;
    const candidatesBlock: string[] = [];
    for (const id of candidateIds) {
      const target = await this.store.read(id);
      if (!target) continue;
      candidatesBlock.push(
        `EXISTING ENTRY:\nID: ${target.id}\nIndex: ${target.primary_abstraction}\nValue: ${target.memory_value}`,
      );
    }
    if (candidatesBlock.length === 0) return { action: 'create' };

    const user = `NEW MEMORY ENTRY:\nID: ${unit.id}\nIndex: ${unit.primary_abstraction}\nValue: ${unit.memory_value}\n\n${candidatesBlock.join('\n\n')}\n\nShould the new entry UPDATE one of the existing entries, or be CREATEd separately?`;

    const fetchFn = llm.fetchFn ?? globalThis.fetch.bind(globalThis);
    const timeoutMs = llm.timeoutMs ?? 30_000;
    try {
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
      const jsonText = content.replace(/```json|```/g, '').trim();
      const start = jsonText.indexOf('{');
      const end = jsonText.lastIndexOf('}');
      if (start === -1 || end === -1) return { action: 'create' };
      const parsed = JSON.parse(jsonText.slice(start, end + 1));
      if (parsed?.action !== 'update' && parsed?.action !== 'create') return { action: 'create' };
      return parsed as JudgeVerdict;
    } catch (err: any) {
      log.warn(`[Consolidation] judge failed: ${err?.message || err}`);
      return null;
    }
  }
}

function dedupeCap(items: string[], cap: number): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item && !out.includes(item)) out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}
