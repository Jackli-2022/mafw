import { deriveEpisodeId, type EpisodeLookup } from '../../../src/core/memory/provenance';

describe('deriveEpisodeId', () => {
  test('first resolvable trace wins', () => {
    const lookup: EpisodeLookup = {
      findEpisodeByTrace: (id: string) => (id === 't1t_b' ? 't1ep_a' : null),
    };
    expect(deriveEpisodeId(lookup, ['t1t_a', 't1t_b'])).toBe('t1ep_a');
  });

  test('unknown traces, empty input and a missing lookup return null', () => {
    expect(deriveEpisodeId({ findEpisodeByTrace: () => null }, ['x'])).toBeNull();
    expect(deriveEpisodeId({ findEpisodeByTrace: () => 't1ep_a' }, [])).toBeNull();
    expect(deriveEpisodeId(null, ['t1t_a'])).toBeNull();
    expect(deriveEpisodeId(undefined, ['t1t_a'])).toBeNull();
  });

  test('a throwing lookup is fail-open', () => {
    const lookup: EpisodeLookup = {
      findEpisodeByTrace: () => {
        throw new Error('db down');
      },
    };
    expect(deriveEpisodeId(lookup, ['t1t_a'])).toBeNull();
  });

  test('non-string and duplicate trace ids are skipped', () => {
    const seen: string[] = [];
    const lookup: EpisodeLookup = {
      findEpisodeByTrace: (id: string) => {
        seen.push(id);
        return id === 't1t_b' ? 't1ep_a' : null;
      },
    };
    expect(
      deriveEpisodeId(lookup, [null as any, 42 as any, 't1t_a', 't1t_a', 't1t_b']),
    ).toBe('t1ep_a');
    expect(seen).toEqual(['t1t_a', 't1t_b']);
  });
});
