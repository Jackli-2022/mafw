import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdapterEvent } from './adapter-event.ts';

test('accepts a valid part.delta', () => {
  const r = validateAdapterEvent({
    id: 'e1', type: 'part.delta', sessionID: 's1', turnID: 't1',
    at: 1, data: { messageID: 'm1', partID: 'p1', field: 'text', delta: 'hi' },
  });
  assert.equal(r.ok, true);
});

test('rejects unknown type', () => {
  const r = validateAdapterEvent({ id: 'e1', type: 'nope', sessionID: 's1', at: 1, data: {} });
  assert.equal(r.ok, false);
});

test('rejects part.delta without sessionID', () => {
  const r = validateAdapterEvent({ id: 'e1', type: 'part.delta', at: 1, data: {} });
  assert.equal(r.ok, false);
});

test('allows session-less runtime.notice', () => {
  const r = validateAdapterEvent({ id: 'e1', type: 'runtime.notice', at: 1, data: { level: 'info', message: 'ok' } });
  assert.equal(r.ok, true);
});

test('accepts the opencode-only canonical event types', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['background.job.updated', { job: { id: 'sh1', sessionID: 's1' } }],
    ['queue.updated', { items: [] }],
    ['session.diff', { diff: [] }],
  ];
  for (const [type, data] of cases) {
    const r = validateAdapterEvent({ id: 'e1', type, sessionID: 's1', at: 1, data });
    assert.equal(r.ok, true, `${type} rejected: ${r.ok ? '' : r.errors.join('; ')}`);
  }
});

test('opencode-only canonical events still require a sessionID', () => {
  for (const type of ['background.job.updated', 'queue.updated', 'session.diff']) {
    const r = validateAdapterEvent({ id: 'e1', type, at: 1, data: {} });
    assert.equal(r.ok, false, `${type} must require sessionID`);
  }
});
