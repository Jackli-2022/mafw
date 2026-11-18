/**
 * M0: the loopback terminator is the only thing cloudflared talks to. It must
 * strip a client-supplied marker and inject the process secret, for both plain
 * HTTP and WebSocket upgrades.
 */
import * as http from 'http';
import * as net from 'net';
import { once } from 'events';
import { WebSocket, WebSocketServer } from 'ws';
import { TUNNEL_HEADER } from '../../../src/core/auth';
import { createTunnelTerminator, newTunnelSecret } from '../../../src/mobile/tunnel-terminator';

const SECRET = newTunnelSecret();

async function listen(server: http.Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as net.AddressInfo).port;
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('tunnel terminator (M0)', () => {
  it('injects the secret and strips a forged marker on HTTP', async () => {
    let seen: { marker?: string; path?: string; method?: string; body?: string } = {};
    const target = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += String(chunk); });
      req.on('end', () => {
        seen = {
          marker: String(req.headers[TUNNEL_HEADER] || ''),
          path: req.url,
          method: req.method,
          body,
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(seen));
      });
    });
    const targetPort = await listen(target);
    const terminator = createTunnelTerminator({ secret: SECRET, targetPort, listenPort: 0 });
    const port = await terminator.start();

    const res = await fetch(`http://127.0.0.1:${port}/api/presence?x=1`, {
      method: 'POST',
      body: 'hello',
      headers: { [TUNNEL_HEADER]: 'client-forged' },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      marker: SECRET,
      path: '/api/presence?x=1',
      method: 'POST',
      body: 'hello',
    });

    await terminator.stop();
    await closeServer(target);
  });

  it('proxies WebSocket upgrades and injects the marker', async () => {
    let marker = '';
    const target = http.createServer();
    const wss = new WebSocketServer({ server: target });
    wss.on('connection', (ws, req) => {
      marker = String(req.headers[TUNNEL_HEADER] || '');
      ws.on('message', (message) => ws.send(String(message)));
    });
    const targetPort = await listen(target);
    const terminator = createTunnelTerminator({ secret: SECRET, targetPort, listenPort: 0 });
    const port = await terminator.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, {
      headers: { [TUNNEL_HEADER]: 'client-forged' },
    });
    await once(ws, 'open');
    const echoed = once(ws, 'message');
    ws.send('ping');
    const [message] = await echoed;
    expect(String(message)).toBe('ping');
    expect(marker).toBe(SECRET);

    ws.terminate();
    await terminator.stop();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    target.closeAllConnections?.();
    await closeServer(target);
  });

  it('returns 502 when the target is down', async () => {
    const probe = http.createServer();
    const targetPort = await listen(probe);
    await closeServer(probe);

    const terminator = createTunnelTerminator({ secret: SECRET, targetPort, listenPort: 0 });
    const port = await terminator.start();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(502);
    await terminator.stop();
  });

  it('stops listening and reports no port after stop', async () => {
    const target = http.createServer((_req, res) => res.end('ok'));
    const targetPort = await listen(target);
    const terminator = createTunnelTerminator({ secret: SECRET, targetPort, listenPort: 0 });
    const port = await terminator.start();
    expect(terminator.port()).toBe(port);

    await terminator.stop();
    expect(terminator.port()).toBeNull();
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
    await closeServer(target);
  });

  it('falls back to an ephemeral port when the requested port is busy', async () => {
    const target = http.createServer((_req, res) => res.end('ok'));
    const targetPort = await listen(target);

    const first = createTunnelTerminator({ secret: SECRET, targetPort, listenPort: 0 });
    const firstPort = await first.start();
    const second = createTunnelTerminator({
      secret: SECRET,
      targetPort,
      listenPort: firstPort,
      fallbackToEphemeral: true,
    });
    const secondPort = await second.start();

    expect(secondPort).not.toBe(firstPort);
    expect(secondPort).toBeGreaterThan(0);

    await second.stop();
    await first.stop();
    await closeServer(target);
  });

  it('generates a 32-byte hex secret', () => {
    expect(newTunnelSecret()).toMatch(/^[0-9a-f]{64}$/);
  });
});
