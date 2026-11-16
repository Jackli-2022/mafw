import Database from 'better-sqlite3';
import { DomainEventConflictError, DomainEventStore } from '../../../src/core/events/domain-event-store';

const base = {
  type: 'goal.node.started',
  aggregateType: 'goal' as const,
  aggregateId: 'g1',
  occurredAt: '2026-11-16T00:00:00.000Z',
  audience: 'none' as const,
  payload: { node: 'plan' },
};

test('assigns monotonic versions per aggregate and replays in order', () => {
  const store = new DomainEventStore(new Database(':memory:'));
  const a = store.append({ ...base, eventId: 'e1' });
  const b = store.append({ ...base, eventId: 'e2', type: 'goal.node.completed' });
  const other = store.append({ ...base, eventId: 'e3', aggregateId: 'g2' });
  expect([a.aggregateVersion, b.aggregateVersion, other.aggregateVersion]).toEqual([1, 2, 1]);
  expect(store.listAggregate('goal', 'g1').map((e) => e.eventId)).toEqual(['e1', 'e2']);
  expect(store.lastVersion('goal', 'g1')).toBe(2);
});

test('same eventId is idempotent and does not bump the version', () => {
  const store = new DomainEventStore(new Database(':memory:'));
  const first = store.append({ ...base, eventId: 'e1' });
  const again = store.append({ ...base, eventId: 'e1', payload: { node: 'review' } });
  expect(again.aggregateVersion).toBe(first.aggregateVersion);
  expect(again.payload).toEqual({ node: 'plan' });
  expect(store.listAggregate('goal', 'g1')).toHaveLength(1);
});

test('rejects a stale expectedVersion', () => {
  const store = new DomainEventStore(new Database(':memory:'));
  store.append({ ...base, eventId: 'e1' });
  expect(() => store.append({ ...base, eventId: 'e2', expectedVersion: 0 }))
    .toThrow(DomainEventConflictError);
});

test('afterVersion filters the replay tail', () => {
  const store = new DomainEventStore(new Database(':memory:'));
  store.append({ ...base, eventId: 'e1' });
  store.append({ ...base, eventId: 'e2' });
  expect(store.listAggregate('goal', 'g1', { afterVersion: 1 }).map((e) => e.eventId))
    .toEqual(['e2']);
});
