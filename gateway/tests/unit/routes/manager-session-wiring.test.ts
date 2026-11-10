// Phase D1 Task H2: GET /api/manager/session registry wiring. Legacy was a
// blind-spot branch (`req.url && req.url.startsWith(...)`, no `?.`), so the
// analyzer never counted it; the registry binds the exact path. POST
// /api/manager/session/rotate stays owned by wave1 (manager.rotate) — attaching
// this module must not touch it (attachHandler would throw on a duplicate).
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachManagerSessionRoutes } from '../../../src/routes/manager-session';
import { canonicalProjectDir } from '../../../src/core/pod/pod-identity';

function fakeReq(opts: { url: string }): IncomingMessage {
  return {
    method: 'GET',
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:3000' },
    on() { return this; },
  } as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

function setup(opts: {
  slots?: Record<string, { sessionId: string; createdAt?: string | null } | null>;
  kvKeys?: string[];
  throwOnKv?: boolean;
} = {}) {
  const slots = opts.slots ?? {};
  const currentCalls: string[] = [];
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachManagerSessionRoutes(registry, {
    leadSessionRegistry: () => ({
      current: (projectDir: string) => {
        currentCalls.push(projectDir);
        return slots[projectDir] ?? null;
      },
    }) as any,
    getGatewayDb: () => ({
      kvAll: (scope: string) => {
        if (opts.throwOnKv) throw new Error('kv exploded');
        expect(scope).toBe('manager-session');
        return (opts.kvKeys ?? []).map((key) => ({ key, value: {} }));
      },
    }) as any,
  });
  return { registry, currentCalls };
}

const handlerFor = (registry: RouteRegistry, url: string) => {
  const m = registry.match('GET', url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('manager session registry wiring (D1 Task H2)', () => {
  it('binds manager.session and leaves manager.rotate to wave1', () => {
    const { registry } = setup();
    expect(registry.match('GET', '/api/manager/session')?.def.operationId).toBe('manager.session');
    expect(handlerFor(registry, '/api/manager/session')).toBeDefined();
    expect(registry.match('POST', '/api/manager/session/rotate')?.def.operationId).toBe('manager.rotate');
    expect(registry.match('POST', '/api/manager/session/rotate')?.def.handler).toBeUndefined();
  });

  it('?projectDir= returns the single canonical slot (404 when unknown)', async () => {
    const dir = 'C:/work/demo';
    const { registry } = setup({ slots: { [dir]: { sessionId: 'ses_1', createdAt: '2026-11-01T00:00:00Z' } } });
    let r = fakeRes();
    await handlerFor(registry, `/api/manager/session?projectDir=${encodeURIComponent(dir)}`)!(
      fakeReq({ url: `/api/manager/session?projectDir=${encodeURIComponent(dir)}` }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({
      projectDir: canonicalProjectDir(dir),
      sessionId: 'ses_1',
      createdAt: '2026-11-01T00:00:00Z',
    });

    const empty = setup();
    r = fakeRes();
    await handlerFor(empty.registry, `/api/manager/session?projectDir=${encodeURIComponent(dir)}`)!(
      fakeReq({ url: `/api/manager/session?projectDir=${encodeURIComponent(dir)}` }), r.res,
    );
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body).error).toBe('No manager session for project');
  });

  it('no filter projects every live canonical slot (createdAt → null)', async () => {
    const dir = 'C:/work/demo';
    const canonical = canonicalProjectDir(dir);
    const { registry, currentCalls } = setup({
      kvKeys: [dir],
      slots: { [canonical]: { sessionId: 'ses_1' } },
    });
    const r = fakeRes();
    await handlerFor(registry, '/api/manager/session')!(fakeReq({ url: '/api/manager/session' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual([{ projectDir: canonical, sessionId: 'ses_1', createdAt: null }]);
    expect(currentCalls).toEqual([canonical]);
  });

  it('dormant slots are dropped; all-dormant → 404 {No manager session}', async () => {
    const dead = 'C:/work/dead';
    const deadCanonical = canonicalProjectDir(dead);
    const { registry } = setup({ kvKeys: [dead], slots: { [deadCanonical]: null } });
    const r = fakeRes();
    await handlerFor(registry, '/api/manager/session')!(fakeReq({ url: '/api/manager/session' }), r.res);
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body).error).toBe('No manager session');
  });

  it('kv failures keep the 500 + legacy message envelope', async () => {
    const { registry } = setup({ throwOnKv: true });
    const r = fakeRes();
    await handlerFor(registry, '/api/manager/session')!(fakeReq({ url: '/api/manager/session' }), r.res);
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body).error).toBe('Failed to read manager sessions');
  });
});
