import { reciprocalRankFusion, diversifyByLoop, RRFResult } from '../../gateway/src/core/compression/rrf-fusion';

describe('reciprocalRankFusion', () => {
  test('two lists with overlap: overlapping items get higher score', () => {
    const list1: RRFResult[] = [
      { id: 'a', score: 10 },
      { id: 'b', score: 9 },
      { id: 'c', score: 8 },
    ];
    const list2: RRFResult[] = [
      { id: 'b', score: 9 },
      { id: 'c', score: 8 },
      { id: 'd', score: 7 },
    ];
    const result = reciprocalRankFusion(list1, list2);
    expect(result.length).toBe(4);
    expect(result[0].id).toBe('b');
    expect(result[1].id).toBe('c');
    expect(result[0].score).toBeGreaterThan(result[2].score);
  });

  test('single list returns same order', () => {
    const list: RRFResult[] = [
      { id: 'x', score: 100 },
      { id: 'y', score: 50 },
      { id: 'z', score: 10 },
    ];
    const result = reciprocalRankFusion(list);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('x');
    expect(result[1].id).toBe('y');
    expect(result[2].id).toBe('z');
  });

  test('three lists', () => {
    const list1: RRFResult[] = [
      { id: 'a', score: 1 },
      { id: 'b', score: 1 },
    ];
    const list2: RRFResult[] = [
      { id: 'b', score: 1 },
      { id: 'c', score: 1 },
    ];
    const list3: RRFResult[] = [
      { id: 'a', score: 1 },
      { id: 'c', score: 1 },
    ];
    const result = reciprocalRankFusion(list1, list2, list3);
    expect(result).toHaveLength(3);
    for (const item of result) {
      expect(item.score).toBeGreaterThan(0);
    }
  });

  test('empty lists', () => {
    const result = reciprocalRankFusion([], [], []);
    expect(result).toEqual([]);
  });

  test('no arguments returns empty', () => {
    const result = reciprocalRankFusion();
    expect(result).toEqual([]);
  });

  test('overload with custom k value', () => {
    const list1: RRFResult[] = [
      { id: 'a', score: 10 },
      { id: 'b', score: 9 },
    ];
    const list2: RRFResult[] = [
      { id: 'b', score: 9 },
      { id: 'c', score: 8 },
    ];
    const resultSmallK = reciprocalRankFusion(1, list1, list2);
    const resultDefaultK = reciprocalRankFusion(list1, list2);
    expect(resultSmallK[0].id).toBe('b');
    expect(resultSmallK[0].score).toBeGreaterThan(resultDefaultK[0].score);
  });

  test('items only in one list vs items in both', () => {
    const list1: RRFResult[] = [
      { id: 'a', score: 10 },
      { id: 'b', score: 9 },
      { id: 'c', score: 8 },
    ];
    const list2: RRFResult[] = [
      { id: 'b', score: 9 },
      { id: 'c', score: 8 },
      { id: 'd', score: 7 },
    ];
    const result = reciprocalRankFusion(list1, list2);
    const itemB = result.find(r => r.id === 'b')!;
    const itemD = result.find(r => r.id === 'd')!;
    expect(itemB.score).toBeGreaterThan(itemD.score);
  });

  test('metadata merging: later lists overwrite earlier', () => {
    const list1: RRFResult[] = [
      { id: 'a', score: 10, metadata: { source: 'first' } },
    ];
    const list2: RRFResult[] = [
      { id: 'a', score: 5, metadata: { source: 'second' } },
    ];
    const result = reciprocalRankFusion(list1, list2);
    expect(result).toHaveLength(1);
    expect(result[0].metadata).toEqual({ source: 'second' });
  });
});

describe('diversifyByLoop', () => {
  test('limits per-loop results', () => {
    const results: RRFResult[] = [
      { id: 'a', score: 3, loopNum: 1 },
      { id: 'b', score: 2, loopNum: 1 },
      { id: 'c', score: 1, loopNum: 1 },
      { id: 'd', score: 0.5, loopNum: 1 },
    ];
    const diversified = diversifyByLoop(results);
    expect(diversified).toHaveLength(3);
    expect(diversified.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  test('preserves order within limit', () => {
    const results: RRFResult[] = [
      { id: 'z', score: 5, loopNum: 2 },
      { id: 'y', score: 4, loopNum: 2 },
      { id: 'x', score: 3, loopNum: 1 },
      { id: 'w', score: 2, loopNum: 2 },
    ];
    const diversified = diversifyByLoop(results, 2);
    expect(diversified).toHaveLength(3);
    expect(diversified[0].id).toBe('z');
    expect(diversified[1].id).toBe('y');
    expect(diversified[2].id).toBe('x');
  });

  test('no loopNum items are not filtered', () => {
    const results: RRFResult[] = [
      { id: 'a', score: 3, loopNum: 1 },
      { id: 'b', score: 2 },
      { id: 'c', score: 1, loopNum: 1 },
      { id: 'd', score: 0.5, loopNum: 1 },
    ];
    const diversified = diversifyByLoop(results, 2);
    expect(diversified).toHaveLength(3);
    expect(diversified.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  test('empty results', () => {
    const diversified = diversifyByLoop([]);
    expect(diversified).toEqual([]);
  });

  test('maxPerLoop = 1', () => {
    const results: RRFResult[] = [
      { id: 'a', score: 3, loopNum: 1 },
      { id: 'b', score: 2, loopNum: 1 },
      { id: 'c', score: 1, loopNum: 2 },
      { id: 'd', score: 0.5, loopNum: 2 },
    ];
    const diversified = diversifyByLoop(results, 1);
    expect(diversified).toHaveLength(2);
    expect(diversified.map(r => r.id)).toEqual(['a', 'c']);
  });

  test('overall ranking of fused + diversified', () => {
    const list1: RRFResult[] = [
      { id: 'a', score: 10, loopNum: 1 },
      { id: 'b', score: 9, loopNum: 1 },
      { id: 'c', score: 8, loopNum: 2 },
    ];
    const list2: RRFResult[] = [
      { id: 'b', score: 9, loopNum: 1 },
      { id: 'c', score: 8, loopNum: 2 },
      { id: 'd', score: 7, loopNum: 2 },
    ];
    const fused = reciprocalRankFusion(list1, list2);
    const diversified = diversifyByLoop(fused, 1);
    expect(diversified).toHaveLength(2);
    const loopNums = diversified.map(r => r.loopNum);
    expect(loopNums).toContain(1);
    expect(loopNums).toContain(2);
  });

  test('default maxPerLoop is 3', () => {
    const results: RRFResult[] = [
      { id: 'a', score: 5, loopNum: 1 },
      { id: 'b', score: 4, loopNum: 1 },
      { id: 'c', score: 3, loopNum: 1 },
      { id: 'd', score: 2, loopNum: 1 },
      { id: 'e', score: 1, loopNum: 1 },
    ];
    const diversified = diversifyByLoop(results);
    expect(diversified).toHaveLength(3);
  });
});
