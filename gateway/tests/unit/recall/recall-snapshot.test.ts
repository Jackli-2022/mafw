/**
 * R8 predictive prefetch snapshot — decision logic (rolling-window query,
 * lexical topic-shift guard, TTL).
 */
import {
  snapshotQueryFromTurns,
  snapshotOverlap,
  snapshotContainment,
  decideSnapshotUse,
  SNAPSHOT_DEFAULTS,
  RecallSnapshot,
} from '../../../src/recall/recall-snapshot';

const snap = (over: Partial<RecallSnapshot> = {}): RecallSnapshot => ({
  query: 'kubernetes deployment rollout notes',
  block: '<recall>…</recall>',
  ids: ['mem_1_aaaaaa'],
  builtAt: new Date().toISOString(),
  ...over,
});

describe('snapshotQueryFromTurns', () => {
  test('empty input → empty query', () => {
    expect(snapshotQueryFromTurns([])).toBe('');
    expect(snapshotQueryFromTurns(['', '   '])).toBe('');
  });

  test('joins recent turn texts oldest → newest', () => {
    expect(snapshotQueryFromTurns(['first turn', 'second turn'])).toBe('first turn second turn');
  });

  test('caps at maxChars, keeping the NEWEST turns (tail matters most)', () => {
    const q = snapshotQueryFromTurns(['A'.repeat(100), 'B'.repeat(100), 'C'.repeat(100)], 150);
    expect(q.length).toBeLessThanOrEqual(150);
    expect(q).toContain('C'.repeat(50));
    expect(q).not.toContain('A'.repeat(50));
  });

  test('collapses whitespace and drops blanks', () => {
    expect(snapshotQueryFromTurns(['  a\n\n b  ', '', 'c'])).toBe('a b c');
  });
});

describe('snapshotOverlap / snapshotContainment / topic shift', () => {
  test('Jaccard is length-biased; containment is not (the reason for the swap)', () => {
    const window = 'kubernetes deployment rollout notes from the previous turns about clusters and pods and services and ingresses';
    const followUp = 'kubernetes rollout pods';
    // A short on-topic follow-up scores near zero with Jaccard…
    expect(snapshotOverlap(window, followUp)).toBeLessThan(0.25);
    // …but its tokens are fully covered by the context → containment is high.
    expect(snapshotContainment(window, followUp)).toBeGreaterThan(0.9);
  });

  test('clearly different topics stay low on containment', () => {
    expect(snapshotContainment('kubernetes deployment rollout notes', 'pasta recipe tomato sauce')).toBe(0);
  });

  test('same topic → high overlap; different topic → low', () => {
    const same = snapshotOverlap('kubernetes deployment rollout', 'kubernetes rollout failed');
    const diff = snapshotOverlap('kubernetes deployment rollout', 'pasta recipe tomato sauce');
    expect(same).toBeGreaterThan(0.25);
    expect(diff).toBeLessThan(0.25);
  });

  test('CJK content still measures overlap', () => {
    expect(snapshotOverlap('记忆检索优化', '记忆检索问题')).toBeGreaterThan(0.25);
  });

  test('empty side → 0 overlap', () => {
    expect(snapshotOverlap('', 'anything')).toBe(0);
  });
});

describe('decideSnapshotUse', () => {
  const now = new Date('2026-09-28T10:00:00Z');

  test('missing / empty snapshot → no-snapshot', () => {
    expect(decideSnapshotUse(null, 'kubernetes', now)).toBe('no-snapshot');
    expect(decideSnapshotUse(snap({ block: '' }), 'kubernetes', now)).toBe('no-snapshot');
    expect(decideSnapshotUse(snap({ ids: [] }), 'kubernetes', now)).toBe('no-snapshot');
  });

  test('expired snapshot → stale', () => {
    const old = snap({ builtAt: new Date(now.getTime() - SNAPSHOT_DEFAULTS.ttlMs - 1000).toISOString() });
    expect(decideSnapshotUse(old, 'kubernetes deployment', now)).toBe('stale');
  });

  test('continuing the same topic → use', () => {
    const s = snap({ builtAt: new Date(now.getTime() - 60_000).toISOString() });
    expect(decideSnapshotUse(s, 'kubernetes deployment rollout status', now)).toBe('use');
  });

  test('short on-topic follow-up → use (containment, not Jaccard)', () => {
    const s = snap({ builtAt: new Date(now.getTime() - 60_000).toISOString() });
    expect(decideSnapshotUse(s, 'kubernetes rollout', now)).toBe('use');
  });

  test('new topic → topic-shift (fall back to live search)', () => {
    const s = snap({ builtAt: new Date(now.getTime() - 60_000).toISOString() });
    expect(decideSnapshotUse(s, 'how do I cook pasta with tomato sauce', now)).toBe('topic-shift');
  });

  test('empty query still uses the snapshot (nothing better to compute)', () => {
    const s = snap({ builtAt: new Date(now.getTime() - 60_000).toISOString() });
    expect(decideSnapshotUse(s, '   ', now)).toBe('use');
  });
});
