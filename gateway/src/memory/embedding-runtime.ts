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
  cfg?: { provider: 'off' | 'local' | 'dashscope'; model?: string; dimensions?: number; baseUrl?: string };
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
export async function computeDenseScores(query: string, topK: number): Promise<Map<string, number> | null> {
  const rt = runtime;
  if (!rt) return null;
  try {
    const [queryVector] = await rt.provider.embed([query], 'query');
    if (!queryVector) return null;
    const hits = rt.vectors.searchByCosine(queryVector, topK);
    return new Map(hits.map(h => [h.id, h.cosine]));
  } catch (err: any) {
    log.warn(`[Embedding] dense scores unavailable (BM25 fallback): ${err?.message || err}`);
    return null;
  }
}
