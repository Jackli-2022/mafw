import { runEmbeddingConformance } from '../../helpers/kernel-v2/embedding-conformance';

test('a complete provider passes and a broken one reports errors', async () => {
  const good = {
    name: 'good',
    modelTag: 'good',
    dims: 2,
    maxInputTokens: 128,
    batchLimit: 2,
    embed: async (texts: string[]) => texts.map(() => [1, 0]),
  };
  expect(await runEmbeddingConformance(good)).toEqual([]);

  const bad = {
    name: '',
    dims: 0,
    embed: async () => [[1, 2, 3]],
  };
  const errors = await runEmbeddingConformance(bad as any);
  expect(errors.join('\n')).toMatch(/name|dims|vector length/);
});
