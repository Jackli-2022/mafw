import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry } from './registry.ts';
import { newRoomId, newRouteSecret } from './room.ts';

function claimInput() {
  return {
    roomId: newRoomId(),
    roomToken: 't'.repeat(64),
    routeSecret: newRouteSecret(),
  };
}

test('claims a new room and authenticates only the right token', () => {
  const registry = new RoomRegistry();
  const input = claimInput();

  const claim = registry.claim(input);
  assert.ok(claim);
  assert.equal(claim!.roomId, input.roomId);
  assert.ok(registry.authenticate(input.roomId, input.roomToken));
  assert.equal(registry.authenticate(input.roomId, 'wrong'), null);
});

test('re-claim with the right token keeps the room; wrong token is rejected', () => {
  const registry = new RoomRegistry();
  const input = claimInput();
  assert.ok(registry.claim(input));
  assert.ok(registry.claim(input));
  assert.equal(registry.claim({ ...input, roomToken: 'x'.repeat(64) }), null);
});

test('attachHost replaces the previous host and detach only clears the current one', () => {
  const registry = new RoomRegistry();
  const input = claimInput();
  registry.claim(input);

  const first = registry.attachHost(input.roomId, 'host-1');
  assert.deepEqual(first, { ok: true });
  assert.equal(registry.online(input.roomId), true);

  const second = registry.attachHost(input.roomId, 'host-2');
  assert.deepEqual(second, { ok: true, replaced: 'host-1' });

  registry.detachHost(input.roomId, 'host-1');
  assert.equal(registry.online(input.roomId), true);

  registry.detachHost(input.roomId, 'host-2');
  assert.equal(registry.online(input.roomId), false);
});

test('release removes the claim', () => {
  const registry = new RoomRegistry();
  const input = claimInput();
  registry.claim(input);
  registry.release(input.roomId);
  assert.equal(registry.get(input.roomId), undefined);
  assert.equal(registry.authenticate(input.roomId, input.roomToken), null);
});
