import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSecret, newRoomId, newRouteSecret, parseRoomHost } from './room.ts';

test('room ids and secrets are 26-char lowercase base32', () => {
  for (const value of [newRoomId(), newRouteSecret()]) {
    assert.match(value, /^[a-z2-7]{26}$/);
  }
});

test('parses <roomId>-<routeSecret>.<domain>', () => {
  const roomId = newRoomId();
  const secret = newRouteSecret();
  assert.deepEqual(parseRoomHost(`${roomId}-${secret}.relay.example.com`, 'relay.example.com'), {
    roomId,
    routeSecret: secret,
  });
});

test('rejects traversal, uppercase, wrong domain and extra labels', () => {
  const roomId = newRoomId();
  const secret = newRouteSecret();
  assert.equal(parseRoomHost(`..-..relay.example.com`, 'relay.example.com'), null);
  assert.equal(parseRoomHost(`${roomId.toUpperCase()}-${secret}.relay.example.com`, 'relay.example.com'), null);
  assert.equal(parseRoomHost(`${roomId}-${secret}.relay.example.com.evil`, 'relay.example.com'), null);
  assert.equal(parseRoomHost(`${roomId}-${secret}.other.example.com`, 'relay.example.com'), null);
  assert.equal(parseRoomHost(`${roomId}${secret}.relay.example.com`, 'relay.example.com'), null);
});

test('hashes secrets deterministically', () => {
  assert.equal(hashSecret('abc'), hashSecret('abc'));
  assert.notEqual(hashSecret('abc'), hashSecret('abd'));
  assert.match(hashSecret('abc'), /^[0-9a-f]{64}$/);
});
