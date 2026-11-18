import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FRAME_PAYLOAD, decodeFrame, encodeFrame } from './frames.ts';

test('round-trips DATA, WINDOW and CLOSE frames', () => {
  const data = { type: 1 as const, streamId: 7, payload: Buffer.from('hello') };
  assert.deepEqual(decodeFrame(encodeFrame(data)), data);

  const window = { type: 2 as const, streamId: 7, payload: Buffer.from([0, 0, 1, 0]) };
  assert.deepEqual(decodeFrame(encodeFrame(window)), window);

  const close = { type: 3 as const, streamId: 7, payload: Buffer.alloc(0) };
  assert.deepEqual(decodeFrame(encodeFrame(close)), close);
});

test('rejects truncated, oversized and unknown frames', () => {
  const encoded = encodeFrame({ type: 1, streamId: 1, payload: Buffer.from('x') });
  assert.throws(() => decodeFrame(encoded.subarray(0, 9)), /short/i);
  assert.throws(() => decodeFrame(Buffer.from([9, 0, 0, 0, 1, 0, 0, 0, 0, 0])), /type/i);
  assert.throws(
    () => encodeFrame({ type: 1, streamId: 1, payload: Buffer.alloc(MAX_FRAME_PAYLOAD + 1) }),
    /payload/i,
  );
});
