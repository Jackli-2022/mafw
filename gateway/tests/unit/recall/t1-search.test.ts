import { createGatewayT1Search, fuseT1Hits } from '../../../src/recall/t1-search';
import { t1VectorKey } from '../../../src/recall/verbatim-recall';
import { config } from '../../../src/config';

function fakeRuntime(rowsByTurn: Record<string, any[]>, cosine = 0.9) {
  const content = Object.values(rowsByTurn)[0]?.[0]?.content ?? 'row';
  const key = t1VectorKey('s1', 1, content);
  return {
    provider: { embed: async () => [[1, 0]] },
    t1Vectors: {
      searchByCosine: () => [{ id: key, cosine }],
    },
  } as any;
}

describe('createGatewayT1Search', () => {
  test('no embedding runtime → empty and fail-open', async () => {
    const db = {
      readArchiveTurn: jest.fn(),
      readTurn: jest.fn(),
    } as any;
    const search = createGatewayT1Search(db, () => null);
    expect(await search('q', 3)).toEqual([]);
    expect(db.readArchiveTurn).not.toHaveBeenCalled();
  });

  test('prefers archive rows and exposes trace ids', async () => {
    const runtime = fakeRuntime({
      's1:1': [{ session_id: 's1', turn_id: 1, trace_id: 't1t_archive', source: 'user_input', content: 'row' }],
    });
    const db = {
      readArchiveTurn: jest.fn(() => [
        { session_id: 's1', turn_id: 1, trace_id: 't1t_archive', source: 'user_input', content: 'row' },
      ]),
      readTurn: jest.fn(() => []),
    } as any;
    const search = createGatewayT1Search(db, () => runtime);
    const hits = await search('q', 3);
    expect(hits).toHaveLength(1);
    expect(hits[0].traceId).toBe('t1t_archive');
    expect(db.readTurn).not.toHaveBeenCalled();
  });

  test('falls back to active rows when archive is empty', async () => {
    const runtime = fakeRuntime({
      's1:1': [{ session_id: 's1', turn_id: 1, trace_id: 't1t_live', source: 'user_input', content: 'row' }],
    });
    const db = {
      readArchiveTurn: jest.fn(() => []),
      readTurn: jest.fn(() => [
        { session_id: 's1', turn_id: 1, trace_id: 't1t_live', source: 'user_input', content: 'row' },
      ]),
    } as any;
    const search = createGatewayT1Search(db, () => runtime);
    const hits = await search('q', 3);
    expect(hits[0].traceId).toBe('t1t_live');
  });

  test('provider failure → empty (fail-open)', async () => {
    const runtime = {
      provider: { embed: async () => { throw new Error('embed down'); } },
      t1Vectors: { searchByCosine: () => [] },
    } as any;
    const db = { readArchiveTurn: () => [], readTurn: () => [] } as any;
    const search = createGatewayT1Search(db, () => runtime);
    expect(await search('q', 3)).toEqual([]);
  });

  test('lexical-only hit works without an embedding runtime', async () => {
    const db = {
      searchT1Lexical: () => [
        { traceId: 't1t_lex', sessionId: 's1', turnId: 2, source: 'tool_result', excerpt: 'ECONNRESET in gateway-db.ts', rank: -2 },
      ],
      readArchiveTurn: () => [],
      readTurn: () => [],
    } as any;
    const search = createGatewayT1Search(db, () => null);
    const hits = await search('ECONNRESET', 3);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      traceId: 't1t_lex',
      sessionId: 's1',
      turnId: 2,
      cosine: 0,
      excerpt: 'ECONNRESET in gateway-db.ts',
      sources: ['lexical'],
    });
    expect(hits[0].score).toBeGreaterThan(0);
  });

  test('dense and lexical hits on the same trace fuse into one result', async () => {
    const runtime = fakeRuntime({
      's1:1': [{ session_id: 's1', turn_id: 1, trace_id: 't1t_both', source: 'user_input', content: 'row' }],
    });
    const db = {
      searchT1Lexical: () => [
        { traceId: 't1t_both', sessionId: 's1', turnId: 1, source: 'user_input', excerpt: 'keyword excerpt', rank: -1 },
      ],
      readArchiveTurn: () => [
        { session_id: 's1', turn_id: 1, trace_id: 't1t_both', source: 'user_input', content: 'row' },
      ],
      readTurn: () => [],
    } as any;
    const search = createGatewayT1Search(db, () => runtime);
    const hits = await search('row', 3);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      traceId: 't1t_both',
      cosine: 0.9,
      excerpt: 'keyword excerpt',
    });
    expect(new Set(hits[0].sources)).toEqual(new Set(['dense', 'lexical']));
    expect(hits[0].score).toBeGreaterThan(1 / 60);
  });

  test('lexical failure leaves dense results usable', async () => {
    const runtime = fakeRuntime({
      's1:1': [{ session_id: 's1', turn_id: 1, trace_id: 't1t_dense', source: 'user_input', content: 'row' }],
    });
    const db = {
      searchT1Lexical: () => { throw new Error('fts down'); },
      readArchiveTurn: () => [
        { session_id: 's1', turn_id: 1, trace_id: 't1t_dense', source: 'user_input', content: 'row' },
      ],
      readTurn: () => [],
    } as any;
    const search = createGatewayT1Search(db, () => runtime);
    const hits = await search('q', 3);
    expect(hits).toHaveLength(1);
    expect(hits[0].traceId).toBe('t1t_dense');
    expect(hits[0].sources).toEqual(['dense']);
  });

  test('lexical disabled in config skips the lexical channel', async () => {
    const prev = config.recall.t1Recall.lexical;
    config.recall.t1Recall.lexical = false;
    try {
      const lexical = jest.fn(() => []);
      const db = { searchT1Lexical: lexical, readArchiveTurn: () => [], readTurn: () => [] } as any;
      const search = createGatewayT1Search(db, () => null);
      expect(await search('q', 3)).toEqual([]);
      expect(lexical).not.toHaveBeenCalled();
    } finally {
      config.recall.t1Recall.lexical = prev;
    }
  });
});

describe('fuseT1Hits', () => {
  test('ranks a hit present in both channels above single-channel hits', () => {
    const dense = [
      { sessionId: 's1', turnId: 1, traceId: 't1t_a', cosine: 0.9, excerpt: 'dense a' },
      { sessionId: 's1', turnId: 2, traceId: 't1t_b', cosine: 0.8, excerpt: 'dense b' },
    ];
    const lexical = [
      { traceId: 't1t_b', sessionId: 's1', turnId: 2, source: 'user_input', excerpt: 'lex b', rank: -3 },
    ];
    const fused = fuseT1Hits(dense as any, lexical as any, 3);
    expect(fused[0].traceId).toBe('t1t_b');
    expect(fused[0].sources).toEqual(['dense', 'lexical']);
    expect(fused).toHaveLength(2);
  });

  test('respects k and drops empty excerpts', () => {
    const fused = fuseT1Hits(
      [{ sessionId: 's1', turnId: 1, traceId: 'a', cosine: 0.5, excerpt: '' }] as any,
      [{ traceId: 'b', sessionId: 's2', turnId: 2, source: 'user_input', excerpt: 'lex', rank: -1 }] as any,
      1,
    );
    expect(fused).toHaveLength(1);
    expect(fused[0].traceId).toBe('b');
  });
});
