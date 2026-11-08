import { runEmbeddingBackfill } from '../../src/memory/embedding-backfill';

function fakeRuntime() {
  const calls: string[][] = [];
  return {
    calls,
    runtime: {
      indexer: {
        backfill: async (ids: string[]) => {
          calls.push(ids);
          return { indexed: Math.min(2, ids.length), skipped: Math.max(0, ids.length - 2), missing: 0 };
        },
      },
      vectors: { size: () => 42 },
    },
  };
}

describe('runEmbeddingBackfill', () => {
  test('no embedding runtime → no-op summary (dense channel off)', async () => {
    const r = await runEmbeddingBackfill(null, ['a']);
    expect(r).toEqual({ ok: true, skippedNoProvider: true, indexed: 0, skipped: 0, missing: 0, vectors: 0 });
  });

  test('passes every index id and reports counts', async () => {
    const f = fakeRuntime();
    const r = await runEmbeddingBackfill(f.runtime, ['a', 'b', 'c', 'd']);
    expect(f.calls).toEqual([['a', 'b', 'c', 'd']]);
    expect(r).toEqual({ ok: true, skippedNoProvider: false, indexed: 2, skipped: 2, missing: 0, vectors: 42 });
  });

  test('a throwing indexer is reported, never thrown (daily job must not fail decay)', async () => {
    const r = await runEmbeddingBackfill(
      { indexer: { backfill: async () => { throw new Error('fetch failed'); } }, vectors: { size: () => 1 } },
      ['a'],
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('fetch failed');
    expect(r.vectors).toBe(1);
  });
});
