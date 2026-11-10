// Phase D1 Task H2: pod events registry wiring — the legacy block was ONE shared
// `{ seenAll | seenOne | list }` gate feeding handlePodEvents with method-armed
// branches; the registry splits it into three (method, path) handlers. Params are
// pre-decoded by the registry (legacy decoded its own regex captures), and the
// 400/404/500 result shapes come straight from handlePodEvents.
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachPodsEventsRoutes } from '../../../src/routes/pods-events-dispatch';

function fakeReq(opts: { method: string; url: string; body?: string }): IncomingMessage {
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

function fakeRes(): { res: ServerResponse; status: number; body: string; headers: Record<string, unknown> } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '', headers: {} as Record<string, unknown> };
  out.res = {
    writeHead: (status: number, headers?: Record<string, unknown>) => {
      out.status = status;
      if (headers) Object.assign(out.headers, headers);
    },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return { res: out.res, get status() { return out.status; }, get body() { return out.body; }, get headers() { return out.headers; } } as any;
}

function service() {
  const listCalls: Array<[string, any]> = [];
  const seen: Array<[string, string]> = [];
  const seenAll: Array<[string, string, number]> = [];
  return {
    listCalls,
    seen,
    seenAll,
    svc: {
      list: (podId: string, opts?: any) => { listCalls.push([podId, opts]); return { items: [{ id: 'e1' }], unread: 3 }; },
      markSeen: (podId: string, id: string) => { seen.push([podId, id]); return true; },
      markSeenAll: (podId: string, goalId: string, revision: number) => { seenAll.push([podId, goalId, revision]); return 2; },
    } as any,
  };
}

function setup(over: { podEventService?: () => any } = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachPodsEventsRoutes(registry, { podEventService: () => undefined, ...over });
  return registry;
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('pod events registry wiring (D1 Task H2)', () => {
  it('binds the three arms and keeps seenAll ahead of :id/seen structurally', () => {
    const registry = setup();
    expect(registry.match('GET', '/api/pods/p1/events')?.def.operationId).toBe('pod.events.list');
    expect(registry.match('POST', '/api/pods/p1/events/seen')?.def.operationId).toBe('pod.events.seenAll');
    expect(registry.match('POST', '/api/pods/p1/events/e1/seen')?.def.operationId).toBe('pod.events.seen');
    for (const [method, url] of [['GET', '/api/pods/p1/events'], ['POST', '/api/pods/p1/events/seen'], ['POST', '/api/pods/p1/events/e1/seen']] as const) {
      expect(handlerFor(registry, method, url)).toBeDefined();
    }
  });

  it('list projects ?state/?limit and returns the 200 {items,unread} body', async () => {
    const s = service();
    const registry = setup({ podEventService: () => s.svc });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/pods/p1/events?state=unread&limit=7')!(
      fakeReq({ method: 'GET', url: '/api/pods/p1/events?state=unread&limit=7' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(r.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(r.body)).toEqual({ items: [{ id: 'e1' }], unread: 3 });
    expect(s.listCalls[0]).toEqual(['p1', { state: 'unread', limit: 7 }]);
  });

  it('seen passes the pre-decoded id and keeps the {ok,changed} shape', async () => {
    const s = service();
    const registry = setup({ podEventService: () => s.svc });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/pods/p1/events/ev%2F1/seen')!(
      fakeReq({ method: 'POST', url: '/api/pods/p1/events/ev%2F1/seen' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true, changed: true });
    // legacy decodeURIComponent(capture) → 'ev/1'; registry params are decoded once.
    expect(s.seen).toEqual([['p1', 'ev/1']]);
  });

  it('seenAll reads goalId/revision from the body (400 when missing)', async () => {
    const s = service();
    const registry = setup({ podEventService: () => s.svc });
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/pods/p1/events/seen')!(
      fakeReq({ method: 'POST', url: '/api/pods/p1/events/seen', body: JSON.stringify({ goalId: 'g1', revision: 4 }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true, changed: 2 });
    expect(s.seenAll).toEqual([['p1', 'g1', 4]]);

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/pods/p1/events/seen')!(
      fakeReq({ method: 'POST', url: '/api/pods/p1/events/seen', body: JSON.stringify({ goalId: 'g1' }) }), r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe('goalId and revision are required');
  });

  it('unparseable POST body falls back to {} (legacy silent catch → 400, not 500)', async () => {
    const s = service();
    const r = fakeRes();
    await handlerFor(setup({ podEventService: () => s.svc }), 'POST', '/api/pods/p1/events/seen')!(
      fakeReq({ method: 'POST', url: '/api/pods/p1/events/seen', body: 'not-json' }), r.res,
    );
    expect(r.status).toBe(400);
  });

  it('an uninitialised podEventService still surfaces handlePodEvents’ 500 envelope', async () => {
    const r = fakeRes();
    await handlerFor(setup(), 'GET', '/api/pods/p1/events')!(fakeReq({ method: 'GET', url: '/api/pods/p1/events' }), r.res);
    expect(r.status).toBe(500);
    expect(typeof JSON.parse(r.body).error).toBe('string');
  });
});
