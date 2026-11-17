import Database from 'better-sqlite3';
import { EventStore } from '../../../src/core/events/event-store';
import { EventLayerService } from '../../../src/core/events/event-layer-service';

const NOW = '2026-11-17T00:00:00.000Z';

function setup(opts: {
  maxDeliveryAttempts?: number;
  deliverContext?: () => Promise<void>;
} = {}) {
  const db = new Database(':memory:');
  const store = new EventStore(db);
  store.insertSource({ id: 'wh', projectDir: '/p', kind: 'webhook', name: 'wh', config: {}, now: NOW });
  const thread = store.ensureThread({
    id: 'th1', sourceId: 'wh', projectDir: '/p', externalKey: 'k1', title: 'Thread', now: NOW,
  });
  store.insertTrigger({
    id: 't1', sourceId: 'wh', threadId: thread.id, externalId: 'e1', kind: 'issue',
    actor: null, payload: {}, occurredAt: NOW, receivedAt: NOW, idempotencyKey: 'wh:1',
  });
  let seq = 0;
  const service = new EventLayerService({
    store,
    now: () => NOW,
    newId: (prefix) => `${prefix}_${++seq}`,
    broadcast: () => {},
    enabled: () => true,
    evaluate: async () => ({ decision: 'accept', mode: 'report', rationale: 'test' }),
    deliverContext: opts.deliverContext ?? (async () => {}),
    maxDeliveryAttempts: opts.maxDeliveryAttempts,
  });
  return { db, store, service, threadId: thread.id };
}

function prepareDelivery(h: ReturnType<typeof setup>) {
  h.service.subscribe({
    threadId: h.threadId, subscriberType: 'lead', subscriberId: 'p1', mode: 'context',
  });
  const deliveries = h.service.fanOut(h.threadId);
  return deliveries[0];
}

test('a delivery drops as dead-letter after max attempts', async () => {
  const h = setup({
    deliverContext: async () => { throw new Error('lead offline'); },
    maxDeliveryAttempts: 2,
  });
  const delivery = prepareDelivery(h);
  await h.service.evaluate(h.threadId);
  expect(h.store.getDelivery(delivery.id)?.state).toBe('failed');
  h.store.updateDelivery(delivery.id, { nextRetryAt: '2000-01-01T00:00:00.000Z' });
  await h.service.evaluate(h.threadId);
  expect(h.store.getDelivery(delivery.id)?.state).toBe('dropped');
  expect(h.store.getDelivery(delivery.id)?.lastError).toContain('dead-letter');
});

test('an overdue failed delivery retries once after restart', async () => {
  let failures = 1;
  const h = setup({
    deliverContext: async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('transient');
      }
    },
  });
  const delivery = prepareDelivery(h);
  await h.service.evaluate(h.threadId);
  expect(h.store.getDelivery(delivery.id)?.state).toBe('failed');
  h.store.updateDelivery(delivery.id, { nextRetryAt: '2000-01-01T00:00:00.000Z' });

  let seq = 0;
  const restarted = new EventLayerService({
    store: h.store,
    now: () => NOW,
    newId: (prefix) => `${prefix}_r${++seq}`,
    broadcast: () => {},
    enabled: () => true,
    evaluate: async () => ({ decision: 'accept', mode: 'report', rationale: 'test' }),
    deliverContext: async () => {},
  });
  await restarted.evaluate(h.threadId);
  expect(h.store.getDelivery(delivery.id)?.state).toBe('delivered');
});
