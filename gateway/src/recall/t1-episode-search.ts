// Episode search: aggregate existing turn-channel hits into hippocampal
// episode hits. Episodes are the retrieval unit for "what happened"; turn
// hits remain available for trace-level drill-down.
import type { T1EpisodeMember, T1EpisodeRecord } from './t1-episodes';

export interface EpisodeSearchDeps {
  searchTurns(
    query: string,
    k: number,
  ): Promise<
    Array<{
      traceId?: string | null;
      sessionId: string;
      turnId: number;
      excerpt: string;
      score?: number;
      cosine?: number;
      sources?: string[];
    }>
  >;
  findEpisodeByTrace(traceId: string): string | null;
  getEpisode(episodeId: string): T1EpisodeRecord | null;
  listMembers(episodeId: string): T1EpisodeMember[];
}

export type EpisodeHitSource = 'turn' | 'actor' | 'concept' | 'sparse' | 'declared';

export interface EpisodeHit {
  episodeId: string;
  sessionId: string;
  startTurn: number;
  endTurn: number;
  status: 'open' | 'closed';
  startedAt: number | null;
  boundarySource: string;
  boundaryReason?: string;
  intent?: string;
  outcome?: string;
  actors: string[];
  conceptIds: string[];
  score: number;
  sources: EpisodeHitSource[];
  topTraceIds: string[];
}

const SOURCE_ORDER: EpisodeHitSource[] = ['turn', 'actor', 'concept', 'sparse', 'declared'];

function mapSource(source: string): EpisodeHitSource | null {
  if (source === 'actor' || source === 'concept' || source === 'sparse') return source;
  if (source === 'dense' || source === 'lexical' || source === 'feature') return 'turn';
  return null;
}

/**
 * Turn hits → episode hits. Scores sum the best score per trace, so a trace
 * appearing in several channels is not double-counted. A declared boundary
 * adds a small bonus and the `declared` source.
 */
export async function searchT1Episodes(
  deps: EpisodeSearchDeps,
  query: string,
  k: number,
): Promise<EpisodeHit[]> {
  if (!query.trim() || !Number.isFinite(k) || k <= 0) return [];

  const turns = await deps.searchTurns(query, Math.max(k * 4, 12));
  const buckets = new Map<
    string,
    {
      episode: T1EpisodeRecord;
      bestByTrace: Map<string, { score: number; turnId: number }>;
      sources: Set<EpisodeHitSource>;
    }
  >();

  for (const hit of turns) {
    if (!hit.traceId) continue;
    const episodeId = deps.findEpisodeByTrace(hit.traceId);
    if (!episodeId) continue;
    const episode = deps.getEpisode(episodeId);
    if (!episode) continue;

    let bucket = buckets.get(episodeId);
    if (!bucket) {
      bucket = { episode, bestByTrace: new Map(), sources: new Set() };
      buckets.set(episodeId, bucket);
    }
    const score = Number(hit.score ?? hit.cosine ?? 0);
    const previous = bucket.bestByTrace.get(hit.traceId);
    if (!previous || previous.score < score) {
      bucket.bestByTrace.set(hit.traceId, { score, turnId: hit.turnId });
    }
    for (const source of hit.sources ?? []) {
      const mapped = mapSource(source);
      if (mapped) bucket.sources.add(mapped);
    }
    if (bucket.sources.size === 0) bucket.sources.add('turn');
  }

  const hits: EpisodeHit[] = [];
  for (const bucket of buckets.values()) {
    const traces = [...bucket.bestByTrace.entries()]
      .sort((a, b) => b[1].score - a[1].score || a[1].turnId - b[1].turnId)
      .map(([traceId]) => traceId);
    let score = [...bucket.bestByTrace.values()].reduce(
      (sum, entry) => sum + entry.score,
      0,
    );
    if (bucket.episode.boundarySource === 'declared') {
      score += 0.25;
      bucket.sources.add('declared');
    }
    hits.push({
      episodeId: bucket.episode.episodeId,
      sessionId: bucket.episode.sessionId,
      startTurn: bucket.episode.startTurn,
      endTurn: bucket.episode.endTurn,
      status: bucket.episode.status,
      startedAt: bucket.episode.startedAt,
      boundarySource: bucket.episode.boundarySource,
      boundaryReason: bucket.episode.boundaryReason,
      intent: bucket.episode.intent,
      outcome: bucket.episode.outcome,
      actors: bucket.episode.actors.map((actor) => actor.actorId),
      conceptIds: bucket.episode.conceptIds,
      score,
      sources: SOURCE_ORDER.filter((source) => bucket.sources.has(source)),
      topTraceIds: traces.slice(0, 3),
    });
  }

  return hits.sort((a, b) => b.score - a.score || a.episodeId.localeCompare(b.episodeId)).slice(0, k);
}
