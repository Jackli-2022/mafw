/**
 * E4-4 upgrade 阶段连接上限（spec §4.4）。
 *
 * 超限必须在 `handleUpgrade` **之前**拒绝：一旦升级成功就再也回不了 503，
 * 而且 `wsClients` 里会多一个永远不会被计入上限的客户端。lease 绑定到
 * socket / ws 的 close+error（二者都可能先到），必须只释放一次。
 */
import * as http from 'http';
import { admitUpgrade, createWsHub, type WsHubDeps } from '../../../src/http/ws-upgrade';
import { ConnectionTable } from '../../../src/resources/connections';
import * as pluginWeb from '../../../src/routes/plugin-web';

const TOKEN = 'sekret';
const LOOPBACK = '127.0.0.1';

interface FakeSocket {
  remoteAddress: string;
  written: string;
  destroyed: boolean;
  listeners: Record<string, Array<() => void>>;
  write(chunk: string): boolean;
  destroy(): void;
  on(ev: string, fn: () => void): FakeSocket;
  emit(ev: string): void;
}

function fakeSocket(remoteAddress: string = LOOPBACK): FakeSocket {
  const socket: FakeSocket = {
    remoteAddress,
    written: '',
    destroyed: false,
    listeners: {},
    write(chunk: string) {
      socket.written += chunk;
      return true;
    },
    destroy() { socket.destroyed = true; },
    on(ev: string, fn: () => void) {
      (socket.listeners[ev] = socket.listeners[ev] ?? []).push(fn);
      return socket;
    },
    emit(ev: string) {
      for (const fn of socket.listeners[ev] ?? []) fn();
    },
  };
  return socket;
}

function fakeReq(url: string): http.IncomingMessage {
  return {
    url,
    headers: { host: '127.0.0.1:3000' },
    socket: { remoteAddress: LOOPBACK },
  } as unknown as http.IncomingMessage;
}

interface FakeWs {
  sent: string[];
  terminated: boolean;
  listeners: Record<string, Array<() => void>>;
  readyState: number;
  deviceId?: string;
  send(frame: string): void;
  terminate(): void;
  ping(): void;
  close(): void;
  on(ev: string, fn: () => void): FakeWs;
  emit(ev: string): void;
}

function fakeWs(): FakeWs {
  const ws: FakeWs = {
    sent: [],
    terminated: false,
    listeners: {},
    readyState: 1,
    send(frame: string) { ws.sent.push(frame); },
    terminate() { ws.terminated = true; },
    ping() {},
    close() {},
    on(ev: string, fn: () => void) {
      (ws.listeners[ev] = ws.listeners[ev] ?? []).push(fn);
      return ws;
    },
    emit(ev: string) {
      for (const fn of ws.listeners[ev] ?? []) fn();
    },
  };
  return ws;
}

const hubs: Array<ReturnType<typeof createWsHub>> = [];

afterEach(() => {
  for (const hub of hubs.splice(0)) hub.dispose();
  jest.restoreAllMocks();
});

function setup(connections: () => ConnectionTable | null) {
  const wsClients = new Set<unknown>();
  const deps: WsHubDeps = {
    wsClients: wsClients as never,
    apiToken: () => TOKEN,
    pushGateway: () => undefined,
    handleWsMessage: jest.fn(),
    getVoiceRuntime: jest.fn(async () => ({ createSession: jest.fn() })),
    getTerminalService: jest.fn(() => ({ bridge: jest.fn(async () => undefined) })),
    pluginWebDeps: jest.fn(() => ({}) as never),
    connections,
  };
  const server = http.createServer();
  const hub = createWsHub(server, deps);
  hubs.push(hub);
  const upgrade = {
    voice: jest.spyOn(hub.voiceWss, 'handleUpgrade').mockImplementation(() => undefined),
    terminal: jest.spyOn(hub.terminalWss, 'handleUpgrade').mockImplementation(() => undefined),
    ws: jest.spyOn(hub.wss, 'handleUpgrade').mockImplementation(() => undefined),
  };
  const plugin = jest.spyOn(pluginWeb, 'handlePluginWsUpgrade').mockImplementation(() => true);
  return {
    hub,
    server,
    upgrade,
    plugin,
    wsClients,
    fire: (url: string, socket: FakeSocket = fakeSocket()) => {
      server.emit('upgrade', fakeReq(url), socket as never, Buffer.alloc(0));
      return socket;
    },
  };
}

function tableWith(over: Record<string, number> = {}): ConnectionTable {
  return new ConnectionTable({
    limits: () => ({
      httpConnections: 256,
      sseClients: 64,
      wsClients: 64,
      voiceClients: 16,
      terminalClients: 16,
      ...over,
    } as never),
  });
}

function httpBody(written: string): any {
  const idx = written.indexOf('\r\n\r\n');
  return JSON.parse(written.slice(idx + 4));
}

describe('admitUpgrade helper', () => {
  it('returns a lease when under the limit and null (ok:false) when refused', () => {
    const table = tableWith({ wsClients: 1 });
    const first = admitUpgrade('ws', () => table);
    expect(first.ok).toBe(true);
    expect(first.ok && first.lease).not.toBeNull();

    const second = admitUpgrade('ws', () => table);
    expect(second.ok).toBe(false);

    if (first.ok) first.lease!.release();
    expect(admitUpgrade('ws', () => table).ok).toBe(true);
  });

  it('passes through when no table is configured (existing behavior)', () => {
    expect(admitUpgrade('ws', undefined)).toEqual({ ok: true, lease: null });
    expect(admitUpgrade('sse', () => null)).toEqual({ ok: true, lease: null });
  });
});

describe('createWsHub: connection limits at upgrade time', () => {
  it('refuses /api/ws with a raw 503 JSON response and does not upgrade', () => {
    const table = tableWith({ wsClients: 1 });
    table.tryAcquire('ws');
    const { upgrade, fire } = setup(() => table);

    const socket = fire('/api/ws?deviceId=dev-1');

    expect(upgrade.ws).not.toHaveBeenCalled();
    expect(socket.written).toMatch(/^HTTP\/1\.1 503 Service Unavailable\r\n/);
    expect(socket.written).toContain('Content-Type: application/json');
    expect(httpBody(socket.written)).toEqual({ error: 'too many ws connections', code: 'connection_limit' });
    expect(socket.destroyed).toBe(true);
    expect(table.snapshot().refused.ws).toBe(1);
  });

  it('acquires on a normal /api/ws upgrade and releases once on close/error', () => {
    const table = tableWith({ wsClients: 4 });
    const { upgrade, fire } = setup(() => table);
    const ws = fakeWs();
    upgrade.ws.mockImplementation(((_req, _socket, _head, cb) => cb(ws as never)) as never);

    fire('/api/ws');

    expect(upgrade.ws).toHaveBeenCalledTimes(1);
    expect(table.snapshot().ws).toBe(1);

    ws.emit('error');
    ws.emit('close');
    ws.emit('close');
    expect(table.snapshot().ws).toBe(0);
  });

  it('applies the voice limit before the voice handshake', () => {
    const table = tableWith({ voiceClients: 1 });
    table.tryAcquire('voice');
    const { upgrade, fire } = setup(() => table);

    const socket = fire('/ws/voice');

    expect(upgrade.voice).not.toHaveBeenCalled();
    expect(httpBody(socket.written)).toEqual({ error: 'too many voice connections', code: 'connection_limit' });
    expect(socket.destroyed).toBe(true);
  });

  it('applies the terminal limit before the terminal handshake', () => {
    const table = tableWith({ terminalClients: 1 });
    table.tryAcquire('terminal');
    const { upgrade, fire } = setup(() => table);

    const socket = fire('/api/terminal/sessions/s1/connect?ticket=t1');

    expect(upgrade.terminal).not.toHaveBeenCalled();
    expect(httpBody(socket.written)).toEqual({ error: 'too many terminal connections', code: 'connection_limit' });
    expect(socket.destroyed).toBe(true);
  });

  it('counts plugin web upgrades as ws and releases on socket close', () => {
    const table = tableWith({ wsClients: 2 });
    const { plugin, fire } = setup(() => table);

    const socket = fire('/api/plugins/pkg/ws/ui/main');

    expect(plugin).toHaveBeenCalledTimes(1);
    expect(table.snapshot().ws).toBe(1);

    socket.emit('close');
    expect(table.snapshot().ws).toBe(0);
  });

  it('refuses plugin web upgrades when the ws limit is exhausted', () => {
    const table = tableWith({ wsClients: 1 });
    table.tryAcquire('ws');
    const { plugin, fire } = setup(() => table);

    const socket = fire('/api/plugins/pkg/ws/ui/main');

    expect(plugin).not.toHaveBeenCalled();
    expect(httpBody(socket.written)).toEqual({ error: 'too many ws connections', code: 'connection_limit' });
    expect(socket.destroyed).toBe(true);
  });

  it('leaves unrelated paths alone when no table is configured', () => {
    const { upgrade, fire } = setup(() => null);
    upgrade.ws.mockImplementation(((_req, _socket, _head, cb) => cb(fakeWs() as never)) as never);
    const socket = fire('/api/ws');
    expect(upgrade.ws).toHaveBeenCalledTimes(1);
    expect(socket.written).toBe('');
  });
});
