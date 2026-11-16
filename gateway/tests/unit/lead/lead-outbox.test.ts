import Database from 'better-sqlite3';
import { EventStore } from '../../../src/core/events/event-store';
import { EventOutbox } from '../../../src/core/events/event-outbox';
import { LeadOutbox } from '../../../src/core/lead/lead-outbox';
import type { LeadOutboxPolicy } from '../../../src/core/lead/lead-outbox-model';

const NOW = '2026-11-16T00:00:05.000Z';

function harness(policy?: Partial<LeadOutboxPolicy>) {
  const db = new Database(':memory:');
  const store = new EventStore(db);
  const outbox = new EventOutbox({ store, now: () => NOW });
  const promptAsync = jest.fn(async (_input: { sessionID: string; text: string }) => {});
  const timers = { every: jest.fn((_name: string, _ms: number, _fn: () => void) => ({ clear: jest.fn() })) };
  const lead = new LeadOutbox({
    store,
    outbox,
    now: () => NOW,
    ensureLead: async () => ({ sessionId: 'ses_lead' }),
    promptAsync,
    timers,
    policy,
  });
  return { store, outbox, lead, promptAsync, timers };
}

test('enqueueDecision creates one channel row and dedupes by record id', () => {
  const h = harness();
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec1', text: '[LEAD EVENT] one' });
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec1', text: '[LEAD EVENT] one' });
  expect(h.store.listOutbox()).toHaveLength(1);
  expect(h.store.getChannel('lead:pod1')).toMatchObject({ kind: 'chat' });
});

test('dispatch batches pending decisions into one Lead prompt and marks all sent', async () => {
  const h = harness();
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec1', text: '[LEAD EVENT] one' });
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec2', text: '[LEAD EVENT] two' });
  const result = await h.lead.dispatch();
  expect(result.sent).toBe(2);
  expect(h.promptAsync).toHaveBeenCalledTimes(1);
  expect(h.promptAsync.mock.calls[0][0].sessionID).toBe('ses_lead');
  expect(h.store.listOutbox().every((r) => r.state === 'sent')).toBe(true);
});

test('a failed prompt marks every row failed and retryable', async () => {
  const h = harness();
  h.promptAsync.mockRejectedValueOnce(new Error('offline'));
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec1', text: '[LEAD EVENT] one' });
  const result = await h.lead.dispatch();
  expect(result.failed).toBe(1);
  expect(h.store.listOutbox()[0]).toMatchObject({ state: 'failed', lastError: 'offline' });
  expect(h.store.listOutbox()[0].nextRetryAt).toBeTruthy();
});

test('budget defers the channel without dropping its rows', async () => {
  const h = harness({ maxPerHour: 1, minIntervalMs: 0 });
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec1', text: '[LEAD EVENT] one' });
  expect((await h.lead.dispatch()).sent).toBe(1);
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec2', text: '[LEAD EVENT] two' });
  const second = await h.lead.dispatch();
  expect(second).toEqual({ sent: 0, deferred: 1, failed: 0 });
  expect(h.store.listOutbox('pending')).toHaveLength(1);
  expect(h.promptAsync).toHaveBeenCalledTimes(1);
});

test('concurrent dispatch is single-flight', async () => {
  const h = harness();
  let release: (() => void) | undefined;
  h.promptAsync.mockImplementationOnce(
    () => new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  h.lead.enqueueDecision({ podId: 'pod1', recordId: 'rec1', text: '[LEAD EVENT] one' });
  const first = h.lead.dispatch();
  const second = await h.lead.dispatch();
  expect(second).toEqual({ sent: 0, deferred: 0, failed: 0 });
  release?.();
  await first;
  expect(h.promptAsync).toHaveBeenCalledTimes(1);
});

test('start is idempotent and stop clears the timer', () => {
  const h = harness();
  h.lead.start();
  h.lead.start();
  expect(h.timers.every).toHaveBeenCalledTimes(1);
  expect(h.timers.every.mock.calls[0][0]).toBe('lead:outbox');
  h.lead.stop();
  expect(h.lead.status()).toEqual({ pending: 0, sent: 0, failed: 0 });
});
