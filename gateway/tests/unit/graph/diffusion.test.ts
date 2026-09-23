import { personalizedPageRank } from '../../../src/graph/diffusion';

// 小图：seed a → b(1.0), c(1.0)；b → d(1.0)
function graph(edges: Record<string, Record<string, number>>) {
  return (id: string) => new Map(Object.entries(edges[id] ?? {}));
}

describe('personalizedPageRank', () => {
  const opts = { alpha: 0.85, iterations: 20, candidateCap: 50 };

  test('seeds 自身与近邻得分高于远端无关节点', () => {
    const edges = { a: { b: 1, c: 1 }, b: { a: 1, d: 1 }, c: { a: 1 }, d: { b: 1 } };
    const scores = personalizedPageRank(['a'], graph(edges), opts);
    expect(scores.get('a')!).toBeGreaterThan(scores.get('b')!);
    expect(scores.get('b')!).toBeGreaterThan(scores.get('d')!);
    expect(scores.get('c')).toBeDefined();
  });

  test('结果按最大值归一到 0–1', () => {
    const edges = { a: { b: 1 }, b: { a: 1 } };
    const scores = personalizedPageRank(['a'], graph(edges), opts);
    expect(Math.max(...scores.values())).toBeCloseTo(1, 5);
  });

  test('空种子返回空 Map', () => {
    expect(personalizedPageRank([], graph({}), opts).size).toBe(0);
  });

  test('candidateCap 限制子图节点数', () => {
    const edges: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 200; i++) edges[`n${i}`] = { [`n${i + 1}`]: 1 };
    const scores = personalizedPageRank(['n0'], graph(edges), { alpha: 0.85, iterations: 5, candidateCap: 10 });
    expect(scores.size).toBeLessThanOrEqual(10);
  });

  test('alpha=0 时只有种子得分', () => {
    const edges = { a: { b: 1 }, b: { a: 1 } };
    const scores = personalizedPageRank(['a'], graph(edges), { alpha: 0, iterations: 5, candidateCap: 50 });
    expect(scores.get('a')).toBeCloseTo(1, 5);
    expect(scores.get('b') ?? 0).toBe(0);
  });
});
