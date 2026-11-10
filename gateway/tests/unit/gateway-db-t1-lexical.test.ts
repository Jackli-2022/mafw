import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase, buildT1FtsQuery } from '../../src/memory/gateway-db';

describe('T1 FTS5 lexical index', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-fts-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function appendTurn(session = 's1', contents: Array<{ source: 'user_input' | 'tool_result'; content: string }> = []) {
    const turn = db.beginTurn(session);
    for (const row of contents) {
      db.append({
        session_id: session,
        turn_id: turn.turn_seq,
        trace_id: turn.trace_id,
        source: row.source,
        content: row.content,
        failure: 0,
      });
    }
    return turn;
  }

  test('buildT1FtsQuery quotes identifiers and strips raw FTS syntax', () => {
    const q = buildT1FtsQuery('gateway-db.ts ECONNRESET');
    expect(q).toBe('"gateway-db.ts" OR "econnreset"');

    const injected = buildT1FtsQuery('foo" OR bar*');
    expect(injected).toBe('"foo" OR "bar"');
    expect(injected).not.toContain('*');
  });

  test('buildT1FtsQuery returns empty for tokens shorter than three characters', () => {
    expect(buildT1FtsQuery('a b c')).toBe('');
    expect(buildT1FtsQuery('')).toBe('');
  });

  test('finds identifiers, paths and error codes', () => {
    const turn = appendTurn('s1', [
      { source: 'tool_result', content: 'C:/repo/gateway-db.ts failed with ECONNRESET' },
    ]);
    const byPath = db.searchT1Lexical('gateway-db.ts', 5);
    expect(byPath).toHaveLength(1);
    expect(byPath[0]).toMatchObject({
      traceId: turn.trace_id,
      sessionId: 's1',
      turnId: turn.turn_seq,
    });
    expect(byPath[0].excerpt).toContain('gateway-db.ts');

    const byCode = db.searchT1Lexical('ECONNRESET', 5);
    expect(byCode).toHaveLength(1);
    expect(byCode[0].traceId).toBe(turn.trace_id);
  });

  test('finds Chinese content', () => {
    const turn = appendTurn('s1', [{ source: 'user_input', content: '部署失败，检查 gateway.db' }]);
    const hits = db.searchT1Lexical('部署失败', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].traceId).toBe(turn.trace_id);
  });

  test('dedupes multiple rows of the same trace and keeps the best excerpt', () => {
    const turn = appendTurn('s1', [
      { source: 'user_input', content: 'unrelated first row' },
      { source: 'tool_result', content: 'deploy failed: ECONNRESET from gateway-db.ts' },
    ]);
    const hits = db.searchT1Lexical('ECONNRESET', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].traceId).toBe(turn.trace_id);
    expect(hits[0].excerpt).toContain('ECONNRESET');
  });

  test('archived rows stay searchable', () => {
    const turn = appendTurn('s1', [{ source: 'user_input', content: 'archive me: ENOTFOUND' }]);
    expect(db.archiveTurn('s1', turn.turn_seq)).toBe(1);
    const hits = db.searchT1Lexical('ENOTFOUND', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].traceId).toBe(turn.trace_id);
  });

  test('deleteTurn and deleteSession remove active rows from the index', () => {
    const a = appendTurn('s1', [{ source: 'user_input', content: 'delete-me-token' }]);
    expect(db.deleteTurn('s1', a.turn_seq)).toBe(1);
    expect(db.searchT1Lexical('delete-me-token', 5)).toEqual([]);

    appendTurn('s2', [{ source: 'user_input', content: 'session-delete-token' }]);
    expect(db.deleteSession('s2')).toBe(1);
    expect(db.searchT1Lexical('session-delete-token', 5)).toEqual([]);
  });

  test('rebuildT1Fts indexes legacy raw rows idempotently', () => {
    const raw = db.getStore();
    raw
      .prepare(
        `INSERT INTO t1_observations (session_id, turn_id, trace_id, observation_key, source, content, failure)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
      )
      .run('legacy', 1, 't1t_legacy', 't1o_legacy_1', 'user_input', 'legacy ROW: unique-needle');

    expect(db.rebuildT1Fts()).toBe(1);
    expect(db.rebuildT1Fts()).toBe(1);
    const hits = db.searchT1Lexical('unique-needle', 5);
    expect(hits).toHaveLength(1);
    expect(hits[0].traceId).toBe('t1t_legacy');
  });

  test('FTS syntax in the query never throws', () => {
    appendTurn('s1', [{ source: 'user_input', content: 'safe content about foo bar' }]);
    expect(() => db.searchT1Lexical('foo" OR bar*', 5)).not.toThrow();
  });
});
