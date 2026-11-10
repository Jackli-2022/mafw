import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';

describe('T1 retrieval events', () => {
  test('records kinds and survives reopen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-events-'));
    const file = path.join(dir, 'test.db');
    let db = new GatewayDatabase(file);
    db.recordT1RetrievalEvent({ traceId: 't1t_a', kind: 'search', score: 0.9 });
    db.recordT1RetrievalEvent({ traceId: 't1t_a', kind: 'redeem' });
    db.recordT1RetrievalEvent({ traceId: 't1t_b', kind: 'recall' });
    db.recordT1RetrievalEvent({ traceId: '', kind: 'search' });
    expect(db.t1RetrievalStats()).toEqual({
      total: 3,
      byKind: { search: 1, recall: 1, redeem: 1 },
      uniqueTraces: 2,
      lastAt: expect.any(Number),
    });
    db.close();

    db = new GatewayDatabase(file);
    expect(db.t1RetrievalStats().total).toBe(3);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('since filters by event timestamp', () => {
    const db = new GatewayDatabase(':memory:');
    db.recordT1RetrievalEvent({ traceId: 't1t_old', kind: 'search', ts: 100 });
    db.recordT1RetrievalEvent({ traceId: 't1t_new', kind: 'search', ts: 200 });
    const stats = db.t1RetrievalStats({ since: 150 });
    expect(stats.total).toBe(1);
    expect(stats.uniqueTraces).toBe(1);
    db.close();
  });

  test('empty stats are zeroed', () => {
    const db = new GatewayDatabase(':memory:');
    expect(db.t1RetrievalStats()).toEqual({
      total: 0,
      byKind: { search: 0, recall: 0, redeem: 0 },
      uniqueTraces: 0,
      lastAt: null,
    });
    db.close();
  });
});
