/**
 * E5a-1 — principal auth through the real transport + WS upgrade + registry gate.
 *
 * These tests drive `createRequestListener` / `createWsHub` with fake
 * request/response/socket objects so the *wiring* is pinned, not just the pure
 * `resolvePrincipal` helper: `req.mafwPrincipal` must be attached after auth,
 * anonymous requests must still get the byte-identical 401, and a device
 * principal must beat the query-string `deviceId` for push presence.
 */
import * as http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import { resolvePrincipal } from '../../../src/core/auth';
import { createRequestListener, type TransportDeps } from '../../../src/http/transport';
import { createWsHub, type WsHubDeps } from '../../../src/http/ws-upgrade';
import { dispatchAuthorized } from '../../../src/routes/registry-dispatch';
import { RouteRegistry } from '../../../src/routes/registry';

const HUMAN = 'h'.repeat(64);
const SERVICE = 'shared-service-token';
const LOOPBACK = '127.0.0.1';
const REMOTE = '203.0.113.9';

interface Recorded {
  status?: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
}

function fakeRes(): { res: ServerResponse; rec: Recorded } {
  const rec: Recorded = { headers: {}, body: '', ended: false };
  const res = {
    headersSent: false,
    setHeader(name: string, value: string) {
      rec.headers[name.toLowerCase()] = String(value);
      return this;
    },
    writeHead(status: number, headers?: Record<string, string>) {
      rec.status = status;
      this.headersSent = true;
      if (headers) for (const [k, v] of Object.entries(headers)) rec.headers[k.toLowerCase()] = String(v);
      return this;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) rec.body += String(chunk);
      rec.ended = true;
      this.headersSent = true;
      return this;
    },
    write(chunk: unknown) {
      rec.body += String(chunk);
      return true;
    },
  } as unknown as ServerResponse;
  return { res, rec };
}

function fakeReq(opts: {
  method?: string;
  url?: string;
  remoteAddress?: string;
  headers?: Record<string, string>;
}): IncomingMessage {
  return {
    method: opts.method ?? 'POST',
    url: opts.url ?? '/api/pods/p1/goals/g1/accept',
    headers: opts.headers ?? {},
    socket: { remoteAddress: opts.remoteAddress ?? REMOTE },
    on() { return this; },
    pipe() { return this; },
  } as unknown as IncomingMessage;
}

function makeTransportDeps(over: Partial<TransportDeps> = {}): {
  deps: TransportDeps;
  dispatchAuthorized: jest.Mock;
} {
  const dispatch = jest.fn(async () => true);
  const deps: TransportDeps = {
    cors: () => ({ origin: '*', methods: 'GET,POST', headers: 'content-type' }),
    apiToken: () => SERVICE,
    humanToken: () => HUMAN,
    verifyDeviceToken: (token: string) => (token === 'dev_good' ? { deviceId: 'dev-1' } : null),
    dispatchAuthorized: dispatch,
    pluginWebWildcard: jest.fn(async () => false),
    fileHistory: jest.fn(async () => false),
    mediaAgent: () => undefined,
    mcpEndpoint: () => undefined,
    mcpStreamable: () => undefined,
    spaRoot: () => '/nonexistent-dashboard-root',
    dashboardDispatch: async () => ({ status: 200, body: {} }),
    register: {
      parseIntent: () => null,
      isUserDataDir: () => false,
      isSelectableProject: () => true,
      registeredProject: () => undefined,
      registerProject: () => undefined,
      setCurrentProject: () => undefined,
      persistRegistry: async () => undefined,
      broadcastProjectRegistered: () => undefined,
      hasRuntime: () => false,
      ensureManagerSession: async () => 'sid',
    },
    control: {
      patchState: async () => undefined,
      destroyAllSessions: async () => undefined,
      getActiveGoal: () => undefined,
      registeredProjects: () => new Map<string, { mafwDir: string }>().entries(),
      getGatewayDb: () => ({} as never),
      archiveGoal: async () => undefined,
    },
    health: {
      serveRunning: () => false,
      registeredProjectDirs: () => [],
      activeGoalIds: () => [],
      mediaConfigured: () => false,
      releaseFields: () => ({}),
    },
    proxyTarget: () => 'http://127.0.0.1:9',
    proxyHeaders: () => ({}),
    ...over,
  };
  return { deps, dispatchAuthorized: dispatch };
}

async function request(
  deps: TransportDeps,
  req: IncomingMessage,
): Promise<{ rec: Recorded; res: ServerResponse }> {
  const { res, rec } = fakeRes();
  await createRequestListener(deps)(req, res);
  return { rec, res };
}

describe('transport principal auth', () => {
  it('passes a remote human-token request and attaches principal=human', async () => {
    const { deps, dispatchAuthorized: dispatch } = makeTransportDeps();
    const req = fakeReq({ headers: { 'x-mafw-human-token': HUMAN } });

    const { rec } = await request(deps, req);

    expect(rec.status).toBeUndefined(); // dispatched, not 401
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((req as any).mafwPrincipal).toEqual({ kind: 'human', method: 'human-token' });
  });

  it('passes a remote service-token request with principal=service', async () => {
    const { deps, dispatchAuthorized: dispatch } = makeTransportDeps();
    const req = fakeReq({ headers: { authorization: `Bearer ${SERVICE}` } });

    await request(deps, req);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((req as any).mafwPrincipal).toEqual({ kind: 'service', method: 'api-token' });
  });

  it('keeps loopback credential-less requests working with principal=local', async () => {
    const { deps, dispatchAuthorized: dispatch } = makeTransportDeps();
    const req = fakeReq({ remoteAddress: LOOPBACK });

    await request(deps, req);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((req as any).mafwPrincipal).toEqual({ kind: 'local', method: 'loopback' });
  });

  it('still returns the unchanged 401 for a remote anonymous request', async () => {
    const { deps, dispatchAuthorized: dispatch } = makeTransportDeps();

    const { rec } = await request(deps, fakeReq({}));

    expect(rec.status).toBe(401);
    expect(JSON.parse(rec.body)).toEqual({ error: 'unauthorized', code: 'unauthorized' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('passes a valid device token as human/device-token with deviceId', async () => {
    const { deps, dispatchAuthorized: dispatch } = makeTransportDeps();
    const req = fakeReq({ headers: { 'x-mafw-device-token': 'dev_good' } });

    await request(deps, req);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((req as any).mafwPrincipal).toEqual({
      kind: 'human',
      method: 'device-token',
      deviceId: 'dev-1',
    });
  });

  it('lets a stale device credential fall through to a valid shared apiToken (F4)', async () => {
    const { deps, dispatchAuthorized: dispatch } = makeTransportDeps();
    const req = fakeReq({ headers: {
      authorization: 'Bearer dev_revoked',
      'x-api-token': SERVICE,
    } });

    await request(deps, req);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((req as any).mafwPrincipal).toEqual({ kind: 'service', method: 'api-token' });
  });
});

describe('registry dispatch principal gate', () => {
  function registryWith(handler: jest.Mock): RouteRegistry {
    const registry = new RouteRegistry();
    registry.register({
      method: 'POST',
      path: '/api/pods/:podId/goals',
      operationId: 'test.podGoalsPrincipal',
      handler: handler as any,
    });
    return registry;
  }

  function fakeDispatchRes(): { res: ServerResponse; out: { status?: number } } {
    const out: { status?: number } = {};
    const res = {
      writeHead: (status: number) => { out.status = status; return res; },
      end: () => undefined,
    } as any;
    return { res, out };
  }

  it('accepts a human principal attached by the transport even without a token header', async () => {
    const handler = jest.fn(async () => true);
    const registry = registryWith(handler);
    const req = fakeReq({ remoteAddress: REMOTE, url: '/api/pods/p1/goals' }) as any;
    req.mafwPrincipal = { kind: 'human', method: 'human-token' };
    const { res } = fakeDispatchRes();

    const handled = await dispatchAuthorized({ registry, apiToken: SERVICE }, req, res);

    expect(handled).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('accepts a device principal attached by the transport', async () => {
    const handler = jest.fn(async () => true);
    const registry = registryWith(handler);
    const req = fakeReq({ remoteAddress: REMOTE, url: '/api/pods/p1/goals' }) as any;
    req.mafwPrincipal = { kind: 'human', method: 'device-token', deviceId: 'dev-1' };
    const { res } = fakeDispatchRes();

    await dispatchAuthorized({ registry, apiToken: SERVICE }, req, res);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps rejecting an anonymous principal from remote', async () => {
    const handler = jest.fn(async () => true);
    const registry = registryWith(handler);
    const req = fakeReq({ remoteAddress: REMOTE, url: '/api/pods/p1/goals' }) as any;
    req.mafwPrincipal = { kind: 'anonymous', method: 'none' };
    const { res, out } = fakeDispatchRes();

    const handled = await dispatchAuthorized({ registry, apiToken: SERVICE }, req, res);

    expect(handled).toBe(true);
    expect(out.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  // F3: fail-closed for malformed / unknown principals (allowlist, not
  // "anything that isn't anonymous"). authorizeRequest is still consulted.
  const badPrincipals: Array<[string, unknown]> = [
    ['empty object', {}],
    ['undefined kind', { kind: undefined }],
    ['unknown kind', { kind: 'agent' }],
    ['non-string kind', { kind: 42 }],
  ];

  it.each(badPrincipals)('rejects a %s principal from remote as fail-closed', async (_label, principal) => {
    const handler = jest.fn(async () => true);
    const registry = registryWith(handler);
    const req = fakeReq({ remoteAddress: REMOTE, url: '/api/pods/p1/goals' }) as any;
    req.mafwPrincipal = principal;
    const { res, out } = fakeDispatchRes();

    const handled = await dispatchAuthorized({ registry, apiToken: SERVICE }, req, res);

    expect(handled).toBe(true);
    expect(out.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// WS upgrade principal auth
// ---------------------------------------------------------------------------

interface FakeSocket {
  remoteAddress: string;
  written: string;
  destroyed: boolean;
  write(chunk: string): boolean;
  destroy(): void;
}

function fakeSocket(remoteAddress: string): FakeSocket {
  const socket: FakeSocket = {
    remoteAddress,
    written: '',
    destroyed: false,
    write(chunk: string) { socket.written += chunk; return true; },
    destroy() { socket.destroyed = true; },
  };
  return socket;
}

const hubs: Array<ReturnType<typeof createWsHub>> = [];

function setupWs(): {
  server: http.Server;
  wsUpgrade: jest.SpyInstance;
  voiceUpgrade: jest.SpyInstance;
  addOnlineWs: jest.Mock;
  fire: (req: http.IncomingMessage, socket: FakeSocket) => void;
} {
  const addOnlineWs = jest.fn();
  const deps: WsHubDeps = {
    wsClients: new Set() as never,
    apiToken: () => SERVICE,
    humanToken: () => HUMAN,
    verifyDeviceToken: (token: string) => (token === 'dev_good' ? { deviceId: 'dev-1' } : null),
    pushGateway: () => ({
      addOnlineWs,
      removeOnlineWs: jest.fn(),
      cleanupStale: jest.fn(),
      syncLastSeenToDeviceStore: jest.fn(),
      pruneDeviceStore: jest.fn(() => []),
    }) as never,
    handleWsMessage: jest.fn(),
    getVoiceRuntime: jest.fn(async () => ({ createSession: jest.fn() })),
    getTerminalService: jest.fn(() => ({ bridge: jest.fn(async () => undefined) })),
    pluginWebDeps: jest.fn(() => ({}) as never),
  };
  const server = http.createServer();
  const hub = createWsHub(server, deps);
  hubs.push(hub);
  const wsUpgrade = jest.spyOn(hub.wss, 'handleUpgrade').mockImplementation(() => undefined);
  const voiceUpgrade = jest.spyOn(hub.voiceWss, 'handleUpgrade').mockImplementation(() => undefined);
  return {
    server,
    wsUpgrade,
    voiceUpgrade,
    addOnlineWs,
    fire: (req, socket) => server.emit('upgrade', req, socket as never, Buffer.alloc(0)),
  };
}

afterEach(() => {
  for (const hub of hubs.splice(0)) hub.dispose();
  jest.restoreAllMocks();
});

function wsReq(url: string, opts: { remoteAddress: string; headers?: Record<string, string> }): IncomingMessage {
  return {
    url,
    headers: { host: '127.0.0.1:3000', ...(opts.headers ?? {}) },
    socket: { remoteAddress: opts.remoteAddress },
  } as unknown as IncomingMessage;
}

describe('WS upgrade principal auth', () => {
  it('admits a remote human-token upgrade and exposes principal on the connection', () => {
    const { server, wsUpgrade, fire } = setupWs();
    const ws = { send: jest.fn(), on: jest.fn(), ping: jest.fn(), terminate: jest.fn(), close: jest.fn() };
    wsUpgrade.mockImplementation(((_req, _socket, _head, cb) => cb(ws as never)) as never);

    fire(wsReq('/api/ws', { remoteAddress: REMOTE, headers: { 'x-mafw-human-token': HUMAN } }), fakeSocket(REMOTE));

    expect(wsUpgrade).toHaveBeenCalledTimes(1);
    expect((ws as any).principal).toEqual({ kind: 'human', method: 'human-token' });
    server.removeAllListeners();
  });

  it('admits a device-token upgrade and prefers principal.deviceId over ?deviceId=', () => {
    const { server, wsUpgrade, addOnlineWs, fire } = setupWs();
    const ws = { send: jest.fn(), on: jest.fn(), ping: jest.fn(), terminate: jest.fn(), close: jest.fn() };
    wsUpgrade.mockImplementation(((_req, _socket, _head, cb) => cb(ws as never)) as never);

    fire(
      wsReq('/api/ws?deviceId=legacy-id', { remoteAddress: REMOTE, headers: { 'x-mafw-device-token': 'dev_good' } }),
      fakeSocket(REMOTE),
    );

    expect(wsUpgrade).toHaveBeenCalledTimes(1);
    expect(addOnlineWs).toHaveBeenCalledWith('dev-1', ws);
    expect((ws as any).deviceId).toBe('dev-1');
    expect((ws as any).principal).toEqual({ kind: 'human', method: 'device-token', deviceId: 'dev-1' });
    server.removeAllListeners();
  });

  it('keeps loopback credential-less upgrades as local', () => {
    const { server, wsUpgrade, fire } = setupWs();
    const ws = { send: jest.fn(), on: jest.fn(), ping: jest.fn(), terminate: jest.fn(), close: jest.fn() };
    wsUpgrade.mockImplementation(((_req, _socket, _head, cb) => cb(ws as never)) as never);

    fire(wsReq('/api/ws', { remoteAddress: LOOPBACK }), fakeSocket(LOOPBACK));

    expect(wsUpgrade).toHaveBeenCalledTimes(1);
    expect((ws as any).principal).toEqual({ kind: 'local', method: 'loopback' });
    server.removeAllListeners();
  });

  it('rejects a remote anonymous upgrade with the unchanged 401 bytes', () => {
    const { server, wsUpgrade, fire } = setupWs();
    const socket = fakeSocket(REMOTE);

    fire(wsReq('/api/ws', { remoteAddress: REMOTE }), socket);

    expect(wsUpgrade).not.toHaveBeenCalled();
    expect(socket.written).toBe('HTTP/1.1 401 Unauthorized\r\n\r\n');
    expect(socket.destroyed).toBe(true);
    server.removeAllListeners();
  });

  it('lets a stale device token fall through to a valid ?token= apiToken on WS upgrade (F4)', () => {
    const { server, wsUpgrade, fire } = setupWs();

    fire(
      wsReq(`/api/ws?token=${SERVICE}`, { remoteAddress: REMOTE, headers: { 'x-mafw-device-token': 'dev_revoked' } }),
      fakeSocket(REMOTE),
    );

    expect(wsUpgrade).toHaveBeenCalledTimes(1);
    server.removeAllListeners();
  });
});

describe('WS voice upgrade principal auth (F4)', () => {
  it('rejects a remote voice upgrade without credentials using the raw 401 bytes', () => {
    const { server, voiceUpgrade, fire } = setupWs();
    const socket = fakeSocket(REMOTE);

    fire(wsReq('/ws/voice', { remoteAddress: REMOTE }), socket);

    expect(voiceUpgrade).not.toHaveBeenCalled();
    expect(socket.written).toBe('HTTP/1.1 401 Unauthorized\r\n\r\n');
    expect(socket.destroyed).toBe(true);
    server.removeAllListeners();
  });

  it('admits a remote voice upgrade carrying the shared service apiToken', () => {
    const { server, voiceUpgrade, fire } = setupWs();

    fire(
      wsReq('/ws/voice', { remoteAddress: REMOTE, headers: { authorization: `Bearer ${SERVICE}` } }),
      fakeSocket(REMOTE),
    );

    expect(voiceUpgrade).toHaveBeenCalledTimes(1);
    server.removeAllListeners();
  });

  it('admits a remote voice upgrade carrying a human token', () => {
    const { server, voiceUpgrade, fire } = setupWs();

    fire(
      wsReq('/ws/voice', { remoteAddress: REMOTE, headers: { 'x-mafw-human-token': HUMAN } }),
      fakeSocket(REMOTE),
    );

    expect(voiceUpgrade).toHaveBeenCalledTimes(1);
    server.removeAllListeners();
  });
});

describe('reverse proxy credential hygiene (F6)', () => {
  it('strips human/device credential headers before forwarding', async () => {
    let resolveHeaders!: (headers: http.IncomingHttpHeaders) => void;
    const capturedHeaders = new Promise<http.IncomingHttpHeaders>((resolve) => { resolveHeaders = resolve; });
    const target = http.createServer((proxyReq, proxyRes) => {
      resolveHeaders(proxyReq.headers);
      proxyRes.writeHead(200, { 'content-type': 'application/json' });
      proxyRes.end('{"ok":true}');
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', () => resolve()));

    try {
      const port = (target.address() as { port: number }).port;
      const { deps } = makeTransportDeps({
        dispatchAuthorized: async () => false,
        proxyTarget: () => `http://127.0.0.1:${port}`,
      });
      const req = fakeReq({
        method: 'GET',
        url: '/api/not-a-registry-route',
        remoteAddress: LOOPBACK,
        headers: {
          host: '127.0.0.1:3000',
          'x-mafw-human-token': HUMAN,
          'X-MAFW-Device-Token': 'dev_good',
          authorization: `Bearer ${SERVICE}`,
          'x-request-id': 'keep-me',
        },
      });
      const { res } = fakeRes();
      // The proxy branch pipes the upstream response into `res`; give the fake
      // response the minimal EventEmitter surface `stream.pipe` touches.
      Object.assign(res as any, {
        on: jest.fn(),
        once: jest.fn(),
        emit: jest.fn(),
        removeListener: jest.fn(),
        writable: true,
      });

      await createRequestListener(deps)(req, res);

      const headers = await capturedHeaders;
      expect(headers['x-mafw-human-token']).toBeUndefined();
      expect(headers['x-mafw-device-token']).toBeUndefined();
      // Existing serve-auth behavior (strip inbound Authorization) is unchanged.
      expect(headers.authorization).toBeUndefined();
      expect(headers['x-request-id']).toBe('keep-me');
    } finally {
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });
});

describe('resolvePrincipal (transport wiring sanity)', () => {
  it('is the same helper the transport uses', () => {
    const principal = resolvePrincipal(
      { remoteAddress: REMOTE, headers: { 'x-mafw-human-token': HUMAN }, url: '/', host: 'localhost' },
      { apiToken: SERVICE, humanToken: HUMAN },
    );
    expect(principal).toEqual({ kind: 'human', method: 'human-token' });
  });
});
