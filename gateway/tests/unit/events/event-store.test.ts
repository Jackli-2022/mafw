import Database from 'better-sqlite3';
import { EventStore, NON_PERSISTED_EVENT_TYPES } from '../../../src/events/event-store';

function makeStore() {
  const db = new Database(':memory:');
  return new EventStore(db);
}

describe('EventStore（spec §5.1）', () => {
  it('append 分配单调递增 seq；headSeq 跟随', () => {
    const s = makeStore();
    const a = s.append({ type: 'session.created' })!;
    const b = s.append({ type: 'turn.completed', properties: { x: 1 } })!;
    expect(b).toBeGreaterThan(a);
    expect(s.headSeq()).toBe(b);
  });
  it('part.delta 不入库不占 seq（C1：seq 空间连续）', () => {
    const s = makeStore();
    expect(s.append({ type: 'part.delta', properties: { delta: 'x' } })).toBeNull();
    const a = s.append({ type: 'part.updated' })!;
    expect(a).toBe(1); // delta 没消耗 seq
  });
  it('replaySince：全量 / 尾窗 / 空', () => {
    const s = makeStore();
    for (let i = 0; i < 5; i++) s.append({ type: 't' + i });
    expect(s.replaySince(0, 100).rows).toHaveLength(5);
    const { rows, firstReplayedSeq } = s.replaySince(3, 100);
    expect(rows.map(r => r.seq)).toEqual([4, 5]);
    expect(firstReplayedSeq).toBe(4);
    expect(s.replaySince(5, 100).rows).toEqual([]);
    expect(s.replaySince(5, 100).firstReplayedSeq).toBeNull();
  });
  it('replaySince 超限取最新 limit 行（Review Focus #4：newest-window）', () => {
    const s = makeStore();
    for (let i = 0; i < 10; i++) s.append({ type: 't' + i });
    const { rows, firstReplayedSeq } = s.replaySince(2, 3);
    expect(rows.map(r => r.seq)).toEqual([8, 9, 10]); // 最新 3 行，不是最旧
    expect(firstReplayedSeq).toBe(8);                  // > since+1 = 截断信号
  });
  it('replaySince 返回的信封可 JSON 还原（含 properties）', () => {
    const s = makeStore();
    s.append({ type: 'turn.completed', properties: { cost: 0.5 }, sessionID: 'ses_1' });
    const row = s.replaySince(0, 10).rows[0];
    expect(row.sessionId).toBe('ses_1');
    expect((row.envelope as any).properties.cost).toBe(0.5);
  });
  it('maybePrune：裁掉旧行后 seq 不重用（Review Focus #1）', () => {
    const s = makeStore();
    for (let i = 0; i < 5; i++) s.append({ type: 't' });
    s.maybePrune(2, 1); // 每 1 次 append 检查，保留 2 行
    const { rows } = s.replaySince(0, 100);
    expect(rows.map(r => r.seq)).toEqual([4, 5]);   // 只剩最新 2 行
    const next = s.append({ type: 'after-prune' })!;
    expect(next).toBe(6);                            // AUTOINCREMENT：不回填 3/4
  });
  it('append 异常 fail-open 返回 null（C5）', () => {
    const db = new Database(':memory:');
    const s = new EventStore(db);
    db.close(); // 句柄关闭后插入必炸
    expect(s.append({ type: 'x' })).toBeNull();
    expect(s.headSeq()).toBe(0);
  });
  it('NON_PERSISTED_EVENT_TYPES 含 part.delta', () => {
    expect(NON_PERSISTED_EVENT_TYPES.has('part.delta')).toBe(true);
  });
});
