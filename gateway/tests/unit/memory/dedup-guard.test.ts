import { exactHashOf, seenExactHash, getDedupStats, resetDedupStatsForTest } from '../../../src/memory/dedup-guard';

describe('L1 exact-hash guard', () => {
  beforeEach(() => resetDedupStatsForTest());

  it('same content → same hash, different content → different hash', () => {
    expect(exactHashOf('用户偏好 TDD')).toBe(exactHashOf('用户偏好 TDD'));
    expect(exactHashOf('用户偏好 TDD')).not.toBe(exactHashOf('用户偏好 lint'));
  });

  it('first sight returns false, second sight returns true', () => {
    const h = exactHashOf('记忆内容 A');
    expect(seenExactHash(h)).toBe(false);
    expect(seenExactHash(h)).toBe(true);
  });

  it('LRU bounded: evicting old hashes makes them unseen again', () => {
    const first = exactHashOf('old');
    for (let i = 0; i < 10_100; i++) seenExactHash(exactHashOf(`bulk-${i}`));
    expect(seenExactHash(first)).toBe(false); // evicted
  });

  it('counts exactHashSkips', () => {
    const h = exactHashOf('x');
    seenExactHash(h); seenExactHash(h);
    expect(getDedupStats().exactHashSkips).toBe(1);
  });
});
