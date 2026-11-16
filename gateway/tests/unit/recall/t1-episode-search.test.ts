import { searchT1Episodes } from '../../../src/recall/t1-episode-search';
import type { T1EpisodeRecord } from '../../../src/recall/t1-episodes';

function episode(over: Partial<T1EpisodeRecord>): T1EpisodeRecord {
  return {
    episodeId: 't1ep_a',
    sessionId: 's1',
    startTurn: 1,
    endTurn: 3,
    status: 'closed',
    startedAt: 1000,
    endedAt: 2000,
    boundarySource: 'inferred',
    boundaryReason: 'actor_shift',
    confidence: 0.8,
    actors: [{ actorId: 'agent:reviewer', role: 'reviewer', weight: 1 }],
    conceptIds: ['concept:embedding'],
    sourceTraceIds: ['t1t_1', 't1t_2', 't1t_3'],
    ...over,
  };
}

describe('searchT1Episodes', () => {
  test('aggregates turn hits into episode hits with top traces', async () => {
    const episodes: Record<string, T1EpisodeRecord> = {
      t1ep_a: episode({ episodeId: 't1ep_a', startTurn: 1, endTurn: 3 }),
      t1ep_b: episode({ episodeId: 't1ep_b', startTurn: 4, endTurn: 5, actors: [], conceptIds: [] }),
    };
    const deps = {
      searchTurns: async () => [
        { traceId: 't1t_1', sessionId: 's1', turnId: 1, excerpt: 'a', score: 0.9, sources: ['lexical'] },
        { traceId: 't1t_2', sessionId: 's1', turnId: 2, excerpt: 'b', score: 0.7, sources: ['concept'] },
        { traceId: 't1t_4', sessionId: 's1', turnId: 4, excerpt: 'c', score: 0.8, sources: ['actor'] },
      ] as any,
      findEpisodeByTrace: (traceId: string) =>
        traceId === 't1t_1' || traceId === 't1t_2' ? 't1ep_a' : 't1ep_b',
      getEpisode: (id: string) => episodes[id] ?? null,
      listMembers: (id: string) =>
        (episodes[id]?.sourceTraceIds ?? []).map((traceId, i) => ({
          episodeId: id,
          traceId,
          turnSeq: episodes[id].startTurn + i,
        })),
    };

    const hits = await searchT1Episodes(deps, 'embedding', 5);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      episodeId: 't1ep_a',
      startTurn: 1,
      endTurn: 3,
      score: 1.6,
      topTraceIds: ['t1t_1', 't1t_2'],
    });
    expect(hits[0].sources).toEqual(['turn', 'concept']);
    expect(hits[1].episodeId).toBe('t1ep_b');
  });

  test('adds a declared source and bonus', async () => {
    const ep = episode({ boundarySource: 'declared' });
    const hits = await searchT1Episodes(
      {
        searchTurns: async () => [
          { traceId: 't1t_1', sessionId: 's1', turnId: 1, excerpt: 'a', score: 0.5 } as any,
        ],
        findEpisodeByTrace: () => 't1ep_a',
        getEpisode: () => ep,
        listMembers: () => [],
      },
      'q',
      3,
    );
    expect(hits[0].score).toBeGreaterThan(0.5);
    expect(hits[0].sources).toContain('declared');
  });

  test('skips turns without an episode and empty queries', async () => {
    const deps = {
      searchTurns: async () => [
        { traceId: 't1t_x', sessionId: 's1', turnId: 1, excerpt: 'x', score: 0.9 } as any,
      ],
      findEpisodeByTrace: () => null,
      getEpisode: () => null,
      listMembers: () => [],
    };
    expect(await searchT1Episodes(deps, 'q', 3)).toEqual([]);
    expect(await searchT1Episodes(deps, '   ', 3)).toEqual([]);
  });

  test('dedupes repeated traces and caps top traces at 3', async () => {
    const ep = episode({ sourceTraceIds: ['t1t_1', 't1t_2', 't1t_3', 't1t_4'] });
    const hits = await searchT1Episodes(
      {
        searchTurns: async () => [
          { traceId: 't1t_1', sessionId: 's1', turnId: 1, excerpt: 'a', score: 0.4 } as any,
          { traceId: 't1t_1', sessionId: 's1', turnId: 1, excerpt: 'a', score: 0.9 } as any,
          { traceId: 't1t_2', sessionId: 's1', turnId: 2, excerpt: 'b', score: 0.8 } as any,
          { traceId: 't1t_3', sessionId: 's1', turnId: 3, excerpt: 'c', score: 0.7 } as any,
          { traceId: 't1t_4', sessionId: 's1', turnId: 4, excerpt: 'd', score: 0.6 } as any,
        ],
        findEpisodeByTrace: () => 't1ep_a',
        getEpisode: () => ep,
        listMembers: () => [],
      },
      'q',
      3,
    );
    expect(hits[0].topTraceIds).toEqual(['t1t_1', 't1t_2', 't1t_3']);
  });
});
