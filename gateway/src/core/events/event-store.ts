import type { Database } from 'better-sqlite3';
import type {
  EventChannelRow,
  EventDecisionRow,
  EventDeliveryRow,
  EventDeliveryState,
  EventDisposition,
  EventOutboxRow,
  EventSourceKind,
  EventSourceRow,
  EventSubscriptionMode,
  EventSubscriptionRow,
  EventThreadRow,
  EventTriggerRow,
} from './event-types';

interface SourceDbRow {
  id: string;
  project_dir: string;
  kind: string;
  name: string;
  config: string | null;
  enabled: number;
  cursor: string | null;
  created_at: string;
  updated_at: string;
}

interface ThreadDbRow {
  id: string;
  source_id: string;
  project_dir: string;
  external_key: string;
  title: string;
  state: string;
  last_trigger_at: string | null;
  created_at: string;
}

interface TriggerDbRow {
  id: string;
  source_id: string;
  thread_id: string;
  external_id: string;
  kind: string;
  actor: string | null;
  payload: string | null;
  occurred_at: string;
  received_at: string;
  idempotency_key: string;
  disposition: string;
}

interface SubscriptionDbRow {
  id: string;
  thread_id: string;
  subscriber_type: string;
  subscriber_id: string;
  mode: string;
  created_at: string;
  expires_at: string | null;
  dropped_at: string | null;
}

interface DecisionDbRow {
  id: string;
  thread_id: string;
  trigger_ids: string | null;
  decision: string;
  mode: string | null;
  goal_run_id: string | null;
  rationale: string;
  decided_by: string | null;
  created_at: string;
}

interface DeliveryDbRow {
  id: string;
  trigger_id: string;
  subscription_id: string;
  state: string;
  attempts: number;
  last_error: string | null;
  delivered_at: string | null;
  read_at: string | null;
  ack_at: string | null;
  answered_at: string | null;
  next_retry_at: string | null;
}

interface ChannelDbRow {
  id: string;
  thread_id: string;
  kind: string;
  address: string | null;
  created_at: string;
}

interface OutboxDbRow {
  id: string;
  channel_id: string;
  dedupe_key: string;
  payload: string | null;
  state: string;
  attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function parseJson(value: unknown, fallback: any): any {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toSource(row: SourceDbRow): EventSourceRow {
  return {
    id: row.id,
    projectDir: row.project_dir,
    kind: row.kind as EventSourceKind,
    name: row.name,
    config: parseJson(row.config, {}),
    enabled: row.enabled === 1,
    cursor: parseJson(row.cursor, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toThread(row: ThreadDbRow): EventThreadRow {
  return {
    id: row.id,
    sourceId: row.source_id,
    projectDir: row.project_dir,
    externalKey: row.external_key,
    title: row.title,
    state: row.state as EventThreadRow['state'],
    lastTriggerAt: row.last_trigger_at,
    createdAt: row.created_at,
  };
}

function toTrigger(row: TriggerDbRow): EventTriggerRow {
  return {
    id: row.id,
    sourceId: row.source_id,
    threadId: row.thread_id,
    externalId: row.external_id,
    kind: row.kind,
    actor: row.actor,
    payload: parseJson(row.payload, {}),
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    idempotencyKey: row.idempotency_key,
    disposition: row.disposition as EventDisposition,
  };
}

function toSubscription(row: SubscriptionDbRow): EventSubscriptionRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    subscriberType: row.subscriber_type as EventSubscriptionRow['subscriberType'],
    subscriberId: row.subscriber_id,
    mode: row.mode as EventSubscriptionMode,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    droppedAt: row.dropped_at,
  };
}

function toDecision(row: DecisionDbRow): EventDecisionRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    triggerIds: parseJson(row.trigger_ids, []),
    decision: row.decision as EventDecisionRow['decision'],
    mode: row.mode as EventDecisionRow['mode'],
    goalRunId: row.goal_run_id,
    rationale: row.rationale,
    decidedBy: row.decided_by,
    createdAt: row.created_at,
  };
}

function toDelivery(row: DeliveryDbRow): EventDeliveryRow {
  return {
    id: row.id,
    triggerId: row.trigger_id,
    subscriptionId: row.subscription_id,
    state: row.state as EventDeliveryState,
    attempts: Number(row.attempts ?? 0),
    lastError: row.last_error,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    ackAt: row.ack_at,
    answeredAt: row.answered_at,
    nextRetryAt: row.next_retry_at,
  };
}

function toChannel(row: ChannelDbRow): EventChannelRow {
  return {
    id: row.id,
    threadId: row.thread_id,
    kind: row.kind as EventChannelRow['kind'],
    address: parseJson(row.address, {}),
    createdAt: row.created_at,
  };
}

function toOutbox(row: OutboxDbRow): EventOutboxRow {
  return {
    id: row.id,
    channelId: row.channel_id,
    dedupeKey: row.dedupe_key,
    payload: parseJson(row.payload, {}),
    state: row.state as EventOutboxRow['state'],
    attempts: Number(row.attempts ?? 0),
    nextRetryAt: row.next_retry_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function ensureEventLayerSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_sources (
      id TEXT PRIMARY KEY,
      project_dir TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      cursor TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_sources_project ON event_sources(project_dir, created_at DESC);

    CREATE TABLE IF NOT EXISTS event_threads (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      project_dir TEXT NOT NULL,
      external_key TEXT NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'open',
      last_trigger_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(source_id, external_key)
    );
    CREATE INDEX IF NOT EXISTS idx_event_threads_project ON event_threads(project_dir, last_trigger_at DESC);

    CREATE TABLE IF NOT EXISTS event_triggers (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      actor TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      disposition TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE INDEX IF NOT EXISTS idx_event_triggers_thread ON event_triggers(thread_id, occurred_at ASC, id ASC);

    CREATE TABLE IF NOT EXISTS event_subscriptions (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      subscriber_type TEXT NOT NULL,
      subscriber_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      dropped_at TEXT,
      UNIQUE(thread_id, subscriber_type, subscriber_id)
    );
    CREATE INDEX IF NOT EXISTS idx_event_subscriptions_thread ON event_subscriptions(thread_id);

    CREATE TABLE IF NOT EXISTS event_decisions (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      trigger_ids TEXT NOT NULL DEFAULT '[]',
      decision TEXT NOT NULL,
      mode TEXT,
      goal_run_id TEXT,
      rationale TEXT NOT NULL DEFAULT '',
      decided_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_decisions_thread ON event_decisions(thread_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS event_deliveries (
      id TEXT PRIMARY KEY,
      trigger_id TEXT NOT NULL,
      subscription_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      delivered_at TEXT,
      read_at TEXT,
      ack_at TEXT,
      answered_at TEXT,
      next_retry_at TEXT,
      UNIQUE(trigger_id, subscription_id)
    );
    CREATE INDEX IF NOT EXISTS idx_event_deliveries_trigger ON event_deliveries(trigger_id);

    CREATE TABLE IF NOT EXISTS event_channels (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS event_outbox (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(channel_id, dedupe_key)
    );
    CREATE INDEX IF NOT EXISTS idx_event_outbox_state ON event_outbox(state, next_retry_at);
  `);
  const deliveryColumns = db.prepare('PRAGMA table_info(event_deliveries)').all() as Array<{ name: string }>;
  if (!deliveryColumns.some((column) => column.name === 'next_retry_at')) {
    db.exec('ALTER TABLE event_deliveries ADD COLUMN next_retry_at TEXT');
  }
}

export class EventStore {
  constructor(private readonly db: Database) {
    ensureEventLayerSchema(db);
  }

  insertSource(input: {
    id: string;
    projectDir: string;
    kind: EventSourceKind;
    name: string;
    config: Record<string, unknown>;
    now: string;
  }): EventSourceRow {
    this.db.prepare(`
      INSERT INTO event_sources (id, project_dir, kind, name, config, enabled, cursor, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, '{}', ?, ?)
    `).run(
      input.id,
      input.projectDir,
      input.kind,
      input.name,
      JSON.stringify(input.config ?? {}),
      input.now,
      input.now,
    );
    return this.getSource(input.id)!;
  }

  getSource(id: string): EventSourceRow | null {
    const row = this.db.prepare('SELECT * FROM event_sources WHERE id = ?').get(id) as SourceDbRow | undefined;
    return row ? toSource(row) : null;
  }

  listSources(projectDir: string): EventSourceRow[] {
    return (this.db.prepare(
      'SELECT * FROM event_sources WHERE project_dir = ? ORDER BY created_at ASC, id ASC',
    ).all(projectDir) as SourceDbRow[]).map(toSource);
  }

  updateSourceCursor(id: string, cursor: Record<string, unknown>, now: string): void {
    this.db.prepare(
      'UPDATE event_sources SET cursor = ?, updated_at = ? WHERE id = ?',
    ).run(JSON.stringify(cursor ?? {}), now, id);
  }

  setSourceEnabled(id: string, enabled: boolean, now: string): void {
    this.db.prepare(
      'UPDATE event_sources SET enabled = ?, updated_at = ? WHERE id = ?',
    ).run(enabled ? 1 : 0, now, id);
  }

  ensureThread(input: {
    id: string;
    sourceId: string;
    projectDir: string;
    externalKey: string;
    title: string;
    now: string;
  }): EventThreadRow {
    this.db.prepare(`
      INSERT OR IGNORE INTO event_threads (
        id, source_id, project_dir, external_key, title, state, last_trigger_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'open', NULL, ?)
    `).run(input.id, input.sourceId, input.projectDir, input.externalKey, input.title, input.now);
    return this.getThreadByKey(input.sourceId, input.externalKey)!;
  }

  getThread(id: string): EventThreadRow | null {
    const row = this.db.prepare('SELECT * FROM event_threads WHERE id = ?').get(id) as ThreadDbRow | undefined;
    return row ? toThread(row) : null;
  }

  getThreadByKey(sourceId: string, externalKey: string): EventThreadRow | null {
    const row = this.db.prepare(
      'SELECT * FROM event_threads WHERE source_id = ? AND external_key = ?',
    ).get(sourceId, externalKey) as ThreadDbRow | undefined;
    return row ? toThread(row) : null;
  }

  touchThread(id: string, now: string): void {
    this.db.prepare('UPDATE event_threads SET last_trigger_at = ? WHERE id = ?').run(now, id);
  }

  listThreads(projectDir: string, sourceId?: string): EventThreadRow[] {
    const rows = sourceId
      ? this.db.prepare(
        'SELECT * FROM event_threads WHERE project_dir = ? AND source_id = ? ORDER BY last_trigger_at DESC, created_at DESC',
      ).all(projectDir, sourceId)
      : this.db.prepare(
        'SELECT * FROM event_threads WHERE project_dir = ? ORDER BY last_trigger_at DESC, created_at DESC',
      ).all(projectDir);
    return (rows as ThreadDbRow[]).map(toThread);
  }

  insertTrigger(
    input: Omit<EventTriggerRow, 'disposition'> & { disposition?: EventDisposition },
  ): { row: EventTriggerRow; duplicate: boolean } {
    const disposition = input.disposition ?? 'pending';
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO event_triggers (
        id, source_id, thread_id, external_id, kind, actor, payload,
        occurred_at, received_at, idempotency_key, disposition
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.sourceId,
      input.threadId,
      input.externalId,
      input.kind,
      input.actor,
      JSON.stringify(input.payload ?? {}),
      input.occurredAt,
      input.receivedAt,
      input.idempotencyKey,
      disposition,
    );
    const row = this.db.prepare(
      'SELECT * FROM event_triggers WHERE idempotency_key = ?',
    ).get(input.idempotencyKey) as TriggerDbRow;
    return { row: toTrigger(row), duplicate: result.changes === 0 };
  }

  listTriggers(threadId: string): EventTriggerRow[] {
    return (this.db.prepare(
      'SELECT * FROM event_triggers WHERE thread_id = ? ORDER BY occurred_at ASC, id ASC',
    ).all(threadId) as TriggerDbRow[]).map(toTrigger);
  }

  setTriggerDisposition(id: string, disposition: EventDisposition): void {
    this.db.prepare('UPDATE event_triggers SET disposition = ? WHERE id = ?').run(disposition, id);
  }

  upsertSubscription(
    input: Omit<EventSubscriptionRow, 'createdAt' | 'expiresAt' | 'droppedAt'> & { now: string },
  ): EventSubscriptionRow {
    this.db.prepare(`
      INSERT INTO event_subscriptions (
        id, thread_id, subscriber_type, subscriber_id, mode, created_at, expires_at, dropped_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
      ON CONFLICT(thread_id, subscriber_type, subscriber_id) DO UPDATE SET
        mode = excluded.mode,
        dropped_at = NULL
    `).run(
      input.id,
      input.threadId,
      input.subscriberType,
      input.subscriberId,
      input.mode,
      input.now,
    );
    return this.getSubscriptionBySubscriber(input.threadId, input.subscriberType, input.subscriberId)!;
  }

  getSubscriptionBySubscriber(
    threadId: string,
    subscriberType: string,
    subscriberId: string,
  ): EventSubscriptionRow | null {
    const row = this.db.prepare(`
      SELECT * FROM event_subscriptions
      WHERE thread_id = ? AND subscriber_type = ? AND subscriber_id = ?
    `).get(threadId, subscriberType, subscriberId) as SubscriptionDbRow | undefined;
    return row ? toSubscription(row) : null;
  }

  listSubscriptions(threadId: string): EventSubscriptionRow[] {
    return (this.db.prepare(
      'SELECT * FROM event_subscriptions WHERE thread_id = ? AND dropped_at IS NULL ORDER BY created_at ASC, id ASC',
    ).all(threadId) as SubscriptionDbRow[]).map(toSubscription);
  }

  removeSubscription(id: string, now: string): boolean {
    const result = this.db.prepare('UPDATE event_subscriptions SET dropped_at = ? WHERE id = ? AND dropped_at IS NULL')
      .run(now, id);
    return result.changes > 0;
  }

  insertDecision(input: Omit<EventDecisionRow, 'createdAt'> & { now: string }): EventDecisionRow {
    this.db.prepare(`
      INSERT INTO event_decisions (
        id, thread_id, trigger_ids, decision, mode, goal_run_id, rationale, decided_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.threadId,
      JSON.stringify(input.triggerIds ?? []),
      input.decision,
      input.mode,
      input.goalRunId,
      input.rationale,
      input.decidedBy,
      input.now,
    );
    return this.latestDecision(input.threadId)!;
  }

  latestDecision(threadId: string): EventDecisionRow | null {
    const row = this.db.prepare(
      'SELECT * FROM event_decisions WHERE thread_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    ).get(threadId) as DecisionDbRow | undefined;
    return row ? toDecision(row) : null;
  }

  insertDelivery(
    input: Omit<EventDeliveryRow, 'attempts' | 'lastError' | 'deliveredAt' | 'readAt' | 'ackAt' | 'answeredAt' | 'nextRetryAt'>,
  ): EventDeliveryRow {
    this.db.prepare(`
      INSERT OR IGNORE INTO event_deliveries (
        id, trigger_id, subscription_id, state, attempts, last_error,
        delivered_at, read_at, ack_at, answered_at, next_retry_at
      ) VALUES (?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, NULL, NULL)
    `).run(input.id, input.triggerId, input.subscriptionId, input.state);
    return this.getDeliveryByTrigger(input.triggerId, input.subscriptionId)!;
  }

  getDelivery(id: string): EventDeliveryRow | null {
    const row = this.db.prepare('SELECT * FROM event_deliveries WHERE id = ?').get(id) as DeliveryDbRow | undefined;
    return row ? toDelivery(row) : null;
  }

  getDeliveryByTrigger(triggerId: string, subscriptionId: string): EventDeliveryRow | null {
    const row = this.db.prepare(
      'SELECT * FROM event_deliveries WHERE trigger_id = ? AND subscription_id = ?',
    ).get(triggerId, subscriptionId) as DeliveryDbRow | undefined;
    return row ? toDelivery(row) : null;
  }

  listDeliveries(threadId: string): EventDeliveryRow[] {
    return (this.db.prepare(`
      SELECT d.* FROM event_deliveries d
      JOIN event_triggers t ON t.id = d.trigger_id
      WHERE t.thread_id = ?
      ORDER BY d.rowid ASC
    `).all(threadId) as DeliveryDbRow[]).map(toDelivery);
  }

  updateDelivery(
    id: string,
    patch: Partial<Pick<EventDeliveryRow, 'state' | 'attempts' | 'lastError' | 'deliveredAt' | 'readAt' | 'ackAt' | 'answeredAt' | 'nextRetryAt'>>,
  ): EventDeliveryRow {
    const current = this.getDelivery(id);
    if (!current) throw new Error(`delivery not found: ${id}`);
    const next = { ...current, ...patch };
    this.db.prepare(`
      UPDATE event_deliveries SET
        state = ?, attempts = ?, last_error = ?, delivered_at = ?, read_at = ?, ack_at = ?, answered_at = ?, next_retry_at = ?
      WHERE id = ?
    `).run(
      next.state,
      next.attempts,
      next.lastError,
      next.deliveredAt,
      next.readAt,
      next.ackAt,
      next.answeredAt,
      next.nextRetryAt,
      id,
    );
    return this.getDelivery(id)!;
  }

  insertChannel(input: Omit<EventChannelRow, 'createdAt'> & { now: string }): EventChannelRow {
    this.db.prepare(`
      INSERT OR IGNORE INTO event_channels (id, thread_id, kind, address, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.threadId,
      input.kind,
      JSON.stringify(input.address ?? {}),
      input.now,
    );
    return this.getChannel(input.id)!;
  }

  getChannel(id: string): EventChannelRow | null {
    const row = this.db.prepare('SELECT * FROM event_channels WHERE id = ?').get(id) as ChannelDbRow | undefined;
    return row ? toChannel(row) : null;
  }

  insertOutbox(
    input: Omit<EventOutboxRow, 'attempts' | 'nextRetryAt' | 'lastError' | 'createdAt' | 'updatedAt'> & { now: string },
  ): EventOutboxRow {
    this.db.prepare(`
      INSERT OR IGNORE INTO event_outbox (
        id, channel_id, dedupe_key, payload, state, attempts, next_retry_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
    `).run(
      input.id,
      input.channelId,
      input.dedupeKey,
      JSON.stringify(input.payload ?? {}),
      input.state,
      input.now,
      input.now,
    );
    return this.getOutboxByKey(input.channelId, input.dedupeKey)!;
  }

  getOutboxByKey(channelId: string, dedupeKey: string): EventOutboxRow | null {
    const row = this.db.prepare(
      'SELECT * FROM event_outbox WHERE channel_id = ? AND dedupe_key = ?',
    ).get(channelId, dedupeKey) as OutboxDbRow | undefined;
    return row ? toOutbox(row) : null;
  }

  getOutbox(id: string): EventOutboxRow | null {
    const row = this.db.prepare('SELECT * FROM event_outbox WHERE id = ?').get(id) as OutboxDbRow | undefined;
    return row ? toOutbox(row) : null;
  }

  listOutbox(state?: EventOutboxRow['state']): EventOutboxRow[] {
    const rows = state
      ? this.db.prepare('SELECT * FROM event_outbox WHERE state = ? ORDER BY created_at ASC, id ASC').all(state)
      : this.db.prepare('SELECT * FROM event_outbox ORDER BY created_at ASC, id ASC').all();
    return (rows as OutboxDbRow[]).map(toOutbox);
  }

  updateOutbox(
    id: string,
    patch: Partial<Pick<EventOutboxRow, 'state' | 'attempts' | 'nextRetryAt' | 'lastError' | 'updatedAt'>>,
  ): EventOutboxRow {
    const row = this.db.prepare('SELECT * FROM event_outbox WHERE id = ?').get(id) as OutboxDbRow | undefined;
    if (!row) throw new Error(`outbox not found: ${id}`);
    const next = { ...toOutbox(row), ...patch };
    this.db.prepare(`
      UPDATE event_outbox SET state = ?, attempts = ?, next_retry_at = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(next.state, next.attempts, next.nextRetryAt, next.lastError, next.updatedAt, id);
    return this.listOutbox().find((item) => item.id === id)!;
  }
}
