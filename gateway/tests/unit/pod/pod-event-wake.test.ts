// gateway/tests/unit/pod/pod-event-wake.test.ts
// Lead wake: budget, dedupe, pause/suspend gates, real merge, and the
// "already delivered by A2A" shortcut that prevents double injection.
import { PodEventWake } from '../../../src/core/pod/pod-event-wake';

const ev = (over: any = {}) => ({
  id: 'e1', podId: 'p', goalId: 'g1', kind: 'member.escalation', title: 'blocked',
  summary: null, refsJson: null, severity: 'p2', ...over,
});

function harness(over: Partial<any> = {}) {
  const prompts: any[] = [];
  const suppressed: string[] = [];
  const delivered: string[] = [];
  const committed: string[][] = [];
  const led = new Set<string>();
  const wake = new PodEventWake({
    events: {
      pendingWakes: () => over.pending ?? [ev()],
      markWakeDelivered: (id: string) => { delivered.push(id); },
      markWakeSuppressed: (id: string) => { suppressed.push(id); },
    } as any,
    leadMemberId: () => 'lead',
    ensureLead: async (podId: string) => {
      if (!led.has(podId)) led.add(podId);
      return { sessionId: 'ses_lead' };
    },
    isBusy: () => over.busy ?? false,
    isSuspended: () => over.suspended ?? false,
    isPodPaused: () => over.paused ?? false,
    promptAsync: async (i: any) => { prompts.push(i); },
    deliveryDelivered: () => over.alreadyDelivered ?? false,
    commitDelivered: (ids: string[]) => { committed.push(ids); },
    now: () => over.now ?? 1_000_000,
    budget: { perHour: 6, dedupeMs: 600_000 },
  });
  return { wake, prompts, suppressed, delivered, committed };
}

it('merges every pending event into one prompt', async () => {
  const h = harness({ pending: [ev({ id: 'e1', title: 'a' }), ev({ id: 'e2', title: 'b' })] });
  const out = await h.wake.scan('p');
  expect(h.prompts).toHaveLength(1);
  expect(h.prompts[0].message).toContain('2 条待处理');
  expect(out.delivered).toBe(2);
  expect(h.delivered).toEqual(['e1', 'e2']);
});

it('skips injection when the message was already delivered (A2A won)', async () => {
  const h = harness({ alreadyDelivered: true, pending: [ev({ refsJson: JSON.stringify([{ kind: 'message', id: 'm1' }]) })] });
  await h.wake.scan('p');
  expect(h.prompts).toHaveLength(0);
  expect(h.delivered).toEqual(['e1']);
});

it('stays pending while paused, suspended or busy', async () => {
  for (const flag of ['paused', 'suspended', 'busy'] as const) {
    const h = harness({ [flag]: true } as any);
    await h.wake.scan('p');
    expect(h.prompts).toHaveLength(0);
    expect(h.delivered).toHaveLength(0);
  }
});

it('suppresses beyond the hourly budget', async () => {
  const h = harness({ pending: Array.from({ length: 8 }, (_, i) => ev({ id: `e${i}` })) });
  const out = await h.wake.scan('p');
  expect(out.delivered).toBe(6);
  expect(out.suppressed).toBe(2);
});

it('dedupes the same goal+kind inside the window', async () => {
  const h = harness({ pending: [ev({ id: 'e1' }), ev({ id: 'e2' })] });
  await h.wake.scan('p');
  expect(h.prompts).toHaveLength(1);
  const second = await h.wake.scan('p');
  expect(second.delivered).toBe(0);
});

it('a fresh instance still sees pending wakes (restart recovery)', async () => {
  const first = harness({ pending: [] as any });
  await first.wake.scan('p');
  const second = harness({ pending: [ev()] });
  await second.wake.scan('p');
  expect(second.prompts).toHaveLength(1);
  expect(second.delivered).toEqual(['e1']);
});
