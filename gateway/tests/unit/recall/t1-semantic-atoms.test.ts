import {
  buildConceptAnchors,
  cosineSimilarity,
  getT1SemanticEncoder,
  T1SemanticEncoder,
} from '../../../src/recall/t1-semantic-atoms';

function fakeEmbedder() {
  const calls: number[] = [];
  const embed = jest.fn(async (texts: string[]) => {
    calls.push(texts.length);
    return texts.map((text) => {
      const value = text.toLowerCase();
      return [
        /unparse|json|parse/.test(value) ? 1 : 0,
        /cover/.test(value) ? 1 : 0,
        /merge|consolidat/.test(value) ? 1 : 0,
      ];
    });
  });
  return { embed, calls };
}

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

  test('encodeMany emits atoms above threshold and batches turns', async () => {
    const embedder = fakeEmbedder();
    const encoder = new T1SemanticEncoder(embedder as any, {
      anchors: [
        { termId: 'error:json_parse', text: 'unparseable' },
        { termId: 'metric:coverage', text: 'coverage' },
      ],
    });

    const map = await encoder.encodeMany([
      { traceId: 't1t_a', text: 'unparseable JSON' },
      { traceId: 't1t_b', text: 'weather tomorrow' },
    ]);

    expect(map.get('t1t_a')).toContainEqual({ termId: 'error:json_parse', score: 1 });
    expect(map.has('t1t_b')).toBe(false);
    // One embed call for the anchors, one for the two turn texts.
    expect(embedder.calls).toEqual([2, 2]);

    const second = await encoder.encodeMany([{ traceId: 't1t_c', text: 'coverage' }]);
    expect(second.get('t1t_c')).toContainEqual({ termId: 'metric:coverage', score: 1 });
    // Anchor vectors are cached; only the new turn is embedded.
    expect(embedder.calls).toEqual([2, 2, 1]);
    expect(encoder.cachedAnchors).toBe(2);
  });

  test('respects the minimum cosine and max atoms', async () => {
    const embedder = fakeEmbedder();
    const encoder = new T1SemanticEncoder(embedder as any, {
      minCosine: 0.99,
      maxAtoms: 1,
      anchors: [
        { termId: 'error:json_parse', text: 'unparseable' },
        { termId: 'metric:coverage', text: 'coverage' },
      ],
    });
    const map = await encoder.encodeMany([{ traceId: 't1t_a', text: 'unparseable coverage' }]);
    // Both anchors score 1/√2 ≈ 0.707, below 0.99.
    expect(map.has('t1t_a')).toBe(false);
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
