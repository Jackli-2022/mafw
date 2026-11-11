/**
 * E3-5：opt-in schema epoch 握手。
 *
 * - 所有响应带 `X-MAFW-Schema-Epoch: <schemaEpoch>`（metadata 未就绪时省略）。
 * - 请求**主动携带**不匹配的 `X-MAFW-Schema-Epoch` → 409
 *   `{error, code:'schema_epoch_mismatch'}`，且 registry/路由链不执行。
 * - 不携带 / 携带匹配值 → 正常放行（不引入强制版本拒绝）。
 *
 * header 必须在 auth 之前写出（401 响应也可见）；校验在 auth 之后、registry 之前。
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { createRequestListener, type TransportDeps } from '../../../src/http/transport';

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

function makeDeps(over: Partial<TransportDeps> = {}): { deps: TransportDeps; dispatch: jest.Mock; pluginWeb: jest.Mock } {
  const dispatch = jest.fn(async () => false);
  const pluginWeb = jest.fn(async () => false);
  const deps: TransportDeps = {
    cors: () => ({ origin: '*', methods: 'GET,POST', headers: 'content-type' }),
    apiToken: () => 'sekret',
    schemaEpoch: () => 7,
    dispatchAuthorized: dispatch,
    pluginWebWildcard: pluginWeb,
    fileHistory: async () => false,
    mediaAgent: () => undefined,
    mcpEndpoint: () => undefined,
    mcpStreamable: () => undefined,
    spaRoot: () => '/nonexistent-dashboard-root',
    dashboardDispatch: async () => ({ status: 200, body: { dashboard: true } }),
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
  return { deps, dispatch, pluginWeb };
}

describe('E3-5: opt-in schema epoch handshake', () => {
  it('every response carries X-MAFW-Schema-Epoch (preflight and auth included)', async () => {
    const { deps } = makeDeps();
    const listener = createRequestListener(deps);

    const preflight = fakeRes();
    await listener(fakeReq({ method: 'OPTIONS', url: '/api/anything' }), preflight.res);
    expect(preflight.rec.status).toBe(204);
    expect(preflight.rec.headers['x-mafw-schema-epoch']).toBe('7');

    const unauthorized = fakeRes();
    await listener(
      fakeReq({ method: 'GET', url: '/api/goals', remoteAddress: '203.0.113.9' }),
      unauthorized.res,
    );
    expect(unauthorized.rec.status).toBe(401);
    expect(unauthorized.rec.headers['x-mafw-schema-epoch']).toBe('7');
  });

  it('mismatched epoch → 409 schema_epoch_mismatch, registry chain not executed', async () => {
    const { deps, dispatch, pluginWeb } = makeDeps();
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();

    await listener(
      fakeReq({
        method: 'GET',
        url: '/api/goals',
        headers: { 'x-mafw-schema-epoch': '6' },
      }),
      res,
    );

    expect(rec.status).toBe(409);
    expect(JSON.parse(rec.body)).toEqual({ error: 'schema epoch mismatch', code: 'schema_epoch_mismatch' });
    expect(rec.headers['x-mafw-schema-epoch']).toBe('7');
    expect(dispatch).not.toHaveBeenCalled();
    expect(pluginWeb).not.toHaveBeenCalled();
  });

  it('no epoch header → normal request', async () => {
    const { deps, dispatch } = makeDeps();
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();

    await listener(fakeReq({ method: 'GET', url: '/api/goals' }), res);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(rec.status).toBe(200);
    expect(JSON.parse(rec.body)).toEqual({ dashboard: true });
  });

  it('matching epoch header → normal request', async () => {
    const { deps, dispatch } = makeDeps();
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();

    await listener(
      fakeReq({
        method: 'GET',
        url: '/api/goals',
        headers: { 'x-mafw-schema-epoch': '7' },
      }),
      res,
    );

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(rec.status).toBe(200);
  });

  it('unknown epoch (metadata not loaded) omits the header and skips enforcement', async () => {
    const { deps, dispatch } = makeDeps({ schemaEpoch: () => null });
    const listener = createRequestListener(deps);
    const { res, rec } = fakeRes();

    await listener(
      fakeReq({
        method: 'GET',
        url: '/api/goals',
        headers: { 'x-mafw-schema-epoch': '6' },
      }),
      res,
    );

    expect(rec.headers['x-mafw-schema-epoch']).toBeUndefined();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(rec.status).toBe(200);
  });
});
