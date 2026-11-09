import test from 'node:test';
import assert from 'node:assert/strict';
import { isMafwMessage, isMafwPart, coerceOutput } from './index.ts';

test('isMafwMessage accepts a flat message and rejects an envelope', () => {
  assert.equal(isMafwMessage({ id: 'm1', sessionID: 's1', role: 'user' }), true);
  assert.equal(isMafwMessage({ info: { id: 'm1' }, parts: [] }), false);
  assert.equal(isMafwMessage(null), false);
});

test('isMafwPart accepts a flat part and rejects a bare object', () => {
  assert.equal(isMafwPart({ id: 'p1', sessionID: 's1', messageID: 'm1', type: 'text', text: 'hi' }), true);
  assert.equal(isMafwPart({ type: 'text' }), false);
});

test('coerceOutput normalises tool output', () => {
  assert.equal(coerceOutput('x'), 'x');
  assert.equal(coerceOutput({ a: 1 }), JSON.stringify({ a: 1 }));
  assert.equal(coerceOutput(undefined), '');
});
