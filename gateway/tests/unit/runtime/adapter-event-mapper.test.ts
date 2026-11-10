import { MAFW } from '@mafw/runtime-contract';
import { backgroundJobEvent, backgroundJobFromSynthetic } from '@mafw/runtime-core';
import { translateOpencode21Event } from '../../../../adapters/opencode/src/events-21';
import { canonicalToAdapterEvent } from '../../../src/runtime/legacy-plugin-bridge';
const canonicalToAdapterEventAdapterPackage = canonicalToAdapterEvent;
import { mapAdapterEvent } from '../../../src/runtime/adapter-event-mapper';

function ev(type: string, data: any, extra: any = {}) {
  return { id: 'e1', type, sessionID: 's1', at: 1, data, ...extra } as any;
}

it('maps part.delta to canonical part.delta', () => {
  const out = mapAdapterEvent(ev('part.delta', { messageID: 'm1', partID: 'p1', field: 'text', delta: 'hi' }, { turnID: 't1' }));
  expect(out.canonical?.payload.type).toBe('part.delta');
  expect(out.canonical?.payload.properties.delta).toBe('hi');
  expect(out.canonical?.payload.properties.messageID).toBe('m1');
  expect(out.canonical?.payload.properties.partID).toBe('p1');
});

it('maps session.status into session.updated', () => {
  const out = mapAdapterEvent(ev('session.status', { status: 'busy' }));
  expect(out.canonical?.payload.type).toBe('session.updated');
  expect(out.canonical?.payload.properties.info).toEqual({ id: 's1', status: 'busy' });
});

it('maps turn.completed and keeps usage internal', () => {
  const out = mapAdapterEvent(ev('turn.completed', { ok: true, usage: { input: 1, output: 2 } }, { turnID: 't1' }));
  expect(out.canonical?.payload.type).toBe('turn.completed');
  expect(out.internal?.type).toBe('turn.completed');
});

it('keeps turn.retrying internal-only', () => {
  const out = mapAdapterEvent(ev('turn.retrying', { attempt: 1, delayMs: 1000, reason: '429' }, { turnID: 't1' }));
  expect(out.canonical).toBeUndefined();
  expect(out.internal?.type).toBe('turn.retrying');
});

it('maps turn-scoped runtime.error to turn.failed', () => {
  const out = mapAdapterEvent(ev('runtime.error', { message: 'boom', retryable: true }, { turnID: 't1' }));
  expect(out.canonical?.payload.type).toBe('turn.failed');
});

it('maps background.job.updated and preserves the job snapshot', () => {
  const job = { id: 'sh1', source: 'runtime-shell', kind: 'shell', status: 'running', sessionID: 's1' };
  const out = mapAdapterEvent(ev('background.job.updated', { job }));
  expect(out.dropped).toBeUndefined();
  expect(out.canonical?.payload).toMatchObject({
    type: 'background.job.updated',
    properties: { sessionID: 's1', job },
  });
});

it('maps queue.updated and preserves the item snapshot', () => {
  const out = mapAdapterEvent(ev('queue.updated', { items: [{ id: 'q1' }] }));
  expect(out.canonical?.payload).toMatchObject({
    type: 'queue.updated',
    properties: { items: [{ id: 'q1' }] },
  });
});

it('preserves an explicitly empty queue.updated snapshot', () => {
  const out = mapAdapterEvent(ev('queue.updated', { items: [] }));
  expect(out.dropped).toBeUndefined();
  expect(out.canonical?.payload).toMatchObject({
    type: 'queue.updated',
    properties: { items: [] },
  });
  // A real empty snapshot clears the client queue; it must survive as `[]`,
  // not be mistaken for "no snapshot" and dropped.
  expect(out.canonical?.payload.properties.items).toEqual([]);
});

it('omits queue.updated items when the payload carries no snapshot', () => {
  const out = mapAdapterEvent(ev('queue.updated', { action: 'enqueued', item: { id: 'q1' }, id: 'q1' }));
  expect(out.canonical?.payload.type).toBe('queue.updated');
  expect(out.canonical?.payload.properties).not.toHaveProperty('items');
  expect(out.canonical?.payload.properties).toMatchObject({ action: 'enqueued', item: { id: 'q1' }, id: 'q1' });
});

it('omits queue.updated items when the payload snapshot is malformed', () => {
  const out = mapAdapterEvent(ev('queue.updated', { items: 'not-an-array' }));
  expect(out.canonical?.payload.type).toBe('queue.updated');
  expect(out.canonical?.payload.properties).not.toHaveProperty('items');
});

it('round-trips an inbox queue event without synthesising an items snapshot', () => {
  const source = {
    payload: {
      type: 'queue.updated',
      properties: { sessionID: 's1', action: 'enqueued', item: { id: 'q1' }, id: 'q1' },
    },
    sessionID: 's1',
  };
  const adapter = canonicalToAdapterEvent(source as any)!;
  expect(adapter.type).toBe('queue.updated');
  expect(adapter.data).toMatchObject({ action: 'enqueued', item: { id: 'q1' }, id: 'q1' });
  expect(adapter.data).not.toHaveProperty('items');

  const back = mapAdapterEvent(adapter).canonical!.payload.properties;
  expect(back).toMatchObject({ action: 'enqueued', item: { id: 'q1' }, id: 'q1' });
  expect(back).not.toHaveProperty('items');

  // 两份 canonicalToAdapterEvent 副本（gateway bridge / adapter 包）行为必须一致
  const adapterCopy = canonicalToAdapterEventAdapterPackage(source as any)!;
  expect(adapterCopy.type).toBe('queue.updated');
  expect(adapterCopy.data).toMatchObject({ action: 'enqueued', item: { id: 'q1' }, id: 'q1' });
  expect(adapterCopy.data).not.toHaveProperty('items');
});

it('round-trips an explicit empty items snapshot instead of dropping it', () => {
  const source = {
    payload: { type: 'queue.updated', properties: { sessionID: 's1', items: [] } },
    sessionID: 's1',
  };
  // Reverse (canonical → AdapterEvent) keeps `[]`: the guard is "is it an
  // array", not "is it non-empty", in both bridge copies.
  for (const convert of [canonicalToAdapterEvent, canonicalToAdapterEventAdapterPackage]) {
    const adapter = convert(source as any)!;
    expect(adapter.type).toBe('queue.updated');
    expect(adapter.data.items).toEqual([]);
    // …and forward again: an empty snapshot still means "clear the queue".
    const back = mapAdapterEvent(adapter).canonical!.payload.properties;
    expect(back.items).toEqual([]);
  }
});

it('pins background jobs across runtime-core, the mapper and the v21 synthetic transform', () => {
  const metadata = { source: 'shell', shellID: 'sh_1', status: 'completed', exitCode: 0 };
  const job = backgroundJobFromSynthetic('s1', metadata)!;
  const event = backgroundJobEvent(job);
  expect(event.payload.type).toBe(MAFW.backgroundJobUpdated);

  // mapper ← runtime-core 信封（type + properties 逐字流入）
  const mapped = mapAdapterEvent(ev(event.payload.type, event.payload.properties));
  expect(mapped.dropped).toBeUndefined();
  expect(mapped.canonical?.payload.type).toBe('background.job.updated');
  expect(mapped.canonical?.payload.properties.job).toBe(job);

  // v21 synthetic 变换 → 同一 canonical 类型与同一 job 语义
  const translated = translateOpencode21Event({
    type: 'session.next.synthetic',
    data: { sessionID: 's1', metadata },
  }) as any;
  expect(translated.payload.type).toBe(MAFW.backgroundJobUpdated);
  expect(translated.payload.properties.job).toMatchObject({
    source: 'runtime-shell', kind: 'shell', status: 'completed', sessionID: 's1',
  });
});

it('maps session.diff and preserves messageID/diff', () => {
  const out = mapAdapterEvent(ev('session.diff', { messageID: 'm1', diff: [{ file: 'a.ts' }] }));
  expect(out.dropped).toBeUndefined();
  expect(out.canonical?.payload).toMatchObject({
    type: 'session.diff',
    properties: { sessionID: 's1', messageID: 'm1', diff: [{ file: 'a.ts' }] },
  });
});

it('drops malformed part.updated', () => {
  const out = mapAdapterEvent(ev('part.updated', { part: { type: 'tool' } }));
  expect(out.dropped).toBeDefined();
});

it('drops malformed session.created, permission.asked and plan.updated', () => {
  expect(mapAdapterEvent(ev('session.created', { session: {} })).dropped).toBeDefined();
  expect(mapAdapterEvent(ev('permission.asked', {}, { requestID: 'r1' })).dropped).toBeDefined();
  expect(mapAdapterEvent(ev('plan.updated', { items: 'nope' })).dropped).toBeDefined();
});
