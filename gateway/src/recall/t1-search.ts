import type { GatewayDatabase, T1LexicalHit } from '../memory/gateway-db';
import type { EmbeddingRuntime } from '../memory/embedding-runtime';
import { getEmbeddingRuntime } from '../memory/embedding-runtime';
import { config } from '../config';
import { makeT1Search, T1Hit } from './verbatim-recall';

const RRF_K = 60;

function hitKey(hit: { traceId?: string | null; sessionId: string; turnId: number }): string {
  return hit.traceId || `${hit.sessionId}:${hit.turnId}`;
}

/**
 * Fuse dense and lexical T1 rankings with reciprocal-rank fusion. A hit
 * present in both channels outranks a single-channel hit at the same rank.
 * Lexical excerpts are preferred (they contain the matched literal), while
 * the dense cosine is preserved for scoring/observability.
 */
export function fuseT1Hits(dense: T1Hit[], lexical: T1LexicalHit[], k: number): T1Hit[] {
  const fused = new Map<
    string,
    { hit: T1Hit; score: number; sources: Set<'dense' | 'lexical'>; lexicalExcerpt?: string }
  >();

  dense.forEach((hit, rank) => {
    if (!hit.excerpt) return;
    const key = hitKey(hit);
    const entry = fused.get(key) ?? { hit: { ...hit }, score: 0, sources: new Set() };
    entry.score += 1 / (RRF_K + rank);
    entry.sources.add('dense');
    fused.set(key, entry);
  });

  lexical.forEach((hit, rank) => {
    if (!hit.excerpt) return;
    const key = hitKey(hit);
    const entry = fused.get(key) ?? {
      hit: {
        sessionId: hit.sessionId,
        turnId: hit.turnId,
        traceId: hit.traceId,
        cosine: 0,
        excerpt: hit.excerpt,
      },
      score: 0,
      sources: new Set(),
    };
    entry.score += 1 / (RRF_K + rank);
    entry.sources.add('lexical');
    entry.lexicalExcerpt = hit.excerpt;
    if (!entry.hit.traceId) entry.hit.traceId = hit.traceId;
    fused.set(key, entry);
  });

  return [...fused.values()]
    .map(({ hit, score, sources, lexicalExcerpt }) => ({
      ...hit,
      excerpt: lexicalExcerpt || hit.excerpt,
      score,
      sources: (['dense', 'lexical'] as const).filter((s) => sources.has(s)),
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, Math.max(0, k));
}

/**
 * Shared gateway T1 search. Resolves the embedding runtime lazily so a
 * hot-swapped embedding engine cannot leave a stale provider wired here.
 * Dense rows are archive-first with active fallback; the lexical channel uses
 * the FTS5 trigram index. Either channel failing leaves the other usable.
 */
export function createGatewayT1Search(
  db: GatewayDatabase,
  getRuntime: () => EmbeddingRuntime | null = getEmbeddingRuntime,
): (query: string, k: number) => Promise<T1Hit[]> {
  const denseSearch = async (query: string, k: number): Promise<T1Hit[]> => {
    try {
      const runtime = getRuntime();
      if (!runtime?.t1Vectors) return [];
      return await makeT1Search({
        runtime,
        fetchRows: (sessionId, turnId) => {
          const archived = db.readArchiveTurn(sessionId, turnId);
          return archived.length ? archived : db.readTurn(sessionId, turnId);
        },
      })(query, k);
    } catch {
      return [];
    }
  };

  return async (query: string, k: number): Promise<T1Hit[]> => {
    if (!query.trim() || k <= 0) return [];
    const dense = await denseSearch(query, k);
    let lexical: T1LexicalHit[] = [];
    if (config.recall.t1Recall?.lexical !== false) {
      try {
        lexical = db.searchT1Lexical?.(query, Math.max(k * 2, 12)) ?? [];
      } catch {
        lexical = [];
      }
    }
    return fuseT1Hits(dense, lexical, k);
  };
}
