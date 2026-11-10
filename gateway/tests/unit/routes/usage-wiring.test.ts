// Phase D1 Task B2: usage 聚合面 registry wiring — fail-open 200 信封（summary/memory/
// modelStats/providers）与 alias 形状保留。
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachUsageRoutes } from '../../../src/routes/usage';

function fakeReq(opts: { url: string; method: string }): IncomingMessage {
  return {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    on() { return this; },
  } as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string } {
  const out = { res: null as unknown as ServerResponse, status: 0, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

const emptySummary = {
  totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  totalCost: 0, turnCount: 0, sessionCount: 0,
};

function fakeStore() {
  return {
    getSessionTokenSummary: () => ({ ...emptySummary, turnCount: 3 }),
    getProjectTokenSummary: () => ({ ...emptySummary, turnCount: 7 }),
    getGlobalTokenSummary: () => ({ ...emptySummary, turnCount: 11 }),
    getMemoryTokenSummary: () => ({ input: 1, output: 2 }),
    list: () => [],
  } as any;
}

function setup(store: any, poller: any = null) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachUsageRoutes(registry, { trajectoryStore: () => store, usagePoller: () => poller });
  const handlerFor = (method: string, url: string) => {
    const m = registry.match(method as never, url);
    if (!m?.def.handler) return undefined;
    const handler = m.def.handler;
    return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
  };
  return { handlerFor };
}

describe('usage registry wiring (D1 Task B2)', () => {
  it('both catalog routes have handlers attached', () => {
    const { handlerFor } = setup(null);
    expect(handlerFor('GET', '/api/usage')).toBeDefined();
    expect(handlerFor('GET', '/api/usage/summary')).toBeDefined();
  });

  it('consolidated usage returns summary + memory + modelStats windows + providers', async () => {
    const poller = { poll: async () => ({ providers: [{ id: 'p1' }], updatedAt: 42 }) };
    const { handlerFor } = setup(fakeStore(), poller);
    const r = fakeRes();
    await handlerFor('GET', '/api/usage?sessionID=s1&projectID=pj1')!(
      fakeReq({ url: '/api/usage?sessionID=s1&projectID=pj1', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.summary.session.turnCount).toBe(3);
    expect(body.summary.project.turnCount).toBe(7);
    expect(body.summary.global.turnCount).toBe(11);
    expect(body.memory).toEqual({ input: 1, output: 2 });
    expect(body.modelStats.windows).toHaveProperty('today');
    expect(body.providers).toEqual([{ id: 'p1' }]);
    expect(body.updatedAt).toBe(42);
  });

  it('no store → zeroed envelope, poller absent → empty providers', async () => {
    const { handlerFor } = setup(null);
    const r = fakeRes();
    await handlerFor('GET', '/api/usage')!(fakeReq({ url: '/api/usage', method: 'GET' }), r.res);
    const body = JSON.parse(r.body);
    expect(r.status).toBe(200);
    expect(body.summary.global.turnCount).toBe(0);
    expect(body.memory).toBeNull();
    expect(body.providers).toEqual([]);
  });

  it('summary alias keeps the {session, project, global, memory} shape', async () => {
    const { handlerFor } = setup(fakeStore());
    const r = fakeRes();
    await handlerFor('GET', '/api/usage/summary?projectID=pj1')!(
      fakeReq({ url: '/api/usage/summary?projectID=pj1', method: 'GET' }), r.res,
    );
    const body = JSON.parse(r.body);
    expect(r.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['global', 'memory', 'project', 'session']);
    expect(body.project.turnCount).toBe(7);
  });
});
