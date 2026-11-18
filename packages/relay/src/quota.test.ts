import test from 'node:test';
import assert from 'node:assert/strict';
import { Quota } from './quota.ts';

test('limits rooms per IP per day', () => {
  let now = 0;
  const quota = new Quota({ roomsPerIpPerDay: 2, now: () => now });
  assert.equal(quota.allowRoom('1.2.3.4'), true);
  assert.equal(quota.allowRoom('1.2.3.4'), true);
  assert.equal(quota.allowRoom('1.2.3.4'), false);
  assert.equal(quota.allowRoom('5.6.7.8'), true);

  now = 86_400_000;
  assert.equal(quota.allowRoom('1.2.3.4'), true);
});

test('limits streams per room and per IP', () => {
  const quota = new Quota({ streamsPerRoom: 2, streamsPerIp: 3 });
  assert.equal(quota.allowStream('room-a', 'ip-1'), true);
  assert.equal(quota.allowStream('room-a', 'ip-1'), true);
  assert.equal(quota.allowStream('room-a', 'ip-1'), false);
  assert.equal(quota.allowStream('room-b', 'ip-1'), true);
  assert.equal(quota.allowStream('room-b', 'ip-1'), false);

  quota.releaseStream('room-a', 'ip-1');
  assert.equal(quota.allowStream('room-b', 'ip-1'), true);
});

test('enforces a per-room byte budget per second', () => {
  let now = 0;
  const quota = new Quota({ roomMbps: 1, now: () => now });
  assert.equal(quota.allowBytes('room-a', 100_000), true);
  assert.equal(quota.allowBytes('room-a', 30_000), false);
  now = 1000;
  assert.equal(quota.allowBytes('room-a', 100_000), true);
});
