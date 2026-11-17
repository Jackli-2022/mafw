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
  const event = events.getByEventId(`external:${trigger.idempotencyKey}`);
  if (!event) return null;
  const eventTriggerId = event.payload?.triggerId;
  if (typeof eventTriggerId === 'string' && eventTriggerId !== trigger.id) return null;
  return event;
}

export function consumerEnvelope(
  trigger: EventTriggerRow,
  event: DomainEvent | null,
): { payload: Record<string, unknown>; kind: string } {
  // Standing Goal filters keep the raw trigger kind (e.g. `pr_opened`); only
  // the content comes from the domain event. The event payload wraps the raw
  // webhook body under `data`; oversized bodies are omitted and fall back.
  if (!event) return { payload: trigger.payload, kind: trigger.kind };
  const data = event.payload?.data;
  const payload = data && typeof data === 'object' && !event.payload.dataOmitted
    ? data as Record<string, unknown>
    : trigger.payload;
  return { payload, kind: trigger.kind };
}
