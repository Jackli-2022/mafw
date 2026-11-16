import {
  buildConceptAnchors,
  cosineSimilarity,
  DEFAULT_REFERENCE_TEXTS,
  getT1AtomCalibration,
  getT1SemanticEncoder,
  resetT1AtomCalibration,
  T1SemanticEncoder,
} from '../../../src/recall/t1-semantic-atoms';

const ANCHORS_4 = [
  { termId: 'error:json_parse', text: 'a0' },
  { termId: 'metric:coverage', text: 'a1' },
  { termId: 'action:merge', text: 'a2' },
  { termId: 'action:deploy', text: 'a3' },
];

/** 4-dim fake: known anchors are one-hot, signals compose, everything else is neutral. */
function vectorFor(text: string): number[] {
  const value = text.toLowerCase();
  if (value === 'a0') return [1, 0, 0, 0];
  if (value === 'a1') return [0, 1, 0, 0];
  if (value === 'a2') return [0, 0, 1, 0];
  if (value === 'a3') return [0, 0, 0, 1];
  const vector = [0, 0, 0, 0];
  if (/unparse|json|parse/.test(value)) vector[0] = 1;
  if (/cover/.test(value)) vector[1] = 1;
  if (/merge|consolidat/.test(value)) vector[2] = 1;
  if (/deploy/.test(value)) vector[3] = 1;
  return vector.some((value) => value > 0) ? vector : [1, 1, 1, 1];
}

function fakeEmbedder() {
  const calls: number[] = [];
  const embed = jest.fn(async (texts: string[]) => {
    calls.push(texts.length);
    return texts.map(vectorFor);
  });
  return { embed, calls };
}

beforeEach(() => {
  resetT1AtomCalibration();
});

describe('T1 semantic atoms', () => {
  test('builds one anchor per concept', () => {
    const anchors = buildConceptAnchors();
    expect(new Set(anchors.map((a) => a.termId)).size).toBe(anchors.length);
    expect(anchors).toContainEqual({ termId: 'error:json_parse', text: 'unparseable' });
    expect(anchors).toContainEqual({ termId: 'metric:coverage', text: 'coverage' });
  });

  test('cosineSimilarity handles empty and mismatched vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 0], [1])).toBe(0);
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
  });

  test('calibrated encode keeps the standing-out atom and batches turns', async () => {
    const embedder = fakeEmbedder();
    const encoder = new T1SemanticEncoder(embedder as any, {
      anchors: ANCHORS_4,
      referenceTexts: () => ['ref-a', 'ref-b'],
    });

    const map = await encoder.encodeMany([
      { traceId: 't1t_a', text: 'unparseable JSON' },
      { traceId: 't1t_b', text: 'weather tomorrow' },
    ]);

    expect(map.get('t1t_a')).toHaveLength(1);
    expect(map.get('t1t_a')![0].termId).toBe('error:json_parse');
    // neutral text abstains instead of being forced onto the nearest concept
    expect(map.has('t1t_b')).toBe(false);
    // One call for anchors, one for references, one for the two turn texts.
    expect(embedder.calls).toEqual([4, 2, 2]);

    const second = await encoder.encodeMany([{ traceId: 't1t_c', text: 'coverage' }]);
    expect(second.get('t1t_c')![0]).toMatchObject({ termId: 'metric:coverage' });
    // Anchors and references are cached; only the new turn is embedded.
    expect(embedder.calls).toEqual([4, 2, 2, 1]);
    expect(encoder.cachedAnchors).toBe(4);
  });

  test('two signals survive as top2 with equal centered scores', async () => {
    const encoder = new T1SemanticEncoder(fakeEmbedder() as any, {
      anchors: ANCHORS_4,
      referenceTexts: () => ['ref'],
    });
    const map = await encoder.encodeMany([{ traceId: 't1t_a', text: 'unparseable coverage' }]);
    const atoms = map.get('t1t_a')!;
    expect(atoms.map((a) => a.termId)).toEqual(['error:json_parse', 'metric:coverage']);
    expect(atoms[0].score).toBeCloseTo(0.3536, 3);
  });

  test('referenceTexts computes calibration once and records the population size', async () => {
    const embedder = fakeEmbedder();
    const encoder = new T1SemanticEncoder(embedder as any, {
      anchors: ANCHORS_4,
      referenceTexts: () => ['ref-a', 'ref-b'],
    });
    await encoder.encodeMany([{ traceId: 'a', text: 'x' }]);
    expect(getT1AtomCalibration()).toMatchObject({ anchors: 4, referenceCount: 2 });
    const callsAfterFirst = embedder.embed.mock.calls.length;
    await encoder.encodeMany([{ traceId: 'b', text: 'y' }]);
    expect(embedder.embed.mock.calls.length).toBe(callsAfterFirst + 1);
  });

  test('an empty reference list falls back to the built-in population', async () => {
    const encoder = new T1SemanticEncoder(fakeEmbedder() as any, {
      anchors: ANCHORS_4,
      referenceTexts: () => [],
    });
    await encoder.encodeMany([{ traceId: 'a', text: 'x' }]);
    expect(getT1AtomCalibration()!.referenceCount).toBe(DEFAULT_REFERENCE_TEXTS.length);
  });

  test('injected baselines skip the reference embedding entirely', async () => {
    const embedder = fakeEmbedder();
    const encoder = new T1SemanticEncoder(embedder as any, {
      anchors: ANCHORS_4,
      baselines: [0.5, 0.5, 0.5, 0.5],
    });
    await encoder.encodeMany([{ traceId: 'a', text: 'unparseable JSON' }]);
    expect(embedder.calls).toEqual([4, 1]);
    expect(encoder.calibrationSnapshot).toMatchObject({ anchors: 4, referenceCount: 0 });
  });

  test('two encoders keep independent calibration', async () => {
    const embedA = fakeEmbedder();
    const embedB = fakeEmbedder();
    const a = new T1SemanticEncoder(embedA as any, {
      anchors: ANCHORS_4,
      baselines: [0.5, 0.5, 0.5, 0.5],
    });
    const b = new T1SemanticEncoder(embedB as any, {
      anchors: ANCHORS_4,
      baselines: [0.2, 0.2, 0.2, 0.2],
    });
    await a.encodeMany([{ traceId: 'x', text: 'unparseable JSON' }]);
    await b.encodeMany([{ traceId: 'y', text: 'unparseable JSON' }]);
    expect(a.calibrationSnapshot!.baselines).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(b.calibrationSnapshot!.baselines).toEqual([0.2, 0.2, 0.2, 0.2]);
    expect(embedA.embed).toHaveBeenCalled();
    expect(embedB.embed).toHaveBeenCalled();
  });

  test('legacy minCosine/maxAtoms do not override calibration', async () => {
    const encoder = new T1SemanticEncoder(fakeEmbedder() as any, {
      anchors: ANCHORS_4,
      referenceTexts: () => ['ref'],
      minCosine: 0.99,
      maxAtoms: 1,
    });
    const map = await encoder.encodeMany([{ traceId: 'a', text: 'unparseable coverage' }]);
    expect(map.get('a')).toHaveLength(2);
  });

  test('provider failure is fail-open', async () => {
    const encoder = new T1SemanticEncoder({
      embed: async () => {
        throw new Error('embedding down');
      },
    });
    expect(await encoder.encodeMany([{ traceId: 't1t_a', text: 'anything' }])).toEqual(
      new Map(),
    );
  });

  test('encoder cache is per embedder instance', () => {
    const embedder = {} as any;
    expect(getT1SemanticEncoder(embedder)).toBe(getT1SemanticEncoder(embedder));
    expect(getT1SemanticEncoder({} as any)).not.toBe(getT1SemanticEncoder(embedder));
  });
});
