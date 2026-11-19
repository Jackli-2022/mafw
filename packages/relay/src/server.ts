import * as http from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { HostHub } from './host-hub.ts';
import { Quota } from './quota.ts';
import { RoomRegistry } from './registry.ts';
import { SqliteRoomStore } from './room-store.ts';
import { createTlsRouter, type TlsRouter } from './tls-router.ts';

export interface RelayServerOptions {
  domain: string;
  listenHost?: string;
  tlsPort?: number;
  controlPort?: number;
  adminPort?: number;
  /** M4: SQLite file for durable room claims; omit for in-memory (tests). */
  dbPath?: string;
  quota?: Quota;
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
  readonly quota: Quota;
}

export function createRelayServer(opts: RelayServerOptions): RelayServer {
  const listenHost = opts.listenHost ?? '127.0.0.1';
  const ownsRegistry = !opts.registry;
  const registry = opts.registry ?? new RoomRegistry(
    opts.dbPath ? new SqliteRoomStore(opts.dbPath) : undefined,
  );
  const quota = opts.quota ?? new Quota();
  const hub = new HostHub(registry, quota);
  const router: TlsRouter = createTlsRouter({
    domain: opts.domain,
    registry,
    hosts: hub,
    listenHost,
    listenPort: opts.tlsPort ?? 443,
    quota,
  });

  let admin: http.Server | null = null;
  let wss: WebSocketServer | null = null;
  let ports: RelayPorts | null = null;

  return {
    registry,
    hub,
    quota,

    async start(): Promise<void> {
      if (ports) return;

      admin = http.createServer((req, res) => {
        const path = (req.url || '').split('?')[0];
        if (req.method === 'GET' && path === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }
        if (req.method === 'GET' && path === '/metrics') {
          const rooms = registry.stats();
          const quotaStats = quota.stats();
          res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
          res.end([
            '# HELP relay_rooms_total Total room claims (online + offline).',
            '# TYPE relay_rooms_total gauge',
            `relay_rooms_total ${rooms.total}`,
            '# HELP relay_rooms_online Rooms with a live host connection.',
            '# TYPE relay_rooms_online gauge',
            `relay_rooms_online ${rooms.online}`,
            '# HELP relay_room_creations_today Room creations counted today.',
            '# TYPE relay_room_creations_today gauge',
            `relay_room_creations_today ${quotaStats.roomsToday}`,
            '# HELP relay_streams_active Active relay streams.',
            '# TYPE relay_streams_active gauge',
            `relay_streams_active ${quotaStats.activeStreams}`,
            '',
          ].join('\n'));
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
      if (ownsRegistry) registry.close();
      ports = null;
    },

    ports(): RelayPorts {
      if (!ports) throw new Error('relay not started');
      return ports;
    },
  };
}
