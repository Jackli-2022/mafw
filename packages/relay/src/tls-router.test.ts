import test from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { Duplex } from 'node:stream';
import { createTlsRouter } from './tls-router.ts';
import { RoomRegistry } from './registry.ts';
import { newRoomId, newRouteSecret } from './room.ts';

class EchoDuplex extends Duplex {
  _read(): void {}
  _write(chunk: Buffer, _enc: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.push(chunk);
    callback();
  }
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

function echoHosts() {
  const opened: string[] = [];
  return {
    opened,
    online: () => true,
    openStream: async (roomId: string) => {
      opened.push(roomId);
      return new EchoDuplex();
    },
  };
}

test('routes a real ClientHello to the room host and pipes bytes', async () => {
  const registry = new RoomRegistry();
  const roomId = newRoomId();
  const routeSecret = newRouteSecret();
  registry.claim({ roomId, routeSecret, roomToken: 't'.repeat(64) });

  const hosts = echoHosts();
  const router = createTlsRouter({ domain: 'relay.example.com', registry, hosts, listenPort: 0 });
  const port = await router.start();
  const hello = await captureClientHello(`${roomId}-${routeSecret}.relay.example.com`);

  const socket = net.connect(port, '127.0.0.1');
  const received: Buffer[] = [];
  socket.on('data', (chunk) => received.push(chunk));
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  socket.write(hello);
  await new Promise((resolve) => setTimeout(resolve, 50));
  socket.write(Buffer.from('ping'));
  await new Promise((resolve) => setTimeout(resolve, 100));
  socket.destroy();

  assert.deepEqual(hosts.opened, [roomId]);
  assert.equal(Buffer.concat(received).includes(Buffer.from('ping')), true);

  await router.stop();
});

test('parses a fragmented ClientHello', async () => {
  const registry = new RoomRegistry();
  const roomId = newRoomId();
  const routeSecret = newRouteSecret();
  registry.claim({ roomId, routeSecret, roomToken: 't'.repeat(64) });
  const hosts = echoHosts();
  const router = createTlsRouter({ domain: 'relay.example.com', registry, hosts, listenPort: 0 });
  const port = await router.start();
  const hello = await captureClientHello(`${roomId}-${routeSecret}.relay.example.com`);

  const socket = net.connect(port, '127.0.0.1');
  await new Promise<void>((resolve) => socket.once('connect', resolve));
  socket.write(hello.subarray(0, 7));
  await new Promise((resolve) => setTimeout(resolve, 30));
  socket.write(hello.subarray(7));
  await new Promise((resolve) => setTimeout(resolve, 100));
  socket.destroy();

  assert.deepEqual(hosts.opened, [roomId]);
  await router.stop();
});

test('closes unknown rooms and wrong route secrets', async () => {
  const registry = new RoomRegistry();
  const roomId = newRoomId();
  const routeSecret = newRouteSecret();
  registry.claim({ roomId, routeSecret, roomToken: 't'.repeat(64) });
  const hosts = echoHosts();
  const router = createTlsRouter({ domain: 'relay.example.com', registry, hosts, listenPort: 0 });
  const port = await router.start();

  for (const sni of [
    `${newRoomId()}-${newRouteSecret()}.relay.example.com`,
    `${roomId}-${newRouteSecret()}.relay.example.com`,
  ]) {
    const hello = await captureClientHello(sni);
    const socket = net.connect(port, '127.0.0.1');
    const closed = new Promise<boolean>((resolve) => socket.once('close', () => resolve(true)));
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    socket.write(hello);
    assert.equal(await closed, true);
    socket.destroy();
  }

  assert.deepEqual(hosts.opened, []);
  await router.stop();
});
