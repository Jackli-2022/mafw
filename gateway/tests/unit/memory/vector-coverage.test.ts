// Harmonic vector coverage must count the active index set as the denominator.
//
// The old stats formula was `vectors.size() / entries.length`: the numerator is
// every vector key (including orphan keys left by abandoned write paths) while
// the denominator includes superseded entries that intentionally have no
// vector. That made live coverage read >100% even when every active memory was
// indexed. The helper below is the single shared statistic for
// `/api/memory/stats` and `kernel.runtimeState`; raw counts stay raw.
import { computeHarmonicVectorCoverage } from '../../../src/memory/vector-coverage';

function store(ids: string[]) {
  return { size: () => ids.length, ids: () => [...ids] };
}

describe('computeHarmonicVectorCoverage', () => {
  it('reports active intersection, orphans, active coverage and unclamped raw coverage', () => {
    // Brief fixture: A/C are the active index rows (both vectored); superseded
    // B has no vector and is no longer an index row; ORPHAN is a vector key with
    // no index row. Raw counts: 2 index rows / 3 vector keys.
    const entries = [{ id: 'a' }, { id: 'c' }];
    expect(computeHarmonicVectorCoverage(entries, store(['a', 'c', 'orphan']))).toEqual({
      vectors: 3,
      indexEntries: 2,
      activeEntries: 2,
      activeWithVectors: 2,
      orphanVectors: 1,
      coverage: 1,
      rawCoverage: 1.5,
    });
  });

  it('superseded rows still present in the index are excluded from the active denominator', () => {
    // The realistic shape: B keeps its index row (superseded_by) but has no
    // vector. Raw ratio 3/3 = 1 while active coverage is 2/2 = 1.
    const entries = [{ id: 'a' }, { id: 'b', superseded_by: 'a' }, { id: 'c' }];
    const result = computeHarmonicVectorCoverage(entries, store(['a', 'c', 'orphan']));
    expect(result.activeEntries).toBe(2);
    expect(result.activeWithVectors).toBe(2);
    expect(result.coverage).toBe(1);
    expect(result.orphanVectors).toBe(1);
    expect(result.indexEntries).toBe(3);
    expect(result.rawCoverage).toBe(1);
  });

  it('empty index and empty store report zero coverage instead of 1', () => {
    expect(computeHarmonicVectorCoverage([], store([]))).toEqual({
      vectors: 0,
      indexEntries: 0,
      activeEntries: 0,
      activeWithVectors: 0,
      orphanVectors: 0,
      coverage: 0,
      rawCoverage: 0,
    });
  });

  it('treats a missing/off embedding runtime as an empty store', () => {
    const entries = [{ id: 'a' }, { id: 'b' }];
    for (const vectors of [null, undefined]) {
      expect(computeHarmonicVectorCoverage(entries, vectors)).toEqual({
        vectors: 0,
        indexEntries: 2,
        activeEntries: 2,
        activeWithVectors: 0,
        orphanVectors: 0,
        coverage: 0,
        rawCoverage: 0,
      });
    }
  });

  it('every active entry missing a vector yields coverage 0 while raw stays 0', () => {
    const entries = [{ id: 'a', superseded_by: null }, { id: 'b' }];
    expect(computeHarmonicVectorCoverage(entries, store([]))).toEqual({
      vectors: 0,
      indexEntries: 2,
      activeEntries: 2,
      activeWithVectors: 0,
      orphanVectors: 0,
      coverage: 0,
      rawCoverage: 0,
    });
  });

  it('a superseded entry with a vector is not an orphan (it is still in the index)', () => {
    const entries = [{ id: 'a' }, { id: 'b', superseded_by: 'a' }];
    const result = computeHarmonicVectorCoverage(entries, store(['a', 'b']));
    expect(result.orphanVectors).toBe(0);
    expect(result.activeWithVectors).toBe(1);
    expect(result.coverage).toBe(1);
    expect(result.rawCoverage).toBe(1);
  });

  it('duplicate active index rows for one id count once in the denominator', () => {
    const entries = [{ id: 'a' }, { id: 'a' }, { id: 'b', superseded_by: 'a' }];
    const result = computeHarmonicVectorCoverage(entries, store(['a']));
    expect(result.activeEntries).toBe(1);
    expect(result.activeWithVectors).toBe(1);
    expect(result.coverage).toBe(1);
    // raw counts stay raw: 1 vector / 3 index rows.
    expect(result.indexEntries).toBe(3);
    expect(result.rawCoverage).toBeCloseTo(1 / 3);
  });

  it('duplicate vector ids do not inflate the intersection or the orphan count', () => {
    const dupeStore = { size: () => 1, ids: () => ['a', 'a'] };
    const result = computeHarmonicVectorCoverage([{ id: 'a' }], dupeStore);
    expect(result.activeWithVectors).toBe(1);
    expect(result.orphanVectors).toBe(0);
    expect(result.vectors).toBe(1);
  });

  it('never clamps rawCoverage when orphan vectors dominate', () => {
    const entries = [{ id: 'a' }];
    const result = computeHarmonicVectorCoverage(entries, store(['a', 'x', 'y', 'z', 'w']));
    expect(result.coverage).toBe(1);
    expect(result.rawCoverage).toBe(5);
    expect(result.orphanVectors).toBe(4);
  });
});
