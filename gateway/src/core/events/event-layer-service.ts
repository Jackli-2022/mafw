import type {
  EventDeliveryRow,
  EventEnvelope,
  EventSourceKind,
  EventSourceRow,
  EventSubscriptionMode,
  EventSubscriptionRow,
  EventThreadRow,
  EventTriggerRow,
} from './event-types';
import type { EventStore } from './event-store';

export interface EventLayerDeps {
  store: EventStore;
  now(): string;
  newId(prefix: string): string;
  broadcast(event: { type: string; properties?: Record<string, unknown> }): void;
  enabled(): boolean;
  admit?(envelope: EventEnvelope): ReturnType<typeof admitIngress>;
  log?(message: string): void;
}

export class EventLayerError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'EventLayerError';
  }
}

export function admitIngress(input: {
  queueDepth: number;
  person: boolean;
  tokens: number;
  maxQueueDepth?: number;
}): { ok: true } | { ok: false; reason: 'queue_full' | 'rate_limited' } {
  if (input.person) return { ok: true };
  const maxQueueDepth = input.maxQueueDepth ?? 100;
  if (input.queueDepth >= maxQueueDepth) return { ok: false, reason: 'queue_full' };
  if (input.tokens <= 0) return { ok: false, reason: 'rate_limited' };
  return { ok: true };
}

export class EventLayerService {
  constructor(private readonly deps: EventLayerDeps) {}

  createSource(input: {
    projectDir: string;
    kind: EventSourceKind;
    name: string;
    config: Record<string, unknown>;
  }): EventSourceRow {
    return this.deps.store.insertSource({
      id: this.deps.newId('source'),
      projectDir: input.projectDir,
      kind: input.kind,
      name: input.name,
      config: input.config,
      now: this.deps.now(),
    });
  }

  setSourceEnabled(id: string, enabled: boolean): EventSourceRow {
    this.deps.store.setSourceEnabled(id, enabled, this.deps.now());
    const source = this.deps.store.getSource(id);
    if (!source) throw new EventLayerError(404, `event source not found: ${id}`);
    return source;
  }

  listSources(projectDir: string): EventSourceRow[] {
    return this.deps.store.listSources(projectDir);
  }

  ingest(envelope: EventEnvelope): {
    trigger: EventTriggerRow;
    thread: EventThreadRow;
    duplicate: boolean;
  } {
    if (!this.deps.enabled()) throw new EventLayerError(503, 'event layer disabled');
    const admission = this.deps.admit?.(envelope) ?? { ok: true } as const;
    if (!admission.ok) {
      throw new EventLayerError(429, `event ingress refused: ${admission.reason}`);
    }

    const thread = this.deps.store.ensureThread({
      id: this.deps.newId('thread'),
      sourceId: envelope.sourceId,
      projectDir: envelope.projectDir,
      externalKey: envelope.externalKey,
      title: envelope.title,
      now: envelope.receivedAt,
    });
    const inserted = this.deps.store.insertTrigger({
      id: this.deps.newId('trigger'),
      sourceId: envelope.sourceId,
      threadId: thread.id,
      externalId: envelope.externalId,
      kind: envelope.kind,
      actor: envelope.actor,
      payload: envelope.payload,
      occurredAt: envelope.occurredAt,
      receivedAt: envelope.receivedAt,
      idempotencyKey: envelope.idempotencyKey,
    });
    if (!inserted.duplicate) {
      this.deps.store.touchThread(thread.id, envelope.receivedAt);
      this.deps.broadcast({
        type: 'event.trigger.received',
        properties: {
          threadId: thread.id,
          triggerId: inserted.row.id,
          kind: inserted.row.kind,
          externalKey: envelope.externalKey,
        },
      });
    }
    return { trigger: inserted.row, thread, duplicate: inserted.duplicate };
  }

  subscribe(input: {
    threadId: string;
    subscriberType: EventSubscriptionRow['subscriberType'];
    subscriberId: string;
    mode: EventSubscriptionMode;
    expiresAt?: string | null;
  }): EventSubscriptionRow {
    return this.deps.store.upsertSubscription({
      id: this.deps.newId('subscription'),
      threadId: input.threadId,
      subscriberType: input.subscriberType,
      subscriberId: input.subscriberId,
      mode: input.mode,
      now: this.deps.now(),
    });
  }

  listSubscriptions(threadId: string): EventSubscriptionRow[] {
    return this.deps.store.listSubscriptions(threadId);
  }

  listThreads(projectDir: string, sourceId?: string): EventThreadRow[] {
    return this.deps.store.listThreads(projectDir, sourceId);
  }

  listTriggers(threadId: string): EventTriggerRow[] {
    return this.deps.store.listTriggers(threadId);
  }

  listDeliveries(threadId: string): EventDeliveryRow[] {
    return this.deps.store.listDeliveries(threadId);
  }
}
