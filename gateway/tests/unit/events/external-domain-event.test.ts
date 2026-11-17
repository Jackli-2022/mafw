import Database from 'better-sqlite3';
import { DomainEventStore } from '../../../src/core/events/domain-event-store';
import { EventStore } from '../../../src/core/events/event-store';
import { EventLayerService } from '../../../src/core/events/event-layer-service';
import { externalDomainEvent } from '../../../src/core/events/external-domain-event';

function setup() {
  const db = new Database(':memory:');
  const store = new EventStore(db);
  store.insertSource({
    id: 'gh', projectDir: '/p', kind: 'github', name: 'gh',
    config: {}, now: '2026-11-17T00:00:00.000Z',
  });
  const domainEvents = new DomainEventStore(db);
  let seq = 0;
  const layer = new EventLayerService({
    store,
    domainEvents,
    now: () => '2026-11-17T00:00:00.000Z',
    newId: (prefix) => `${prefix}_${++seq}`,
    broadcast: () => {},
    enabled: () => true,
    evaluate: async () => ({ decision: 'ignore', rationale: 'test' }),
  });
  return { db, store, domainEvents, layer };
}

const envelope = {
  projectDir: '/p', sourceId: 'gh', sourceKind: 'github' as const,
  externalId: 'issue-1', externalKey: 'acme/repo#1', kind: 'issue',
  actor: 'octocat', payload: { title: 'Bug' },
  occurredAt: '2026-11-17T00:00:00.000Z', receivedAt: '2026-11-17T00:00:00.000Z',
  idempotencyKey: 'gh:acme/repo#1:issue:1', title: 'Bug',
};

test('maps an external event to a domain event', () => {
  expect(externalDomainEvent({ envelope, triggerId: 't1' }))
    .toMatchObject({
      type: 'external.github.issue',
      aggregateType: 'external',
      aggregateId: 'acme/repo#1',
      eventId: 'external:gh:acme/repo#1:issue:1',
      audience: 'none',
    });
});

test('duplicate ingest keeps one trigger and one domain event', () => {
  const h = setup();
  const first = h.layer.ingest(envelope);
  const second = h.layer.ingest(envelope);
  expect(second.duplicate).toBe(true);
  const events = h.domainEvents.listAggregate('external', 'acme/repo#1');
  expect(events).toHaveLength(1);
  expect(events[0].aggregateVersion).toBe(1);
  expect(first.trigger.id).toBe(second.trigger.id);
});

test('internal sources do not append external events', () => {
  const h = setup();
  h.store.insertSource({
    id: 'internal', projectDir: '*', kind: 'internal', name: 'internal',
    config: {}, now: '2026-11-17T00:00:00.000Z',
  });
  h.store.insertSource({
    id: 'cron', projectDir: '*', kind: 'cron', name: 'cron',
    config: {}, now: '2026-11-17T00:00:00.000Z',
  });
  h.layer.ingest({
    ...envelope, sourceId: 'internal', sourceKind: 'internal', idempotencyKey: 'internal:1',
  });
  expect(h.domainEvents.listAggregate('external', 'acme/repo#1')).toHaveLength(0);
  h.layer.ingest({
    ...envelope, sourceId: 'cron', sourceKind: 'cron', kind: 'cron.tick',
    externalKey: 'cron:standing-1', idempotencyKey: 'cron:1',
  });
  expect(h.domainEvents.listAggregate('external', 'cron:standing-1')[0]?.type)
    .toBe('external.cron.tick');
});
