// Phase D1 Task E1: sessions read-model registry wiring — five legacy GET branches
// (messages / todo / trajectory / token-summary / children). The load-bearing
// quirk is fail-open 200: null runtime AND a throwing runtime both answer 200
// with an empty shell — never 404/500. messages keeps delegating to
// routes/session-history.ts (capability 503 + overlay), children keeps the
// subagentService depth enrichment.
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachSessionsReadRoutes } from '../../../src/routes/sessions-read';

function fakeReq(opts: { url: string; method: string; body?: string }): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    on(ev: string, fn: (c?: unknown) => void) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return req;
    },
  };
  process.nextTick(() => {
    for (const fn of listeners['data'] ?? []) fn(opts.body ?? '');
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as unknown as IncomingMessage;
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

const ZERO_SUMMARY = {
  totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  totalCost: 0,
  turnCount: 0,
  avgTokensPerTurn: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
};

interface SetupOpts {
  runtime?: any;
  trajectoryStore?: any;
  subagentDepth?: number;
  partsCalls?: Array<[string, string[]]>;
}

function setup(opts: SetupOpts = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachSessionsReadRoutes(registry, {
    runtime: () => opts.runtime ?? null,
    trajectoryStore: () => opts.trajectoryStore ?? null,
    projectDir: () => 'C:/proj',
    listDataParts: (sessionID, messageIds) => {
      opts.partsCalls?.push([sessionID, messageIds]);
      return [{ messageID: messageIds[0], partID: 'p1', kind: 'report', text: 'overlay' }];
    },
    subagentService: () => ({ depthOf: async () => opts.subagentDepth ?? 0 }),
  });
  return { registry };
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('sessions read models registry wiring (D1 Task E1)', () => {
  it('all five catalog routes have handlers attached (no silent 404)', () => {
    const { registry } = setup();
    const expectOps: Array<[string, string]> = [
      ['/api/sessions/s1/messages', 'session.messages'],
      ['/api/sessions/s1/todo', 'session.todo'],
      ['/api/sessions/s1/trajectory', 'session.trajectory'],
      ['/api/sessions/s1/token-summary', 'session.tokenSummary'],
      ['/api/sessions/s1/children', 'session.children'],
    ];
    for (const [url, op] of expectOps) {
      expect(registry.match('GET', url)?.def.operationId).toBe(op);
      expect(handlerFor(registry, 'GET', url)).toBeDefined();
    }
  });

  it('messages delegates to handleSessionHistory with flat data-parts overlay', async () => {
    const partsCalls: Array<[string, string[]]> = [];
    const messages = [{ id: 'm1', role: 'user', parts: [] }];
    const { registry } = setup({
      runtime: { session: { messages: async () => ({ data: messages, nextCursor: null }) } },
      partsCalls,
    });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/sessions/s1/messages?limit=5')!(
      fakeReq({ url: '/api/sessions/s1/messages?limit=5', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.nextCursor).toBeNull();
    expect(body.data).toHaveLength(1);
    expect(partsCalls).toEqual([['s1', ['m1']]]);
  });

  it('messages propagates the delegate false on a trailing-slash URL (no hung request)', async () => {
    // RouteRegistry.match() strips trailing slashes, so /api/sessions/s1/messages/
    // reaches this handler while handleSessionHistory's own anchored regex returns
    // false. That false must reach dispatchAuthorized and no response may be written.
    const { registry } = setup({
      runtime: { session: { messages: async () => { throw new Error('must not run'); } } },
    });
    const r = fakeRes();
    const handled = await handlerFor(registry, 'GET', '/api/sessions/s1/messages/')!(
      fakeReq({ url: '/api/sessions/s1/messages/', method: 'GET' }), r.res,
    );
    expect(handled).toBe(false);
    expect(r.body).toBe('');
  });

  it('todo: 200 {data:[]} on a null runtime AND on a throwing runtime', async () => {
    const nullRuntime = setup();
    let r = fakeRes();
    await handlerFor(nullRuntime.registry, 'GET', '/api/sessions/s1/todo')!(
      fakeReq({ url: '/api/sessions/s1/todo', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ data: [] });

    const throwing = setup({ runtime: { session: { todo: async () => { throw new Error('boom'); } } } });
    r = fakeRes();
    await handlerFor(throwing.registry, 'GET', '/api/sessions/s1/todo')!(
      fakeReq({ url: '/api/sessions/s1/todo', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ data: [] });
  });

  it('todo returns the runtime list verbatim (non-array → empty shell)', async () => {
    const { registry } = setup({ runtime: { session: { todo: async () => [{ id: 't1' }] } } });
    let r = fakeRes();
    await handlerFor(registry, 'GET', '/api/sessions/s1/todo')!(
      fakeReq({ url: '/api/sessions/s1/todo', method: 'GET' }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ data: [{ id: 't1' }] });

    const { registry: bad } = setup({ runtime: { session: { todo: async () => 'nope' } } });
    r = fakeRes();
    await handlerFor(bad, 'GET', '/api/sessions/s1/todo')!(
      fakeReq({ url: '/api/sessions/s1/todo', method: 'GET' }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ data: [] });
  });

  it('trajectory: null store → 200 {turns:[],events:[]}', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/sessions/s1/trajectory')!(
      fakeReq({ url: '/api/sessions/s1/trajectory', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ turns: [], events: [] });
  });

  it('trajectory forwards limit/before_turn to the store and returns its timeline', async () => {
    const seen: any[] = [];
    const store = {
      getSessionTrajectory: (sessionID: string, o: any) => {
        seen.push([sessionID, o]);
        return { turns: [{ turnID: 2 }], events: [] };
      },
    };
    const { registry } = setup({ trajectoryStore: store });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/sessions/s1/trajectory?limit=900&before_turn=7')!(
      fakeReq({ url: '/api/sessions/s1/trajectory?limit=900&before_turn=7', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ turns: [{ turnID: 2 }], events: [] });
    // limit is capped at 200 in the handler (legacy quirk).
    expect(seen).toEqual([['s1', { limit: 200, beforeTurn: 7 }]]);
  });

  it('trajectory fail-open 200 when the store throws (even on rebuild)', async () => {
    const store = { getSessionTrajectory: () => { throw new Error('db gone'); } };
    const { registry } = setup({
      trajectoryStore: store,
      runtime: { session: { messages: async () => ({ data: [{ id: 'm1', role: 'user' }] }) } },
    });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/sessions/s1/trajectory?rebuild=1')!(
      fakeReq({ url: '/api/sessions/s1/trajectory?rebuild=1', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ turns: [], events: [] });
  });

  it('token-summary: null store → zeroed summary; store hit → verbatim summary', async () => {
    let r = fakeRes();
    const { registry } = setup();
    await handlerFor(registry, 'GET', '/api/sessions/s1/token-summary')!(
      fakeReq({ url: '/api/sessions/s1/token-summary', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual(ZERO_SUMMARY);

    const summary = { ...ZERO_SUMMARY, totalCost: 1.25, turnCount: 3 };
    const { registry: withStore } = setup({ trajectoryStore: { getSessionTokenSummary: () => summary } });
    r = fakeRes();
    await handlerFor(withStore, 'GET', '/api/sessions/s1/token-summary')!(
      fakeReq({ url: '/api/sessions/s1/token-summary', method: 'GET' }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual(summary);

    const { registry: throwing } = setup({ trajectoryStore: { getSessionTokenSummary: () => { throw new Error('x'); } } });
    r = fakeRes();
    await handlerFor(throwing, 'GET', '/api/sessions/s1/token-summary')!(
      fakeReq({ url: '/api/sessions/s1/token-summary', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual(ZERO_SUMMARY);
  });

  it('children: depth enrichment uses parentDepth+1 only when the item has no depth', async () => {
    const { registry } = setup({
      runtime: {
        session: {
          children: async () => [{ id: 'c1' }, { id: 'c2', depth: 4 }],
        },
      },
      subagentDepth: 2,
    });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/sessions/s1/children')!(
      fakeReq({ url: '/api/sessions/s1/children', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ items: [{ id: 'c1', depth: 3 }, { id: 'c2', depth: 4 }] });
  });

  it('children: 503 on a null/unsupported runtime, 200 {items:[]} on a throwing supported runtime', async () => {
    let r = fakeRes();
    const { registry } = setup();
    await handlerFor(registry, 'GET', '/api/sessions/s1/children')!(
      fakeReq({ url: '/api/sessions/s1/children', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ error: 'runtime does not support session.children' });

    const { registry: unsupported } = setup({
      runtime: {
        capabilities: { sessionChildrenApi: false },
        session: { children: async () => [{ id: 'ignored' }] },
      },
    });
    r = fakeRes();
    await handlerFor(unsupported, 'GET', '/api/sessions/s1/children')!(
      fakeReq({ url: '/api/sessions/s1/children', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(503);

    const { registry: throwing } = setup({
      runtime: { session: { children: async () => { throw new Error('boom'); } } },
    });
    r = fakeRes();
    await handlerFor(throwing, 'GET', '/api/sessions/s1/children')!(
      fakeReq({ url: '/api/sessions/s1/children', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ items: [] });
  });
});
