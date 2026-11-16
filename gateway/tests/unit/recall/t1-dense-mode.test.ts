import { createGatewayT1Search, getT1DenseStats, resetT1DenseStats } from '../../../src/recall/t1-search';
import { t1VectorKey } from '../../../src/recall/verbatim-recall';
import { config } from '../../../src/config';

function setup() {
  const row = { session_id: 's1', turn_id: 1, trace_id: 't1t_a', source: 'user_input', content: 'dense row' };
  const embed = jest.fn(async () => [[1, 0]]);
  const runtime = {
    provider: { embed },
    t1Vectors: { searchByCosine: () => [{ id: t1VectorKey('s1', 1, 'dense row'), cosine: 0.9 }] },
  } as any;
  const db = {
    readArchiveTurn: () => [row],
    readTurn: () => [row],
    searchT1Lexical: () => [
      { traceId: 't1t_lex', sessionId: 's1', turnId: 2, source: 'user_input', excerpt: 'lexical row', rank: -1 },
    ],
    searchT1Features: () => [],
    searchT1Concepts: () => [],
    searchT1Actors: () => [],
    searchT1Sparse: () => [],
    expandT1Neighbors: () => [],
  } as any;
  return { db, runtime, embed };
}

describe('T1 denseIndex modes', () => {
  const previous = config.recall.t1Recall.denseIndex;
  const previousAtoms = config.recall.t1Recall.semanticAtoms;
  afterEach(() => {
    config.recall.t1Recall.denseIndex = previous;
    config.recall.t1Recall.semanticAtoms = previousAtoms;
    resetT1DenseStats();
  });

  test('on fuses dense into sources', async () => {
    config.recall.t1Recall.denseIndex = 'on';
    const { db, runtime } = setup();
    const hits = await createGatewayT1Search(db, () => runtime)('row', 3);
    expect(hits.some((h) => h.sources?.includes('dense'))).toBe(true);
  });

  test('shadow computes dense but does not fuse it', async () => {
    config.recall.t1Recall.denseIndex = 'shadow';
    const { db, runtime, embed } = setup();
    const hits = await createGatewayT1Search(db, () => runtime)('row', 3);
    expect(embed).toHaveBeenCalled();
    expect(hits.every((h) => !h.sources?.includes('dense'))).toBe(true);
    expect(getT1DenseStats()).toMatchObject({ evaluations: 1, withDenseHits: 1 });
  });

  test('off skips dense retrieval; query atoms are independent', async () => {
    config.recall.t1Recall.denseIndex = 'off';
    config.recall.t1Recall.semanticAtoms = 'on';
    const { db, runtime, embed } = setup();
    const hits = await createGatewayT1Search(db, () => runtime)('row', 3);
    expect(hits.every((h) => !h.sources?.includes('dense'))).toBe(true);
    expect(hits.some((h) => h.traceId === 't1t_lex')).toBe(true);
    expect(getT1DenseStats()).toEqual({ evaluations: 0, withDenseHits: 0 });
    // Semantic atoms have their own switch; dense off does not disable them.
    expect(embed).toHaveBeenCalled();
  });

  test('dense off + atoms off skips the embedding runtime entirely', async () => {
    config.recall.t1Recall.denseIndex = 'off';
    config.recall.t1Recall.semanticAtoms = 'off';
    const { db, runtime, embed } = setup();
    const hits = await createGatewayT1Search(db, () => runtime)('row', 3);
    expect(embed).not.toHaveBeenCalled();
    expect(hits.some((h) => h.traceId === 't1t_lex')).toBe(true);
  });
});
