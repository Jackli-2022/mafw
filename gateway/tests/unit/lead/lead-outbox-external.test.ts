import Database from 'better-sqlite3';
import { EventStore } from '../../../src/core/events/event-store';
import { EventOutbox } from '../../../src/core/events/event-outbox';
import { LeadOutbox } from '../../../src/core/lead/lead-outbox';
import { leadOutboxPayload, renderLeadOutboxBatch } from '../../../src/core/lead/lead-outbox-model';
import { renderExternalEvent } from '../../../src/core/events/lead-event';

function setup() {
  const store = new EventStore(new Database(':memory:'));
  const outbox = new EventOutbox({ store, now: () => '2026-11-17T00:00:00.000Z' });
  const lead = new LeadOutbox({
    store,
    outbox,
    now: () => '2026-11-17T00:00:00.000Z',
    ensureLead: async () => ({ sessionId: 'ses_lead' }),
    promptAsync: async () => {},
    timers: { every: () => ({ clear: () => {} }) },
  });
  return { store, outbox, lead };
}

test('external items dedupe by trigger and render as [EVENT]', () => {
  const h = setup();
  const a = h.lead.enqueueExternal({ podId: 'p1', triggerId: 't1', text: '[EVENT] issue' });
  h.lead.enqueueExternal({ podId: 'p1', triggerId: 't1', text: '[EVENT] issue' });
  const b = h.lead.enqueueExternal({ podId: 'p1', triggerId: 't2', text: '[EVENT] cron' });
  expect(h.store.listOutbox()).toHaveLength(2);
  expect(a.dedupeKey).toBe('external:t1');
  expect(leadOutboxPayload(a)).toMatchObject({ kind: 'external', recordId: 't1' });
  expect(renderLeadOutboxBatch([a, b])).toContain('[EVENT] 2 条待处理');
});

test('renderExternalEvent includes thread key, kind and actor', () => {
  const text = renderExternalEvent(
    {
      id: 't1', sourceId: 'gh', threadId: 'th1', externalId: 'issue-1', kind: 'issue',
      actor: 'octocat', payload: { title: 'Bug report' }, occurredAt: '2026-11-17T00:00:00.000Z',
      receivedAt: '2026-11-17T00:00:00.000Z', idempotencyKey: 'gh:1', disposition: 'pending',
    } as any,
    {
      id: 'th1', sourceId: 'gh', projectDir: '/p', externalKey: 'acme/repo#1',
      title: 'Issue #1', state: 'open', lastTriggerAt: null, createdAt: '2026-11-17T00:00:00.000Z',
    } as any,
  );
  expect(text).toContain('[EVENT]');
  expect(text).toContain('acme/repo#1');
  expect(text).toContain('kind=issue');
  expect(text).toContain('actor=octocat');
});
