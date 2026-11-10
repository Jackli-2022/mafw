import Database from 'better-sqlite3';
import { EventStore } from '../../../src/core/events/event-store';

describe('EventStore', () => {
  test('dedupes triggers by idempotency key and keeps one thread per external key', () => {
    const db = new Database(':memory:');
    const store = new EventStore(db);
    const source = store.insertSource({
      id: 's1',
      projectDir: '/p',
      kind: 'github',
      name: 'repo',
      config: {},
      now: '2026-11-10T00:00:00.000Z',
    });
    const thread = store.ensureThread({
      id: 't1',
      sourceId: source.id,
      projectDir: '/p',
      externalKey: 'acme/app#42',
      title: 'PR 42',
      now: source.createdAt,
    });
    const trigger = {
      id: 'tr1',
      sourceId: source.id,
      threadId: thread.id,
      externalId: 'd1',
      kind: 'pr_opened',
      actor: 'alice',
      payload: { number: 42 },
      occurredAt: source.createdAt,
      receivedAt: source.createdAt,
      idempotencyKey: 'github:d1',
    };

    expect(store.insertTrigger(trigger).duplicate).toBe(false);
    expect(store.insertTrigger({ ...trigger, id: 'tr2' }).duplicate).toBe(true);
    expect(store.listTriggers(thread.id)).toHaveLength(1);
    expect(store.ensureThread({
      id: 't2',
      sourceId: source.id,
      projectDir: '/p',
      externalKey: 'acme/app#42',
      title: 'again',
      now: source.createdAt,
    }).id).toBe('t1');
  });
});
