import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteRoomStore } from './room-store.ts';

test('sqlite room store persists and deletes claims across reopen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-relay-db-'));
  const file = path.join(dir, 'relay.db');
  const record = {
    roomId: 'a'.repeat(26),
    tokenHash: 'b'.repeat(64),
    routeSecretHash: 'c'.repeat(64),
    createdAt: 1,
    lastSeenAt: 2,
    hostConnectionId: 'host-1',
  };

  const first = new SqliteRoomStore(file);
  first.save(record);
  assert.deepEqual(first.load(), [record]);
  first.close();

  const second = new SqliteRoomStore(file);
  assert.deepEqual(second.load(), [record]);
  second.delete(record.roomId);
  assert.deepEqual(second.load(), []);
  second.close();
});
