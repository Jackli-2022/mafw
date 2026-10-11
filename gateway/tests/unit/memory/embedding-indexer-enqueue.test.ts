import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EmbeddingIndexer, MemoryVectorStore } from '../../../src/memory/vector-store';

class FakeProvider {
  name = 'fake-embed';
  dims = 4;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(t => [t.length, 1, 0, 0]);
  }
}

describe('EmbeddingIndexer.enqueueText', () => {
  test('enqueues raw text (not documentText), flushes into the vector store', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-enq-'));
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 4, 'fake');
    const indexer = new EmbeddingIndexer({ vectors: vectors as any, provider: new FakeProvider() as any });
    indexer.enqueueText('k1', 'raw verbatim content');
    const r = await indexer.flushQueue();
    expect(r.indexed).toBe(1);
    expect(vectors.get('k1')).toEqual([20, 1, 0, 0]);
  });
  test('overwrites same id (idempotent upsert)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-enq2-'));
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 4, 'fake');
    const indexer = new EmbeddingIndexer({ vectors: vectors as any, provider: new FakeProvider() as any });
    indexer.enqueueText('k1', 'a');
    indexer.enqueueText('k1', 'longer text');
    await indexer.flushQueue();
    expect(vectors.get('k1')).toEqual([11, 1, 0, 0]);
  });
});
