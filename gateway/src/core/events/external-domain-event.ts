// gateway/src/core/events/external-domain-event.ts
// External ingests (GitHub / cron / webhook) become domain facts. The event id is
// derived from the trigger idempotency key, so a duplicate delivery is a no-op
// at the domain log as well as in `event_triggers`.
import type { DomainEventInput } from './domain-event';
import type { EventEnvelope, EventSourceKind } from './event-types';

export function externalEventType(sourceKind: EventSourceKind, kind: string): string {
  const normalized = String(kind ?? '').trim() || 'event';
  if (sourceKind === 'cron') {
    return `external.cron.${normalized.replace(/^cron\./, '')}`;
  }
  return `external.${sourceKind}.${normalized}`;
}

export function externalDomainEvent(input: {
  envelope: EventEnvelope;
  triggerId: string;
}): DomainEventInput {
  const { envelope } = input;
  return {
    eventId: `external:${envelope.idempotencyKey}`,
    type: externalEventType(envelope.sourceKind, envelope.kind),
    aggregateType: 'external',
    aggregateId: envelope.externalKey,
    occurredAt: envelope.occurredAt,
    audience: 'none',
    payload: {
      triggerId: input.triggerId,
      sourceId: envelope.sourceId,
      sourceKind: envelope.sourceKind,
      externalKey: envelope.externalKey,
      externalId: envelope.externalId,
      kind: envelope.kind,
      actor: envelope.actor,
      title: envelope.title,
      projectDir: envelope.projectDir,
      occurredAt: envelope.occurredAt,
      data: envelope.payload,
    },
  };
}
