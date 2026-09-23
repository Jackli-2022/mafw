import { GatewayDatabase } from '../../src/memory/gateway-db';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function seed(db: GatewayDatabase, session: string, turn: number, source: string, content: string) {
  (db as any).db.prepare(
    'INSERT INTO t1_archive (session_id, turn_id, source, content, failure, created_at) VALUES (?,?,?,?,?,?)',
  ).run(session, turn, source, content, 0, Math.floor(Date.now() / 1000));
}

describe('GatewayDatabase.searchArchive', () => {
  let dir: string;
  let db: GatewayDatabase;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srcarch-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('按锚点命中数排序，取 k 条', () => {
    seed(db, 's1', 1, 'user_input', 'kubernetes deployment question');
    seed(db, 's1', 2, 'assistant_reply', 'kubernetes rollout detail');
    seed(db, 's1', 3, 'assistant_reply', 'unrelated chatter');
    const out = db.searchArchive('s1', ['kubernetes', 'rollout'], 2);
    expect(out.length).toBe(2);
    expect(out[0].turn_id).toBe(2);
  });

  test('不跨会话', () => {
    seed(db, 's1', 1, 'user_input', 'kubernetes deployment');
    seed(db, 's2', 1, 'user_input', 'kubernetes deployment');
    const out = db.searchArchive('s1', ['kubernetes'], 5);
    expect(out.every(t => t.session_id === 's1')).toBe(true);
  });

  test('空参数返回空', () => {
    expect(db.searchArchive('s1', [], 5)).toEqual([]);
    expect(db.searchArchive('s1', ['x'], 0)).toEqual([]);
  });
});
