import * as net from 'net';
import { once } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import { RelayTunnelClient } from '../../../src/mobile/relay-tunnel-client';
import { decodeFrame, encodeFrame } from '../../../src/mobile/relay-frames';

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

describe('RelayTunnelClient', () => {
  it('registers, bridges a stream to the local terminator and closes it', async () => {
    const roomId = 'a'.repeat(26);
    const routeSecret = 'b'.repeat(26);
    const roomToken = 't'.repeat(64);
    let localSocket: net.Socket | null = null;

    const echo = net.createServer((socket) => {
      localSocket = socket;
      socket.pipe(socket);
    });
    echo.listen(0, '127.0.0.1');
    await once(echo, 'listening');
    const echoPort = (echo.address() as net.AddressInfo).port;

    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(wss, 'listening');
    const controlPort = (wss.address() as any).port;

    let relaySocket: WebSocket | null = null;
    let hello: any = null;
    wss.on('connection', (ws) => {
      relaySocket = ws;
      ws.on('message', (data, isBinary) => {
        if (!isBinary && hello === null) hello = JSON.parse(data.toString());
      });
    });

    const client = new RelayTunnelClient({
      url: `ws://127.0.0.1:${controlPort}`,
      roomId,
      roomToken,
      routeSecret,
      localPort: echoPort,
      reconnectMs: 50,
    });
    client.start();

    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (hello) {
          clearInterval(timer);
          resolve(undefined);
        }
      }, 10);
    });
    expect(hello).toMatchObject({ type: 'hello', roomId, roomToken, routeSecret, protocolVersion: 1 });

    relaySocket!.send(JSON.stringify({ type: 'hello-ok', roomId }));
    const localConnected = once(echo, 'connection');
    relaySocket!.send(JSON.stringify({ type: 'open', streamId: 1 }));
    await localConnected;

    const inbound = nextBinary(relaySocket!);
    relaySocket!.send(encodeFrame({ type: 1, streamId: 1, payload: Buffer.from('ping') }));
    const echoed = decodeFrame(await inbound);
    expect(echoed.type).toBe(1);
    expect(echoed.payload.toString()).toBe('ping');

    const closed = once(localSocket!, 'close');
    relaySocket!.send(encodeFrame({ type: 3, streamId: 1, payload: Buffer.alloc(0) }));
    await closed;

    client.stop();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => echo.close(() => resolve()));
  });
});
