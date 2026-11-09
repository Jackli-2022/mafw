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
