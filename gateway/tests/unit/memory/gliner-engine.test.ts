import { buildGlinerInput, decodeGlinerOutput, GLINER_ENT, GLINER_SEP } from '../../../src/memory/gliner-engine';

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
