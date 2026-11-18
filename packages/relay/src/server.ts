import * as http from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { HostHub } from './host-hub.ts';
import { RoomRegistry } from './registry.ts';
import { createTlsRouter, type TlsRouter } from './tls-router.ts';

export interface RelayServerOptions {
  domain: string;
  listenHost?: string;
  tlsPort?: number;
  controlPort?: number;
  adminPort?: number;
  registry?: RoomRegistry;
}

export interface RelayPorts {
  tls: number;
  control: number;
  admin: number;
}

export interface RelayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  ports(): RelayPorts;
  readonly registry: RoomRegistry;
  readonly hub: HostHub;
}

export function createRelayServer(opts: RelayServerOptions): RelayServer {
  const listenHost = opts.listenHost ?? '127.0.0.1';
  const registry = opts.registry ?? new RoomRegistry();
  const hub = new HostHub(registry);
  const router: TlsRouter = createTlsRouter({
    domain: opts.domain,
    registry,
    hosts: hub,
    listenHost,
    listenPort: opts.tlsPort ?? 443,
  });

  let admin: http.Server | null = null;
  let wss: WebSocketServer | null = null;
  let ports: RelayPorts | null = null;

  return {
    registry,
    hub,

    async start(): Promise<void> {
      if (ports) return;

      admin = http.createServer((req, res) => {
        if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
      admin.listen(opts.adminPort ?? 8080, listenHost);
      await once(admin, 'listening');

      wss = new WebSocketServer({ port: opts.controlPort ?? 8444, host: listenHost });
      wss.on('connection', (ws) => hub.attach(ws));
      await once(wss, 'listening');

      const tlsPort = await router.start();
      const adminPort = (admin.address() as { port: number }).port;
      const controlPort = (wss.address() as { port: number }).port;
      ports = { tls: tlsPort, control: controlPort, admin: adminPort };
    },

    async stop(): Promise<void> {
      await router.stop();
      if (wss) {
        for (const client of wss.clients) client.terminate();
        await new Promise<void>((resolve) => wss!.close(() => resolve()));
        wss = null;
      }
      if (admin) {
        admin.closeAllConnections?.();
        await new Promise<void>((resolve) => admin!.close(() => resolve()));
        admin = null;
      }
      ports = null;
    },

    ports(): RelayPorts {
      if (!ports) throw new Error('relay not started');
      return ports;
    },
  };
}
