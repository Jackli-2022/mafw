/**
 * P1b: MemoryVectorStore (persistent cosine index) + EmbeddingIndexer
 * (write-path async embedding, backfill).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { MemoryVectorStore, EmbeddingIndexer } from '../../src/memory/vector-store';
import { EmbeddingProvider } from '../../src/memory/embedding-provider';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-vec-'));
}

function stubProvider(vectors: Record<string, number[]>): EmbeddingProvider {
  return {
    name: 'stub',
    dims: 2,
    embed: async (texts: string[]) => texts.map(t => {
      if (!vectors[t]) throw new Error('no vector for ' + t);
      return vectors[t];
    }),
  };
}

describe('MemoryVectorStore', () => {
  test('upsert / get / remove / size round-trip in memory', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'vectors-test.json');
    const store = new MemoryVectorStore(file, 2);

    expect(store.size()).toBe(0);
    store.upsert('a', [1, 0]);
    store.upsert('b', [0, 1]);
    expect(store.size()).toBe(2);
    expect(store.get('a')).toEqual([1, 0]);

    store.remove('a');
    expect(store.size()).toBe(1);
    expect(store.get('a')).toBeUndefined();
  });

  test('flush persists atomically and reloads', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'vectors-test.json');
    const store = new MemoryVectorStore(file, 2);
    store.upsert('a', [1, 0]);
    store.upsert('b', [0, 1]);
    store.flush();

    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(file + '.tmp')).toBe(false);

    const reloaded = new MemoryVectorStore(file, 2);
    expect(reloaded.size()).toBe(2);
    expect(reloaded.get('b')).toEqual([0, 1]);
  });

  test('searchByCosine ranks by cosine similarity desc and respects topK', () => {
    const dir = tmpDir();
    const store = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    store.upsert('same', [1, 0]);
    store.upsert('orthogonal', [0, 1]);
    store.upsert('opposite', [-1, 0]);

    const hits = store.searchByCosine([1, 0], 3);
    expect(hits).toHaveLength(3);
    expect(hits[0].id).toBe('same');
    expect(hits[0].cosine).toBeCloseTo(1);
    expect(hits[1].id).toBe('orthogonal');
    expect(hits[1].cosine).toBeCloseTo(0);
    expect(hits[2].id).toBe('opposite');
    expect(hits[2].cosine).toBeCloseTo(-1);
  });

  test('searchByCosine skips entries with dimension mismatch', () => {
    const dir = tmpDir();
    const store = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    store.upsert('ok', [1, 0]);
    store.upsert('bad', [1, 0, 0]);

    const hits = store.searchByCosine([1, 0], 5);
    expect(hits.map(h => h.id)).toEqual(['ok']);
  });
});

describe('EmbeddingIndexer', () => {
  test('flushQueue embeds document text (abstraction + value) and upserts vectors', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    const embedded: string[] = [];
    const provider: EmbeddingProvider = {
      name: 'stub',
      dims: 2,
      embed: async (texts, kind) => {
        expect(kind).toBe('document');
        embedded.push(...texts);
        return texts.map((_, i) => [i, 1]);
      },
    };
    const indexer = new EmbeddingIndexer({ vectors, provider });

    indexer.onUnitWritten({ id: 'u1', primary_abstraction: 'Abs A', memory_value: 'value one' } as any);
    indexer.onUnitWritten({ id: 'u2', primary_abstraction: 'Abs B', memory_value: 'value two' } as any);
    await indexer.flushQueue();

    expect(embedded).toEqual(['Abs A\nvalue one', 'Abs B\nvalue two']);
    expect(vectors.get('u1')).toEqual([0, 1]);
    expect(vectors.get('u2')).toEqual([1, 1]);
  });

  test('document text is capped to avoid pathological values', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    const embedded: string[] = [];
    const provider: EmbeddingProvider = {
      name: 'stub',
      dims: 2,
      embed: async (texts) => {
        embedded.push(...texts);
        return texts.map(() => [1, 0]);
      },
    };
    const indexer = new EmbeddingIndexer({ vectors, provider });

    indexer.onUnitWritten({ id: 'u1', primary_abstraction: 'A', memory_value: 'x'.repeat(10000) } as any);
    await indexer.flushQueue();

    expect(embedded[0].length).toBeLessThanOrEqual(2100);
  });

  test('embedding failure is fail-open (item dropped, no throw)', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    const provider: EmbeddingProvider = {
      name: 'stub',
      dims: 2,
      embed: async () => { throw new Error('provider down'); },
    };
    const indexer = new EmbeddingIndexer({ vectors, provider });

    indexer.onUnitWritten({ id: 'u1', primary_abstraction: 'A', memory_value: 'v' } as any);
    await expect(indexer.flushQueue()).resolves.not.toThrow();
    expect(vectors.size()).toBe(0);
  });

  test('backfill indexes only entries missing vectors and returns counts', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    const seen: string[] = [];
    const provider: EmbeddingProvider = {
      name: 'stub',
      dims: 2,
      embed: async (texts) => {
        seen.push(...texts);
        return texts.map(t => (t.startsWith('abs old') ? [1, 0] : [0, 1]));
      },
    };
    const indexer = new EmbeddingIndexer({
      vectors,
      provider,
      getTextForId: async (id) => id === 'e1' ? 'abs old\nold value' : id === 'e2' ? 'abs new\nnew value' : null,
    });

    vectors.upsert('e2', [0, 1]); // e2 already indexed

    const result = await indexer.backfill(['e1', 'e2', 'e3']);
    expect(result).toEqual({ indexed: 1, skipped: 1, missing: 1 });
    expect(seen).toEqual(['abs old\nold value']);
    expect(vectors.get('e1')).toEqual([1, 0]);
  });

  test('removeUnit drops the vector', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    const indexer = new EmbeddingIndexer({ vectors, provider: stubProvider({}) });
    vectors.upsert('gone', [1, 1]);

    indexer.removeUnit('gone');
    expect(vectors.get('gone')).toBeUndefined();
  });
});
