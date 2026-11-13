import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initEmbeddingRuntime, setEmbeddingRuntime } from '../../src/memory/embedding-runtime';
import type { EmbeddingProvider } from '../../src/memory/embedding-provider';

function fakeProvider(name: string, vector: number[]): EmbeddingProvider {
  return {
    name,
    modelTag: name,
    dims: vector.length,
    embed: async (texts) => texts.map(() => vector),
  };
}

describe('embedding provider switch', () => {
  test('switching provider keeps the old namespace and rolls back without re-embedding', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-switch-'));
    const a = fakeProvider('fake-a', [1, 0]);
    const b = fakeProvider('fake-b', [0, 1]);

    const rtA = initEmbeddingRuntime({ baseDir: dir, provider: a, providerId: 'fake-a' })!;
    rtA.indexer.enqueueText('u1', 'alpha');
    await rtA.indexer.flushQueue();
    const fileA = rtA.namespace.vectorFile;
    expect(fs.existsSync(fileA)).toBe(true);

    const rtB = initEmbeddingRuntime({ baseDir: dir, provider: b, providerId: 'fake-b' })!;
    rtB.indexer.enqueueText('u1', 'alpha');
    await rtB.indexer.flushQueue();
    expect(fileA).not.toBe(rtB.namespace.vectorFile);
    expect(fs.existsSync(fileA)).toBe(true);

    setEmbeddingRuntime(null);
    const back = initEmbeddingRuntime({ baseDir: dir, provider: a, providerId: 'fake-a' })!;
    expect(back.vectors.get('u1')).toEqual([1, 0]);
    setEmbeddingRuntime(null);
  });
});
