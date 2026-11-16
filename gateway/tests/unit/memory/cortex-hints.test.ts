import {
  planEpisodeHints,
  type HintEntry,
  type HintEpisode,
} from '../../../src/memory/cortex-grounding';

const episodesBySession = new Map<string, HintEpisode[]>([
  ['s1', [{ episodeId: 't1ep_a', endedAt: 100_000 }]],
  ['s2', [
    { episodeId: 't1ep_b', endedAt: 200_000 },
    { episodeId: 't1ep_c', endedAt: 300_000 },
  ]],
  ['s3', []],
]);

const entry = (over: Partial<HintEntry> & { id: string }): HintEntry => ({
  source_session_id: 's1',
  created_at: '1970-01-01T00:00:10.000Z',
  ...over,
});

describe('planEpisodeHints', () => {
  test('single-episode sessions get a high-confidence hint', () => {
    const plan = planEpisodeHints([entry({ id: 'a' })], episodesBySession);
    expect(plan.updates).toEqual([
      { id: 'a', hint: { episodeId: 't1ep_a', basis: 'session_single', confidence: 0.8 } },
    ]);
  });

  test('multi-episode sessions use the latest episode only when written after it', () => {
    const plan = planEpisodeHints(
      [
        entry({ id: 'after', source_session_id: 's2', created_at: '1970-01-01T00:06:00.000Z' }),
        entry({ id: 'before', source_session_id: 's2', created_at: '1970-01-01T00:03:00.000Z' }),
      ],
      episodesBySession,
    );
    expect(plan.updates).toEqual([
      { id: 'after', hint: { episodeId: 't1ep_c', basis: 'session_latest_after', confidence: 0.6 } },
    ]);
    expect(plan.ambiguous).toBe(1);
  });

  test('skips exact links, existing hints, no-session and no-episode units', () => {
    const plan = planEpisodeHints(
      [
        entry({ id: 'exact', episode_id: 't1ep_x' }),
        entry({ id: 'hinted', episode_hint: { episodeId: 't1ep_y' } }),
        entry({ id: 'no-session', source_session_id: undefined }),
        entry({ id: 'no-episode', source_session_id: 's3' }),
      ],
      episodesBySession,
    );
    expect(plan.updates).toEqual([]);
    expect(plan.skippedExisting).toBe(2);
    expect(plan.noSession).toBe(1);
    expect(plan.noEpisode).toBe(1);
  });

  test('an invalid created_at is ambiguous, not a guess', () => {
    const plan = planEpisodeHints(
      [entry({ id: 'bad', source_session_id: 's2', created_at: 'not-a-date' })],
      episodesBySession,
    );
    expect(plan.updates).toEqual([]);
    expect(plan.ambiguous).toBe(1);
  });
});
