import { runRerankerConformance } from '../../helpers/kernel-v2/reranker-conformance';

test('a valid reranker preserves candidates and respects topK', async () => {
  const candidates = [
    { entry: { id: 'a' }, score: 1 },
    { entry: { id: 'b' }, score: 0.5 },
  ] as any;

  const good = {
    name: 'good',
    strategy: 'good',
    rerank: (_query: string, items: any[], topK: number) => items.slice(0, topK),
  };
  expect(await runRerankerConformance(good, candidates)).toEqual([]);

  const bad = {
    name: 'bad',
    strategy: 'bad',
    rerank: () => [{ entry: { id: 'ghost' }, score: 1 }],
  };
  const errors = await runRerankerConformance(bad as any, candidates);
  expect(errors.join('\n')).toMatch(/unknown|subset/);

  const empty = { name: 'empty', strategy: 'empty', rerank: () => [] };
  expect((await runRerankerConformance(empty, candidates)).join('\n')).toMatch(/no candidates/);
});
