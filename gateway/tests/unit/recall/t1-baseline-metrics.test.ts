import { recallAtK, mrr, summarize } from '../../../../evaluation/t1/src/metrics';

describe('T1 baseline metrics', () => {
  test('recall@k counts expected ids in the top-k', () => {
    expect(recallAtK(['a'], ['a', 'b'], 1)).toBe(1);
    expect(recallAtK(['a'], ['b', 'a'], 1)).toBe(0);
    expect(recallAtK(['a', 'b'], ['a', 'x', 'b'], 3)).toBe(1);
    expect(recallAtK(['a', 'b'], ['a'], 3)).toBe(0.5);
  });

  test('no-answer cases only pass when the channel returns nothing', () => {
    expect(recallAtK([], [], 3)).toBe(1);
    expect(recallAtK([], ['x'], 3)).toBe(0);
  });

  test('MRR uses the first expected hit rank', () => {
    expect(mrr(['b'], ['a', 'b'])).toBe(0.5);
    expect(mrr(['a'], ['a'])).toBe(1);
    expect(mrr(['a'], ['b'])).toBe(0);
    expect(mrr([], [])).toBe(1);
  });

  test('summarize aggregates recall, MRR and no-answer accuracy', () => {
    const summary = summarize(
      [
        { expected: ['a'], actual: ['a'] },
        { expected: ['b'], actual: ['x', 'b'] },
        { expected: [], actual: [] },
      ],
      3,
    );
    expect(summary.cases).toBe(3);
    expect(summary.recall).toBeCloseTo(1, 6);
    expect(summary.mrr).toBeCloseTo((1 + 0.5 + 1) / 3, 6);
    expect(summary.noAnswer).toBe(1);
  });
});
