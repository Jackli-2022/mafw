import test from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { createTlsRouter } from './tls-router.ts';
import { RoomRegistry } from './registry.ts';
import { newRoomId, newRouteSecret } from './room.ts';

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

test('refuses a stream when the quota says no', async () => {
  const registry = new RoomRegistry();
  const roomId = newRoomId();
  const routeSecret = newRouteSecret();
  registry.claim({ roomId, routeSecret, roomToken: 't'.repeat(64) });
  let opened = 0;
  const hosts = {
    online: () => true,
    openStream: async () => { opened++; return new PassThrough(); },
  };
  const router = createTlsRouter({
    domain: 'relay.example.com',
    registry,
    hosts,
    listenPort: 0,
    quota: { allowStream: () => false, releaseStream: () => {}, allowBytes: () => true },
  });
  const port = await router.start();
  const hello = await captureClientHello(`${roomId}-${routeSecret}.relay.example.com`);
  const socket = net.connect(port, '127.0.0.1');
  const closed = once(socket, 'close');
  await once(socket, 'connect');
  socket.write(hello);
  await closed;
  assert.equal(opened, 0);
  await router.stop();
});

test('releases the stream quota when the phone disconnects', async () => {
  const registry = new RoomRegistry();
  const roomId = newRoomId();
  const routeSecret = newRouteSecret();
  registry.claim({ roomId, routeSecret, roomToken: 't'.repeat(64) });
  let released = 0;
  const hosts = {
    online: () => true,
    openStream: async () => new PassThrough(),
  };
  const router = createTlsRouter({
    domain: 'relay.example.com',
    registry,
    hosts,
    listenPort: 0,
    quota: { allowStream: () => true, releaseStream: () => { released++; }, allowBytes: () => true },
  });
  const port = await router.start();
  const hello = await captureClientHello(`${roomId}-${routeSecret}.relay.example.com`);
  const socket = net.connect(port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write(hello);
  await new Promise((resolve) => setTimeout(resolve, 50));
  socket.destroy();
  for (let i = 0; i < 40 && released === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(released, 1);
  await router.stop();
});
