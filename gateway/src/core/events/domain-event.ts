// gateway/src/core/events/domain-event.ts
// Domain event envelope. `domain_events` is the append-only fact log; inbox
// projections (`pod_events`, attention, presence) are derived from it.
export type DomainAggregateType = 'goal' | 'pod' | 'external';
export type DomainEventAudience = 'human' | 'lead' | 'member' | 'none';

export interface DomainEvent {
  eventId: string;
  type: string;
  aggregateType: DomainAggregateType;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  recordedAt: string;
  actor: string | null;
  correlationId: string | null;
  causationId: string | null;
  audience: DomainEventAudience;
  schemaVersion: number;
  payload: Record<string, unknown>;
}

export interface DomainEventInput {
  eventId?: string;
  type: string;
  aggregateType: DomainAggregateType;
  aggregateId: string;
  /** Optimistic concurrency: caller believes this is the current version. */
  expectedVersion?: number;
  occurredAt: string;
  actor?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
  audience: DomainEventAudience;
  payload?: Record<string, unknown>;
}

export class DomainEventConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainEventConflictError';
  }
}
