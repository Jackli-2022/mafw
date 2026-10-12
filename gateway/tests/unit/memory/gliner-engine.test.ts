import { buildGlinerInput, decodeGlinerOutput, GLINER_ENT, GLINER_SEP, glinerAugmentListener, setGlinerForTest } from '../../../src/memory/gliner-engine';

describe('GLiNER pure helpers (V2 ①c)', () => {
  it('buildGlinerInput: label segments precede the text segment', () => {
    const ids = buildGlinerInput({ labelIds: [128001, 10, 128002], textIds: [128001, 20, 21, 128002] });
    expect(ids).toEqual([128001, 10, 128002, 128001, 20, 21, 128002]);
  });

  it('GLINER_ENT/GLINER_SEP token ids match the published gliner_onnx_config', () => {
    expect(GLINER_ENT).toBe(128001);
    expect(GLINER_SEP).toBe(128002);
  });

  it('decodeGlinerOutput: top scoring span per label above threshold', () => {
    // logits layout: [numLabels][seqLen][seqLen] — label 0, span (3, 4) hot.
    const seq = 6, textStart = 3;
    const logits = new Float32Array(1 * seq * seq).fill(-5);
    logits[0 * seq * seq + 3 * seq + 4] = 4.5; // sigmoid ≈ 0.989
    const spans = decodeGlinerOutput(logits, {
      seqLen: seq, textStart, labels: ['tool'],
      tokens: ['a', 'b', 'c', 'BM25', 'cache', 'x'], threshold: 0.5, maxWidth: 12,
    });
    expect(spans).toEqual([{ label: 'tool', text: 'BM25 cache', score: expect.any(Number) }]);
    expect(spans[0].score).toBeGreaterThan(0.9);
  });

  it('decodeGlinerOutput: below threshold → no span', () => {
    const seq = 5, textStart = 2;
    const logits = new Float32Array(1 * seq * seq).fill(-5);
    logits[0 * seq * seq + 2 * seq + 3] = -1; // sigmoid ≈ 0.27
    const spans = decodeGlinerOutput(logits, {
      seqLen: seq, textStart, labels: ['tool'],
      tokens: ['a', 'b', 'x', 'y', 'z'], threshold: 0.5, maxWidth: 12,
    });
    expect(spans).toEqual([]);
  });
});

describe('glinerAugmentListener (V2 ①c wiring)', () => {
  function mkIndex(entries: any[]) {
    let saved = 0;
    return {
      getIndex: () => ({ entries }),
      save: () => { saved++; },
      savedCount: () => saved,
    };
  }

  afterEach(() => setGlinerForTest(undefined));

  it('fake engine spans augment cue_anchors (dedup + cap 10)', async () => {
    const entry = { id: 'u1', cue_anchors: ['bm25'], superseded_by: undefined };
    const idx = mkIndex([entry]);
    setGlinerForTest({
      extract: async () => [
        { label: 'tool', text: 'HarmonicIndexManager', score: 0.9 },
        { label: 'tool', text: 'BM25 Cache', score: 0.8 },
      ],
    });
    const flush = glinerAugmentListener({ index: idx as any });
    flush({ id: 'u1', memory_value: 'some text' });
    await new Promise(r => setTimeout(r, 20));
    expect(entry.cue_anchors).toEqual(['bm25', 'HarmonicIndexManager', 'BM25 Cache']);
    expect((idx as any).savedCount()).toBe(1);
  });

  it('null engine → no-op, no save', async () => {
    const entry = { id: 'u2', cue_anchors: ['x'] };
    const idx = mkIndex([entry]);
    setGlinerForTest(null);
    const flush = glinerAugmentListener({ index: idx as any });
    flush({ id: 'u2', memory_value: 'text' });
    await new Promise(r => setTimeout(r, 10));
    expect(entry.cue_anchors).toEqual(['x']);
    expect((idx as any).savedCount()).toBe(0);
  });

  it('superseded entry → skip', async () => {
    const entry = { id: 'u3', cue_anchors: ['x'], superseded_by: 'z' };
    const idx = mkIndex([entry]);
    setGlinerForTest({ extract: async () => [{ label: 'tool', text: 'thing', score: 0.9 }] });
    const flush = glinerAugmentListener({ index: idx as any });
    flush({ id: 'u3', memory_value: 'text' });
    await new Promise(r => setTimeout(r, 10));
    expect(entry.cue_anchors).toEqual(['x']);
    expect((idx as any).savedCount()).toBe(0);
  });
});
