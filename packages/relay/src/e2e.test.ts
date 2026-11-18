import test from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createRelayServer } from './server.ts';
import { RoomRegistry } from './registry.ts';
import { newRoomId, newRouteSecret } from './room.ts';
import { encodeFrame } from './frames.ts';

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

async function captureClientHello(servername: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const server = net.createServer((socket) => socket.on('data', (chunk) => chunks.push(chunk)));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  const client = tls.connect({ host: '127.0.0.1', port, servername, rejectUnauthorized: false });
  client.on('error', () => {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  client.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return Buffer.concat(chunks);
}

test('local relay: health, host hello and end-to-end bytes', async () => {
  const registry = new RoomRegistry();
  const roomId = newRoomId();
  const routeSecret = newRouteSecret();
  const roomToken = 't'.repeat(64);
  registry.claim({ roomId, routeSecret, roomToken });

  const relay = createRelayServer({
    domain: 'relay.example.com',
    listenHost: '127.0.0.1',
    tlsPort: 0,
    controlPort: 0,
    adminPort: 0,
    registry,
  });
  await relay.start();
  const ports = relay.ports();

  const health = await fetch(`http://127.0.0.1:${ports.admin}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const host = new WebSocket(`ws://127.0.0.1:${ports.control}`);
  await once(host, 'open');
  host.send(JSON.stringify({ type: 'hello', protocolVersion: 1, roomId, roomToken, routeSecret }));
  assert.equal((await nextJson(host)).type, 'hello-ok');

  const hello = await captureClientHello(`${roomId}-${routeSecret}.relay.example.com`);
  const client = net.connect(ports.tls, '127.0.0.1');
  await new Promise<void>((resolve) => client.once('connect', resolve));
  client.write(hello);

  const open = await nextJson(host);
  assert.equal(open.type, 'open');
  host.send(encodeFrame({ type: 1, streamId: open.streamId, payload: Buffer.from('pong') }));

  const received: Buffer[] = [];
  client.on('data', (chunk) => received.push(chunk));
  for (let i = 0; i < 40 && !Buffer.concat(received).includes(Buffer.from('pong')); i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(Buffer.concat(received).includes(Buffer.from('pong')), true);

  client.destroy();
  host.close();
  await relay.stop();
});
