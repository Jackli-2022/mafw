import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { once } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import { createRelayService } from '../../../src/mobile/relay-service';
import { TUNNEL_HEADER } from '../../../src/core/auth';

describe('RelayService', () => {
  it('loads identity, starts TLS terminator + client and advertises pairing endpoint', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-relay-service-'));
    let marker = '';
    const target = http.createServer((req, res) => {
      marker = String(req.headers[TUNNEL_HEADER] || '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    target.listen(0, '127.0.0.1');
    await once(target, 'listening');
    const targetPort = (target.address() as any).port;

    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(wss, 'listening');
    let hostWs: WebSocket | null = null;
    let hello: any = null;
    wss.on('connection', (ws) => {
      hostWs = ws;
      ws.on('message', (data, isBinary) => {
        if (!isBinary && hello === null) hello = JSON.parse(data.toString());
      });
    });

    const service = createRelayService({
      enabled: true,
      domain: 'relay.example.com',
      controlUrl: `ws://127.0.0.1:${(wss.address() as any).port}`,
      dataDir,
      targetPort,
      tunnelSecret: 'a'.repeat(64),
      localPort: 0,
    });

    const status = await service.start();
    expect(status.enabled).toBe(true);
    expect(status.roomUrl).toMatch(/^https:\/\/[a-z2-7]{26}-[a-z2-7]{26}\.relay\.example\.com$/);
    expect(status.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (hello) {
          clearInterval(timer);
          resolve(undefined);
        }
      }, 10);
    });
    expect(hello).toMatchObject({
      type: 'hello',
      protocolVersion: 1,
      roomId: expect.stringMatching(/^[a-z2-7]{26}$/),
      routeSecret: expect.stringMatching(/^[a-z2-7]{26}$/),
    });

    hostWs!.send(JSON.stringify({ type: 'hello-ok', roomId: hello.roomId }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(service.status().connected).toBe(true);

    // Direct TLS request to the terminator still injects the M0 marker.
    const body = await new Promise<string>((resolve, reject) => {
      const req = https.request(
        { host: '127.0.0.1', port: service.terminatorPort(), path: '/api/presence', rejectUnauthorized: false },
        (res: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
          res.on('end', () => resolve(Buffer.concat(chunks).toString()));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(JSON.parse(body)).toEqual({ ok: true });
    expect(marker).toBe('a'.repeat(64));

    service.stop();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => target.close(() => resolve()));
  });

  it('is a no-op when disabled', async () => {
    const service = createRelayService({
      enabled: false,
      domain: 'relay.example.com',
      controlUrl: 'ws://127.0.0.1:1',
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-relay-service-off-')),
      targetPort: 1,
      tunnelSecret: 'x',
    });
    const status = await service.start();
    expect(status).toEqual({ enabled: false, connected: false });
    service.stop();
  });
});
