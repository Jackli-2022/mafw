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

function harness(over: Record<string, any> = {}, nowFn = () => '2026-11-10T00:00:02.000Z') {
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
  const evaluate = over.evaluate ?? jest.fn(async () => ({ decision: 'accept' as const, mode: 'full' as const, rationale: 'new PR' }));
  const deliverWork = over.deliverWork ?? jest.fn(async () => {});
  let seq = 0;
  const service = new EventLayerService({
    store,
    now: nowFn,
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
    h.service.subscribe({ threadId: 't1', subscriberType: 'standing_goal', subscriberId: 'sg1', mode: 'work' });
    h.service.ingest(envelope({ idempotencyKey: 'k1' }));

    const first = await h.service.evaluate('t1');
    const second = await h.service.evaluate('t1');

    expect(second?.id).toBe(first?.id);
    expect(h.evaluate).toHaveBeenCalledTimes(1);
  });

  test('failed work delivery is recorded and retried after backoff', async () => {
    let now = '2026-11-10T00:00:02.000Z';
    const deliverWork = jest.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const h = harness({ deliverWork }, () => now);
    h.service.subscribe({ threadId: 't1', subscriberType: 'standing_goal', subscriberId: 'sg1', mode: 'work' });
    h.service.ingest(envelope({ idempotencyKey: 'k1' }));
    h.service.fanOut('t1');
    await h.service.evaluate('t1');

    expect(h.service.listDeliveries('t1')[0]).toMatchObject({
      state: 'failed',
      attempts: 1,
      lastError: 'offline',
    });

    now = '2026-11-10T00:00:05.000Z';
    await h.service.evaluate('t1');
    expect(deliverWork).toHaveBeenCalledTimes(2);
    expect(h.service.listDeliveries('t1')[0]).toMatchObject({ state: 'delivered', lastError: null });
  });

  test('unavailable decision leaves the batch pending for a later retry', async () => {
    const evaluate = jest.fn(async () => ({ decision: 'unavailable' as const, rationale: 'timeout' }));
    const h = harness({ evaluate });
    h.service.subscribe({ threadId: 't1', subscriberType: 'standing_goal', subscriberId: 'sg1', mode: 'work' });
    h.service.ingest(envelope({ idempotencyKey: 'k1' }));
    h.service.fanOut('t1');

    await h.service.evaluate('t1');
    await h.service.evaluate('t1');

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(h.service.listTriggers('t1')[0].disposition).toBe('fanned_out');
  });

  test('a thread without subscriptions can fan out later', () => {
    const h = harness();
    h.service.ingest(envelope({ idempotencyKey: 'k1' }));
    expect(h.service.fanOut('t1')).toHaveLength(0);
    expect(h.service.listTriggers('t1')[0].disposition).toBe('pending');

    h.service.subscribe({ threadId: 't1', subscriberType: 'standing_goal', subscriberId: 'sg1', mode: 'work' });
    expect(h.service.fanOut('t1')).toHaveLength(1);
  });
});
