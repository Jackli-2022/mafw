import {
  computeAnchorBaselines,
  selectCalibratedAtoms,
} from '../../../src/recall/t1-atom-calibration';

const anchors = Array.from({ length: 12 }, (_, i) => `c${i}`);
const BASELINES = Array(12).fill(0.5);

describe('computeAnchorBaselines', () => {
  test('averages the cosine to each anchor over the reference texts', () => {
    const anchorVectors = [
      [1, 0],
      [0, 1],
    ];
    const referenceVectors = [
      [1, 0],
      [1, 1],
    ];
    const [a0, a1] = computeAnchorBaselines(anchorVectors, referenceVectors);
    expect(a0).toBeCloseTo(0.8536, 3);
    expect(a1).toBeCloseTo(0.3536, 3);
  });

  test('empty reference population yields zero baselines', () => {
    expect(computeAnchorBaselines([[1, 0]], [])).toEqual([0]);
  });
});

describe('selectCalibratedAtoms', () => {
  test('flat text yields zero atoms', () => {
    const raw = anchors.map((termId) => ({ termId, cosine: 0.5 }));
    expect(selectCalibratedAtoms(raw, BASELINES)).toEqual([]);
  });

  test('a hub anchor at its baseline contributes nothing', () => {
    const raw = anchors.map((termId, i) => ({ termId, cosine: i === 0 ? 0.6 : 0.5 }));
    const baselines = [0.6, ...Array(11).fill(0.5)];
    expect(selectCalibratedAtoms(raw, baselines)).toEqual([]);
  });

  test('the single standing-out atom survives with its centered score', () => {
    const raw = anchors.map((termId, i) => ({ termId, cosine: i === 3 ? 0.72 : 0.5 }));
    const out = selectCalibratedAtoms(raw, BASELINES);
    expect(out).toHaveLength(1);
    expect(out[0].termId).toBe('c3');
    expect(out[0].score).toBeCloseTo(0.2017, 3);
  });

  test('top2 keeps the runner-up only when it stands out', () => {
    const raw = anchors.map((termId, i) => ({
      termId,
      cosine: i === 3 ? 0.72 : i === 4 ? 0.65 : 0.5,
    }));
    expect(selectCalibratedAtoms(raw, BASELINES).map((a) => a.termId)).toEqual(['c3', 'c4']);
  });

  test('minTop1 suppresses a weak best atom', () => {
    const raw = anchors.map((termId, i) => ({ termId, cosine: i === 0 ? 0.54 : 0.5 }));
    expect(selectCalibratedAtoms(raw, BASELINES)).toEqual([]);
  });

  test('ties break by termId for determinism', () => {
    const raw = [
      { termId: 'b', cosine: 0.72 },
      { termId: 'a', cosine: 0.72 },
      { termId: 'c', cosine: 0.5 },
    ];
    const out = selectCalibratedAtoms(raw, [0.5, 0.5, 0.5]);
    expect(out.map((a) => a.termId)).toEqual(['a', 'b']);
  });
});
