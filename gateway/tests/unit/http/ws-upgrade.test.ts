/**
 * D3 Task 3 review minor (a) — `createWsHub` contract (folded into Task 4).
 *
 * `startApiServer()` used to own a single `server.on('upgrade')` fan-out inline,
 * so nothing could assert it. The hub extracts that fan-out; these tests drive
 * the real `http.Server` 'upgrade' event with fake sockets and pin the parts a
 * refactor can silently break:
 *
 *   1. routing order voice → terminal → plugin → `/api/ws`, first match wins
 *      (exactly one target per upgrade, later arms untouched);
 *   2. the `/api/ws` auth gate still runs BEFORE the handshake (non-loopback
 *      without a token gets the 401 bytes and a destroyed socket);
 *   3. `?deviceId=` tracking reaches PushGateway + `wsClients` on connect;
 *   4. an unrecognized path is destroyed instead of leaked;
 *   5. `dispose()` clears both maintenance intervals (the kernel calls it from
 *      graceful shutdown; before D3 nobody cleared them).
 *
 * `handleUpgrade` is stubbed through the hub's own WebSocketServer instances so
 * no real handshake bytes are produced; the connection-side bookkeeping stays
 * real. Plugin upgrade handling is spied on the module export (ts-jest emits
 * CJS property lookups, so the spy is honoured at call time).
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { createWsHub, type WsHubDeps } from '../../../src/http/ws-upgrade';
import { TUNNEL_HEADER } from '../../../src/core/auth';
import * as pluginWeb from '../../../src/routes/plugin-web';

const TOKEN = 'sekret';
const LOOPBACK = '127.0.0.1';
const REMOTE = '203.0.113.9'; // non-loopback: token checks apply

interface FakeSocket {
  remoteAddress: string;
  written: string;
  destroyed: boolean;
  write(chunk: string): boolean;
  destroy(): void;
}

function fakeSocket(remoteAddress: string = LOOPBACK): FakeSocket {
  const socket: FakeSocket = {
    remoteAddress,
    written: '',
    destroyed: false,
    write(chunk: string) {
      socket.written += chunk;
      return true;
    },
    destroy() {
      socket.destroyed = true;
    },
  };
  return socket;
}

function fakeReq(
  url: string,
  opts: { remoteAddress?: string; headers?: Record<string, string> } = {},
): http.IncomingMessage {
  const addr = opts.remoteAddress ?? LOOPBACK;
  return {
    url,
    headers: opts.headers ?? { host: '127.0.0.1:3000' },
    socket: { remoteAddress: addr },
  } as unknown as http.IncomingMessage;
}

interface Spies {
  handleWsMessage: jest.Mock;
  getVoiceRuntime: jest.Mock;
  getTerminalService: jest.Mock;
  addOnlineWs: jest.Mock;
  removeOnlineWs: jest.Mock;
  cleanupStale: jest.Mock;
  syncLastSeenToDeviceStore: jest.Mock;
  pruneDeviceStore: jest.Mock;
  pluginWebDeps: jest.Mock;
}

/** Hubs created by `setup()`; afterEach disposes them so no interval outlives a test. */
const hubs: Array<ReturnType<typeof createWsHub>> = [];

function setup(over: Partial<WsHubDeps> = {}): {
  hub: ReturnType<typeof createWsHub>;
  server: http.Server;
  wsClients: Set<unknown>;
  spies: Spies;
  upgrade: Record<'voice' | 'terminal' | 'ws', jest.SpyInstance>;
  plugin: jest.SpyInstance;
  fire: (req: http.IncomingMessage, socket: FakeSocket) => void;
} {
  const spies: Spies = {
    handleWsMessage: jest.fn(),
    getVoiceRuntime: jest.fn(async () => ({ createSession: jest.fn() })),
    getTerminalService: jest.fn(() => ({ bridge: jest.fn(async () => undefined) })),
    addOnlineWs: jest.fn(),
    removeOnlineWs: jest.fn(),
    cleanupStale: jest.fn(),
    syncLastSeenToDeviceStore: jest.fn(),
    pruneDeviceStore: jest.fn(() => []),
    pluginWebDeps: jest.fn(() => ({}) as never),
  };
  const wsClients = new Set<unknown>();
  const deps: WsHubDeps = {
    wsClients: wsClients as never,
    apiToken: () => TOKEN,
    // The 60s PushGateway maintenance timer would otherwise call into a
    // half-stubbed gateway if it ever outlives the test (see afterEach).
    pushGateway: () => ({
      addOnlineWs: spies.addOnlineWs,
      removeOnlineWs: spies.removeOnlineWs,
      cleanupStale: spies.cleanupStale,
      syncLastSeenToDeviceStore: spies.syncLastSeenToDeviceStore,
      pruneDeviceStore: spies.pruneDeviceStore,
    }) as never,
    handleWsMessage: spies.handleWsMessage,
    getVoiceRuntime: spies.getVoiceRuntime,
    getTerminalService: spies.getTerminalService,
    pluginWebDeps: spies.pluginWebDeps,
    ...over,
  };
  const server = http.createServer();
  const hub = createWsHub(server, deps);
  hubs.push(hub);
  const upgrade = {
    voice: jest.spyOn(hub.voiceWss, 'handleUpgrade').mockImplementation(() => undefined),
    terminal: jest.spyOn(hub.terminalWss, 'handleUpgrade').mockImplementation(() => undefined),
    ws: jest.spyOn(hub.wss, 'handleUpgrade').mockImplementation(() => undefined),
  };
  const plugin = jest.spyOn(pluginWeb, 'handlePluginWsUpgrade').mockImplementation(() => undefined);
  return {
    hub,
    server,
    wsClients,
    spies,
    upgrade,
    plugin,
    fire: (req, socket) => {
      server.emit('upgrade', req, socket as never, Buffer.alloc(0));
    },
  };
}

afterEach(() => {
  // A live hub keeps its 30s heartbeat / 60s PushGateway intervals unref'ed but
  // armed; in a long `--runInBand` suite they fired after the test file finished
  // and crashed the worker (deps.pushGateway().cleanupStale is not a function).
  for (const hub of hubs.splice(0)) hub.dispose();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('createWsHub: upgrade routing (voice → terminal → plugin → /api/ws)', () => {
  it('routes every upgrade path to exactly one target, in the original order', () => {
    const { server, upgrade, plugin, fire } = setup();
    const cases: Array<[string, 'voice' | 'terminal' | 'plugin' | 'ws']> = [
      ['/ws/voice', 'voice'],
      ['/ws/voice?token=t', 'voice'],
      ['/api/terminal/sessions/s1/connect?ticket=t1', 'terminal'],
      ['/api/plugins/pkg/ws/ui/main', 'plugin'],
      ['/api/ws?deviceId=dev-1', 'ws'],
    ];
    // Marker order in the source: the fan-out is first-match-wins, so a later
    // arm moving in front of an earlier one would hijack its paths.
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'http', 'ws-upgrade.ts'),
      'utf-8',
    );
    const markers = [
      'isVoiceUpgradePath(url)',
      'matchTerminalConnectUrl(url)',
      'parsePluginWsUrl(url)',
      "url.startsWith('/api/ws')",
    ];
    const positions = markers.map((m) => src.indexOf(m));
    for (let i = 0; i < markers.length; i++) {
      expect({ marker: markers[i], found: positions[i] }).not.toEqual({ marker: markers[i], found: -1 });
      if (i > 0) expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }

    for (const [url, expected] of cases) {
      for (const spy of Object.values(upgrade)) spy.mockClear();
      plugin.mockClear();

      fire(fakeReq(url), fakeSocket());

      const hit = {
        voice: upgrade.voice.mock.calls.length,
        terminal: upgrade.terminal.mock.calls.length,
        plugin: plugin.mock.calls.length,
        ws: upgrade.ws.mock.calls.length,
      };
      expect({ url, ...hit }).toEqual({
        url,
        voice: expected === 'voice' ? 1 : 0,
        terminal: expected === 'terminal' ? 1 : 0,
        plugin: expected === 'plugin' ? 1 : 0,
        ws: expected === 'ws' ? 1 : 0,
      });
    }
    server.removeAllListeners();
  });

  it('destroys the socket for an unrecognized upgrade path', () => {
    const { server, upgrade, plugin, fire } = setup();
    const socket = fakeSocket();
    fire(fakeReq('/not-a-ws-endpoint'), socket);

    expect(socket.destroyed).toBe(true);
    expect(socket.written).toBe('');
    expect(upgrade.voice).not.toHaveBeenCalled();
    expect(upgrade.terminal).not.toHaveBeenCalled();
    expect(upgrade.ws).not.toHaveBeenCalled();
    expect(plugin).not.toHaveBeenCalled();
    server.removeAllListeners();
  });

  it('rejects a non-loopback /api/ws upgrade without a token before the handshake', () => {
    const { server, upgrade, fire } = setup();
    const socket = fakeSocket(REMOTE);
    fire(fakeReq('/api/ws', { remoteAddress: REMOTE }), socket);

    expect(upgrade.ws).not.toHaveBeenCalled();
    expect(socket.written).toMatch(/^HTTP\/1\.1 401 /);
    expect(socket.destroyed).toBe(true);
    server.removeAllListeners();
  });

  it('records ?deviceId= on the socket and joins wsClients on connect', () => {
    const { server, upgrade, spies, wsClients, fire } = setup();
    const ws = {
      deviceId: undefined as string | undefined,
      send: jest.fn(),
      on: jest.fn(),
      ping: jest.fn(),
      terminate: jest.fn(),
      close: jest.fn(),
    };
    upgrade.ws.mockImplementation(((_req, _socket, _head, cb) => cb(ws as never)) as never);

    fire(fakeReq('/api/ws?deviceId=dev-1'), fakeSocket());

    expect(upgrade.ws).toHaveBeenCalledTimes(1);
    expect(spies.addOnlineWs).toHaveBeenCalledWith('dev-1', ws);
    expect((ws as { deviceId?: string }).deviceId).toBe('dev-1');
    expect(wsClients.has(ws)).toBe(true);
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('"type":"connected"'));
    server.removeAllListeners();
  });

  it('dispose() clears both maintenance intervals', () => {
    jest.useFakeTimers();
    const clear = jest.spyOn(global, 'clearInterval');
    const { hub, server } = setup();

    hub.dispose();

    expect(clear).toHaveBeenCalledTimes(2);
    server.removeAllListeners();
  });
});

describe('createWsHub: relay gates (M0)', () => {
  const SECRET = 'a'.repeat(64);

  it('allows /api/ws for a relay principal', () => {
    const { upgrade, fire } = setup({ tunnelSecret: SECRET });
    const socket = fakeSocket();
    const req = fakeReq('/api/ws', { headers: { [TUNNEL_HEADER]: SECRET } });

    fire(req, socket);

    expect(socket.destroyed).toBe(false);
    expect((req as any).mafwPrincipal).toEqual({ kind: 'relay', method: 'tunnel' });
    expect(upgrade.ws).toHaveBeenCalledTimes(1);
  });

  it('denies terminal, voice and plugin WS for a relay principal', () => {
    for (const url of [
      '/api/terminal/sessions/s1/connect?ticket=t1',
      '/ws/voice',
      '/api/plugins/pkg/ws/ui/main',
    ]) {
      const { upgrade, plugin, fire } = setup({ tunnelSecret: SECRET });
      const socket = fakeSocket();

      fire(fakeReq(url, { headers: { [TUNNEL_HEADER]: SECRET } }), socket);

      expect(`${url}:${socket.destroyed}`).toBe(`${url}:true`);
      expect(upgrade.voice).not.toHaveBeenCalled();
      expect(upgrade.terminal).not.toHaveBeenCalled();
      expect(plugin).not.toHaveBeenCalled();
    }
  });
});
