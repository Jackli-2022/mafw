// gateway/tests/unit/pod/pod-event-wake.test.ts
// Pod event relay: every pending wake becomes one durable Lead outbox row.
// Pacing/batching/Lead delivery live in LeadOutbox, not here.
import { PodEventWake, renderPodEvent } from '../../../src/core/pod/pod-event-wake';

const ev = (over: any = {}) => ({
  id: 'e1', podId: 'p', goalId: 'g1', kind: 'member.escalation', title: 'blocked',
  summary: null, refsJson: null, severity: 'p2', ...over,
});

function harness(over: Partial<any> = {}) {
  const enqueued: any[] = [];
  const queued: Array<[string, string]> = [];
  const wake = new PodEventWake({
    events: {
      pendingWakes: () => over.pending ?? [ev()],
      markWakeQueued: (id: string, outboxId: string) => { queued.push([id, outboxId]); },
      markWakeSuppressed: () => {},
      markWakeAttempt: () => {},
    } as any,
    enqueue: over.enqueue ?? (async (input: any) => {
      enqueued.push(input);
      return { id: `outbox_${enqueued.length}` };
    }),
    leadMemberId: () => over.leadMemberId ?? 'lead',
    deliveryDelivered: () => over.alreadyDelivered ?? false,
    isPodPaused: () => over.paused ?? false,
    now: () => over.now ?? 1_000_000,
    runScan: over.runScan,
  });
  return { wake, enqueued, queued };
}

test('enqueues every pending event and marks it queued', async () => {
  const h = harness({ pending: [ev({ id: 'e1' }), ev({ id: 'e2', title: 'other' })] });
  const out = await h.wake.scan('p');
  expect(h.enqueued.map((item) => item.eventId)).toEqual(['e1', 'e2']);
  expect(h.enqueued[0].text).toContain('[POD EVENT]');
  expect(h.enqueued[0].text).toContain('title: blocked');
  expect(h.queued).toEqual([['e1', 'outbox_1'], ['e2', 'outbox_2']]);
  expect(out.delivered).toBe(2);
});

test('maps pod severity to outbox priority', async () => {
  const h = harness({ pending: [ev({ severity: 'p1' }), ev({ id: 'e2', severity: 'p3' })] });
  await h.wake.scan('p');
  expect(h.enqueued.map((item) => item.priority)).toEqual(['p1', 'p3']);
});

test('paused pod leaves events pending', async () => {
  const h = harness({ paused: true });
  await h.wake.scan('p');
  expect(h.enqueued).toHaveLength(0);
  expect(h.queued).toHaveLength(0);
});

test('skips enqueue when the mirrored message was already delivered by A2A', async () => {
  const h = harness({
    alreadyDelivered: true,
    pending: [ev({ refsJson: JSON.stringify([{ kind: 'message', id: 'm1' }]) })],
  });
  await h.wake.scan('p');
  expect(h.enqueued).toHaveLength(0);
  expect(h.queued).toEqual([['e1', 'a2a:m1']]);
});

test('enqueue failure leaves the event pending', async () => {
  const h = harness({
    pending: [ev({ id: 'e1' })],
    enqueue: async () => { throw new Error('offline'); },
  });
  await h.wake.scan('p');
  expect(h.enqueued).toHaveLength(0);
  expect(h.queued).toHaveLength(0);
});

test('coalesces concurrent scans through the injected runScan', async () => {
  let scanFnRuns = 0;
  let inflight: Promise<any> | null = null;
  const runScan = (fn: () => Promise<any>) => {
    if (!inflight) {
      scanFnRuns++;
      inflight = fn().finally(() => { inflight = null; });
    }
    return inflight;
  };
  const h = harness({
    pending: [ev({ id: 'e1' }), ev({ id: 'e2' })],
    runScan: runScan as any,
  });
  const p1 = h.wake.scan('p');
  const p2 = h.wake.scan();
  const [r1, r2] = await Promise.all([p1, p2]);
  expect(scanFnRuns).toBe(1);
  expect(r1).toEqual(r2);
  expect(h.enqueued).toHaveLength(2);
  expect(h.queued).toEqual([['e1', 'outbox_1'], ['e2', 'outbox_2']]);
});

test('scan without runScan still runs directly', async () => {
  const h = harness({ pending: [ev()] });
  const out = await h.wake.scan('p');
  expect(out.delivered).toBe(1);
});

test('renderPodEvent includes goal, kind, title, summary and message ref', () => {
  const text = renderPodEvent(ev({
    title: 'blocked',
    summary: 'needs review',
    refsJson: JSON.stringify([{ kind: 'message', id: 'm1' }]),
  }) as any);
  expect(text).toContain('[POD EVENT]');
  expect(text).toContain('goal=g1 kind=member.escalation');
  expect(text).toContain('title: blocked');
  expect(text).toContain('summary: needs review');
  expect(text).toContain('message: m1');
});
