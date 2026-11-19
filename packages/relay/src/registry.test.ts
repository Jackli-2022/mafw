import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry } from './registry.ts';
import { MemoryRoomStore } from './room-store.ts';
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
  assert.equal(registry.routeSecretMatches(input.roomId, input.routeSecret), true);
  assert.equal(registry.routeSecretMatches(input.roomId, newRouteSecret()), false);
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

test('reloads claims from a persistent store', () => {
  const store = new MemoryRoomStore();
  const input = claimInput();

  const first = new RoomRegistry(store);
  first.claim(input);
  first.attachHost(input.roomId, 'host-1');

  const second = new RoomRegistry(store);
  assert.equal(second.authenticate(input.roomId, input.roomToken)?.roomId, input.roomId);
  assert.equal(second.online(input.roomId), true);

  second.release(input.roomId);
  assert.equal(new RoomRegistry(store).get(input.roomId), undefined);
});
