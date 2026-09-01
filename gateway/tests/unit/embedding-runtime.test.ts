/**
 * EmbeddingRuntime singleton wiring (P1): provider + vector store + indexer,
 * plus the query-side dense-score helper used by search entry points.
 */
import { setEmbeddingRuntime, getEmbeddingRuntime, computeDenseScores, EmbeddingRuntime } from '../../src/memory/embedding-runtime';
import { MemoryVectorStore } from '../../src/memory/vector-store';
import { EmbeddingProvider } from '../../src/memory/embedding-provider';

function stubRuntime(vectorsByText: Record<string, number[]>): EmbeddingProvider {
  return {
    name: 'stub',
    dims: 2,
    embed: async (texts, kind) => {
      if (kind === 'query') {
        // query "zzz" → nearest to id "near"
        return [texts[0] === 'zzz' ? [1, 0] : [0, 1]];
      }
      return texts.map(t => {
        const v = vectorsByText[t];
        if (!v) throw new Error('no vec ' + t);
        return v;
      });
    },
  };
}

describe('embedding-runtime', () => {
  test('computeDenseScores returns null when runtime absent', async () => {
    setEmbeddingRuntime(null);
    expect(getEmbeddingRuntime()).toBeNull();
    expect(await computeDenseScores('q', 5)).toBeNull();
  });

  test('computeDenseScores maps cosine hits to id → score map', async () => {
    const vectors = new MemoryVectorStore('/tmp/does-not-matter.json', 2);
    vectors.upsert('near', [1, 0]);
    vectors.upsert('far', [0, 1]);
    const rt = { provider: stubRuntime({}), vectors, indexer: {} as any, scheduleFlush: () => {} };
    setEmbeddingRuntime(rt);
    try {
      const scores = await computeDenseScores('zzz', 5);
      expect(scores).not.toBeNull();
      expect(scores!.get('near')).toBeCloseTo(1);
      expect(scores!.get('far')).toBeCloseTo(0);
    } finally {
      setEmbeddingRuntime(null);
    }
  });

  test('computeDenseScores fail-open: provider error → null', async () => {
    const rt = {
      provider: {
        name: 'boom',
        dims: 2,
        embed: async () => { throw new Error('down'); },
      } as EmbeddingProvider,
      vectors: new MemoryVectorStore('/tmp/does-not-matter.json', 2),
      indexer: {} as any,
      scheduleFlush: () => {},
    };
    setEmbeddingRuntime(rt);
    try {
      expect(await computeDenseScores('q', 5)).toBeNull();
    } finally {
      setEmbeddingRuntime(null);
    }
  });
});
