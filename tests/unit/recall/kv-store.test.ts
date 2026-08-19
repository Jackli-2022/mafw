import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';

describe('GatewayDatabase kv_store', () => {
  let db: GatewayDatabase;
  beforeEach(() => {
    db = new GatewayDatabase(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  test('kvSet/kvGet round-trips JSON values', () => {
    db.kvSet('scope-a', 'k1', { sessionId: 'ses_1', createdAt: 't' });
    expect(db.kvGet('scope-a', 'k1')).toEqual({ sessionId: 'ses_1', createdAt: 't' });
    expect(db.kvGet('scope-a', 'missing')).toBeNull();
  });

  test('kvSet upserts (no duplicate rows)', () => {
    db.kvSet('s', 'k', 'v1');
    db.kvSet('s', 'k', 'v2');
    expect(db.kvAll('s')).toHaveLength(1);
    expect(db.kvGet('s', 'k')).toBe('v2');
  });

  test('kvAll returns all rows of a scope', () => {
    db.kvSet('manager-session', 'proj-a', { sessionId: 'x' });
    db.kvSet('manager-session', 'proj-b', { sessionId: 'y' });
    db.kvSet('other', 'k', 'z');
    const all = db.kvAll<{ sessionId: string }>('manager-session');
    expect(all.map((e) => e.key).sort()).toEqual(['proj-a', 'proj-b']);
    expect(all[0].value.sessionId).toBeDefined();
  });

  test('kvDelete removes a row', () => {
    db.kvSet('s', 'k', 'v');
    db.kvDelete('s', 'k');
    expect(db.kvGet('s', 'k')).toBeNull();
  });

  test('plain strings and objects coexist', () => {
    db.kvSet('s', 'str', 'hello');
    db.kvSet('s', 'obj', { a: 1 });
    expect(db.kvGet('s', 'str')).toBe('hello');
    expect(db.kvGet('s', 'obj')).toEqual({ a: 1 });
  });
});
