// gateway/src/core/events/domain-event-consumer.ts
// Consumers (Lead inbox / Standing Goal) prefer the domain fact over the raw
// trigger; decision/internal triggers have no `external:*` event and fall back.
import type { DomainEvent } from './domain-event';
import type { EventTriggerRow } from './event-types';

export function domainEventForTrigger(
  events: { getByEventId(eventId: string): DomainEvent | null } | null,
  trigger: EventTriggerRow,
): DomainEvent | null {
  if (!events || !trigger.idempotencyKey) return null;
  return events.getByEventId(`external:${trigger.idempotencyKey}`);
}

export function consumerEnvelope(
  trigger: EventTriggerRow,
  event: DomainEvent | null,
): { payload: Record<string, unknown>; kind: string } {
  if (!event) return { payload: trigger.payload, kind: trigger.kind };
  return { payload: event.payload, kind: event.type };
}
