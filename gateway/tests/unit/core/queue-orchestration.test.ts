import { SessionQueue } from '../../../src/core/session-queue';
import { shouldFlush } from '../../../src/core/queue-flush';

describe('flush 编排纯函数（spec §5.4）', () => {
  it('idle + 有队 → 取队首（每终态一条 C3）', () => {
    const q = new SessionQueue();
    q.enqueue('s1', { text: 'a', source: 't' });
    q.enqueue('s1', { text: 'b', source: 't' });
    const busy = new Map<string, number>();
    const item = shouldFlush(q, busy, 's1')!;
    expect(item.text).toBe('a');
    expect(q.size('s1')).toBe(1);           // 只取一条
    expect(shouldFlush(q, busy, 's1')!.text).toBe('b');  // 下一终态再取
    expect(shouldFlush(q, busy, 's1')).toBeNull();       // 空 → null
  });
  it('busy（flush 后新 turn 已开始）→ 不取（Review Focus #3：防 flush 重入）', () => {
    const q = new SessionQueue();
    q.enqueue('s1', { text: 'a', source: 't' });
    const busy = new Map([['s1', Date.now()]]);
    expect(shouldFlush(q, busy, 's1')).toBeNull();
    expect(q.size('s1')).toBe(1);           // 队列不动
  });
  it('item 保留完整信息（idempotencyKey 等——发送时构造新 opts 剥离）', () => {
    const q = new SessionQueue();
    const { item } = q.enqueue('s1', { text: 'a', source: 't', idempotencyKey: 'k' }) as any;
    expect(item.idempotencyKey).toBe('k');
  });
});
