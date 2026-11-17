import Database from 'better-sqlite3';
import { DomainEventStore } from '../../../src/core/events/domain-event-store';
import { domainEventForTrigger, consumerEnvelope } from '../../../src/core/events/domain-event-consumer';
import { renderDomainEvent } from '../../../src/core/events/lead-event';

const trigger = {
  id: 'trigger_1', sourceId: 'wh', threadId: 'th1', externalId: 'e1', kind: 'issue',
  actor: 'octocat', payload: { title: 'Trigger title' },
  occurredAt: '2026-11-17T00:00:00.000Z', receivedAt: '2026-11-17T00:00:00.000Z',
  idempotencyKey: 'wh:delivery-1', disposition: 'accepted',
} as any;

test('finds the external event by trigger idempotency key', () => {
  const store = new DomainEventStore(new Database(':memory:'));
  const event = store.append({
    eventId: 'external:wh:delivery-1',
    type: 'external.webhook.issue', aggregateType: 'external', aggregateId: 'thread-key',
    occurredAt: '2026-11-17T00:00:00.000Z', audience: 'none',
    payload: {
      triggerId: 'trigger_1', sourceKind: 'webhook', title: 'Event title', actor: 'hubot',
      data: { action: 'opened', branch: 'main' },
    },
  });
  expect(domainEventForTrigger(store, trigger)?.eventId).toBe(event.eventId);
  expect(consumerEnvelope(trigger, domainEventForTrigger(store, trigger)))
    .toEqual({
      payload: { action: 'opened', branch: 'main' },
      kind: trigger.kind,
    });
});

test('rejects an event whose triggerId does not match', () => {
  const store = new DomainEventStore(new Database(':memory:'));
  store.append({
    eventId: 'external:wh:delivery-1',
    type: 'external.webhook.issue', aggregateType: 'external', aggregateId: 'thread-key',
    occurredAt: '2026-11-17T00:00:00.000Z', audience: 'none',
    payload: { triggerId: 'someone-else' },
  });
  expect(domainEventForTrigger(store, trigger)).toBeNull();
});

test('falls back to the trigger payload for omitted or missing data', () => {
  const base = {
    eventId: 'external:wh:1', type: 'external.webhook.issue',
    aggregateType: 'external' as const, aggregateId: 'thread-key', aggregateVersion: 1,
    occurredAt: '2026-11-17T00:00:00.000Z', recordedAt: '2026-11-17T00:00:00.000Z',
    actor: null, correlationId: null, causationId: null, audience: 'none' as const,
    schemaVersion: 1,
  };
  expect(consumerEnvelope(trigger, { ...base, payload: { dataOmitted: true, dataBytes: 20000 } }))
    .toEqual({ payload: trigger.payload, kind: trigger.kind });
  expect(consumerEnvelope(trigger, { ...base, payload: { title: 'no data' } }))
    .toEqual({ payload: trigger.payload, kind: trigger.kind });
});

test('falls back to the trigger when the event is missing', () => {
  expect(domainEventForTrigger(null, trigger)).toBeNull();
  expect(consumerEnvelope(trigger, null))
    .toEqual({ payload: trigger.payload, kind: trigger.kind });
});

test('renders an external domain event', () => {
  const text = renderDomainEvent({
    eventId: 'external:wh:1', type: 'external.webhook.issue',
    aggregateType: 'external', aggregateId: 'thread-key', aggregateVersion: 1,
    occurredAt: '2026-11-17T00:00:00.000Z', recordedAt: '2026-11-17T00:00:00.000Z',
    actor: null, correlationId: null, causationId: null, audience: 'none', schemaVersion: 1,
    payload: { sourceKind: 'webhook', title: 'Event title', actor: 'hubot' },
  });
  expect(text).toContain('[EVENT]');
  expect(text).toContain('type=external.webhook.issue');
  expect(text).toContain('key=thread-key');
  expect(text).toContain('title: Event title');
  expect(text).toContain('actor=hubot');
});
