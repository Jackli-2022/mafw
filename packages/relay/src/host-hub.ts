import { randomUUID } from 'node:crypto';
import { Duplex } from 'node:stream';
import type { WebSocket } from 'ws';
import { decodeFrame, encodeFrame } from './frames.ts';
import type { RoomRegistry } from './registry.ts';

interface HostConnection {
  id: string;
  roomId: string;
  ws: WebSocket;
  streams: Map<number, HostStream>;
  nextStreamId: number;
}

class HostStream extends Duplex {
  private readonly connection: HostConnection;
  readonly streamId: number;

  constructor(connection: HostConnection, streamId: number) {
    super();
    this.connection = connection;
    this.streamId = streamId;
  }

  _read(): void {
    // M1: the router reads at its own pace; window updates land with the
    // bandwidth milestone. The frame primitives already cap payload size.
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    try {
      this.connection.ws.send(encodeFrame({
        type: 1,
        streamId: this.streamId,
        payload: Buffer.from(chunk),
      }));
      callback();
    } catch (err) {
      callback(err as Error);
    }
  }

  _final(callback: (error?: Error | null) => void): void {
    try {
      this.connection.ws.send(encodeFrame({ type: 3, streamId: this.streamId, payload: Buffer.alloc(0) }));
    } catch { /* host already gone */ }
    callback();
  }

  pushFromHost(payload: Buffer): void {
    this.push(payload);
  }

  endFromHost(): void {
    this.push(null);
  }
}

export interface HostQuota {
  allowRoom?(ip: string): boolean;
  allowBytes(roomId: string, bytes: number): boolean;
}

/**
 * M1 host control plane. One WebSocket per host connection, multiplexed streams
 * identified by a 32-bit id. The relay never parses the stream contents.
 */
export class HostHub {
  private readonly hosts = new Map<string, HostConnection>();
  private readonly registry: RoomRegistry;
  private readonly quota?: HostQuota;

  constructor(registry: RoomRegistry, quota?: HostQuota) {
    this.registry = registry;
    this.quota = quota;
  }

  attach(ws: WebSocket): void {
    let connection: HostConnection | null = null;
    const ip = String((ws as any)._socket?.remoteAddress || '').replace(/^::ffff:/, '');

    ws.on('message', (data, isBinary) => {
      if (!connection) {
        if (isBinary) {
          ws.close(1008, 'hello required');
          return;
        }
        connection = this.handleHello(ws, Buffer.from(data as Buffer), ip);
        return;
      }
      if (isBinary) {
        this.handleFrame(connection, Buffer.from(data as Buffer));
        return;
      }
      this.handleControl(connection, Buffer.from(data as Buffer));
    });

    ws.on('close', () => {
      if (connection) this.detach(connection);
    });
  }

  online(roomId: string): boolean {
    return this.hosts.has(roomId);
  }

  async openStream(roomId: string): Promise<Duplex> {
    const connection = this.hosts.get(roomId);
    if (!connection) throw new Error('room offline');
    const streamId = connection.nextStreamId++;
    const stream = new HostStream(connection, streamId);
    connection.streams.set(streamId, stream);
    connection.ws.send(JSON.stringify({ type: 'open', streamId }));
    return stream;
  }

  closeStream(roomId: string, streamId: number): void {
    const connection = this.hosts.get(roomId);
    const stream = connection?.streams.get(streamId);
    if (!stream) return;
    connection!.streams.delete(streamId);
    stream.destroy();
    try { connection!.ws.send(JSON.stringify({ type: 'close', streamId })); } catch { /* gone */ }
  }

  private handleHello(ws: WebSocket, raw: Buffer, ip: string): HostConnection | null {
    let hello: any;
    try {
      hello = JSON.parse(raw.toString('utf8'));
    } catch {
      ws.close(1008, 'invalid hello');
      return null;
    }
    if (hello?.type !== 'hello' || hello?.protocolVersion !== 1
      || typeof hello.roomId !== 'string' || typeof hello.roomToken !== 'string'
      || typeof hello.routeSecret !== 'string') {
      ws.close(1008, 'invalid hello');
      return null;
    }

    let claim = this.registry.authenticate(hello.roomId, hello.roomToken, hello.routeSecret);
    if (!claim) {
      if (!this.registry.get(hello.roomId) && this.quota?.allowRoom && !this.quota.allowRoom(ip)) {
        ws.send(JSON.stringify({ type: 'error', code: 'room_quota' }));
        ws.close(1008, 'room_quota');
        return null;
      }
      // First host connection creates the room claim; later connections must
      // present the same token (claim() returns null on a mismatch).
      claim = this.registry.claim({
        roomId: hello.roomId,
        roomToken: hello.roomToken,
        routeSecret: hello.routeSecret,
      });
    }
    if (!claim) {
      ws.send(JSON.stringify({ type: 'error', code: 'unauthorized' }));
      ws.close(1008, 'unauthorized');
      return null;
    }

    const id = randomUUID();
    const attached = this.registry.attachHost(hello.roomId, id);
    if (!attached.ok) {
      ws.send(JSON.stringify({ type: 'error', code: 'room_not_found' }));
      ws.close(1008, 'room_not_found');
      return null;
    }

    if (attached.replaced) {
      const old = this.hosts.get(hello.roomId);
      if (old) {
        for (const stream of old.streams.values()) stream.destroy();
        old.streams.clear();
        try { old.ws.close(4001, 'replaced'); } catch { /* gone */ }
      }
    }

    const connection: HostConnection = {
      id,
      roomId: hello.roomId,
      ws,
      streams: new Map(),
      nextStreamId: 1,
    };
    this.hosts.set(hello.roomId, connection);
    ws.send(JSON.stringify({ type: 'hello-ok', roomId: hello.roomId }));
    return connection;
  }

  private handleFrame(connection: HostConnection, raw: Buffer): void {
    let frame;
    try {
      frame = decodeFrame(raw);
    } catch {
      connection.ws.close(1008, 'invalid frame');
      return;
    }
    const stream = connection.streams.get(frame.streamId);
    if (!stream) return;
    if (frame.type === 1) {
      if (this.quota && !this.quota.allowBytes(connection.roomId, frame.payload.length)) {
        this.closeStream(connection.roomId, frame.streamId);
        return;
      }
      stream.pushFromHost(frame.payload);
    } else if (frame.type === 3) {
      connection.streams.delete(frame.streamId);
      stream.endFromHost();
    }
    // type 2 (WINDOW) is accepted for forward compatibility; M1 does not
    // apply per-stream backpressure yet.
  }

  private handleControl(connection: HostConnection, raw: Buffer): void {
    let message: any;
    try {
      message = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }
    if (message?.type === 'ping') {
      try { connection.ws.send(JSON.stringify({ type: 'pong' })); } catch { /* gone */ }
    }
  }

  private detach(connection: HostConnection): void {
    this.registry.detachHost(connection.roomId, connection.id);
    for (const stream of connection.streams.values()) stream.destroy();
    connection.streams.clear();
    if (this.hosts.get(connection.roomId)?.id === connection.id) {
      this.hosts.delete(connection.roomId);
    }
  }
}
