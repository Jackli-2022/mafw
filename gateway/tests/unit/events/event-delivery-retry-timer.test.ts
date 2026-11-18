import {
  EVENT_DELIVERY_RETRY_INTERVAL_MS,
  startEventDeliveryRetry,
} from '../../../src/core/events/event-delivery-retry';

interface PendingSweep {
  resolve: () => void;
  reject: (error: unknown) => void;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function harness() {
  let registered: { name: string; ms: number; fn: () => void } | null = null;
  const pending: PendingSweep[] = [];
  const logs: string[] = [];
  const handle = { clear: () => {} };
  const timer = startEventDeliveryRetry({
    every: (name, ms, fn) => {
      registered = { name, ms, fn };
      return handle;
    },
    sweep: () => new Promise<void>((resolve, reject) => {
      pending.push({ resolve, reject });
    }),
    log: (message) => logs.push(message),
  });
  return { timer, handle, registered: () => registered, pending, logs };
}

test('registers a 30s delivery retry timer', () => {
  const h = harness();
  expect(h.registered()).toMatchObject({
    name: 'event:delivery-retry',
    ms: EVENT_DELIVERY_RETRY_INTERVAL_MS,
  });
  expect(EVENT_DELIVERY_RETRY_INTERVAL_MS).toBe(30_000);
});

test('skips an overlapping sweep while the previous one is in flight', async () => {
  const h = harness();
  h.registered()!.fn();
  h.registered()!.fn();
  await flush();
  expect(h.pending).toHaveLength(1);

  h.pending[0].resolve();
  await flush();
  h.registered()!.fn();
  await flush();
  expect(h.pending).toHaveLength(2);
});

test('logs a sweep failure and releases the in-flight guard', async () => {
  const h = harness();
  h.registered()!.fn();
  await flush();
  h.pending[0].reject(new Error('db busy'));
  await flush();
  expect(h.logs[0]).toContain('db busy');

  h.registered()!.fn();
  await flush();
  expect(h.pending).toHaveLength(2);
});

test('clearing the returned handle clears the registered timer', () => {
  const h = harness();
  let cleared = false;
  (h.handle as { clear: () => void }).clear = () => { cleared = true; };
  h.timer.clear();
  expect(cleared).toBe(true);
});
