import { WriteQueue } from '../../../gateway/src/memory/write-queue';

test('serializes concurrent writes', async () => {
  const q = new WriteQueue();
  const order: number[] = [];
  const p1 = q.enqueue(async () => { await new Promise(r => setTimeout(r, 10)); order.push(1); });
  const p2 = q.enqueue(async () => { order.push(2); });
  await Promise.all([p1, p2]);
  expect(order).toEqual([1, 2]);
});

test('propagates errors from enqueued functions', async () => {
  const q = new WriteQueue();
  const err = new Error('test error');
  const p = q.enqueue(async () => { throw err; });
  await expect(p).rejects.toThrow('test error');
});
