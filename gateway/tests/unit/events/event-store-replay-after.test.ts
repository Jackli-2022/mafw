/**
 * E5b-1：`EventStore.replayAfter` —— 升序分页恢复源。
 *
 * 与 `replaySince`（newest-window，降序取尾再 reverse）不同，恢复面要求：
 *   - 升序 `ORDER BY seq ASC`（客户端从游标向后连续消费）；
 *   - 支持 `since` 早于当前保留窗口（`oldestSeq` 由调用方判定 truncated）；
 *   - 全路径 fail-open（空 rows + 0/0），与 replaySince 的 stance 一致。
 *
 * Spec: docs/superpowers/specs/2026-11-12-gateway-e5b-event-recovery-design.md §3.1
 */
import Database from 'better-sqlite3';
import { EventStore } from '../../../src/events/event-store';

function makeStore(): { db: Database.Database; store: EventStore } {
  const db = new Database(':memory:');
  return { db, store: new EventStore(db) };
}

describe('EventStore.replayAfter', () => {
  test('空表：rows=[] 且 head/oldest 均为 0', () => {
    const { store } = makeStore();
    expect(store.replayAfter(0, 10)).toEqual({ rows: [], headSeq: 0, oldestSeq: 0 });
    // 任意 since 的空表同样不应报错
    expect(store.replayAfter(42, 10)).toEqual({ rows: [], headSeq: 0, oldestSeq: 0 });
  });

  test('升序返回 seq > since 的行，并投影列', () => {
    const { store } = makeStore();
    store.append({ type: 'mafw_event', sessionID: 'ses_a', data: { n: 1 } });
    store.append({ type: 'mafw_event', sessionID: 'ses_b', data: { n: 2 } });
    store.append({ type: 'mafw_event', sessionID: 'ses_c', data: { n: 3 } });

    const page = store.replayAfter(0, 10);
    expect(page.rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect(page.headSeq).toBe(3);
    expect(page.oldestSeq).toBe(1);
    expect(page.rows[0]).toMatchObject({
      seq: 1,
      type: 'mafw_event',
      sessionId: 'ses_a',
      envelope: { type: 'mafw_event', sessionID: 'ses_a', data: { n: 1 } },
    });
    expect(typeof page.rows[0].ts).toBe('string');
  });

  test('分页：since 之后最多 limit 行，顺序仍升序', () => {
    const { store } = makeStore();
    for (let i = 0; i < 5; i++) store.append({ type: 'e', sessionID: null, i });

    const first = store.replayAfter(0, 2);
    expect(first.rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(first.headSeq).toBe(5);
    expect(first.oldestSeq).toBe(1);

    const second = store.replayAfter(first.rows[first.rows.length - 1].seq, 2);
    expect(second.rows.map((r) => r.seq)).toEqual([3, 4]);

    const third = store.replayAfter(4, 2);
    expect(third.rows.map((r) => r.seq)).toEqual([5]);
  });

  test('since 超过 head：空 rows，head/oldest 仍是当前值（reset 判定交给路由）', () => {
    const { store } = makeStore();
    for (let i = 0; i < 3; i++) store.append({ type: 'e', i });

    expect(store.replayAfter(10, 10)).toEqual({ rows: [], headSeq: 3, oldestSeq: 1 });
  });

  test('headSeq = MAX(seq)，oldestSeq = MIN(seq)：裁剪后 oldest 前移', () => {
    const { store } = makeStore();
    for (let i = 0; i < 5; i++) store.append({ type: 'e', i });
    store.pruneNow(2);

    const page = store.replayAfter(0, 10);
    expect(page.oldestSeq).toBe(4);
    expect(page.headSeq).toBe(5);
    expect(page.rows.map((r) => r.seq)).toEqual([4, 5]);
  });

  test('DB 异常 fail-open：空 rows + 0/0（不抛）', () => {
    const db = {
      exec: () => undefined,
      prepare: () => { throw new Error('db gone'); },
    } as unknown as Database.Database;
    const store = new EventStore(db);

    expect(() => store.replayAfter(0, 10)).not.toThrow();
    expect(store.replayAfter(0, 10)).toEqual({ rows: [], headSeq: 0, oldestSeq: 0 });
  });

  test('非持久类型（part.delta / transient data part）不入日志、不占 seq', () => {
    const { store } = makeStore();
    store.append({ type: 'part.delta', sessionID: 'ses_a', data: { delta: 'x' } });
    store.append({
      type: 'part.updated',
      sessionID: 'ses_a',
      properties: { part: { type: 'data-preview', transient: true } },
    });
    store.append({ type: 'mafw_event', sessionID: 'ses_a' });

    const page = store.replayAfter(0, 10);
    expect(page.rows.map((r) => r.type)).toEqual(['mafw_event']);
    expect(page.rows.map((r) => r.seq)).toEqual([1]);
    expect(page.headSeq).toBe(1);
    expect(page.oldestSeq).toBe(1);
  });
});
