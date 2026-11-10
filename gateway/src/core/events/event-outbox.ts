import { randomUUID } from 'crypto';
import type { EventOutboxRow } from './event-types';
import type { EventStore } from './event-store';

export function nextChannelRetryAt(attempt: number, now: string): string {
  const safe = Math.max(1, Math.trunc(attempt));
  const delay = Math.min(300_000, 5_000 * 2 ** (safe - 1));
  return new Date(Date.parse(now) + delay).toISOString();
}

export class EventOutbox {
  constructor(private readonly deps: { store: EventStore; now(): string }) {}

  enqueue(input: {
    channelId: string;
    dedupeKey: string;
    payload: Record<string, unknown>;
  }): EventOutboxRow {
    return this.deps.store.insertOutbox({
      id: `outbox_${randomUUID()}`,
      channelId: input.channelId,
      dedupeKey: input.dedupeKey,
      payload: input.payload,
      state: 'pending',
      now: this.deps.now(),
    });
  }

  markSent(id: string): EventOutboxRow {
    return this.deps.store.updateOutbox(id, {
      state: 'sent',
      updatedAt: this.deps.now(),
    });
  }

  markFailed(id: string, error: string): EventOutboxRow {
    const current = this.deps.store.getOutbox(id);
    if (!current) throw new Error(`outbox not found: ${id}`);
    const attempts = current.attempts + 1;
    return this.deps.store.updateOutbox(id, {
      state: 'failed',
      attempts,
      lastError: error,
      nextRetryAt: nextChannelRetryAt(attempts, this.deps.now()),
      updatedAt: this.deps.now(),
    });
  }

  pending(): EventOutboxRow[] {
    const now = Date.parse(this.deps.now());
    return this.deps.store.listOutbox('pending').filter((row) =>
      !row.nextRetryAt || Date.parse(row.nextRetryAt) <= now);
  }
}
