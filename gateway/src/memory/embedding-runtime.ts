// EmbeddingRuntime: process-wide dense-retrieval wiring (P1).
//
// A single runtime instance owns the embedding provider, the vector store
// (one JSON file per model under <baseDir>/memory/), and the write-path
// indexer. Search entry points (MCP handler, HTTP route, eval harness) call
// computeDenseScores() and pass the result into searchScored({ denseScores }).
//
// Everything here is fail-open: embedding errors degrade to BM25-only recall,
// never block the synchronous path.

import * as path from 'path';
import { config } from '../config';
import { log } from '../core/utils/logger';
import { createEmbeddingProvider, EmbeddingProvider } from './embedding-provider';
import { MemoryVectorStore, EmbeddingIndexer } from './vector-store';

export interface EmbeddingRuntime {
  provider: EmbeddingProvider;
  vectors: MemoryVectorStore;
  indexer: EmbeddingIndexer;
  /** Debounced async flush of the embedding queue (call after each write). */
  scheduleFlush(): void;
}

let runtime: EmbeddingRuntime | null = null;

export function setEmbeddingRuntime(rt: EmbeddingRuntime | null): void {
  runtime = rt;
}

export function getEmbeddingRuntime(): EmbeddingRuntime | null {
  return runtime;
}

export interface InitEmbeddingRuntimeOptions {
  baseDir: string;
  /** Resolve the embeddable text for an entry id (startup backfill). */
  getTextForId?: (id: string) => Promise<string | null>;
  /** Config override for tests (defaults to config.memory.embedding). */
  cfg?: { provider: 'off' | 'local' | 'dashscope'; model?: string; dimensions?: number; baseUrl?: string; threads?: number };
}

export function initEmbeddingRuntime(opts: InitEmbeddingRuntimeOptions): EmbeddingRuntime | null {
  const cfg = opts.cfg ?? (config as any).memory?.embedding;
  if (!cfg || cfg.provider === 'off') return null;
  try {
    const provider = createEmbeddingProvider({
      provider: cfg.provider,
      model: cfg.model,
      dimensions: cfg.dimensions,
      baseUrl: cfg.baseUrl || undefined,
      threads: (cfg as any).threads,
    });
    if (!provider) return null;

    const modelTag = (cfg.model || 'default').replace(/[^a-zA-Z0-9._-]/g, '_');
    const vectors = new MemoryVectorStore(
      path.join(opts.baseDir, 'memory', `vectors-${modelTag}.json`),
      cfg.dimensions || 1024,
      cfg.model,
    );

    const indexer = new EmbeddingIndexer({ vectors, provider, getTextForId: opts.getTextForId });

    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const rt: EmbeddingRuntime = {
      provider,
      vectors,
      indexer,
      scheduleFlush() {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          flushTimer = null;
          indexer.flushQueue().catch(() => { /* fail-open */ });
        }, 2000);
        (flushTimer as any).unref?.();
      },
    };

    runtime = rt;
    log.info(`[Embedding] runtime initialized: ${provider.name} (${vectors.size()} vectors)`);
    return rt;
  } catch (err: any) {
    log.warn(`[Embedding] runtime init failed (BM25-only fallback): ${err?.message || err}`);
    return null;
  }
}

/**
 * Query-side dense scores for hybrid retrieval. Returns null on any failure —
 * callers pass the map into searchScored({ denseScores }) or fall back to
 * plain BM25.
 */
/**
 * Two dense hits with self-cosine ≥ this are treated as the same fact's
 * old/new versions (knowledge-update pattern): semantic similarity is blind
 * to WHICH version is current, so keep the newer and suppress the older —
 * the BM25 channel still sees it (exact keywords on the updated value).
 */
const NEAR_DUP_COSINE = 0.92;

export async function computeDenseScores(
  query: string,
  topK: number,
  index?: { getIndex(): { entries: Array<{ id: string; created_at?: string }> } },
): Promise<Map<string, number> | null> {
  const rt = runtime;
  if (!rt) return null;
  try {
    const [queryVector] = await rt.provider.embed([query], 'query');
    if (!queryVector) return null;
    let hits = rt.vectors.searchByCosine(queryVector, topK);
    if (index && hits.length > 1) {
      hits = suppressNearDuplicates(hits, rt.vectors, index.getIndex().entries);
    }
    return new Map(hits.map(h => [h.id, h.cosine]));
  } catch (err: any) {
    log.warn(`[Embedding] dense scores unavailable (BM25 fallback): ${err?.message || err}`);
    return null;
  }
}

function suppressNearDuplicates(
  hits: Array<{ id: string; cosine: number }>,
  vectors: MemoryVectorStore,
  entries: Array<{ id: string; created_at?: string }>,
): Array<{ id: string; cosine: number }> {
  const createdAt = new Map(entries.map(e => [e.id, e.created_at]));
  const vecOf = (id: string) => vectors.get(id);
  const suppressed = new Set<string>();
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      const a = hits[i];
      const b = hits[j];
      if (suppressed.has(a.id) || suppressed.has(b.id)) continue;
      const va = vecOf(a.id);
      const vb = vecOf(b.id);
      if (!va || !vb || va.length !== vb.length) continue;
      let dot = 0;
      let na = 0;
      let nb = 0;
      for (let k = 0; k < va.length; k++) {
        dot += va[k] * vb[k];
        na += va[k] * va[k];
        nb += vb[k] * vb[k];
      }
      if (na === 0 || nb === 0) continue;
      if (dot / Math.sqrt(na * nb) < NEAR_DUP_COSINE) continue;
      const ta = Date.parse(createdAt.get(a.id) ?? '');
      const tb = Date.parse(createdAt.get(b.id) ?? '');
      if (Number.isNaN(ta) || Number.isNaN(tb)) continue; // can't order → keep both
      suppressed.add(ta < tb ? a.id : b.id);
    }
  }
  if (suppressed.size === 0) return hits;
  return hits.filter(h => !suppressed.has(h.id));
}
