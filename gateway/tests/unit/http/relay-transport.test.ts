/**
 * M0: the transport must turn a marker-bearing request into `relay` and keep it
 * inside the mobile allowlist. Real local clients keep `local`; device tokens
 * keep `human` even through the tunnel.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { TUNNEL_HEADER } from '../../../src/core/auth';
import { createRequestListener, type TransportDeps } from '../../../src/http/transport';

const SECRET = 'a'.repeat(64);
const LOOPBACK = '127.0.0.1';
const REMOTE = '203.0.113.9';

interface Recorded {
  status?: number;
  body: string;
}

function fakeRes(): { res: ServerResponse; rec: Recorded } {
  const rec: Recorded = { body: '' };
  const res = {
    headersSent: false,
    setHeader() { return this; },
    writeHead(status: number) { rec.status = status; this.headersSent = true; return this; },
    end(chunk?: unknown) { if (chunk !== undefined) rec.body += String(chunk); return this; },
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
    url: opts.url ?? '/api/presence',
    headers: opts.headers ?? {},
    socket: { remoteAddress: opts.remoteAddress ?? LOOPBACK },
    on() { return this; },
    pipe() { return this; },
  } as unknown as IncomingMessage;
}

function makeDeps(over: Partial<TransportDeps> = {}): { deps: TransportDeps; dispatch: jest.Mock } {
  const dispatch = jest.fn(async () => true);
  const deps: TransportDeps = {
    cors: () => ({ origin: '*', methods: 'GET,POST', headers: 'content-type' }),
    apiToken: () => 'svc-token',
    humanToken: () => 'human-token',
    verifyDeviceToken: (token: string) => (token === 'dev_good' ? { deviceId: 'dev-1' } : null),
    tunnelSecret: SECRET,
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
  return { deps, dispatch };
}

async function request(deps: TransportDeps, req: IncomingMessage): Promise<Recorded> {
  const { res, rec } = fakeRes();
  await createRequestListener(deps)(req, res);
  return rec;
}

describe('transport relay principal (M0)', () => {
  it('requires a credential for a relayed API request', async () => {
    const { deps, dispatch } = makeDeps();
    const req = fakeReq({ headers: { [TUNNEL_HEADER]: SECRET } });

    const rec = await request(deps, req);

    expect(rec.status).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
    expect((req as any).mafwPrincipal).toEqual({ kind: 'relay', method: 'tunnel', tunneled: true });
  });

  it('allows relayed pairing verify because the nonce is the credential', async () => {
    const { deps, dispatch } = makeDeps();
    const rec = await request(deps, fakeReq({
      method: 'POST',
      url: '/api/mobile/pairing/verify',
      headers: { [TUNNEL_HEADER]: SECRET },
    }));

    expect(rec.status).toBeUndefined();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('keeps anonymous tunneled health minimal', async () => {
    const { deps } = makeDeps({ dispatchAuthorized: jest.fn(async () => false) });
    const rec = await request(deps, fakeReq({
      method: 'GET',
      url: '/health',
      headers: { [TUNNEL_HEADER]: SECRET },
    }));

    expect(rec.status).toBe(200);
    expect(JSON.parse(rec.body)).toEqual({ status: 'ok' });
  });

  it('never proxies an unmatched tunneled route to the runtime', async () => {
    const { deps, dispatch } = makeDeps();
    const rec = await request(deps, fakeReq({
      method: 'GET',
      url: '/api/session/s1/message',
      headers: { [TUNNEL_HEADER]: SECRET, authorization: 'Bearer dev_good' },
    }));

    expect(rec.status).toBe(403);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('rejects traversal paths before the allowlist', async () => {
    const { deps, dispatch } = makeDeps();
    const rec = await request(deps, fakeReq({
      method: 'POST',
      url: '/api/mobile/../../api/pty',
      headers: { [TUNNEL_HEADER]: SECRET, authorization: 'Bearer dev_good' },
    }));

    expect(rec.status).toBe(403);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('allows a tunneled device token on the mobile surface', async () => {
    const { deps, dispatch } = makeDeps();
    const req = fakeReq({ headers: { [TUNNEL_HEADER]: SECRET, authorization: 'Bearer dev_good' } });

    const rec = await request(deps, req);

    expect(rec.status).toBeUndefined();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((req as any).mafwPrincipal).toEqual({
      kind: 'human', method: 'device-token', deviceId: 'dev-1', tunneled: true,
    });
  });

  it('denies relay on desktop-only routes before dispatch', async () => {
    for (const [method, url] of [
      ['POST', '/a2a'],
      ['GET', '/api/terminal/sessions'],
      ['POST', '/api/python/execute'],
      ['POST', '/api/tools/execute'],
      ['POST', '/api/cognition/gate'],
    ] as const) {
      const { deps, dispatch } = makeDeps();
      const rec = await request(deps, fakeReq({ method, url, headers: { [TUNNEL_HEADER]: SECRET } }));
      expect(`${method} ${url}:${rec.status}`).toBe(`${method} ${url}:403`);
      expect(dispatch).not.toHaveBeenCalled();
    }
  });

  it('denies desktop-only routes even with a valid device token', async () => {
    const { deps, dispatch } = makeDeps();
    const rec = await request(deps, fakeReq({
      method: 'GET',
      url: '/api/terminal/sessions',
      headers: { [TUNNEL_HEADER]: SECRET, authorization: 'Bearer dev_good' },
    }));

    expect(rec.status).toBe(403);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('keeps a real local request local', async () => {
    const { deps, dispatch } = makeDeps();
    const req = fakeReq({ url: '/dashboard' });

    const rec = await request(deps, req);

    expect(rec.status).toBeUndefined();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((req as any).mafwPrincipal).toEqual({ kind: 'local', method: 'loopback' });
  });

  it('keeps a device token human through the tunnel', async () => {
    const { deps } = makeDeps();
    const req = fakeReq({ headers: { [TUNNEL_HEADER]: SECRET, authorization: 'Bearer dev_good' } });

    await request(deps, req);

    expect((req as any).mafwPrincipal).toEqual({ kind: 'human', method: 'device-token', deviceId: 'dev-1', tunneled: true });
  });

  it('rejects a forged marker from a non-loopback address', async () => {
    const { deps } = makeDeps();
    const rec = await request(deps, fakeReq({ remoteAddress: REMOTE, headers: { [TUNNEL_HEADER]: 'forged' } }));
    expect(rec.status).toBe(401);
  });
});
