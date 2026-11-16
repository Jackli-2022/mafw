import Database from 'better-sqlite3';
import { EventStore } from '../../../src/core/events/event-store';
import { EventLayerService, admitIngress } from '../../../src/core/events/event-layer-service';
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

function harness(over: Partial<ConstructorParameters<typeof EventLayerService>[0]> = {}) {
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
  const evaluate = jest.fn(async () => ({ decision: 'ignore' as const, rationale: 'no evaluator' }));
  let seq = 0;
  const service = new EventLayerService({
    store,
    now: () => '2026-11-10T00:00:01.000Z',
    newId: (prefix) => (prefix === 'thread' ? 't1' : `${prefix}_${++seq}`),
    broadcast,
    enabled: () => true,
    evaluate,
    ...over,
  });
  return { store, service, broadcast };
}

describe('EventLayerService ingress', () => {
  test('ingest is idempotent and emits one received event', () => {
    const h = harness();
    const first = h.service.ingest(envelope({ idempotencyKey: 'k1' }));
    const second = h.service.ingest(envelope({ idempotencyKey: 'k1' }));
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(h.broadcast).toHaveBeenCalledTimes(1);
    expect(h.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'event.trigger.received' }));
  });

  test('disabled layer refuses ingest', () => {
    const h = harness({ enabled: () => false });
    expect(() => h.service.ingest(envelope())).toThrow('event layer disabled');
  });

  test('disabled source refuses ingest', () => {
    const h = harness();
    h.service.setSourceEnabled('s1', false);
    expect(() => h.service.ingest(envelope())).toThrow('event source disabled');
  });

  test('person events are admitted even when the queue is full', () => {
    expect(admitIngress({ queueDepth: 100, person: true, tokens: 0, maxQueueDepth: 100 })).toEqual({ ok: true });
    expect(admitIngress({ queueDepth: 100, person: false, tokens: 10, maxQueueDepth: 100 }))
      .toMatchObject({ ok: false, reason: 'queue_full' });
    expect(admitIngress({ queueDepth: 0, person: false, tokens: 0, maxQueueDepth: 100 }))
      .toMatchObject({ ok: false, reason: 'rate_limited' });
  });

  test('ensureSystemSource creates the internal source once', () => {
    const h = harness();
    const first = h.service.ensureSystemSource('internal');
    const second = h.service.ensureSystemSource('internal');
    expect(first).toMatchObject({ id: 'internal', kind: 'internal', enabled: true });
    expect(second.id).toBe('internal');
    expect(h.store.getSource('internal')).toMatchObject({ id: 'internal', enabled: true });
  });

  test('creates sources and stores work/context subscriptions', () => {
    const h = harness();
    const source = h.service.createSource({ projectDir: '/p', kind: 'webhook', name: 'hooks', config: {} });
    expect(h.service.listSources('/p').map((item) => item.id)).toContain(source.id);
    expect(h.service.setSourceEnabled(source.id, false).enabled).toBe(false);

    h.service.ingest(envelope());
    const work = h.service.subscribe({ threadId: 't1', subscriberType: 'standing_goal', subscriberId: 'sg1', mode: 'work' });
    expect(work.mode).toBe('work');
    expect(h.service.listSubscriptions('t1')).toHaveLength(1);
  });
});
