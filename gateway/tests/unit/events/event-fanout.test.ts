import Database from 'better-sqlite3';
import { EventStore } from '../../../src/core/events/event-store';
import { EventLayerService } from '../../../src/core/events/event-layer-service';
import type { EventEnvelope } from '../../../src/core/events/event-types';

function envelope(over: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    projectDir: '/p',
    sourceId: 's1',
    sourceKind: 'github',
    externalId: 'd1',
    externalKey: 'acme/app#42',
    kind: 'pr_opened',
    actor: 'alice',
    payload: { number: 42 },
    occurredAt: '2026-11-10T00:00:00.000Z',
    receivedAt: '2026-11-10T00:00:01.000Z',
    idempotencyKey: 'github:d1',
    title: 'PR 42',
    ...over,
  };
}

function harness() {
  const db = new Database(':memory:');
  const store = new EventStore(db);
  store.insertSource({
    id: 's1',
    projectDir: '/p',
    kind: 'github',
    name: 'repo',
    config: {},
    now: '2026-11-10T00:00:00.000Z',
  });
  const broadcast = jest.fn();
  const evaluate = jest.fn(async () => ({ decision: 'accept' as const, mode: 'full' as const, rationale: 'new PR' }));
  const deliverWork = jest.fn(async () => {});
  let seq = 0;
  const service = new EventLayerService({
    store,
    now: () => '2026-11-10T00:00:02.000Z',
    newId: (prefix) => (prefix === 'thread' ? 't1' : `${prefix}_${++seq}`),
    broadcast,
    enabled: () => true,
    evaluate,
    deliverWork,
  });
  return { store, service, broadcast, evaluate, deliverWork };
}

describe('EventLayerService fan-out and evaluation', () => {
  test('work and context both get deliveries, but only work invokes execution', async () => {
    const h = harness();
    h.service.subscribe({ threadId: 't1', subscriberType: 'standing_goal', subscriberId: 'sg1', mode: 'work' });
    h.service.subscribe({ threadId: 't1', subscriberType: 'lead', subscriberId: 'lead1', mode: 'context' });
    h.service.ingest(envelope({ idempotencyKey: 'k1' }));

    const deliveries = h.service.fanOut('t1');
    expect(deliveries).toHaveLength(2);

    await h.service.evaluate('t1');
    expect(h.deliverWork).toHaveBeenCalledTimes(1);
    expect(h.deliverWork.mock.calls[0][0].subscription.mode).toBe('work');
    expect(h.store.latestDecision('t1')).toMatchObject({ decision: 'accept', mode: 'full' });
    expect(h.service.listDeliveries('t1').every((delivery) => delivery.state === 'delivered')).toBe(true);
  });

  test('same trigger set is evaluated once', async () => {
    const h = harness();
    h.service.ingest(envelope({ idempotencyKey: 'k1' }));

    const first = await h.service.evaluate('t1');
    const second = await h.service.evaluate('t1');

    expect(second?.id).toBe(first?.id);
    expect(h.evaluate).toHaveBeenCalledTimes(1);
  });
});
