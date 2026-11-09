import test from 'node:test';
import assert from 'node:assert/strict';
import { isMafwMessage, isMafwPart, coerceOutput, requireSessionDir, fixMediaPayload } from './index.ts';

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

test('requireSessionDir prefers opts.directory and fails closed', () => {
  assert.equal(requireSessionDir('/a', '/b'), '/a');
  assert.equal(requireSessionDir(undefined, '/b'), '/b');
  assert.throws(() => requireSessionDir(undefined, undefined), /directory is required/);
});

test('fixMediaPayload rewrites video/audio data URLs only', () => {
  const video = { messages: [{ content: [{ type: 'image_url', image_url: { url: 'data:video/mp4;base64,AAA' } }] }] };
  const audio = { messages: [{ content: [{ type: 'image_url', image_url: { url: 'data:audio/wav;base64,BBB' } }] }] };
  const text = { messages: [{ content: [{ type: 'text', text: 'hi' }] }] };
  assert.deepEqual(fixMediaPayload(video), { messages: [{ content: [{ type: 'video_url', video_url: { url: 'data:video/mp4;base64,AAA' } }] }] });
  assert.deepEqual(fixMediaPayload(audio), { messages: [{ content: [{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,BBB' } }] }] });
  assert.equal(fixMediaPayload(text), undefined);
});
