import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { HostHub } from './host-hub.ts';
import { RoomRegistry } from './registry.ts';
import { newRoomId, newRouteSecret } from './room.ts';
import { decodeFrame, encodeFrame } from './frames.ts';

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

function nextBinary(ws: WebSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('binary timeout')), 2000);
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (!isBinary) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(Buffer.from(data as Buffer));
    };
    ws.on('message', onMessage);
  });
}

test('a second host replaces the first connection', async () => {
  const registry = new RoomRegistry();
  const roomId = newRoomId();
  const routeSecret = newRouteSecret();
  const roomToken = 't'.repeat(64);
  registry.claim({ roomId, routeSecret, roomToken });

  const hub = new HostHub(registry);
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (ws) => hub.attach(ws));
  await once(wss, 'listening');
  const port = (wss.address() as any).port;

  const connect = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, roomId, roomToken, routeSecret }));
    assert.equal((await nextJson(ws)).type, 'hello-ok');
    return ws;
  };

  const first = await connect();
  const firstClosed = once(first, 'close');
  const second = await connect();
  const [code] = await firstClosed;
  assert.equal(code, 4001);
  assert.equal(hub.online(roomId), true);

  second.close();
  await new Promise((resolve) => wss.close(resolve));
});

test('host hello, open stream, data and close', async () => {
  const registry = new RoomRegistry();
  const roomId = newRoomId();
  const routeSecret = newRouteSecret();
  const roomToken = 't'.repeat(64);
  registry.claim({ roomId, routeSecret, roomToken });

  const hub = new HostHub(registry);
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (ws) => hub.attach(ws));
  await once(wss, 'listening');
  const port = (wss.address() as any).port;

  const host = new WebSocket(`ws://127.0.0.1:${port}`);
  await once(host, 'open');
  host.send(JSON.stringify({ type: 'hello', protocolVersion: 1, roomId, roomToken, routeSecret }));
  assert.equal((await nextJson(host)).type, 'hello-ok');
  assert.equal(hub.online(roomId), true);

  const openPromise = nextJson(host);
  const stream = await hub.openStream(roomId);
  const open = await openPromise;
  assert.equal(open.type, 'open');
  assert.equal(open.streamId, 1);

  const inbound = nextBinary(host);
  const fromHost = once(stream, 'data');
  host.send(encodeFrame({ type: 1, streamId: open.streamId, payload: Buffer.from('ping') }));
  const [data] = await fromHost;
  assert.equal(Buffer.from(data).toString(), 'ping');

  stream.write(Buffer.from('pong'));
  const outbound = decodeFrame(await inbound);
  assert.equal(outbound.type, 1);
  assert.equal(outbound.payload.toString(), 'pong');

  const closeFrame = nextBinary(host);
  stream.end();
  assert.equal(decodeFrame(await closeFrame).type, 3);

  host.close();
  await new Promise((resolve) => wss.close(resolve));
});
