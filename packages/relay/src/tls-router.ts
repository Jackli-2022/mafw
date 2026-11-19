import * as net from 'node:net';
import type { Duplex } from 'node:stream';
import { parseClientHelloSni } from './sni.ts';
import { parseRoomHost } from './room.ts';
import type { RoomRegistry } from './registry.ts';

export interface RouterHosts {
  online(roomId: string): boolean;
  openStream(roomId: string): Promise<Duplex>;
}

export interface RouterQuota {
  allowStream(roomId: string, ip: string): boolean;
  releaseStream(roomId: string, ip: string): void;
  allowBytes(roomId: string, bytes: number): boolean;
}

export interface TlsRouterOptions {
  domain: string;
  registry: RoomRegistry;
  hosts: RouterHosts;
  listenHost?: string;
  listenPort?: number;
  clientHelloTimeoutMs?: number;
  quota?: RouterQuota;
}

export interface TlsRouter {
  start(): Promise<number>;
  stop(): Promise<void>;
  port(): number | null;
}

const MAX_CLIENT_HELLO = 16 * 1024;

export function createTlsRouter(opts: TlsRouterOptions): TlsRouter {
  const listenHost = opts.listenHost ?? '127.0.0.1';
  const listenPort = opts.listenPort ?? 443;
  const timeoutMs = opts.clientHelloTimeoutMs ?? 5_000;

  let server: net.Server | null = null;
  let boundPort: number | null = null;
  const sockets = new Set<net.Socket>();
  const streams = new Set<Duplex>();

  function reject(socket: net.Socket): void {
    sockets.delete(socket);
    socket.destroy();
  }

  function handle(socket: net.Socket): void {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(timeoutMs, () => reject(socket));

    let buffered = Buffer.alloc(0);
    let opening = false;

    const onData = (chunk: Buffer): void => {
      if (opening) return;
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 5) return;

      const recordLength = buffered.readUInt16BE(3);
      if (recordLength <= 0 || recordLength > MAX_CLIENT_HELLO) {
        reject(socket);
        return;
      }
      if (buffered.length < 5 + recordLength) return;

      opening = true;
      socket.off('data', onData);
      socket.pause();
      socket.setTimeout(0);

      const sni = parseClientHelloSni(buffered);
      const room = sni ? parseRoomHost(sni, opts.domain) : null;
      if (!room
        || !opts.registry.get(room.roomId)
        || !opts.registry.routeSecretMatches(room.roomId, room.routeSecret)
        || !opts.hosts.online(room.roomId)) {
        reject(socket);
        return;
      }

      const clientIp = (socket.remoteAddress || '').replace(/^::ffff:/, '');
      if (opts.quota && !opts.quota.allowStream(room.roomId, clientIp)) {
        reject(socket);
        return;
      }
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        opts.quota?.releaseStream(room.roomId, clientIp);
      };
      if (opts.quota && !opts.quota.allowBytes(room.roomId, buffered.length)) {
        release();
        reject(socket);
        return;
      }

      void opts.hosts.openStream(room.roomId).then((stream) => {
        if (socket.destroyed) {
          stream.destroy();
          release();
          return;
        }
        streams.add(stream);
        stream.on('close', () => {
          streams.delete(stream);
          release();
        });
        stream.on('error', () => {
          socket.destroy();
          release();
        });
        socket.on('error', () => stream.destroy());
        socket.on('close', () => {
          stream.destroy();
          release();
        });
        socket.on('data', (chunk: Buffer) => {
          if (opts.quota && !opts.quota.allowBytes(room.roomId, chunk.length)) {
            socket.destroy();
            stream.destroy();
          }
        });

        stream.write(buffered);
        buffered = Buffer.alloc(0);
        socket.pipe(stream);
        stream.pipe(socket);
        socket.resume();
      }).catch(() => {
        release();
        reject(socket);
      });
    };

    socket.on('data', onData);
  }

  return {
    async start(): Promise<number> {
      if (server && boundPort !== null) return boundPort;
      await new Promise<void>((resolve, rejectStart) => {
        const next = net.createServer(handle);
        next.once('error', rejectStart);
        next.listen(listenPort, listenHost, () => {
          next.removeAllListeners('error');
          next.on('error', () => { /* per-connection errors are handled above */ });
          server = next;
          boundPort = (next.address() as net.AddressInfo).port;
          resolve();
        });
      });
      return boundPort as number;
    },

    async stop(): Promise<void> {
      const current = server;
      server = null;
      boundPort = null;
      for (const stream of streams) stream.destroy();
      streams.clear();
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      if (!current) return;
      await new Promise<void>((resolve) => current.close(() => resolve()));
    },

    port(): number | null {
      return boundPort;
    },
  };
}
