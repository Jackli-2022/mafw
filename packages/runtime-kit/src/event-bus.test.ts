import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from './event-bus.ts';

test('fan-out: every subscriber receives every pushed value', async () => {
  const bus = createEventBus<{ n: number }>();
  const a = (await bus.event()).stream;
  const b = (await bus.event()).stream;
  const gotA: number[] = [];
  const gotB: number[] = [];
  const ia = a[Symbol.asyncIterator]();
  const ib = b[Symbol.asyncIterator]();
  const pa = (async () => { for (let i = 0; i < 3; i++) gotA.push((await ia.next()).value.n); })();
  const pb = (async () => { for (let i = 0; i < 3; i++) gotB.push((await ib.next()).value.n); })();
  await Promise.resolve();
  bus.push({ n: 1 });
  bus.push({ n: 2 });
  bus.push({ n: 3 });
  await Promise.all([pa, pb]);
  assert.deepEqual(gotA, [1, 2, 3]);
  assert.deepEqual(gotB, [1, 2, 3]);
});

test('no replay: values pushed before subscription are dropped', async () => {
  const bus = createEventBus<string>();
  bus.push('lost');
  const stream = (await bus.event()).stream;
  const it = stream[Symbol.asyncIterator]();
  bus.push('delivered');
  const next = await it.next();
  assert.equal(next.value, 'delivered');
  assert.equal(next.done, false);
});

test('stream return unsubscribes (no further delivery, push stays safe)', async () => {
  const bus = createEventBus<number>();
  const stream = (await bus.event()).stream;
  const it = stream[Symbol.asyncIterator]();
  await it.return?.();
  bus.push(1); // must not throw
});
