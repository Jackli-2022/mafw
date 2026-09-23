import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { CoactivationGraphStore } from '../../../src/graph/coactivation-store';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DAY = 86_400;
const iso = (secAgo: number) => new Date(Date.now() - secAgo * 1000).toISOString();

describe('CoactivationGraphStore', () => {
  let dir: string;
  let db: GatewayDatabase;
  let store: CoactivationGraphStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coact-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
    store = new CoactivationGraphStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('同会话单元互建边', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(10) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: iso(10) });
    const nb = store.getNeighbors(['a'], 10).get('a')!;
    expect(nb.get('b')).toBeGreaterThan(0);
  });

  test('不同会话且超出时间窗不建边', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(10 * DAY) });
    store.upsertUnit({ id: 'b', source_session_id: 's2', created_at: iso(1) });
    const nb = store.getNeighbors(['a'], 10).get('a')!;
    expect(nb.has('b')).toBe(false);
  });

  test('时间邻近（同窗口）建边', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(100) });
    store.upsertUnit({ id: 'b', source_session_id: 's2', created_at: iso(200) });
    const nb = store.getNeighbors(['a'], 10).get('a')!;
    expect(nb.get('b')).toBeGreaterThan(0);
  });

  test('同 Goal 经 goal_sessions 建边', () => {
    (db as any).db.prepare(
      'INSERT INTO goal_sessions (goal_id, session_id, phase, loop, created_at) VALUES (?,?,?,?,?)'
    ).run('g1', 's1', 'execute', 1, new Date().toISOString());
    (db as any).db.prepare(
      'INSERT INTO goal_sessions (goal_id, session_id, phase, loop, created_at) VALUES (?,?,?,?,?)'
    ).run('g1', 's2', 'execute', 1, new Date().toISOString());
    // created_at 相隔 5 天（超出时间窗）且会话不同 → 只有 Goal 信号能连边
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(10 * DAY) });
    store.upsertUnit({ id: 'b', source_session_id: 's2', created_at: iso(5 * DAY) });
    const nb = store.getNeighbors(['a'], 10).get('a')!;
    expect(nb.get('b')).toBeGreaterThan(0);
  });

  test('hub 防护：会话成员超 maxGroupSize 后新单元不再建该信号边', () => {
    // config 默认 maxGroupSize=50；造 60 个同会话单元，created_at 彼此错开 2 天（避开时间窗）
    for (let i = 0; i < 60; i++) store.upsertUnit({ id: `u${i}`, source_session_id: 'big', created_at: iso((i + 1) * 2 * DAY) });
    // 第 61 个单元：会话成员数已 >50 → 跳过会话信号；时间窗也避开
    store.upsertUnit({ id: 'late', source_session_id: 'big', created_at: iso(200 * DAY) });
    expect(store.getNeighbors(['late'], 100).get('late')!.size).toBe(0);
  });

  test('读时衰减：越久未更新的边权越小', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(10) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: iso(10) });
    const fresh = store.getNeighbors(['a'], 10).get('a')!.get('b')!;
    (db as any).db.prepare('UPDATE coactivation_edges SET updated_at = ?').run(Math.floor(Date.now() / 1000) - 30 * DAY);
    const stale = store.getNeighbors(['a'], 10).get('a')!.get('b')!;
    expect(stale).toBeLessThan(fresh);
  });

  test('rebuild 从索引重建并跳过 superseded', () => {
    store.rebuild({ entries: [
      { id: 'a', source_session_id: 's1', created_at: iso(10) },
      { id: 'b', source_session_id: 's1', created_at: iso(10) },
      { id: 'c', source_session_id: 's1', created_at: iso(10), superseded_by: 'b' },
    ] });
    expect(store.stats().edges).toBe(1);
  });

  test('removeUnit 清掉相关边', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(10) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: iso(10) });
    store.removeUnit('b');
    expect(store.getNeighbors(['a'], 10).get('a')!.size).toBe(0);
  });

  test('重复 upsert 合并而非重复计数', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(10) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: iso(10) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: iso(10) });
    expect(store.stats().edges).toBe(1);
  });
});
