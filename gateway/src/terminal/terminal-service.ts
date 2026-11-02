/**
 * 中性 terminal service：PTY 会话 CRUD、不透明 ticket、MAFW 帧桥接。
 *
 * 边界：
 *  - runtime 原生 PTY（/api/pty、connect-token、原生 WS 帧）只存在于 adapter；
 *  - 本服务只消费 `RuntimePtyChannel` 与 MAFW 帧；
 *  - 不支持时抛 `TerminalUnsupportedError`（503 + supported:false），绝不伪造 PTY。
 */
import { randomBytes } from 'crypto';
import { WebSocket } from 'ws';
import type {
  RuntimePtyChannel,
  RuntimePtyInfo,
  RuntimePtyInbound,
} from '../runtime/pty';
import {
  MAFW_TERMINAL_PROTOCOL,
  TERMINAL_CLOSE_CODES,
  decodeTerminalFrame,
  encodeTerminalFrame,
  terminalConnectPath,
  type TerminalFrame,
} from './terminal-protocol';

export interface TerminalCreateOpts {
  directory: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  title?: string;
}

export interface TerminalSessionView {
  id: string;
  /** 仅在归属已知（本进程创建/列表带来）时给出；未知时省略，不伪造。 */
  directory?: string;
  title?: string;
  status: 'running' | 'exited' | 'unknown';
  cwd?: string;
}

export interface TerminalListResult {
  protocol: string;
  supported: boolean;
  sessions: TerminalSessionView[];
}

/** 服务端回给客户端的连接描述（相对路径，不含票据）。 */
export interface TerminalConnectView {
  protocol: string;
  id: string;
  url: string;
}

export interface TerminalTicketView {
  protocol: string;
  ticket: string;
  /** 相对 WS 路径 + 一次性票据 query。 */
  url: string;
  expiresAt: number;
}

/** 下游（desktop）socket 的最小面（ws.WebSocket 结构兼容）。 */
export interface TerminalSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message' | 'close' | 'error', cb: (...args: any[]) => void): void;
}

/** 上游（runtime 原生）socket 的最小面。 */
export interface TerminalNativeSocket {
  /** 原生 socket 状态（ws：0=CONNECTING / 1=OPEN）；缺省视为未就绪，等 `open` 事件。 */
  readyState?: number;
  send(data: unknown): void;
  close(code?: number, reason?: string): void;
  on(event: 'open' | 'message' | 'close' | 'error', cb: (...args: any[]) => void): void;
}

/** ws 常量：readyState === 1 表示 OPEN（测试与实现共用）。 */
export const NATIVE_PTY_OPEN = 1;

export interface TerminalServiceOptions {
  /** 热切换安全：每次调用现读 runtime（不得缓存 adapter 实例）。 */
  getRuntime(): { pty?: RuntimePtyChannel } | null;
  now?: () => number;
  randomToken?: () => string;
  /** 票据有效期（默认 30s——升级握手立刻消费，无需更长）。 */
  ticketTtlMs?: number;
  /** 测试注入；缺省用 ws 客户端连接 runtime 原生 URL。 */
  openNative?(url: string, headers?: Record<string, string>): TerminalNativeSocket;
}

interface TicketGrant {
  id: string;
  directory: string;
  expiresAt: number;
}

interface TrackedSession {
  id: string;
  directory: string;
  title?: string;
}

export class TerminalUnsupportedError extends Error {
  readonly status = 503;
  readonly supported = false;

  constructor() {
    super('terminal PTY is not supported by the active runtime');
    this.name = 'TerminalUnsupportedError';
  }
}

export class TerminalTicketError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'TerminalTicketError';
  }
}

const DEFAULT_TICKET_TTL_MS = 30_000;

function decodeBytes(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof Uint8Array) return Buffer.from(data).toString('utf8');
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return null;
}

export class TerminalService {
  private readonly opts: TerminalServiceOptions;
  private readonly tickets = new Map<string, TicketGrant>();
  private readonly sessions = new Map<string, TrackedSession>();

  constructor(opts: TerminalServiceOptions) {
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private ticketTtlMs(): number {
    const ttl = this.opts.ticketTtlMs;
    return typeof ttl === 'number' && ttl > 0 ? ttl : DEFAULT_TICKET_TTL_MS;
  }

  private token(): string {
    return this.opts.randomToken ? this.opts.randomToken() : randomBytes(24).toString('base64url');
  }

  private channel(): RuntimePtyChannel | null {
    const channel = this.opts.getRuntime()?.pty;
    if (!channel || typeof channel.create !== 'function' || typeof channel.connect !== 'function') return null;
    return channel;
  }

  supports(): boolean {
    return this.channel() !== null;
  }

  async create(opts: TerminalCreateOpts): Promise<{ id: string }> {
    const channel = this.channel();
    if (!channel) throw new TerminalUnsupportedError();
    if (!opts?.directory || typeof opts.directory !== 'string') {
      throw new TerminalTicketError('directory is required');
    }
    const created = await channel.create({
      directory: opts.directory,
      cwd: opts.cwd ?? opts.directory,
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 30,
      ...(opts.title ? { title: opts.title } : {}),
    });
    if (!created?.id) throw new Error('runtime PTY create returned no id');
    this.sessions.set(created.id, {
      id: created.id,
      directory: opts.directory,
      ...(opts.title ? { title: opts.title } : {}),
    });
    return { id: created.id };
  }

  async list(opts: { directory?: string } = {}): Promise<TerminalListResult> {
    const channel = this.channel();
    const directory = opts.directory;
    if (!channel) return { protocol: MAFW_TERMINAL_PROTOCOL, supported: false, sessions: [] };
    if (typeof channel.list === 'function') {
      const rows: RuntimePtyInfo[] = await channel.list({ directory });
      return {
        protocol: MAFW_TERMINAL_PROTOCOL,
        supported: true,
        sessions: rows
          .filter((row) => !!row?.id)
          .map((row) => {
            // 目录只信「本进程创建时记录」的真值；请求 query 是过滤条件，不是归属证据。
            // 未知归属时省略 directory，绝不编造。
            const known = this.sessions.get(String(row.id))?.directory;
            return {
              id: String(row.id),
              ...(known ? { directory: known } : {}),
              ...(row.title ? { title: row.title } : {}),
              status: row.status ?? 'unknown',
              ...(row.cwd ? { cwd: row.cwd } : {}),
            };
          }),
      };
    }
    const tracked = [...this.sessions.values()].filter((s) => !directory || s.directory === directory);
    return {
      protocol: MAFW_TERMINAL_PROTOCOL,
      supported: true,
      sessions: tracked.map((s) => ({
        id: s.id,
        directory: s.directory,
        ...(s.title ? { title: s.title } : {}),
        status: 'running' as const,
      })),
    };
  }

  /** 中性连接描述：协议 + id + 相对路径（票据另行签发）。 */
  async connect(id: string, _directory?: string): Promise<TerminalConnectView> {
    if (!id) throw new TerminalTicketError('terminal session id is required');
    if (!this.channel()) throw new TerminalUnsupportedError();
    return { protocol: MAFW_TERMINAL_PROTOCOL, id, url: terminalConnectPath(id) };
  }

  /** 签发一次性 ticket：绑定 ptyId + directory + 短 TTL。 */
  issueTicket(opts: { id: string; directory: string }): TerminalTicketView {
    if (!this.channel()) throw new TerminalUnsupportedError();
    if (!opts?.id) throw new TerminalTicketError('terminal session id is required');
    if (!opts?.directory) throw new TerminalTicketError('directory is required');
    this.pruneExpired();
    const ticket = this.token();
    const expiresAt = this.now() + this.ticketTtlMs();
    this.tickets.set(ticket, { id: opts.id, directory: opts.directory, expiresAt });
    return {
      protocol: MAFW_TERMINAL_PROTOCOL,
      ticket,
      url: `${terminalConnectPath(opts.id)}?ticket=${encodeURIComponent(ticket)}`,
      expiresAt,
    };
  }

  /** 单次消费；id 不匹配/过期/不存在 → null。 */
  consumeTicket(ticket: string, opts: { id: string }): { directory: string } | null {
    // 顺手清过期票据：签发点之外的第二次清扫（客户端可能签发后从不连接，
    // 只靠 issueTicket 触发会让 tickets 无界增长）。
    this.pruneExpired();
    const grant = this.tickets.get(ticket);
    if (!grant) return null;
    if (grant.expiresAt <= this.now()) {
      this.tickets.delete(ticket);
      return null;
    }
    if (grant.id !== opts.id) return null;
    this.tickets.delete(ticket);
    return { directory: grant.directory };
  }

  async remove(id: string, directory?: string): Promise<void> {
    if (!id) throw new TerminalTicketError('terminal session id is required');
    const channel = this.channel();
    if (!channel) throw new TerminalUnsupportedError();
    this.sessions.delete(id);
    await channel.remove({ id, ...(directory ? { directory } : {}) });
  }

  /**
   * WS 升级后的桥接：校验 ticket → 连 runtime 原生 socket → 双向翻译。
   * 任何失败都用中性 close 帧告知客户端，不把原生错误/URL 泄漏出去。
   */
  async bridge(params: { socket: TerminalSocket; id: string; ticket: string }): Promise<void> {
    const { socket, id, ticket } = params;
    const grant = this.consumeTicket(ticket, { id });
    if (!grant) {
      this.closeClient(socket, TERMINAL_CLOSE_CODES.unauthorized, 'terminal ticket rejected');
      return;
    }
    const channel = this.channel();
    if (!channel) {
      this.closeClient(socket, TERMINAL_CLOSE_CODES.unsupported, 'terminal is not supported');
      return;
    }
    let closed = false;
    let native: TerminalNativeSocket | null = null;
    let nativeReady = false;
    const outbox: unknown[] = [];
    const closeClient = (code: number, reason: string) => {
      if (closed) return;
      closed = true;
      this.closeClient(socket, code, reason);
      try { native?.close(code, reason); } catch { /* already closed */ }
    };

    const sendNow = (payload: unknown): void => {
      if (!native) return;
      try {
        native.send(payload);
      } catch {
        closeClient(TERMINAL_CLOSE_CODES.upstream, 'terminal upstream unavailable');
      }
    };

    /** 原生 socket 未 OPEN 前一律排队（ws 在 CONNECTING 发消息会抛错 → 不能断会话）。 */
    const sendOrQueue = (payload: unknown): void => {
      if (!native || !nativeReady) {
        outbox.push(payload);
        return;
      }
      sendNow(payload);
    };

    const flushOutbox = (): void => {
      if (!native || !nativeReady) return;
      while (outbox.length > 0 && !closed) {
        sendNow(outbox.shift());
      }
    };

    // 先挂客户端监听：`connect` 往返期间到达的 input 排队、resize 直接走 HTTP 原语。
    socket.on('message', (raw: unknown) => {
      if (closed) return;
      const frame = decodeTerminalFrame(raw);
      if (!frame) {
        closeClient(TERMINAL_CLOSE_CODES.badFrame, 'invalid terminal frame');
        return;
      }
      this.handleClientFrame(channel, grant.directory, id, frame, closeClient, sendOrQueue);
    });
    socket.on('close', () => {
      closed = true;
      try { native?.close(); } catch { /* already closed */ }
    });
    socket.on('error', () => {
      closed = true;
      try { native?.close(); } catch { /* already closed */ }
    });

    let connection: { url: string; headers?: Record<string, string> };
    try {
      connection = await channel.connect({ id, directory: grant.directory });
    } catch {
      closeClient(TERMINAL_CLOSE_CODES.upstream, 'terminal upstream unavailable');
      return;
    }
    if (closed) return;

    let opened: TerminalNativeSocket;
    try {
      opened = this.opts.openNative
        ? this.opts.openNative(connection.url, connection.headers)
        : (new WebSocket(connection.url, {
            headers: connection.headers,
          } as any) as unknown as TerminalNativeSocket);
    } catch {
      closeClient(TERMINAL_CLOSE_CODES.upstream, 'terminal upstream unavailable');
      return;
    }
    native = opened;

    opened.on('open', () => {
      if (closed) return;
      nativeReady = true;
      flushOutbox();
    });
    opened.on('message', (data: unknown) => {
      if (closed) return;
      for (const event of this.inboundEvents(channel, data)) {
        if (event.kind === 'output') socket.send(encodeTerminalFrame({ v: 1, type: 'output', data: event.data }));
        else if (event.kind === 'meta') {
          socket.send(encodeTerminalFrame({
            v: 1,
            type: 'meta',
            event: event.event,
            ...(event.payload !== undefined ? { payload: event.payload } : {}),
          }));
        } else if (event.kind === 'close') {
          // 原生 meta/close 与 WS close 同义：必须真正收口上下游状态。
          closeClient(event.code ?? 1000, event.reason ?? 'terminal closed');
        }
      }
    });
    opened.on('close', (code?: number, reason?: unknown) => {
      if (closed) return;
      closed = true;
      const reasonText = decodeBytes(reason) ?? '';
      this.closeClient(
        socket,
        typeof code === 'number' && code > 0 ? code : 1000,
        reasonText || 'terminal upstream closed',
      );
    });
    opened.on('error', () => {
      closeClient(TERMINAL_CLOSE_CODES.upstream, 'terminal upstream error');
    });

    // 已 OPEN 的注入式 tunnel（或无 open 事件的 fake）立即放行队列。
    if (opened.readyState === NATIVE_PTY_OPEN) {
      nativeReady = true;
      flushOutbox();
    }
  }

  private inboundEvents(channel: RuntimePtyChannel, data: unknown): RuntimePtyInbound[] {
    if (typeof channel.decodeInbound === 'function') {
      try {
        const events = channel.decodeInbound(data);
        return Array.isArray(events) ? events : [];
      } catch {
        return [];
      }
    }
    const text = decodeBytes(data);
    return text === null ? [] : [{ kind: 'output', data: text }];
  }

  private handleClientFrame(
    channel: RuntimePtyChannel,
    directory: string,
    id: string,
    frame: TerminalFrame,
    close: (code: number, reason: string) => void,
    sendInput: (payload: unknown) => void,
  ): void {
    switch (frame.type) {
      case 'input': {
        sendInput(typeof channel.encodeInput === 'function' ? channel.encodeInput(frame.data) : frame.data);
        return;
      }
      case 'resize': {
        try {
          // 直接触发（同步入队），失败不终止会话（与桌面既有语义一致）。
          const pending = channel.resize({ id, directory, cols: frame.cols, rows: frame.rows });
          void Promise.resolve(pending).catch(() => { /* resize 失败不终止会话 */ });
        } catch { /* resize 失败不终止会话 */ }
        return;
      }
      case 'close': {
        close(frame.code, frame.reason ?? 'terminal closed');
        return;
      }
      default:
        // output/meta 只允许服务端 → 客户端；客户端发送视为非法。
        close(TERMINAL_CLOSE_CODES.badFrame, 'invalid terminal frame');
    }
  }

  private closeClient(socket: TerminalSocket, code: number, reason: string): void {
    try {
      socket.send(encodeTerminalFrame({ v: 1, type: 'close', code, reason }));
    } catch { /* socket already gone */ }
    try {
      socket.close(code, reason);
    } catch { /* already closed */ }
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [ticket, grant] of this.tickets) {
      if (grant.expiresAt <= now) this.tickets.delete(ticket);
    }
  }
}
