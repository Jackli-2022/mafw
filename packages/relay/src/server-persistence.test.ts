import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createRelayServer } from './server.ts';
import { newRoomId, newRouteSecret } from './room.ts';

function nextJson(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('json timeout')), 2000);
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(JSON.parse(data.toString()));
    };
    ws.on('message', onMessage);
  });
}

async function hello(controlPort: number, roomId: string, routeSecret: string, roomToken: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${controlPort}`);
  await once(ws, 'open');
  ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, roomId, routeSecret, roomToken }));
  const reply = await nextJson(ws);
  ws.close();
  return reply;
}

test('admin /metrics exposes room and stream counters', async () => {
  const relay = createRelayServer({
    domain: 'relay.example.com',
    listenHost: '127.0.0.1',
    tlsPort: 0,
    controlPort: 0,
    adminPort: 0,
  });
  await relay.start();
  const roomId = newRoomId();
  relay.registry.claim({ roomId, roomToken: 't'.repeat(64), routeSecret: newRouteSecret() });
  relay.registry.attachHost(roomId, 'host-1');
  relay.quota.allowRoom('127.0.0.1');
  relay.quota.allowStream(roomId, '127.0.0.1');

  const res = await fetch(`http://127.0.0.1:${relay.ports().admin}/metrics`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /relay_rooms_total 1/);
  assert.match(text, /relay_rooms_online 1/);
  assert.match(text, /relay_room_creations_today 1/);
  assert.match(text, /relay_streams_active 1/);

  await relay.stop();
});

test('sqlite room claim survives a relay restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-relay-persist-'));
  const dbPath = path.join(dir, 'relay.db');
  const roomId = newRoomId();
  const routeSecret = newRouteSecret();
  const roomToken = 't'.repeat(64);

  const first = createRelayServer({
    domain: 'relay.example.com',
    listenHost: '127.0.0.1',
    tlsPort: 0,
    controlPort: 0,
    adminPort: 0,
    dbPath,
  });
  await first.start();
  assert.equal((await hello(first.ports().control, roomId, routeSecret, roomToken)).type, 'hello-ok');
  await first.stop();

  const second = createRelayServer({
    domain: 'relay.example.com',
    listenHost: '127.0.0.1',
    tlsPort: 0,
    controlPort: 0,
    adminPort: 0,
    dbPath,
  });
  await second.start();
  assert.equal((await hello(second.ports().control, roomId, routeSecret, roomToken)).type, 'hello-ok');
  await second.stop();
});
