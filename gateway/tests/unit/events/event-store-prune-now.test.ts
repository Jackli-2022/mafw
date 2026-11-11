/**
 * E4-6b: `EventStore.pruneNow` —— disk critical 边沿的一次性裁剪（spec §4.2）。
 *
 * 与 `maybePrune` 的区别：不等 append 计数摊销，立刻按 retention 裁到
 * `max(seq) - retention` 之前；AUTOINCREMENT 保证裁剪后 seq 不重用，
 * 客户端陈旧 lastEventId 仍安全。异常一律 fail-open（裁剪失败不得影响采样）。
 */
import Database from 'better-sqlite3';
import { EventStore } from '../../../src/events/event-store';

function seeded(count: number): EventStore {
  const store = new EventStore(new Database(':memory:'));
  for (let i = 0; i < count; i++) store.append({ type: 'tick', sessionID: null });
  return store;
}

function rowCount(store: EventStore): number {
  return store.replaySince(0, 1_000_000).rows.length;
}

function brokenDb(): Database {
  return {
    exec: () => {},
    prepare: () => { throw new Error('disk I/O error'); },
  } as unknown as Database;
}

describe('EventStore.pruneNow', () => {
  it('立即裁到最新 retention 行（不等 append 摊销）', () => {
    const store = seeded(50);
    expect(rowCount(store)).toBe(50);
    store.pruneNow(10);
    const rows = store.replaySince(0, 1_000_000).rows;
    expect(rows).toHaveLength(10);
    expect(rows[rows.length - 1].seq).toBe(store.headSeq());
    expect(rows[0].seq).toBe(store.headSeq() - 9);
  });

  it('headSeq 不因裁剪回退（AUTOINCREMENT 语义保留）', () => {
    const store = seeded(12);
    const head = store.headSeq();
    store.pruneNow(5);
    expect(store.headSeq()).toBe(head);
    expect(store.append({ type: 'tick' })!).toBe(head + 1);
  });

  it('行数少于 retention 时不删除任何行', () => {
    const store = seeded(5);
    store.pruneNow(100);
    expect(rowCount(store)).toBe(5);
  });

  it('db 异常时静默 fail-open（不抛）', () => {
    const store = new EventStore(brokenDb());
    expect(() => store.pruneNow(100)).not.toThrow();
  });

  it('retention 非有限或负数时 no-op（NaN / -1 / Infinity）', () => {
    const store = seeded(5);
    store.pruneNow(Number.NaN);
    store.pruneNow(-1);
    store.pruneNow(Infinity);
    expect(rowCount(store)).toBe(5);
  });

  it('retention 0 清空全表，且 seq 不重用（AUTOINCREMENT）', () => {
    const store = seeded(8);
    const head = store.headSeq();
    store.pruneNow(0);
    expect(rowCount(store)).toBe(0);
    // headSeq() derives from rows; monotonic seq is proven by the next insert.
    expect(store.append({ type: 'tick' })!).toBe(head + 1);
  });

  it('小数 retention 向下取整（3.9 → 保留 3 行）', () => {
    const store = seeded(10);
    store.pruneNow(3.9);
    expect(rowCount(store)).toBe(3);
  });
});
