import { createGatewayT1Search } from '../../../src/recall/t1-search';
import { t1VectorKey } from '../../../src/recall/verbatim-recall';

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
});
