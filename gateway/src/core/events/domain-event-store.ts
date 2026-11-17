// gateway/src/core/events/domain-event-store.ts
// Append-only domain event log. One version sequence per aggregate; `eventId`
// is the idempotency key so a crash between append and outbox retries safely.
import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import {
  DomainEventConflictError,
  type DomainAggregateType,
  type DomainEvent,
  type DomainEventInput,
} from './domain-event';

interface DomainEventDbRow {
  event_id: string;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  occurred_at: string;
  recorded_at: string;
  actor: string | null;
  correlation_id: string | null;
  causation_id: string | null;
  audience: string;
  schema_version: number;
  payload: string;
}

function toEvent(row: DomainEventDbRow): DomainEvent {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.payload);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed;
  } catch {
    /* unreadable payload stays empty; the row itself is the fact */
  }
  return {
    eventId: row.event_id,
    type: row.type,
    aggregateType: row.aggregate_type as DomainAggregateType,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    actor: row.actor ?? null,
    correlationId: row.correlation_id ?? null,
    causationId: row.causation_id ?? null,
    audience: row.audience as DomainEvent['audience'],
    schemaVersion: row.schema_version,
    payload,
  };
}

export class DomainEventStore {
  constructor(private readonly db: Database.Database) {
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS domain_events (
        event_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_version INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        actor TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        audience TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        payload TEXT NOT NULL DEFAULT '{}',
        UNIQUE(aggregate_type, aggregate_id, aggregate_version)
      );
      CREATE INDEX IF NOT EXISTS idx_domain_events_aggregate
        ON domain_events(aggregate_type, aggregate_id, aggregate_version);
    `);
  }

  getByEventId(eventId: string): DomainEvent | null {
    const row = this.db.prepare('SELECT * FROM domain_events WHERE event_id = ?')
      .get(eventId) as DomainEventDbRow | undefined;
    return row ? toEvent(row) : null;
  }

  lastVersion(aggregateType: DomainAggregateType, aggregateId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(aggregate_version), 0) AS version
      FROM domain_events WHERE aggregate_type = ? AND aggregate_id = ?
    `).get(aggregateType, aggregateId) as { version: number };
    return Number(row?.version ?? 0);
  }

  append(input: DomainEventInput): DomainEvent {
    return this.db.transaction((): DomainEvent => {
      if (input.eventId) {
        const existing = this.getByEventId(input.eventId);
        if (existing) return existing;
      }

      const current = this.lastVersion(input.aggregateType, input.aggregateId);
      if (input.expectedVersion !== undefined && input.expectedVersion !== current) {
        throw new DomainEventConflictError(
          `${input.aggregateType}:${input.aggregateId} expected version ${input.expectedVersion} but current is ${current}`,
        );
      }

      const eventId = input.eventId ?? `devt_${randomUUID()}`;
      const version = current + 1;
      const recordedAt = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO domain_events (
          event_id, type, aggregate_type, aggregate_id, aggregate_version,
          occurred_at, recorded_at, actor, correlation_id, causation_id,
          audience, schema_version, payload
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        eventId,
        input.type,
        input.aggregateType,
        input.aggregateId,
        version,
        input.occurredAt,
        recordedAt,
        input.actor ?? null,
        input.correlationId ?? null,
        input.causationId ?? null,
        input.audience,
        JSON.stringify(input.payload ?? {}),
      );

      return this.getByEventId(eventId)!;
    })();
  }

  listAggregate(
    aggregateType: DomainAggregateType,
    aggregateId: string,
    opts: { afterVersion?: number; limit?: number } = {},
  ): DomainEvent[] {
    const after = opts.afterVersion ?? 0;
    const limit = Math.max(1, Math.min(10_000, opts.limit ?? 10_000));
    const rows = this.db.prepare(`
      SELECT * FROM domain_events
      WHERE aggregate_type = ? AND aggregate_id = ? AND aggregate_version > ?
      ORDER BY aggregate_version ASC
      LIMIT ?
    `).all(aggregateType, aggregateId, after, limit) as DomainEventDbRow[];
    return rows.map(toEvent);
  }
}
