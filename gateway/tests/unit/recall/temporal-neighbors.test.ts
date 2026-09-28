/**
 * R6: temporal-neighbor bundling — retrieving one memory reinstates its
 * temporal context (lag-CRP; Howard & Kahana 2002). Anchors pull in their
 * chronologically adjacent entries (±window), same-session neighbors weighted
 * above cross-session ones (episodic-boundary attenuation).
 *
 * Pure function: entries are supplied in chronological order (index write
 * order), so position is a reliable time proxy even when created_at ties.
 */
import { computeTemporalNeighbors, chronologicalOrder } from '../../../src/recall/temporal-neighbors';

function entry(id: string, sessionId: string | undefined, created_at = '2024-01-01T00:00:00Z') {
  return { id, type: 'episodic', primary_abstraction: id, cue_anchors: [], tier: 'episodic', energy: 0.8, source_session_id: sessionId, created_at };
}

// Chronological order: a1 a2 a3 (session A) | b1 b2 (session B) | c1 (session C)
const CORPUS = [
  entry('a1', 'A'),
  entry('a2', 'A'),
  entry('a3', 'A'),
  entry('b1', 'B'),
  entry('b2', 'B'),
  entry('c1', 'C'),
];

test('pulls ±1 chronological neighbors of an anchor', () => {
  const nbs = computeTemporalNeighbors([{ id: 'a2', score: 1 }], CORPUS);
  expect(nbs.map(n => n.id).sort()).toEqual(['a1', 'a3']);
});

test('same-session neighbors are weighted above cross-session ones', () => {
  // a3 is the last entry of session A; its +1 neighbor is b1 (session B).
  const nbs = computeTemporalNeighbors(
    [{ id: 'a3', score: 1 }],
    CORPUS,
    { sameSessionWeight: 0.5, crossSessionWeight: 0.35 },
  );
  const byId = Object.fromEntries(nbs.map(n => [n.id, n]));
  expect(byId.a2.sameSession).toBe(true);
  expect(byId.a2.score).toBeCloseTo(0.5);
  expect(byId.b1.sameSession).toBe(false);
  expect(byId.b1.score).toBeCloseTo(0.35);
});

test('neighbor score scales with the anchor score', () => {
  const nbs = computeTemporalNeighbors([{ id: 'a2', score: 2 }], CORPUS, { sameSessionWeight: 0.5 });
  expect(Math.max(...nbs.map(n => n.score))).toBeCloseTo(1);
});

test('window=2 reaches distance-2 neighbors with decay', () => {
  const nbs = computeTemporalNeighbors([{ id: 'a2', score: 1 }], CORPUS, { window: 2 });
  expect(nbs.map(n => n.id).sort()).toEqual(['a1', 'a3', 'b1']);
  // distance 2 (b1, cross-session) is weaker than both distance-1 neighbors
  const b1 = nbs.find(n => n.id === 'b1')!;
  const a1 = nbs.find(n => n.id === 'a1')!;
  expect(b1.score).toBeLessThan(a1.score);
});

test('never returns an entry that is already an anchor', () => {
  const nbs = computeTemporalNeighbors(
    [{ id: 'a2', score: 1 }, { id: 'a3', score: 0.9 }],
    CORPUS,
  );
  expect(nbs.some(n => n.id === 'a2' || n.id === 'a3')).toBe(false);
});

test('skips superseded entries as neighbors', () => {
  const corpus = CORPUS.map(e => (e.id === 'a1' ? { ...e, superseded_by: 'zzz' } : e));
  const nbs = computeTemporalNeighbors([{ id: 'a2', score: 1 }], corpus);
  expect(nbs.map(n => n.id)).toEqual(['a3']);
});

test('anchorFloor: low-scoring anchors are not expanded', () => {
  const nbs = computeTemporalNeighbors(
    [{ id: 'a2', score: 0.1 }, { id: 'b2', score: 1 }],
    CORPUS,
    { anchorFloor: 0.5 },
  );
  // a2 below floor → no a1/a3; b2 expanded → b1 and c1
  expect(nbs.map(n => n.id).sort()).toEqual(['b1', 'c1']);
});

test('maxNeighbors caps the result, keeping the strongest', () => {
  const nbs = computeTemporalNeighbors(
    [{ id: 'a2', score: 1 }, { id: 'b2', score: 1 }],
    CORPUS,
    { maxNeighbors: 2 },
  );
  expect(nbs).toHaveLength(2);
  expect(Math.min(...nbs.map(n => n.score))).toBeCloseTo(0.5);
});

test('dedupes a neighbor pulled in by two anchors, keeping the max score', () => {
  // a2 and a3 both have a1 as a neighbor only via window=2 chains; use b1 shared
  const nbs = computeTemporalNeighbors(
    [{ id: 'a3', score: 1 }, { id: 'b1', score: 1 }],
    CORPUS,
    { window: 1 },
  );
  expect(nbs.filter(n => n.id === 'a2')).toHaveLength(1);
});

test('empty anchors → no neighbors', () => {
  expect(computeTemporalNeighbors([], CORPUS)).toEqual([]);
});

test('entries without ids in corpus are ignored gracefully', () => {
  const nbs = computeTemporalNeighbors([{ id: 'missing', score: 1 }], CORPUS);
  expect(nbs).toEqual([]);
});

test('chronologicalOrder sorts by created_at, ties keep index order (stable)', () => {
  const dated = [
    entry('late', 'X', '2024-03-01T00:00:00Z'),
    entry('early', 'X', '2024-01-01T00:00:00Z'),
    entry('tie1', 'X', '2024-01-01T00:00:00Z'),
    entry('mid', 'X', '2024-02-01T00:00:00Z'),
  ];
  expect(chronologicalOrder(dated).map(e => e.id)).toEqual(['early', 'tie1', 'mid', 'late']);
});

test('chronologicalOrder puts entries without a parseable date last, preserving order', () => {
  const dated = [
    entry('nodate1', 'X', 'not-a-date'),
    entry('dated', 'X', '2024-01-01T00:00:00Z'),
    { ...entry('nodate2', 'X'), created_at: undefined },
  ];
  expect(chronologicalOrder(dated).map(e => e.id)).toEqual(['dated', 'nodate1', 'nodate2']);
});
