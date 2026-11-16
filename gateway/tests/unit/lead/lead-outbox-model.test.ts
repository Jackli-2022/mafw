import type { EventOutboxRow } from '../../../src/core/events/event-types';
import {
  DEFAULT_LEAD_OUTBOX_POLICY,
  leadOutboxPayload,
  renderLeadOutboxBatch,
  selectLeadOutboxBatch,
} from '../../../src/core/lead/lead-outbox-model';

function row(over: Partial<EventOutboxRow> = {}): EventOutboxRow {
  return {
    id: 'o1',
    channelId: 'lead:pod1',
    dedupeKey: 'decision:rec1',
    payload: {
      kind: 'decision',
      priority: 'p2',
      text: '[LEAD EVENT] one',
      podId: 'pod1',
      goalId: 'g1',
      recordId: 'rec1',
      createdAt: '2026-11-16T00:00:00.000Z',
    },
    state: 'pending',
    attempts: 0,
    nextRetryAt: null,
    lastError: null,
    createdAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z',
    ...over,
  };
}

test('parses a valid decision payload and rejects malformed ones', () => {
  expect(leadOutboxPayload(row())).toMatchObject({ recordId: 'rec1', priority: 'p2' });
  expect(leadOutboxPayload(row({ payload: {} }))).toBeNull();
  expect(leadOutboxPayload(row({ payload: { ...(row().payload as object), kind: 'other' } }))).toBeNull();
});

test('missing priority defaults to p2', () => {
  const { priority: _omit, ...rest } = row().payload as Record<string, unknown>;
  expect(leadOutboxPayload(row({ payload: rest }))?.priority).toBe('p2');
});

test('selects a batch in priority/created order and enforces maxBatch', () => {
  const rows = [
    row({ id: 'o2', createdAt: '2026-11-16T00:00:02.000Z' }),
    row({ id: 'o1', createdAt: '2026-11-16T00:00:01.000Z' }),
  ];
  const picked = selectLeadOutboxBatch({
    rows,
    now: Date.parse('2026-11-16T00:00:10.000Z'),
    policy: { ...DEFAULT_LEAD_OUTBOX_POLICY, maxBatch: 1 },
    sentBatchesLastHour: 0,
    lastSentAt: null,
  });
  expect(picked.reason).toBe('ok');
  expect(picked.rows.map((r) => r.id)).toEqual(['o1']);
});

test('p1 rows sort before p3 rows', () => {
  const rows = [
    row({ id: 'p3', createdAt: '2026-11-16T00:00:01.000Z', payload: { ...(row().payload as object), priority: 'p3' } }),
    row({ id: 'p1', createdAt: '2026-11-16T00:00:02.000Z', payload: { ...(row().payload as object), priority: 'p1' } }),
  ];
  const picked = selectLeadOutboxBatch({
    rows,
    now: Date.parse('2026-11-16T00:00:10.000Z'),
    policy: DEFAULT_LEAD_OUTBOX_POLICY,
    sentBatchesLastHour: 0,
    lastSentAt: null,
  });
  expect(picked.rows.map((r) => r.id)).toEqual(['p1', 'p3']);
});

test('p1 bypasses budget and interval', () => {
  const p2 = row({
    id: 'p2',
    payload: { ...(row().payload as object), priority: 'p2' },
  });
  const p1 = row({
    id: 'p1',
    payload: { ...(row().payload as object), priority: 'p1' },
  });
  const picked = selectLeadOutboxBatch({
    rows: [p2, p1],
    now: 1000,
    policy: { ...DEFAULT_LEAD_OUTBOX_POLICY, maxPerHour: 1 },
    sentBatchesLastHour: 1,
    lastSentAt: 999,
  });
  expect(picked.reason).toBe('ok');
  expect(picked.rows.map((r) => r.id)).toEqual(['p1']);
});

test('defers on budget or interval without dropping rows', () => {
  const rows = [row()];
  expect(
    selectLeadOutboxBatch({
      rows,
      now: 1000,
      policy: DEFAULT_LEAD_OUTBOX_POLICY,
      sentBatchesLastHour: DEFAULT_LEAD_OUTBOX_POLICY.maxPerHour,
      lastSentAt: null,
    }).reason,
  ).toBe('budget');
  expect(
    selectLeadOutboxBatch({
      rows,
      now: 1000,
      policy: DEFAULT_LEAD_OUTBOX_POLICY,
      sentBatchesLastHour: 0,
      lastSentAt: 1000 - DEFAULT_LEAD_OUTBOX_POLICY.minIntervalMs + 1,
    }).reason,
  ).toBe('interval');
  expect(
    selectLeadOutboxBatch({
      rows: [],
      now: 1000,
      policy: DEFAULT_LEAD_OUTBOX_POLICY,
      sentBatchesLastHour: 0,
      lastSentAt: null,
    }).reason,
  ).toBe('empty');
});

test('parses a pod-event payload and renders a mixed batch', () => {
  const decision = row({ payload: { ...(row().payload as object), kind: 'decision', recordId: 'dec_1', text: '[LEAD EVENT] decision' } });
  const pod = row({
    id: 'o2',
    dedupeKey: 'pod-event:evt_1',
    payload: {
      ...(row().payload as object),
      kind: 'pod-event',
      recordId: 'evt_1',
      messageId: 'm1',
      text: '[POD EVENT] failed',
    },
  });
  expect(leadOutboxPayload(decision)).toMatchObject({ kind: 'decision' });
  expect(leadOutboxPayload(pod)).toMatchObject({ kind: 'pod-event', messageId: 'm1' });
  const text = renderLeadOutboxBatch([decision, pod]);
  expect(text).toContain('2 条待确认');
  expect(text).toContain('[LEAD EVENT] decision');
  expect(text).toContain('[POD EVENT] failed');
});

test('renders one message for a batch and labels multiple decisions', () => {
  expect(renderLeadOutboxBatch([row()])).toBe('[LEAD EVENT] one');
  const merged = renderLeadOutboxBatch([
    row({ id: 'o1' }),
    row({
      id: 'o2',
      payload: { ...(row().payload as object), recordId: 'rec2', text: '[LEAD EVENT] two' },
    }),
  ]);
  expect(merged).toContain('2 条待确认');
  expect(merged).toContain('rec1');
  expect(merged).toContain('rec2');
});
