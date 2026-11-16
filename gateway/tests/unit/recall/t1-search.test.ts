import { createGatewayT1Search, fuseT1Hits, applyT1ActivationRanking, getT1RankingStats, resetT1RankingStats } from '../../../src/recall/t1-search';
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
  const previousDenseMode = config.recall.t1Recall.denseIndex;
  beforeEach(() => { config.recall.t1Recall.denseIndex = 'on'; });
  afterEach(() => { config.recall.t1Recall.denseIndex = previousDenseMode; });

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

  test('queries concept/actor/sparse channels and fuses their hits', async () => {
    const db = {
      searchT1Lexical: () => [],
      searchT1Features: () => [],
      searchT1Concepts: jest.fn(() => [
        { traceId: 't1t_c', sessionId: 's1', turnId: 1, source: 'concept', excerpt: 'concept a', rank: -1 },
      ]),
      searchT1Actors: jest.fn(() => []),
      searchT1Sparse: jest.fn(() => [
        { traceId: 't1t_c', sessionId: 's1', turnId: 1, source: 'sparse', excerpt: 'sparse a', rank: -1 },
      ]),
      expandT1Neighbors: () => [],
      readArchiveTurn: () => [],
      readTurn: () => [],
    } as any;
    const search = createGatewayT1Search(db, () => null);
    const hits = await search('解析失败', 3);
    expect(db.searchT1Concepts).toHaveBeenCalled();
    expect(db.searchT1Sparse).toHaveBeenCalled();
    expect(hits).toHaveLength(1);
    expect(hits[0].traceId).toBe('t1t_c');
    expect(hits[0].sources).toEqual(['concept', 'sparse']);
    expect(hits[0].excerpt).toBe('concept a');
  });

  test('fills remaining slots with 1-hop pattern-completion neighbors', async () => {
    const db = {
      searchT1Lexical: () => [
        { traceId: 't1t_direct', sessionId: 's1', turnId: 1, source: 'user_input', excerpt: 'direct', rank: -1 },
      ],
      searchT1Features: () => [],
      searchT1Concepts: () => [],
      searchT1Actors: () => [],
      searchT1Sparse: () => [],
      expandT1Neighbors: jest.fn(() => [
        { traceId: 't1t_neighbor', sessionId: 's1', turnId: 2, source: 'neighbor', excerpt: 'neighbor', rank: 1 },
      ]),
      readArchiveTurn: () => [],
      readTurn: () => [],
    } as any;
    const search = createGatewayT1Search(db, () => null);
    const hits = await search('direct', 3);
    expect(db.expandT1Neighbors).toHaveBeenCalledWith(['t1t_direct'], 2);
    expect(hits.map((h) => h.traceId)).toEqual(['t1t_direct', 't1t_neighbor']);
    expect(hits[1].sources).toEqual(['neighbor']);
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

describe('fuseT1Hits', () => {  test('ranks a hit present in both channels above single-channel hits', () => {
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

  test('includes a feature-only hit and marks its source', () => {
    const feature = [
      { traceId: 't1t_f', sessionId: 's1', turnId: 3, source: 'feature', excerpt: 'feature f', rank: -2 },
    ];
    const fused = fuseT1Hits([], [], 3, feature as any);
    expect(fused).toHaveLength(1);
    expect(fused[0].traceId).toBe('t1t_f');
    expect(fused[0].sources).toEqual(['feature']);
  });

  test('fuses concept/actor/sparse channels and preserves provenance', () => {
    const hit = (traceId: string, sessionId: string, source: string) => ({
      traceId,
      sessionId,
      turnId: 1,
      source,
      excerpt: `${source} excerpt`,
      rank: -1,
    });
    const fused = fuseT1Hits([], [], 3, {
      concept: [hit('t1t_c', 's1', 'concept') as any],
      actor: [hit('t1t_a', 's1', 'actor') as any],
      sparse: [hit('t1t_s', 's2', 'sparse') as any],
    });
    expect(fused.map((h) => h.traceId)).toEqual(
      expect.arrayContaining(['t1t_c', 't1t_a', 't1t_s']),
    );
    expect(fused.find((h) => h.traceId === 't1t_c')!.sources).toEqual(['concept']);
    expect(fused.find((h) => h.traceId === 't1t_a')!.sources).toEqual(['actor']);
    expect(fused.find((h) => h.traceId === 't1t_s')!.sources).toEqual(['sparse']);
  });

  test('same trace across channels accumulates score and merges sources', () => {
    const fused = fuseT1Hits(
      [{ sessionId: 's1', turnId: 1, traceId: 't1t_x', cosine: 0.9, excerpt: 'dense x' }] as any,
      [{ traceId: 't1t_x', sessionId: 's1', turnId: 1, source: 'user_input', excerpt: 'lex x', rank: -1 }] as any,
      2,
      {
        concept: [{ traceId: 't1t_x', sessionId: 's1', turnId: 1, source: 'concept', excerpt: 'concept x', rank: -1 }] as any,
      },
    );
    expect(fused[0].sources).toEqual(['dense', 'lexical', 'concept']);
    expect(fused[0].excerpt).toBe('lex x');
  });
});

describe('applyT1ActivationRanking', () => {
  const hit = (traceId: string, score: number) => ({
    sessionId: 's1', turnId: 1, traceId, cosine: 0, excerpt: traceId, score,
  }) as any;

  test('on: a close lower-ranked hit can overtake with a bounded boost', () => {
    const out = applyT1ActivationRanking(
      [hit('a', 1.0), hit('b', 0.95)],
      { mode: 'on', activation: new Map([['b', 1]]), weight: 0.1, band: 0.6 },
    );
    expect(out.reordered).toBe(true);
    expect(out.results.map((h) => h.traceId)).toEqual(['b', 'a']);
  });

  test('band gate: activation never lifts a far-less-relevant hit', () => {
    const out = applyT1ActivationRanking(
      [hit('a', 1.0), hit('low', 0.4)],
      { mode: 'on', activation: new Map([['low', 1]]), weight: 0.1, band: 0.6 },
    );
    expect(out.reordered).toBe(false);
    expect(out.results.map((h) => h.traceId)).toEqual(['a', 'low']);
  });

  test('shadow returns the original order even when it would reorder', () => {
    const out = applyT1ActivationRanking(
      [hit('a', 1.0), hit('b', 0.95)],
      { mode: 'shadow', activation: new Map([['b', 1]]), weight: 0.1, band: 0.6 },
    );
    expect(out.reordered).toBe(true);
    expect(out.results.map((h) => h.traceId)).toEqual(['a', 'b']);
  });
});

describe('createGatewayT1Search activation ranking modes', () => {
  const lexicalHit = (traceId: string, rankIndex: number) => ({
    traceId, sessionId: 's1', turnId: rankIndex + 1, source: 'user_input',
    excerpt: traceId, rank: -(rankIndex + 1),
  });

  function fakeDb(activations: Map<string, number>, lookup = jest.fn(() => activations)) {
    return {
      searchT1Lexical: () => [lexicalHit('t1t_a', 0), lexicalHit('t1t_b', 1)],
      readArchiveTurn: () => [],
      readTurn: () => [],
      t1Activations: lookup,
    } as any;
  }

  beforeEach(() => resetT1RankingStats());

  test('off keeps relevance order and skips the activation lookup', async () => {
    const prev = config.recall.t1Recall.activationRanking;
    config.recall.t1Recall.activationRanking = 'off';
    try {
      const lookup = jest.fn(() => new Map([['t1t_b', 1]]));
      const search = createGatewayT1Search(fakeDb(new Map(), lookup), () => null);
      const hits = await search('q', 2);
      expect(hits.map((h) => h.traceId)).toEqual(['t1t_a', 't1t_b']);
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      config.recall.t1Recall.activationRanking = prev;
    }
  });

  test('shadow counts a would-be reorder but serves relevance order', async () => {
    const prev = config.recall.t1Recall.activationRanking;
    config.recall.t1Recall.activationRanking = 'shadow';
    try {
      const search = createGatewayT1Search(fakeDb(new Map([['t1t_b', 1]])), () => null);
      const hits = await search('q', 2);
      expect(hits.map((h) => h.traceId)).toEqual(['t1t_a', 't1t_b']);
      expect(getT1RankingStats()).toEqual({ evaluations: 1, wouldReorder: 1, applied: 0 });
    } finally {
      config.recall.t1Recall.activationRanking = prev;
    }
  });

  test('on applies the bounded reorder and counts it', async () => {
    const prev = config.recall.t1Recall.activationRanking;
    config.recall.t1Recall.activationRanking = 'on';
    try {
      const search = createGatewayT1Search(fakeDb(new Map([['t1t_b', 1]])), () => null);
      const hits = await search('q', 2);
      expect(hits.map((h) => h.traceId)).toEqual(['t1t_b', 't1t_a']);
      expect(getT1RankingStats()).toEqual({ evaluations: 1, wouldReorder: 0, applied: 1 });
    } finally {
      config.recall.t1Recall.activationRanking = prev;
    }
  });

  test('activation lookup failure falls back to relevance order', async () => {
    const prev = config.recall.t1Recall.activationRanking;
    config.recall.t1Recall.activationRanking = 'on';
    try {
      const search = createGatewayT1Search(
        fakeDb(new Map(), () => { throw new Error('state down'); }),
        () => null,
      );
      const hits = await search('q', 2);
      expect(hits.map((h) => h.traceId)).toEqual(['t1t_a', 't1t_b']);
    } finally {
      config.recall.t1Recall.activationRanking = prev;
    }
  });
});
