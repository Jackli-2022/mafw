import Database from 'better-sqlite3';
import { EventStore } from '../../../src/core/events/event-store';
import { EventOutbox, nextChannelRetryAt } from '../../../src/core/events/event-outbox';

describe('EventOutbox', () => {
  test('outbox retries channel sends and keeps the failure visible', () => {
    const db = new Database(':memory:');
    const store = new EventStore(db);
    const outbox = new EventOutbox({ store, now: () => '2026-11-10T00:00:00.000Z' });

    const row = outbox.enqueue({ channelId: 'ch1', dedupeKey: 'pr42:comment', payload: { body: 'hi' } });
    expect(row.state).toBe('pending');
    expect(outbox.markFailed(row.id, 'offline').state).toBe('failed');
    expect(outbox.pending()).toHaveLength(0);
    expect(store.listOutbox()).toHaveLength(1);
  });

  test('failed rows become retryable after nextRetryAt', () => {
    let now = '2026-11-10T00:00:00.000Z';
    const db = new Database(':memory:');
    const store = new EventStore(db);
    const outbox = new EventOutbox({ store, now: () => now });
    const row = outbox.enqueue({ channelId: 'ch1', dedupeKey: 'retry', payload: { body: 'hi' } });
    outbox.markFailed(row.id, 'offline');
    expect(outbox.pending()).toHaveLength(0);

    now = '2026-11-10T00:00:10.000Z';
    expect(outbox.pending().map((item) => item.id)).toEqual([row.id]);
  });

  test('dedupes channel sends and schedules a capped retry', () => {
    expect(nextChannelRetryAt(1, '2026-11-10T00:00:00.000Z')).toBe('2026-11-10T00:00:05.000Z');
    expect(nextChannelRetryAt(10, '2026-11-10T00:00:00.000Z')).toBe('2026-11-10T00:05:00.000Z');

    const db = new Database(':memory:');
    const store = new EventStore(db);
    const outbox = new EventOutbox({ store, now: () => '2026-11-10T00:00:00.000Z' });
    const first = outbox.enqueue({ channelId: 'ch1', dedupeKey: 'same', payload: { body: 'a' } });
    const second = outbox.enqueue({ channelId: 'ch1', dedupeKey: 'same', payload: { body: 'b' } });
    expect(second.id).toBe(first.id);
    expect(outbox.markSent(first.id).state).toBe('sent');
  });
});
