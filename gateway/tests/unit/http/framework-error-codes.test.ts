/**
 * E3-3：框架边界错误带机器码（additive）。
 *
 * 只覆盖框架层：transport 的 401/403/500、registry-dispatch 的 401、
 * kernel capGuard 的 503。既有 `error` 字符串逐字保持不变，只新增 `code`。
 * 路由内业务错误不在本测试范围（错误信封按层，见 spec §E3-3）。
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { createRequestListener, type TransportDeps } from '../../../src/http/transport';
import { dispatchAuthorized } from '../../../src/routes/registry-dispatch';
import { RouteRegistry } from '../../../src/routes/registry';
import { MafwScheduler } from '../../../src/index';

const TOKEN = 'sekret';

interface Rec {
  status?: number;
  headers: Record<string, string>;
  body: string;
}

function fakeRes(): { res: ServerResponse; rec: Rec } {
  const rec: Rec = { headers: {}, body: '' };
  const res = {
    headersSent: false,
    setHeader(name: string, value: string) { rec.headers[name.toLowerCase()] = String(value); return res; },
    writeHead(status: number, headers?: Record<string, string>) {
      rec.status = status;
      res.headersSent = true;
      if (headers) for (const [k, v] of Object.entries(headers)) rec.headers[k.toLowerCase()] = String(v);
      return res;
    },
    end(chunk?: unknown) { if (chunk !== undefined) rec.body += String(chunk); res.headersSent = true; return res; },
    write(chunk: unknown) { rec.body += String(chunk); return true; },
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

function makeDeps(over: Partial<TransportDeps> = {}): { deps: TransportDeps; dispatch: jest.Mock } {
  const dispatch = jest.fn(async () => false);
  const deps: TransportDeps = {
    cors: () => ({ origin: '*', methods: 'GET,POST', headers: 'content-type' }),
    apiToken: () => TOKEN,
    dispatchAuthorized: dispatch,
    pluginWebWildcard: async () => false,
    fileHistory: async () => false,
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
  return { deps, dispatch };
}

const REMOTE = '203.0.113.9';

describe('E3-3: framework error codes', () => {
  it('transport auth 401 keeps the error string and adds code=unauthorized', async () => {
    const { deps } = makeDeps();
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();

    await listener(fakeReq({ method: 'GET', url: '/api/goals', remoteAddress: REMOTE }), res);

    expect(rec.status).toBe(401);
    expect(JSON.parse(rec.body)).toEqual({ error: 'unauthorized', code: 'unauthorized' });
  });

  it('transport loopback 403 adds code=forbidden (error string unchanged)', async () => {
    const { deps } = makeDeps();
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();

    // Auth passes (token), then the A2A artifact branch rejects non-loopback.
    await listener(
      fakeReq({
        method: 'GET',
        url: '/a2a/artifacts/abc',
        remoteAddress: REMOTE,
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
      res,
    );

    expect(rec.status).toBe(403);
    expect(JSON.parse(rec.body)).toEqual({ error: 'forbidden', code: 'forbidden' });
  });

  it('transport outer 500 adds code=internal and preserves the message', async () => {
    const { deps } = makeDeps({
      dispatchAuthorized: async () => { throw new Error('boom'); },
    });
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();

    await listener(fakeReq({ method: 'GET', url: '/api/goals' }), res);

    expect(rec.status).toBe(500);
    expect(JSON.parse(rec.body)).toEqual({ error: 'boom', code: 'internal' });
  });

  it('registry dispatch 401 adds code=unauthorized and still blocks the handler', async () => {
    const handler = jest.fn(async () => true);
    const registry = new RouteRegistry();
    registry.register({
      method: 'POST',
      path: '/api/pods/:podId/goals',
      operationId: 'test.podGoals',
      handler: handler as any,
    });
    const { res, rec } = fakeRes();

    const handled = await dispatchAuthorized(
      { registry, apiToken: TOKEN },
      fakeReq({
        method: 'POST',
        url: '/api/pods/p1/goals',
        remoteAddress: REMOTE,
      }),
      res,
    );

    expect(handled).toBe(true);
    expect(rec.status).toBe(401);
    expect(JSON.parse(rec.body)).toEqual({ error: 'unauthorized', code: 'unauthorized' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('kernel capGuard 503 adds code=capability_unavailable (message unchanged)', () => {
    const scheduler = new MafwScheduler('.');
    const { res, rec } = fakeRes();

    const handled = (scheduler as any).capGuard(res, 'demo.surface');

    expect(handled).toBe(true);
    expect(rec.status).toBe(503);
    expect(JSON.parse(rec.body)).toEqual({
      error: "runtime surface 'demo.surface' is not available",
      code: 'capability_unavailable',
    });
  });
});
