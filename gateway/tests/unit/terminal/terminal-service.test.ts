/**
 * Task 4：中性 terminal service（CRUD、不透明 ticket、WS 桥接）。
 *
 * 责任边界：
 *  - gateway 只认 MAFW 帧与 RuntimePtyChannel 契约；
 *  - 原生 URL / 原生票据 / 原生帧格式只在 adapter（此处以 fake channel 扮演）；
 *  - ticket：随机、短 TTL、绑定 ptyId + directory、单次使用。
 */
import type { RuntimePtyChannel, RuntimePtyInbound } from '../../../src/runtime/pty';
import { decodeOpencodePtyChunk } from '../../../src/runtime/opencode-adapter';
import { RuntimeAccess } from '../../../src/runtime/runtime-access';
import { projectExperienceActions } from '../../../src/experience/experience-projector';
import { MAFW_TERMINAL_PROTOCOL, TERMINAL_CLOSE_CODES } from '../../../src/terminal/terminal-protocol';
import { WebSocketServer } from 'ws';
import {
  TerminalService,
  TerminalTicketError,
  TerminalUnsupportedError,
  type TerminalNativeSocket,
  type TerminalSocket,
} from '../../../src/terminal/terminal-service';

const DIRECTORY = 'C:/work/look';

class FakeSocket implements TerminalSocket {
  sent: any[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];
  private handlers = new Map<string, Array<(...args: any[]) => void>>();

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
  }

  on(event: 'message' | 'close' | 'error', cb: (...args: any[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }

  emit(event: string, ...args: any[]): void {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }
}

class FakeNative implements TerminalNativeSocket {
  readyState = 1;
  sent: unknown[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];
  private handlers = new Map<string, Array<(...args: any[]) => void>>();

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
  }

  on(event: 'open' | 'message' | 'close' | 'error', cb: (...args: any[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }

  emit(event: string, ...args: any[]): void {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }
}

/** 真实 ws 语义：CONNECTING 时 send 抛错，只有 open 后才能写。 */
class ConnectingNative implements TerminalNativeSocket {
  readyState = 0;
  sent: unknown[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];
  sendAttempts = 0;
  private handlers = new Map<string, Array<(...args: any[]) => void>>();

  send(data: unknown): void {
    this.sendAttempts += 1;
    if (this.readyState !== 1) throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed.push({ code, reason });
  }

  on(event: 'open' | 'message' | 'close' | 'error', cb: (...args: any[]) => void): void {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }

  open(): void {
    this.readyState = 1;
    this.emit('open');
  }

  emit(event: string, ...args: any[]): void {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }
}

function fakePtyRuntime(overrides: Partial<RuntimePtyChannel> = {}) {
  const calls = {
    created: [] as any[],
    connected: [] as any[],
    resized: [] as any[],
    removed: [] as any[],
    listed: [] as any[],
  };
  const channel: RuntimePtyChannel = {
    async create(opts) {
      calls.created.push(opts);
      return { id: 'pty_1' };
    },
    async connect(opts) {
      calls.connected.push(opts);
      return {
        url: 'ws://127.0.0.1:4096/api/pty/pty_1/connect?ticket=native_secret',
        headers: { 'x-native': '1' },
      };
    },
    async resize(opts) {
      calls.resized.push(opts);
    },
    async remove(opts) {
      calls.removed.push(opts);
    },
    ...overrides,
  };
  return { runtime: { pty: channel }, channel, calls };
}

function serviceWith(runtime: { pty?: RuntimePtyChannel } | null, extra: Partial<ConstructorParameters<typeof TerminalService>[0]> = {}) {
  const natives: FakeNative[] = [];
  const opened: Array<{ url: string; headers?: Record<string, string> }> = [];
  const service = new TerminalService({
    getRuntime: () => runtime,
    openNative: (url, headers) => {
      opened.push({ url, headers });
      const native = new FakeNative();
      natives.push(native);
      return native;
    },
    ...extra,
  });
  return { service, natives, opened };
}

function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function nativeMeta(value: unknown): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const out = new Uint8Array(json.length + 1);
  out[0] = 0;
  out.set(json, 1);
  return out;
}

describe('TerminalService', () => {
  it('creates a session through the neutral channel with sane defaults', async () => {
    const { runtime, calls } = fakePtyRuntime();
    const { service } = serviceWith(runtime);

    const created = await service.create({ directory: DIRECTORY });
    expect(created).toEqual({ id: 'pty_1' });
    expect(calls.created[0]).toMatchObject({
      directory: DIRECTORY,
      cwd: DIRECTORY,
      cols: 120,
      rows: 30,
    });
  });

  it('maps runtime native meta frames behind the adapter boundary', async () => {
    const { runtime } = fakePtyRuntime();
    const { service } = serviceWith(runtime);
    const { id } = await service.create({ directory: DIRECTORY, cwd: DIRECTORY, cols: 120, rows: 30 });
    const conn = await service.connect(id, DIRECTORY);
    expect(conn.protocol).toBe('mafw-terminal/1');
    expect(conn.id).toBe(id);
    expect(JSON.stringify(conn)).not.toMatch(/opencode|ticket/i);
  });

  it('returns a neutral 503 when the runtime has no PTY channel', async () => {
    const { service } = serviceWith({});
    expect(service.supports()).toBe(false);
    await expect(service.create({ directory: DIRECTORY })).rejects.toBeInstanceOf(TerminalUnsupportedError);
    try {
      await service.create({ directory: DIRECTORY });
    } catch (err: any) {
      expect(err.status).toBe(503);
      expect(err.supported).toBe(false);
      expect(String(err.message)).not.toMatch(/opencode|pi\b|opencode/i);
    }
    expect(await service.list({ directory: DIRECTORY })).toEqual({
      protocol: MAFW_TERMINAL_PROTOCOL,
      supported: false,
      sessions: [],
    });
  });

  it('lists runtime sessions when the channel exposes them, else tracks created ones', async () => {
    const listless = fakePtyRuntime();
    const first = serviceWith(listless.runtime).service;
    await first.create({ directory: DIRECTORY, title: 'MAFW' });
    expect((await first.list({ directory: DIRECTORY })).sessions).toEqual([
      { id: 'pty_1', directory: DIRECTORY, title: 'MAFW', status: 'running' },
    ]);
    expect((await first.list({ directory: 'C:/other' })).sessions).toEqual([]);

    const listed = fakePtyRuntime({
      async list() {
        return [{ id: 'pty_9', status: 'exited' as const, title: 'old' }];
      },
    });
    const second = serviceWith(listed.runtime).service;
    expect(await second.list({ directory: DIRECTORY })).toEqual({
      protocol: MAFW_TERMINAL_PROTOCOL,
      supported: true,
      sessions: [{ id: 'pty_9', title: 'old', status: 'exited' }],
    });
  });

  it('never fabricates a directory for untracked runtime list rows', async () => {
    const listed = fakePtyRuntime({
      async list() {
        return [
          { id: 'pty_9', status: 'running' as const },
          { id: 'pty_1', status: 'running' as const },
        ];
      },
    });
    const { service } = serviceWith(listed.runtime);
    await service.create({ directory: DIRECTORY, title: 'MAFW' });

    // 无 directory 查询：已知归属用真值，未知归属省略字段。
    const all = await service.list();
    expect(all.sessions).toEqual([
      { id: 'pty_9', status: 'running' },
      { id: 'pty_1', directory: DIRECTORY, status: 'running' },
    ]);

    // 查询目录不是归属证据：pty_1 的目录来自台账，pty_9 仍然没有归属。
    const mismatched = await service.list({ directory: 'C:/other' });
    expect(mismatched.sessions).toEqual([
      { id: 'pty_9', status: 'running' },
      { id: 'pty_1', directory: DIRECTORY, status: 'running' },
    ]);
    expect(JSON.stringify(mismatched)).not.toContain('C:/other');
  });

  it('filters the local ledger by directory and keeps known ownership without a filter', async () => {
    const { runtime } = fakePtyRuntime();
    const { service } = serviceWith(runtime);
    await service.create({ directory: DIRECTORY, title: 'MAFW' });

    expect((await service.list()).sessions).toEqual([
      { id: 'pty_1', directory: DIRECTORY, title: 'MAFW', status: 'running' },
    ]);
    expect((await service.list({ directory: 'C:/other' })).sessions).toEqual([]);
  });

  it('issues single-use tickets bound to pty id and directory with a short TTL', async () => {
    let now = 1_000;
    const { runtime } = fakePtyRuntime();
    const { service } = serviceWith(runtime, { now: () => now, ticketTtlMs: 5_000, randomToken: () => 'tk_fixed' });

    const grant = service.issueTicket({ id: 'pty_1', directory: DIRECTORY });
    expect(grant.ticket).toBe('tk_fixed');
    expect(grant.expiresAt).toBe(6_000);
    expect(grant.url).toBe('/api/terminal/sessions/pty_1/connect?ticket=tk_fixed');
    expect(JSON.stringify(grant)).not.toMatch(/opencode|x-opencode-ticket/i);

    expect(service.consumeTicket('tk_fixed', { id: 'pty_1' })).toEqual({ directory: DIRECTORY });
    // single use
    expect(service.consumeTicket('tk_fixed', { id: 'pty_1' })).toBeNull();

    service.issueTicket({ id: 'pty_1', directory: DIRECTORY });
    expect(service.consumeTicket('tk_fixed', { id: 'pty_2' })).toBeNull();

    now = 10_000;
    service.issueTicket({ id: 'pty_1', directory: DIRECTORY });
    now = 15_000;
    expect(service.consumeTicket('tk_fixed', { id: 'pty_1' })).toBeNull();
  });

  it('refuses to issue tickets without a PTY channel', () => {
    const { service } = serviceWith({});
    expect(() => service.issueTicket({ id: 'pty_1', directory: DIRECTORY })).toThrow(TerminalUnsupportedError);
  });

  it('bridges MAFW frames to the native socket and back', async () => {
    const inbound: RuntimePtyInbound[] = [
      { kind: 'output', data: 'hello' },
      { kind: 'meta', event: 'cursor', payload: { cursor: 7 } },
    ];
    const { runtime, calls } = fakePtyRuntime({
      decodeInbound: () => inbound,
    });
    const { service, natives, opened } = serviceWith(runtime);
    const grant = service.issueTicket({ id: 'pty_1', directory: DIRECTORY });
    const socket = new FakeSocket();

    await service.bridge({ socket, id: 'pty_1', ticket: grant.ticket });

    // bridge 必须把 ticket 绑定的 location 传给 adapter（原生 WS 升级 location-scoped）
    expect(calls.connected).toEqual([{ id: 'pty_1', directory: DIRECTORY }]);
    expect(opened).toEqual([
      { url: 'ws://127.0.0.1:4096/api/pty/pty_1/connect?ticket=native_secret', headers: { 'x-native': '1' } },
    ]);
    const native = natives[0]!;

    native.emit('message', 'opaque-native-bytes');
    expect(socket.sent).toEqual([
      { v: 1, type: 'output', data: 'hello' },
      { v: 1, type: 'meta', event: 'cursor', payload: { cursor: 7 } },
    ]);

    socket.emit('message', Buffer.from('{"v":1,"type":"input","data":"ls\\r"}'));
    expect(native.sent).toEqual(['ls\r']);

    socket.emit('message', '{"v":1,"type":"resize","cols":100,"rows":40}');
    expect(calls.resized).toEqual([{ id: 'pty_1', directory: DIRECTORY, cols: 100, rows: 40 }]);

    socket.emit('message', '{"v":1,"type":"close","code":1001,"reason":"bye"}');
    expect(native.closed).toEqual([{ code: 1001, reason: 'bye' }]);
  });

  it('queues client frames that arrive before the upstream connection is ready', async () => {
    let resolveConnect!: (value: { url: string }) => void;
    const gate = new Promise<{ url: string }>((resolve) => { resolveConnect = resolve; });
    const { runtime, calls } = fakePtyRuntime({
      async connect() { return gate; },
    });
    const { service, natives } = serviceWith(runtime);
    const grant = service.issueTicket({ id: 'pty_1', directory: DIRECTORY });
    const socket = new FakeSocket();

    const bridged = service.bridge({ socket, id: 'pty_1', ticket: grant.ticket });
    socket.emit('message', '{"v":1,"type":"input","data":"echo"}');
    socket.emit('message', '{"v":1,"type":"resize","cols":90,"rows":20}');
    resolveConnect({ url: 'ws://native' });
    await bridged;

    expect(natives[0]!.sent).toEqual(['echo']);
    expect(calls.resized).toEqual([{ id: 'pty_1', directory: DIRECTORY, cols: 90, rows: 20 }]);
  });

  it('never writes to a CONNECTING native socket; flushes queued input on open', async () => {
    const { runtime, calls } = fakePtyRuntime();
    const connecting = new ConnectingNative();
    const { service } = serviceWith(runtime, { openNative: () => connecting });
    const grant = service.issueTicket({ id: 'pty_1', directory: DIRECTORY });
    const socket = new FakeSocket();

    await service.bridge({ socket, id: 'pty_1', ticket: grant.ticket });
    socket.emit('message', '{"v":1,"type":"input","data":"ls\\r"}');
    socket.emit('message', '{"v":1,"type":"resize","cols":111,"rows":33}');

    // CONNECTING 阶段既不写（不触发 ws 抛错），也不关闭会话。
    expect(connecting.sendAttempts).toBe(0);
    expect(connecting.sent).toEqual([]);
    expect(connecting.closed).toEqual([]);
    expect(socket.closed).toEqual([]);
    expect(calls.resized).toEqual([{ id: 'pty_1', directory: DIRECTORY, cols: 111, rows: 33 }]);

    connecting.open();
    expect(connecting.sent).toEqual(['ls\r']);
    expect(connecting.closed).toEqual([]);
    expect(socket.closed).toEqual([]);
  });

  it('closes both sides when a native inbound close event arrives', async () => {
    const { runtime } = fakePtyRuntime({ decodeInbound: () => [{ kind: 'close', code: 1004, reason: 'meta close' }] });
    const { service, natives } = serviceWith(runtime);
    const grant = service.issueTicket({ id: 'pty_1', directory: DIRECTORY });
    const socket = new FakeSocket();
    await service.bridge({ socket, id: 'pty_1', ticket: grant.ticket });

    natives[0]!.emit('message', 'native-close');
    expect(socket.sent).toEqual([{ v: 1, type: 'close', code: 1004, reason: 'meta close' }]);
    expect(natives[0]!.closed).toEqual([{ code: 1004, reason: 'meta close' }]);
  });

  it('closes the client socket with a neutral code when the ticket is invalid', async () => {
    const { runtime } = fakePtyRuntime();
    const { service, natives } = serviceWith(runtime);
    const socket = new FakeSocket();

    await service.bridge({ socket, id: 'pty_1', ticket: 'forged' });

    expect(natives).toHaveLength(0);
    expect(socket.sent).toEqual([
      { v: 1, type: 'close', code: TERMINAL_CLOSE_CODES.unauthorized, reason: 'terminal ticket rejected' },
    ]);
    expect(socket.closed[0]?.code).toBe(TERMINAL_CLOSE_CODES.unauthorized);
  });

  it('closes with the unsupported code when the runtime drops PTY support after issuance', async () => {
    const { runtime } = fakePtyRuntime();
    const runtimeRef: { pty?: RuntimePtyChannel } = runtime;
    const { service } = serviceWith(runtimeRef);
    const grant = service.issueTicket({ id: 'pty_1', directory: DIRECTORY });
    delete runtimeRef.pty;
    const socket = new FakeSocket();

    await service.bridge({ socket, id: 'pty_1', ticket: grant.ticket });

    expect(socket.sent).toEqual([
      { v: 1, type: 'close', code: TERMINAL_CLOSE_CODES.unsupported, reason: 'terminal is not supported' },
    ]);
  });

  it('forwards native close and rejects bad client frames', async () => {
    const { runtime } = fakePtyRuntime();
    const { service, natives } = serviceWith(runtime);
    const first = service.issueTicket({ id: 'pty_1', directory: DIRECTORY });
    const socket = new FakeSocket();
    await service.bridge({ socket, id: 'pty_1', ticket: first.ticket });
    natives[0]!.emit('close', 1000, 'upstream closed');
    expect(socket.sent).toEqual([{ v: 1, type: 'close', code: 1000, reason: 'upstream closed' }]);

    const second = new FakeSocket();
    const grant = service.issueTicket({ id: 'pty_1', directory: DIRECTORY });
    await service.bridge({ socket: second, id: 'pty_1', ticket: grant.ticket });
    second.emit('message', 'not-a-frame');
    expect(second.sent).toEqual([
      { v: 1, type: 'close', code: TERMINAL_CLOSE_CODES.badFrame, reason: 'invalid terminal frame' },
    ]);
  });

  it('refuses to consume tickets from a different session id', () => {
    const { runtime } = fakePtyRuntime();
    const { service } = serviceWith(runtime, { randomToken: () => 'tk_x' });
    service.issueTicket({ id: 'pty_1', directory: DIRECTORY });
    expect(service.consumeTicket('tk_x', { id: 'pty_2' })).toBeNull();
    expect(service.consumeTicket('missing', { id: 'pty_1' })).toBeNull();
    // consumed only by a successful match
    expect(service.consumeTicket('tk_x', { id: 'pty_1' })).toEqual({ directory: DIRECTORY });
  });
});

describe('terminal.pty surface projection', () => {
  function runtimeWith(pty?: RuntimePtyChannel) {
    return {
      name: 'test-runtime',
      capabilities: {},
      semantics: pty ? { 'terminal.pty': { persistent: true, protocol: MAFW_TERMINAL_PROTOCOL } } : {},
      ...(pty ? { pty } : {}),
    } as any;
  }

  it('lights up terminal.attach from a runtime that exposes the neutral PTY channel', () => {
    const { runtime } = fakePtyRuntime();
    const access = new RuntimeAccess(runtimeWith(runtime.pty));
    expect(access.can('terminal.pty')).toBe(true);
    expect(projectExperienceActions(access, {})['terminal.attach']).toEqual({
      supported: true,
      enabled: true,
      semantics: { persistent: true, protocol: MAFW_TERMINAL_PROTOCOL },
    });
  });

  it('keeps terminal.attach unsupported (no fake PTY) when the channel is absent', () => {
    const access = new RuntimeAccess(runtimeWith(undefined));
    expect(access.can('terminal.pty')).toBe(false);
    expect(projectExperienceActions(access, {})['terminal.attach']).toEqual({
      supported: false,
      enabled: false,
      reason: 'unsupported',
    });
  });
});

describe('TerminalService remove', () => {
  it('removes through the channel and forgets the tracked session', async () => {
    const { runtime, calls } = fakePtyRuntime();
    const { service } = serviceWith(runtime);
    await service.create({ directory: DIRECTORY });
    await service.remove('pty_1', DIRECTORY);
    expect(calls.removed).toEqual([{ id: 'pty_1', directory: DIRECTORY }]);
    expect((await service.list({ directory: DIRECTORY })).sessions).toEqual([]);
  });

  it('rejects empty ids', async () => {
    const { runtime } = fakePtyRuntime();
    const { service } = serviceWith(runtime);
    await expect(service.remove('', DIRECTORY)).rejects.toBeInstanceOf(TerminalTicketError);
  });
});

describe('opencode native PTY framing', () => {
  it('maps the replay cursor and drops unknown native meta payloads', () => {
    expect(decodeOpencodePtyChunk(nativeMeta({ cursor: 7 }))).toEqual([
      { kind: 'meta', event: 'cursor', payload: { cursor: 7 } },
    ]);
    // 未知原生 meta 不转发 payload：任意原生 JSON 不得泄漏到客户端。
    expect(decodeOpencodePtyChunk(nativeMeta({ secret: 'native-only', token: 'x' }))).toEqual([]);
    expect(decodeOpencodePtyChunk(nativeMeta(null))).toEqual([]);
    expect(decodeOpencodePtyChunk(nativeMeta([1, 2, 3]))).toEqual([]);
    expect(decodeOpencodePtyChunk(new Uint8Array([0, 123, 111, 111]))).toEqual([]); // invalid JSON after 0x00
  });

  it('keeps plain text/binary payloads as output', () => {
    expect(decodeOpencodePtyChunk('plain output')).toEqual([{ kind: 'output', data: 'plain output' }]);
    expect(decodeOpencodePtyChunk(new TextEncoder().encode('bytes'))).toEqual([
      { kind: 'output', data: 'bytes' },
    ]);
  });
});

describe('real ws bridge (default transport)', () => {
  it('opens a real WebSocket, streams output, forwards input and maps close', async () => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    expect(port).toBeGreaterThan(0);

    const received: string[] = [];
    let serverSocket: any;
    server.on('connection', (ws) => {
      serverSocket = ws;
      ws.send('boot');
      ws.on('message', (data) => {
        received.push(data.toString());
        ws.send(`echo:${data.toString()}`);
      });
    });

    const channel: RuntimePtyChannel = {
      async create() { return { id: 'pty_1' }; },
      async connect() { return { url: `ws://127.0.0.1:${port}` }; },
      async resize() { /* noop */ },
      async remove() { /* noop */ },
    };
    const service = new TerminalService({ getRuntime: () => ({ pty: channel }) });
    const socket = new FakeSocket();

    try {
      const grant = service.issueTicket({ id: 'pty_1', directory: DIRECTORY });
      await service.bridge({ socket, id: 'pty_1', ticket: grant.ticket });

      await waitFor(() => socket.sent.some((f) => f.type === 'output' && f.data === 'boot'));
      socket.emit('message', '{"v":1,"type":"input","data":"ls\\r"}');
      await waitFor(() => socket.sent.some((f) => f.type === 'output' && f.data === 'echo:ls\r'));
      expect(received).toEqual(['ls\r']);

      serverSocket.close(1000, 'bye');
      await waitFor(() => socket.sent.some((f) => f.type === 'close'));
      expect(socket.sent.find((f) => f.type === 'close')).toMatchObject({ code: 1000, reason: 'bye' });
    } finally {
      for (const client of server.clients) {
        try { client.terminate(); } catch { /* already closed */ }
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20_000);
});
