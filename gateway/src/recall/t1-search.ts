import type { GatewayDatabase, T1LexicalHit } from '../memory/gateway-db';
import type { EmbeddingRuntime } from '../memory/embedding-runtime';
import { getEmbeddingRuntime } from '../memory/embedding-runtime';
import { config } from '../config';
import { makeT1Search, T1Hit, type T1HitSource } from './verbatim-recall';
import { getT1SemanticEncoder } from './t1-semantic-atoms';
import { MIN_RETRIEVAL_ATOM_SCORE, type T1SparseAtom } from './t1-sparse';

const RRF_K = 60;

/** Dense-channel A/B counters (shadow/off observability). */
const denseStats = { evaluations: 0, withDenseHits: 0 };
export function getT1DenseStats(): { evaluations: number; withDenseHits: number } {
  return { ...denseStats };
}
export function resetT1DenseStats(): void {
  denseStats.evaluations = 0;
  denseStats.withDenseHits = 0;
}

export interface T1FusionChannels {
  feature?: T1LexicalHit[];
  concept?: T1LexicalHit[];
  actor?: T1LexicalHit[];
  sparse?: T1LexicalHit[];
}

function hitKey(hit: { traceId?: string | null; sessionId: string; turnId: number }): string {
  return hit.traceId || `${hit.sessionId}:${hit.turnId}`;
}

type FusionEntry = {
  hit: T1Hit;
  score: number;
  sources: Set<T1HitSource>;
  excerpts: Partial<Record<T1HitSource, string>>;
};

/**
 * Fuse every T1 channel with reciprocal-rank fusion. A hit present in several
 * channels outranks a single-channel hit at the same rank, and channel
 * provenance is preserved in `sources` for observability.
 *
 * `channels` accepts a bare `T1LexicalHit[]` for backwards compatibility
 * (treated as the feature channel).
 */
export function fuseT1Hits(
  dense: T1Hit[],
  lexical: T1LexicalHit[],
  k: number,
  channels: T1LexicalHit[] | T1FusionChannels = {},
): T1Hit[] {
  const channelMap: T1FusionChannels = Array.isArray(channels)
    ? { feature: channels }
    : channels;
  const fused = new Map<string, FusionEntry>();
  const excerptOrder: T1HitSource[] = [
    'lexical',
    'feature',
    'concept',
    'actor',
    'sparse',
    'neighbor',
  ];

  const merge = (
    hit: {
      sessionId: string;
      turnId: number;
      traceId?: string | null;
      cosine?: number;
      excerpt: string;
    },
    source: T1HitSource,
    rank: number,
  ) => {
    if (!hit.excerpt) return;
    const key = hitKey(hit);
    const entry = fused.get(key) ?? {
      hit: {
        sessionId: hit.sessionId,
        turnId: hit.turnId,
        traceId: hit.traceId,
        cosine: hit.cosine ?? 0,
        excerpt: hit.excerpt,
      },
      score: 0,
      sources: new Set<T1HitSource>(),
      excerpts: {},
    };
    entry.score += 1 / (RRF_K + rank);
    entry.sources.add(source);
    entry.excerpts[source] = hit.excerpt;
    if (!entry.hit.traceId) entry.hit.traceId = hit.traceId;
    fused.set(key, entry);
  };

  dense.forEach((hit, rank) => merge(hit, 'dense', rank));
  lexical.forEach((hit, rank) => merge(hit, 'lexical', rank));

  for (const source of ['feature', 'concept', 'actor', 'sparse'] as const) {
    (channelMap[source] ?? []).forEach((hit, rank) => merge(hit, source, rank));
  }

  return [...fused.values()]
    .map(({ hit, score, sources, excerpts }) => {
      const preferred = excerptOrder.find((source) => excerpts[source]);
      return {
        ...hit,
        excerpt: (preferred && excerpts[preferred]) || hit.excerpt,
        score,
        sources: [
          'dense',
          'lexical',
          'feature',
          'concept',
          'actor',
          'sparse',
          'neighbor',
        ].filter((source): source is T1HitSource => sources.has(source as T1HitSource)),
      };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, Math.max(0, k));
}

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


/**
 * Shared gateway T1 search. Resolves the embedding runtime lazily so a
 * hot-swapped embedding engine cannot leave a stale provider wired here.
 * Dense rows are archive-first with active fallback; the lexical channel uses
 * the FTS5 trigram index. Either channel failing leaves the other usable.
 */
export interface T1SearchOptions {
  /** Test seam: query atom encoder (defaults to the shared calibrated encoder). */
  atomsForQuery?: (query: string) => Promise<T1SparseAtom[]>;
}

export function createGatewayT1Search(
  db: GatewayDatabase,
  getRuntime: () => EmbeddingRuntime | null = getEmbeddingRuntime,
  opts: T1SearchOptions = {},
): (query: string, k: number) => Promise<T1Hit[]> {
  const denseSearch = async (
    query: string,
    k: number,
    runtime: EmbeddingRuntime | null,
  ): Promise<T1Hit[]> => {
    try {
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

  const atomsEnabled = () => config.recall.t1Recall?.semanticAtoms !== 'off';

  const queryAtomIds = async (
    query: string,
    runtime: EmbeddingRuntime | null,
  ): Promise<string[]> => {
    if (!atomsEnabled()) return [];
    try {
      const atoms = opts.atomsForQuery
        ? await opts.atomsForQuery(query)
        : runtime?.provider
          ? (await getT1SemanticEncoder(runtime.provider, {
              referenceTexts: () => db.sampleTurnTexts(24),
            }).encodeMany([{ traceId: '__query__', text: query }])).get('__query__') ?? []
          : [];
      return atoms
        .filter((atom) => atom.score >= MIN_RETRIEVAL_ATOM_SCORE)
        .map((atom) => `sem:${atom.termId}`);
    } catch {
      return [];
    }
  };

  return async (query: string, k: number): Promise<T1Hit[]> => {
    if (!query.trim() || k <= 0) return [];
    const runtime = getRuntime();
    const denseMode = config.recall.t1Recall?.denseIndex ?? 'shadow';
    const dense = denseMode === 'off' ? [] : await denseSearch(query, k, runtime);
    if (denseMode !== 'off') {
      denseStats.evaluations++;
      if (dense.length > 0) denseStats.withDenseHits++;
    }
    const denseForFusion = denseMode === 'on' ? dense : [];
    const semIds = await queryAtomIds(query, runtime);
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
      feature = db.searchT1Features?.(query, Math.max(k * 2, 12)) ?? [];
    } catch {
      feature = [];
    }
    let concept: T1LexicalHit[] = [];
    let actor: T1LexicalHit[] = [];
    let sparse: T1LexicalHit[] = [];
    try {
      concept = db.searchT1Concepts?.(query, Math.max(k * 2, 12)) ?? [];
    } catch {
      concept = [];
    }
    try {
      actor = db.searchT1Actors?.(query, Math.max(k * 2, 12)) ?? [];
    } catch {
      actor = [];
    }
    try {
      sparse = db.searchT1Sparse?.(query, Math.max(k * 2, 12), semIds) ?? [];
    } catch {
      sparse = [];
    }

    let fused = fuseT1Hits(denseForFusion, lexical, k, { feature, concept, actor, sparse });

    // CA3-style bounded pattern completion: a strong cue activates turns that
    // share a concept or a non-generic actor with the seeds. Neighbours can
    // only fill remaining slots, never displace a direct hit.
    try {
      if (fused.length > 0 && fused.length < k) {
        const seeds = fused
          .slice(0, 3)
          .map((hit) => hit.traceId)
          .filter((id): id is string => Boolean(id));
        const neighbors = seeds.length > 0
          ? db.expandT1Neighbors?.(seeds, k - fused.length) ?? []
          : [];
        if (neighbors.length > 0) {
          const known = new Set(fused.map((hit) => hit.traceId));
          const floor = fused[fused.length - 1]?.score ?? 0;
          neighbors.forEach((hit, index) => {
            if (!hit.traceId || known.has(hit.traceId)) return;
            known.add(hit.traceId);
            fused.push({
              sessionId: hit.sessionId,
              turnId: hit.turnId,
              traceId: hit.traceId,
              cosine: 0,
              excerpt: hit.excerpt,
              score: (floor * 0.9) / (index + 1),
              sources: ['neighbor'],
            });
          });
        }
      }
    } catch {
      /* fail-open: direct hits remain */
    }

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
