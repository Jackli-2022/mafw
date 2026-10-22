import { SessionQueue, QueuedItem } from '../../../src/core/session-queue';

const base = (over: Partial<Parameters<SessionQueue['enqueue']>[1]> = {}) => ({
  text: 'hello', source: 'http', ...over,
});

describe('SessionQueue（spec §5.2）', () => {
  it('FIFO：enqueue→dequeue 顺序', () => {
    const q = new SessionQueue();
    q.enqueue('s1', base({ text: 'a' }));
    q.enqueue('s1', base({ text: 'b' }));
    expect(q.dequeue('s1')!.text).toBe('a');
    expect(q.dequeue('s1')!.text).toBe('b');
    expect(q.dequeue('s1')).toBeNull();
  });
  it('per-session 隔离', () => {
    const q = new SessionQueue();
    q.enqueue('s1', base()); q.enqueue('s2', base({ text: 'other' }));
    expect(q.size('s1')).toBe(1); expect(q.size('s2')).toBe(1);
    expect(q.dequeue('s2')!.text).toBe('other');
  });
  it('幂等：同 idempotencyKey 返回 duplicate 既有项（C6）', () => {
    const q = new SessionQueue();
    const r1 = q.enqueue('s1', base({ idempotencyKey: 'k1' }));
    const r2 = q.enqueue('s1', base({ idempotencyKey: 'k1', text: 'dup-attempt' }));
    expect('item' in r1).toBe(true);
    expect('duplicate' in r2).toBe(true);
    expect((r2 as any).duplicate.id).toBe((r1 as any).item.id);
    expect(q.size('s1')).toBe(1);
  });
  it('幂等窗口 = 排队期：dequeue 后同 key 再 enqueue 是新项', () => {
    const q = new SessionQueue();
    q.enqueue('s1', base({ idempotencyKey: 'k1' }));
    q.dequeue('s1');
    const r = q.enqueue('s1', base({ idempotencyKey: 'k1' }));
    expect('item' in r).toBe(true);
  });
  it('上限 32：超限 rejected（C5）', () => {
    const q = new SessionQueue();
    for (let i = 0; i < 32; i++) q.enqueue('s1', base({ text: String(i) }));
    expect('rejected' in q.enqueue('s1', base())).toBe(true);
    expect(q.size('s1')).toBe(32);
  });
  it('cancel：队内取消返回该项；未知 id / 已 dequeue 的 id 返回 null（Review Focus #5）', () => {
    const q = new SessionQueue();
    const { item } = q.enqueue('s1', base()) as { item: QueuedItem };
    expect(q.cancel('s1', item.id)!.id).toBe(item.id);
    expect(q.cancel('s1', item.id)).toBeNull();
    const { item: i2 } = q.enqueue('s1', base()) as { item: QueuedItem };
    q.dequeue('s1');
    expect(q.cancel('s1', i2.id)).toBeNull();  // flush 已取走——不炸不复活
  });
  it('clear 返回被清项（事件载荷）', () => {
    const q = new SessionQueue();
    q.enqueue('s1', base()); q.enqueue('s1', base({ text: 'b' }));
    const cleared = q.clear('s1');
    expect(cleared).toHaveLength(2);
    expect(q.size('s1')).toBe(0);
  });
  it('expireOlderThan：TTL 过期摘除（C4；now 注入）', () => {
    const q = new SessionQueue();
    q.enqueue('s1', base({ text: 'old' }));  // enqueuedAt = 真实时钟（现在）
    // now 注入为远未来 → 该项 age >= TTL → 过期
    const expired = q.expireOlderThan('s1', 24 * 3600_000, Date.now() + 25 * 3600_000);
    expect(expired).toHaveLength(1);
    expect(q.size('s1')).toBe(0);
    // 未过期路径：now = 现在 → age ≈ 0 < TTL → 保留
    q.enqueue('s1', base({ text: 'fresh' }));
    expect(q.expireOlderThan('s1', 24 * 3600_000)).toHaveLength(0);
    expect(q.size('s1')).toBe(1);
  });
  it('requeueHead：flush 失败重入队首（终审 #3——不静默丢）', () => {
    const q = new SessionQueue();
    q.enqueue('s1', base({ text: 'a' }));
    q.enqueue('s1', base({ text: 'b' }));
    const flushed = q.dequeue('s1')!;          // flush 取走 a
    expect(q.requeueHead('s1', flushed)).toBe(true);
    expect(q.dequeue('s1')!.text).toBe('a');   // 队首重试
    expect(q.dequeue('s1')!.text).toBe('b');
  });
  it('requeueHead：幂等 key 不复活冲突（同 key 已在队时拒绝重入）', () => {
    const q = new SessionQueue();
    q.enqueue('s1', base({ idempotencyKey: 'k1', text: 'a' }));
    const flushed = q.dequeue('s1')!;
    q.enqueue('s1', base({ idempotencyKey: 'k2', text: 'new' }));
    expect(q.requeueHead('s1', flushed)).toBe(true);  // 无冲突——重入成功
    const flushed2 = q.dequeue('s1')!;
    // 同 key 项已在队（k2 在队）时另一 k2 项重入 → 拒绝
    expect(q.requeueHead('s1', { ...flushed2, idempotencyKey: 'k2' })).toBe(false);
  });
  it('list 只读快照（内部数组不可外泄）', () => {
    const q = new SessionQueue();
    q.enqueue('s1', base());
    const l = q.list('s1');
    l.length = 0;
    expect(q.size('s1')).toBe(1);
  });
});
