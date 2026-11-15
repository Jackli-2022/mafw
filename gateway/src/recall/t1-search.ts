import type { GatewayDatabase, T1LexicalHit } from '../memory/gateway-db';
import type { EmbeddingRuntime } from '../memory/embedding-runtime';
import { getEmbeddingRuntime } from '../memory/embedding-runtime';
import { config } from '../config';
import { makeT1Search, T1Hit } from './verbatim-recall';

const RRF_K = 60;

export type ActivationRankingMode = 'off' | 'shadow' | 'on';

interface ActivationRankingOptions {
  mode: ActivationRankingMode;
  activation?: Map<string, number>;
  /** Max relative boost (hard cap 0.2). Default 0.1. */
  weight?: number;
  /** Only hits with baseScore >= band × topScore are eligible. Default 0.6. */
  band?: number;
}

/** A/B counters for the shadow/on activation ranking modes. */
const rankingStats = { evaluations: 0, wouldReorder: 0, applied: 0 };

export function getT1RankingStats(): { evaluations: number; wouldReorder: number; applied: number } {
  return { ...rankingStats };
}

export function resetT1RankingStats(): void {
  rankingStats.evaluations = 0;
  rankingStats.wouldReorder = 0;
  rankingStats.applied = 0;
}

/**
 * Bounded activation re-rank. Activation may only reorder hits that already
 * cleared the relevance band (baseScore >= band × topScore), and its boost is
 * capped at `weight` (≤20%). It can never add hits or rescue irrelevant ones.
 */
export function applyT1ActivationRanking(
  hits: T1Hit[],
  opts: ActivationRankingOptions,
): { results: T1Hit[]; reordered: boolean } {
  if (opts.mode === 'off' || hits.length < 2 || !opts.activation || opts.activation.size === 0) {
    return { results: hits, reordered: false };
  }
  const weight = Math.min(0.2, Math.max(0, Number.isFinite(opts.weight) ? opts.weight! : 0.1));
  const band = Math.min(1, Math.max(0, Number.isFinite(opts.band) ? opts.band! : 0.6));
  const baseScore = (hit: T1Hit) => hit.score ?? hit.cosine ?? 0;
  const top = Math.max(...hits.map(baseScore));
  if (top <= 0) return { results: hits, reordered: false };

  const ranked = hits.map((hit, index) => {
    const base = baseScore(hit);
    const key = hit.traceId || `${hit.sessionId}:${hit.turnId}`;
    const activation = Math.min(1, Math.max(0, opts.activation!.get(key) ?? 0));
    const eligible = activation > 0 && base >= top * band;
    return { hit, index, score: eligible ? base * (1 + weight * activation) : base };
  });
  ranked.sort((a, b) => b.score - a.score || a.index - b.index);
  const reordered = ranked.some((x, i) => x.index !== i);
  if (!reordered) return { results: hits, reordered: false };
  if (opts.mode === 'shadow') return { results: hits, reordered: true };
  return { results: ranked.map((x) => x.hit), reordered: true };
}


function hitKey(hit: { traceId?: string | null; sessionId: string; turnId: number }): string {
  return hit.traceId || `${hit.sessionId}:${hit.turnId}`;
}

/**
 * Fuse dense and lexical T1 rankings with reciprocal-rank fusion. A hit
 * present in both channels outranks a single-channel hit at the same rank.
 * Lexical excerpts are preferred (they contain the matched literal), while
 * the dense cosine is preserved for scoring/observability.
 */
export function fuseT1Hits(
  dense: T1Hit[],
  lexical: T1LexicalHit[],
  k: number,
  feature: T1LexicalHit[] = [],
): T1Hit[] {
  const fused = new Map<
    string,
    {
      hit: T1Hit;
      score: number;
      sources: Set<'dense' | 'lexical' | 'feature'>;
      lexicalExcerpt?: string;
      featureExcerpt?: string;
    }
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

  feature.forEach((hit, rank) => {
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
    entry.sources.add('feature');
    entry.featureExcerpt = hit.excerpt;
    if (!entry.hit.traceId) entry.hit.traceId = hit.traceId;
    fused.set(key, entry);
  });

  return [...fused.values()]
    .map(({ hit, score, sources, lexicalExcerpt, featureExcerpt }) => ({
      ...hit,
      excerpt: lexicalExcerpt || featureExcerpt || hit.excerpt,
      score,
      sources: (['dense', 'lexical', 'feature'] as const).filter((s) => sources.has(s)),
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
    let feature: T1LexicalHit[] = [];
    try {
      feature = (db as any).searchT1Features?.(query, Math.max(k * 2, 12)) ?? [];
    } catch {
      feature = [];
    }
    const fused = fuseT1Hits(dense, lexical, k, feature);
    const t1Cfg = config.recall.t1Recall;
    const mode: ActivationRankingMode = t1Cfg?.activationRanking ?? 'shadow';
    if (mode === 'off' || fused.length < 2) return fused;

    let activation: Map<string, number> | undefined;
    try {
      const ids = Array.from(new Set(fused.map((h) => h.traceId).filter((x): x is string => Boolean(x))));
      activation = ids.length > 0 && typeof (db as any).t1Activations === 'function'
        ? (db as any).t1Activations(ids)
        : undefined;
    } catch {
      activation = undefined;
    }

    rankingStats.evaluations++;
    const ranked = applyT1ActivationRanking(fused, {
      mode,
      activation,
      weight: t1Cfg?.activationRankWeight,
      band: t1Cfg?.activationRankBand,
    });
    if (ranked.reordered) {
      if (mode === 'on') rankingStats.applied++;
      else rankingStats.wouldReorder++;
    }
    return ranked.results;
  };
}
