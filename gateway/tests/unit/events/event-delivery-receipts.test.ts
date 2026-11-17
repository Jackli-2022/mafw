import Database from 'better-sqlite3';
import { EventStore } from '../../../src/core/events/event-store';
import { EventLayerService } from '../../../src/core/events/event-layer-service';

const NOW = '2026-11-17T00:00:00.000Z';

function setup() {
  const db = new Database(':memory:');
  const store = new EventStore(db);
  const logs: string[] = [];
  store.insertSource({ id: 'wh', projectDir: '/p', kind: 'webhook', name: 'wh', config: {}, now: NOW });
  const thread = store.ensureThread({
    id: 'th1', sourceId: 'wh', projectDir: '/p', externalKey: 'k1', title: 'Thread', now: NOW,
  });
  const trigger = store.insertTrigger({
    id: 't1', sourceId: 'wh', threadId: thread.id, externalId: 'e1', kind: 'issue',
    actor: null, payload: {}, occurredAt: NOW, receivedAt: NOW, idempotencyKey: 'wh:1',
  }).row;
  const subscription = store.upsertSubscription({
    id: 's1', threadId: thread.id, subscriberType: 'lead', subscriberId: 'p1',
    mode: 'context', now: NOW,
  });
  const delivery = store.insertDelivery({
    id: 'd1', triggerId: trigger.id, subscriptionId: subscription.id, state: 'pending',
  });
  store.updateDelivery(delivery.id, { state: 'delivered', deliveredAt: NOW });
  store.insertChannel({ id: 'lead:p1', threadId: '*', kind: 'chat', address: {}, now: NOW });
  const outbox = store.insertOutbox({
    id: 'o1', channelId: 'lead:p1', dedupeKey: 'external:t1',
    payload: { kind: 'external', triggerId: trigger.id }, state: 'sent', now: NOW,
  });
  const service = new EventLayerService({
    store,
    now: () => NOW,
    newId: (prefix) => `${prefix}_x`,
    broadcast: () => {},
    enabled: () => true,
    evaluate: async () => ({ decision: 'ignore', rationale: 'test' }),
    log: (message) => logs.push(message),
  });
  return { db, store, service, delivery, outbox, logs };
}

test('receipts move the delivery and mirror the outbox timestamps', () => {
  const h = setup();
  h.service.markDeliveryReceipt('d1', 'read');
  expect(h.store.getDelivery('d1')?.state).toBe('read');
  expect(h.store.getOutbox(h.outbox.id)?.readAt).toBe(NOW);

  h.service.markDeliveryReceipt('d1', 'acknowledged');
  expect(h.store.getOutbox(h.outbox.id)?.ackAt).toBe(NOW);

  h.service.markDeliveryReceipt('d1', 'answered');
  expect(h.store.getDelivery('d1')?.state).toBe('answered');
  expect(h.store.getOutbox(h.outbox.id)?.answeredAt).toBe(NOW);
});

test('invalid transitions throw and change nothing', () => {
  const h = setup();
  expect(() => h.service.markDeliveryReceipt('d1', 'answered')).toThrow(/invalid delivery transition/);
  expect(h.store.getDelivery('d1')?.state).toBe('delivered');
  expect(h.store.getOutbox(h.outbox.id)?.answeredAt).toBeNull();
});

test('receipts are scoped to the subscriber pod and sent rows', () => {
  const h = setup();
  h.store.insertChannel({ id: 'lead:p2', threadId: '*', kind: 'chat', address: {}, now: NOW });
  const other = h.store.insertOutbox({
    id: 'o2', channelId: 'lead:p2', dedupeKey: 'external:t1',
    payload: { kind: 'external', triggerId: 't1' }, state: 'sent', now: NOW,
  });
  h.service.markDeliveryReceipt('d1', 'read');
  expect(h.store.getOutbox(h.outbox.id)?.readAt).toBe(NOW);
  expect(h.store.getOutbox(other.id)?.readAt).toBeNull();
});

test('a receipt whose outbox write fails rolls the delivery back', () => {
  const h = setup();
  const spy = jest.spyOn(h.store, 'updateDelivery').mockImplementation(() => {
    throw new Error('write failed');
  });
  try {
    expect(() => h.service.markDeliveryReceipt('d1', 'read')).toThrow('write failed');
  } finally {
    spy.mockRestore();
  }
  expect(h.store.getOutbox(h.outbox.id)?.readAt).toBeNull();
  expect(h.store.getDelivery('d1')?.state).toBe('delivered');
});

test('a human can answer directly after reading', () => {
  const h = setup();
  h.service.markDeliveryReceipt('d1', 'read');
  h.service.markDeliveryReceipt('d1', 'answered');
  expect(h.store.getDelivery('d1')?.state).toBe('answered');
  expect(h.store.getOutbox(h.outbox.id)?.answeredAt).toBe(NOW);
});

test('logs when an external receipt has no outbox row', () => {
  const h = setup();
  h.db.prepare('DELETE FROM event_outbox WHERE id = ?').run(h.outbox.id);
  h.service.markDeliveryReceipt('d1', 'read');
  expect(h.logs.some((line) => line.includes('no outbox row'))).toBe(true);
  expect(h.store.getDelivery('d1')?.state).toBe('read');
});

test('lead session ack propagates to the delivery audit', () => {
  const h = setup();
  h.store.updateOutbox(h.outbox.id, {
    state: 'sent', sentSessionId: 'ses_a', ackAt: '2026-11-17T00:01:00.000Z',
  });
  expect(h.store.ackDeliveriesForSession('ses_a', '2026-11-17T00:01:00.000Z')).toBe(1);
  expect(h.store.getDelivery('d1')?.state).toBe('acknowledged');
  expect(h.store.getDelivery('d1')?.ackAt).toBe('2026-11-17T00:01:00.000Z');
  expect(h.store.getDelivery('d1')?.readAt).toBe('2026-11-17T00:01:00.000Z');
});
