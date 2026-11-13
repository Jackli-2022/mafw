import * as fs from 'fs';
import * as path from 'path';

test('kernel wires the embedding registry and keeps route-write deps live', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../src/kernel.ts'),
    'utf8',
  );
  expect(source).toContain('createEmbeddingProviderRegistry');
  expect(source).toContain('initEmbeddingRuntime({');
  expect(source).toContain('wireRouteWriteDeps(mafwDir)');
  expect(source).toContain('old.dispose?.()');
  expect(source).toContain('lastEmbeddingConfigKey');
});
