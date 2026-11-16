import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { createGatewayT1Search } from '../../../src/recall/t1-search';
import { config } from '../../../src/config';

describe('T1 query-side atoms', () => {
  let dir: string;
  let db: GatewayDatabase;
  let traceId: string;
  const previousAtoms = config.recall.t1Recall.semanticAtoms;

  beforeEach(() => {
    config.recall.t1Recall.semanticAtoms = previousAtoms;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-query-atoms-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
    const turn = db.beginTurn('s1');
    traceId = turn.trace_id;
    db.append({
      session_id: 's1',
      turn_id: turn.turn_seq,
      trace_id: traceId,
      source: 'user_input',
      content: '修一下 reflection，unparseable JSON',
      failure: 0,
    });
  });
  afterEach(() => {
    config.recall.t1Recall.semanticAtoms = previousAtoms;
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function storeSemAtom(termId = 'error:json_parse') {
    db.upsertSparseTerms(traceId, [
      {
        traceId,
        termId: `sem:${termId}`,
        kind: 'semantic',
        weight: 0.2,
        model: 'sparse-embed-v1',
      },
    ]);
  }

  test('extra ids make stored sem: atoms reachable', () => {
    storeSemAtom();
    expect(db.searchT1Sparse('weather', 5)).toHaveLength(0);
    const hits = db.searchT1Sparse('weather', 5, ['sem:error:json_parse']);
    expect(hits).toHaveLength(1);
    expect(hits[0].traceId).toBe(traceId);
  });

  test('search passes query atoms into the sparse channel', async () => {
    storeSemAtom();
    const seen: string[][] = [];
    const spy = jest
      .spyOn(db, 'searchT1Sparse')
      .mockImplementation((_query, _k, extra = []) => {
        seen.push(extra);
        return [];
      });

    const search = createGatewayT1Search(db, () => null, {
      atomsForQuery: async () => [{ termId: 'error:json_parse', score: 0.2 }],
    });
    await search('解码失败', 3);
    expect(seen[0]).toContain('sem:error:json_parse');
    spy.mockRestore();
  });

  test('atom failure leaves the lexical channel intact', async () => {
    const search = createGatewayT1Search(db, () => null, {
      atomsForQuery: async () => {
        throw new Error('embedding down');
      },
    });
    const hits = await search('unparseable JSON', 3);
    expect(hits.some((hit) => hit.traceId === traceId)).toBe(true);
  });

  test('semanticAtoms=off skips query atom encoding', async () => {
    config.recall.t1Recall.semanticAtoms = 'off';
    const atomsForQuery = jest.fn(async () => []);
    const search = createGatewayT1Search(db, () => null, { atomsForQuery });
    await search('unparseable JSON', 3);
    expect(atomsForQuery).not.toHaveBeenCalled();
  });
});
