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

it('drops malformed part.updated', () => {
  const out = mapAdapterEvent(ev('part.updated', { part: { type: 'tool' } }));
  expect(out.dropped).toBeDefined();
});

it('drops malformed session.created, permission.asked and plan.updated', () => {
  expect(mapAdapterEvent(ev('session.created', { session: {} })).dropped).toBeDefined();
  expect(mapAdapterEvent(ev('permission.asked', {}, { requestID: 'r1' })).dropped).toBeDefined();
  expect(mapAdapterEvent(ev('plan.updated', { items: 'nope' })).dropped).toBeDefined();
});
