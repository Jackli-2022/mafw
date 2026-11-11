/**
 * D3 Task 3 — HTTP transport module behaviour + ordering (spec §4, Review Focus 1/2).
 *
 * The listener used to be a 626-line inline callback in `startApiServer()`, which
 * made its ordering untestable. Now `createRequestListener(deps)` can be driven
 * with fake request/response objects, so the two load-bearing contracts get real
 * assertions instead of source greps:
 *
 *   1. OPTIONS(204) → auth(401) → registry dispatch (P0-1): a preflight never
 *      needs a token, an unauthorized request never reaches the registry, and a
 *      registry hit short-circuits the rest of the chain.
 *   2. the dashboard joint catch-all (`/api/goals|stats|memory`) runs BEFORE
 *      `/control` in this chain. Since E1-4 the registry claims
 *      `POST /api/goals/control` (`goals.control`) before this chain, so the
 *      dashboard joint is now a backstop for *missed* dispatch only.
 *
 * Plus the transport-level matchers that D3-R2 rewrote (no `req.url?.match`):
 * `/a2a`, `/mcp`, the SPA, and the `/a2a/artifacts/<id>` prefix+slot.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { createRequestListener, matchArtifactId, type TransportDeps } from '../../../src/http/transport';

const TOKEN = 'sekret';

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
    method: opts.method ?? 'GET',
    url: opts.url ?? '/',
    headers: opts.headers ?? {},
    socket: { remoteAddress: opts.remoteAddress ?? '127.0.0.1' },
    on() { return this; },
    pipe() { return this; },
  } as unknown as IncomingMessage;
}

interface Spies {
  dispatchAuthorized: jest.Mock;
  pluginWebWildcard: jest.Mock;
  fileHistory: jest.Mock;
  dashboardDispatch: jest.Mock;
  controlPatchState: jest.Mock;
  proxyTarget: jest.Mock;
}

function makeDeps(over: Partial<TransportDeps> = {}): { deps: TransportDeps; spies: Spies } {
  const spies: Spies = {
    dispatchAuthorized: jest.fn(async () => false),
    pluginWebWildcard: jest.fn(async () => false),
    fileHistory: jest.fn(async () => false),
    dashboardDispatch: jest.fn(async () => ({ status: 200, body: { dashboard: true } })),
    controlPatchState: jest.fn(async () => undefined),
    proxyTarget: jest.fn(() => 'http://127.0.0.1:9'),
  };
  const deps: TransportDeps = {
    cors: () => ({ origin: '*', methods: 'GET,POST', headers: 'content-type' }),
    apiToken: () => TOKEN,
    dispatchAuthorized: spies.dispatchAuthorized,
    pluginWebWildcard: spies.pluginWebWildcard,
    fileHistory: spies.fileHistory,
    mediaAgent: () => undefined,
    mcpEndpoint: () => undefined,
    mcpStreamable: () => undefined,
    spaRoot: () => '/nonexistent-dashboard-root',
    dashboardDispatch: spies.dashboardDispatch,
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
      patchState: spies.controlPatchState,
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
    proxyTarget: spies.proxyTarget,
    ...over,
  };
  return { deps, spies };
}

const REMOTE = '203.0.113.9'; // non-loopback: token checks apply

describe('createRequestListener: OPTIONS → auth → registry order', () => {
  it('answers CORS preflight with 204 before any auth work', async () => {
    const { deps, spies } = makeDeps();
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();
    // Non-loopback + no token: still a preflight, not a 401.
    await listener(fakeReq({ method: 'OPTIONS', url: '/api/anything', remoteAddress: REMOTE }), res);
    expect(rec.status).toBe(204);
    expect(rec.ended).toBe(true);
    expect(spies.dispatchAuthorized).not.toHaveBeenCalled();
    expect(spies.pluginWebWildcard).not.toHaveBeenCalled();
    expect(spies.dashboardDispatch).not.toHaveBeenCalled();
  });

  it('rejects a non-loopback request without a token before the registry', async () => {
    const { deps, spies } = makeDeps();
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();
    await listener(fakeReq({ method: 'GET', url: '/api/goals', remoteAddress: REMOTE }), res);
    expect(rec.status).toBe(401);
    expect(JSON.parse(rec.body)).toEqual({ error: 'unauthorized', code: 'unauthorized' });
    expect(spies.dispatchAuthorized).not.toHaveBeenCalled();
    expect(spies.dashboardDispatch).not.toHaveBeenCalled();
  });

  it('lets a registry hit short-circuit the legacy chain', async () => {
    const { deps, spies } = makeDeps();
    spies.dispatchAuthorized.mockResolvedValue(true);
    const listener = createRequestListener(deps);
    const { res } = fakeRes();
    await listener(
      fakeReq({ method: 'GET', url: '/api/goals', remoteAddress: REMOTE, headers: { authorization: `Bearer ${TOKEN}` } }),
      res,
    );
    expect(spies.dispatchAuthorized).toHaveBeenCalledTimes(1);
    // token threaded into the dep (same value the auth gate saw)
    expect(spies.dispatchAuthorized.mock.calls[0][2]).toBe(TOKEN);
    expect(spies.pluginWebWildcard).not.toHaveBeenCalled();
    expect(spies.dashboardDispatch).not.toHaveBeenCalled();
  });

  it('runs plugin-web wildcard and file-history after a missed registry dispatch', async () => {
    const { deps, spies } = makeDeps();
    spies.pluginWebWildcard.mockResolvedValue(true);
    const listener = createRequestListener(deps);
    await listener(fakeReq({ method: 'POST', url: '/api/plugins/demo/ui/x.js' }), fakeRes().res);
    expect(spies.dispatchAuthorized).toHaveBeenCalledTimes(1);
    expect(spies.pluginWebWildcard).toHaveBeenCalledTimes(1);
    expect(spies.fileHistory).not.toHaveBeenCalled();
  });
});

describe('createRequestListener: dashboard joint stays behind registry dispatch (R6 superseded by E1-4)', () => {
  it('a MISSED registry dispatch still falls back to the dashboard catch-all', async () => {
    const { deps, spies } = makeDeps();
    // E1-4: `POST /api/goals/control` is now owned by the registry
    // (`goals.control` handler) and never reaches this chain in production —
    // see tests/unit/routes/goals-dispatch-fixes.test.ts for the reachability
    // pin. This test keeps the transport-level backstop honest: if dispatch
    // misses (no handler / unmatched), the dashboard joint still answers.
    spies.dispatchAuthorized.mockResolvedValue(false);
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();
    await listener(fakeReq({ method: 'POST', url: '/api/goals/control' }), res);
    expect(spies.dashboardDispatch).toHaveBeenCalledTimes(1);
    expect(spies.controlPatchState).not.toHaveBeenCalled();
    expect(rec.status).toBe(200);
    expect(JSON.parse(rec.body)).toEqual({ dashboard: true });
  });

  it('POST /control (not /api/*) reaches the control handler', async () => {
    const { deps, spies } = makeDeps();
    const listener = createRequestListener(deps);
    const { res } = fakeRes();
    // The control body reads the request stream; `req.on('data'|'end')` is a
    // no-op fake here, so the branch returns without answering — what matters is
    // that the dashboard joint did NOT claim it.
    await listener(fakeReq({ method: 'POST', url: '/control' }), res);
    expect(spies.dashboardDispatch).not.toHaveBeenCalled();
  });
});

describe('createRequestListener: transport matchers (D3-R2 rewrites)', () => {
  const ok = { method: 'GET', url: '/' };

  it('serves /.well-known/agent-card.json as 503 when no MediaAgent is wired', async () => {
    const { deps } = makeDeps();
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();
    await listener(fakeReq({ ...ok, url: '/.well-known/agent-card.json' }), res);
    expect(rec.status).toBe(503);
    expect(JSON.parse(rec.body)).toEqual({ error: 'MediaAgent not initialized' });
  });

  it('matches /a2a/artifacts/<id> but not a deeper path', async () => {
    const { deps, spies } = makeDeps();
    const listener = createRequestListener(deps);
    const deeper = fakeRes();
    await listener(fakeReq({ ...ok, url: '/a2a/artifacts/abc/def' }), deeper.res);
    // Not an artifact slot → falls through to the reverse proxy (which fails
    // asynchronously against a dead port; the fall-through itself is the contract).
    expect(spies.proxyTarget).toHaveBeenCalled();
    expect(spies.dashboardDispatch).not.toHaveBeenCalled();
  });

  it('the MCP GET contract keeps 405 for standalone-stream asks', async () => {
    const { deps } = makeDeps();
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();
    await listener(fakeReq({ ...ok, url: '/mcp', headers: { 'mcp-protocol-version': '2025-03-26' } }), res);
    expect(rec.status).toBe(405);
    expect(rec.headers.allow).toBe('POST');
  });

  it('the dead plain /health arm answers non-GET methods', async () => {
    const { deps } = makeDeps();
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();
    await listener(fakeReq({ method: 'POST', url: '/health' }), res);
    expect(rec.status).toBe(200);
    expect(JSON.parse(rec.body)).toEqual({ status: 'ok' });
  });

  it('the rich /health arm reports live deps fields', async () => {
    const { deps } = makeDeps({
      health: {
        serveRunning: () => true,
        registeredProjectDirs: () => ['/p'],
        activeGoalIds: () => ['g1'],
        mediaConfigured: () => true,
        releaseFields: () => ({ gatewayVersion: '1.2.3' }),
      },
    });
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();
    await listener(fakeReq({ method: 'GET', url: '/health' }), res);
    expect(rec.status).toBe(200);
    expect(JSON.parse(rec.body)).toEqual({
      status: 'ok',
      serveRunning: true,
      registeredProjects: ['/p'],
      activeGoals: ['g1'],
      media: { configured: true },
      gatewayVersion: '1.2.3',
    });
  });
});

describe('matchArtifactId (old ^/a2a/artifacts/([^/]+)$ semantics)', () => {
  it.each([
    ['/a2a/artifacts/abc', 'abc'],
    ['/a2a/artifacts/abc?x=1', 'abc?x=1'], // the old regex accepted '?' inside the slot
    ['/a2a/artifacts/', null],
    ['/a2a/artifacts/a/b', null],
    ['/a2a/artifact/abc', null],
    ['/a2a/artifacts', null],
    ['/api/a2a/artifacts/abc', null],
  ])('%s → %s', (url, expected) => {
    expect(matchArtifactId(url as string)).toBe(expected as string | null);
  });
});
