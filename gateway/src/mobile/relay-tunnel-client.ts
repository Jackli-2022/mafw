import * as net from 'net';
import { WebSocket } from 'ws';
import { decodeFrame, encodeFrame } from './relay-frames';

export interface RelayTunnelClientOptions {
  /** Relay control WSS, e.g. wss://relay.example.com:8443/host. */
  url: string;
  roomId: string;
  roomToken: string;
  routeSecret: string;
  /** Loopback TLS terminator port. */
  localPort: number;
  reconnectMs?: number;
  maxReconnectMs?: number;
}

export interface RelayTunnelStatus {
  connected: boolean;
  lastError?: string;
}

/**
 * M2 gateway-side host client. It keeps an outbound control WebSocket to the
 * relay, registers the room, and bridges each relay `open` stream to the local
 * TLS terminator. The relay never sees plaintext.
 */
export class RelayTunnelClient {
  private readonly opts: RelayTunnelClientOptions;
  private ws: WebSocket | null = null;
  private stopped = true;
  private connected = false;
  private lastError: string | undefined;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay: number;
  private readonly sockets = new Map<number, net.Socket>();

  constructor(opts: RelayTunnelClientOptions) {
    this.opts = opts;
    this.reconnectDelay = opts.reconnectMs ?? 1_000;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.closeSockets();
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* already closed */ }
  }

  status(): RelayTunnelStatus {
    return this.connected ? { connected: true } : { connected: false, lastError: this.lastError };
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.on('open', () => {
      if (this.ws !== ws) return;
      ws.send(JSON.stringify({
        type: 'hello',
        protocolVersion: 1,
        roomId: this.opts.roomId,
        roomToken: this.opts.roomToken,
        routeSecret: this.opts.routeSecret,
      }));
    });

    ws.on('message', (data, isBinary) => {
      if (this.ws !== ws) return;
      if (isBinary) {
        this.onBinary(Buffer.from(data as Buffer));
        return;
      }
      this.onControl(Buffer.from(data as Buffer));
    });

    ws.on('error', (err) => {
      this.lastError = err.message;
    });

    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.connected = false;
      this.ws = null;
      this.closeSockets();
      this.scheduleReconnect();
    });
  }

  private onControl(raw: Buffer): void {
    let message: any;
    try {
      message = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }
    if (message?.type === 'hello-ok') {
      this.connected = true;
      this.lastError = undefined;
      this.reconnectDelay = this.opts.reconnectMs ?? 1_000;
      return;
    }
    if (message?.type === 'error') {
      this.lastError = typeof message.code === 'string' ? message.code : 'relay error';
      return;
    }
    if (message?.type === 'open' && Number.isInteger(message.streamId)) {
      this.openLocal(message.streamId);
    }
  }

  private openLocal(streamId: number): void {
    const socket = net.connect(this.opts.localPort, '127.0.0.1');
    this.sockets.set(streamId, socket);
    socket.on('data', (chunk) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(encodeFrame({ type: 1, streamId, payload: Buffer.from(chunk) }));
      }
    });
    socket.on('close', () => {
      if (!this.sockets.delete(streamId)) return;
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(encodeFrame({ type: 3, streamId, payload: Buffer.alloc(0) }));
      }
    });
    socket.on('error', () => {
      this.sockets.delete(streamId);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(encodeFrame({ type: 3, streamId, payload: Buffer.alloc(0) }));
      }
    });
  }

  private onBinary(raw: Buffer): void {
    let frame;
    try {
      frame = decodeFrame(raw);
    } catch {
      return;
    }
    const socket = this.sockets.get(frame.streamId);
    if (!socket) return;
    if (frame.type === 1) {
      socket.write(frame.payload);
    } else if (frame.type === 3) {
      this.sockets.delete(frame.streamId);
      socket.end();
    }
  }

  private closeSockets(): void {
    for (const socket of this.sockets.values()) socket.destroy();
    this.sockets.clear();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(
      (this.opts.maxReconnectMs ?? 30_000),
      Math.max(this.opts.reconnectMs ?? 1_000, this.reconnectDelay * 2),
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }
}
