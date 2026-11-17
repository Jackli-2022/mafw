// gateway/src/core/events/external-domain-event.ts
// External ingests (GitHub / cron / webhook) become domain facts. The event id is
// derived from the trigger idempotency key, so a duplicate delivery is a no-op
// at the domain log as well as in `event_triggers`.
import type { DomainEventInput } from './domain-event';
import type { EventEnvelope, EventSourceKind } from './event-types';

/** External payloads above this size are summarized in the domain log. */
export const EXTERNAL_EVENT_PAYLOAD_LIMIT_BYTES = 16_384;

function packedData(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const safe = payload && typeof payload === 'object' ? payload : {};
  let serialized: string;
  try {
    serialized = JSON.stringify(safe);
  } catch {
    return { dataOmitted: true, dataBytes: 0 };
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes <= EXTERNAL_EVENT_PAYLOAD_LIMIT_BYTES) return { data: safe };
  return { dataOmitted: true, dataBytes: bytes };
}

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
      ...packedData(envelope.payload),
    },
  };
}
