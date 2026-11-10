// Phase D1 Task C3: obs/capture registry wiring — manual chunked reader kept verbatim:
// 1MB abort → silent drop (no response), recursion guards, fail-open 200 on errors,
// redact + salience side effects and the user_input-only prefetch chain.
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachObsRoutes } from '../../../src/routes/obs';
import { redactSecrets } from '../../../src/recall/redact';

function fakeReq(opts: { url: string; method: string; body?: string; destroy?: () => void }): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    destroy: opts.destroy ?? (() => {}),
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

function fakeRes(): { res: ServerResponse; status: number; body: string; ended: boolean } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '', ended: false };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.ended = true; out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

function setup(opts: { internal?: boolean; appendThrows?: boolean; dreamQueries?: string[]; appendId?: string | null } = {}) {
  const appended: any[] = [];
  const deleted: Array<[string, string]> = [];
  const prefetched: Array<[string, string]> = [];
  const snapshots: string[] = [];
  const db = {
    nextTurnId: () => 7,
    currentTurnId: () => 7,
    append: (row: any) => { if (opts.appendThrows) throw new Error('db down'); appended.push(row); return opts.appendId === undefined ? 'obs-1' : opts.appendId; },
    kvGet: (_scope: string, _key: string) => (opts.dreamQueries ? { queries: opts.dreamQueries } : undefined),
    kvDelete: (scope: string, key: string) => { deleted.push([scope, key]); },
  } as any;
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachObsRoutes(registry, {
    internalSessionRoles: () => ({ has: () => !!opts.internal }),
    getGatewayDb: () => db,
    getScanService: () => ({ prefetch: (sid: string, text: string) => { prefetched.push([sid, text]); } }) as any,
    scheduleSnapshotRefresh: (sid) => { snapshots.push(sid); },
  });
  return { registry, appended, deleted, prefetched, snapshots };
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

const wrap = (url: string, body: unknown) => fakeReq({ url, method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

/** The handler writes the response from the stream 'end' listener (next tick). */
const settle = () => new Promise((r) => setImmediate(r));

describe('obs capture registry wiring (D1 Task C3)', () => {
  it('route is attached (no silent 404)', () => {
    const { registry } = setup();
    expect(handlerFor(registry, 'POST', '/api/obs/capture')).toBeDefined();
  });

  it('redacts, tags salience and assigns the turn id from the db', async () => {
    const { registry, appended } = setup();
    const r = fakeRes();
    const raw = 'hello sk-ant-abcdefghijklmnopqrstuvwxyz0123456789';
    await handlerFor(registry, 'POST', '/api/obs/capture')!(wrap('/api/obs/capture', { sessionID: 's1', source: 'user_input', content: raw }), r.res);
    await settle();
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true, id: 'obs-1', turnId: 7, deduped: false });
    expect(appended[0].content).toBe(redactSecrets(raw).slice(0, 100_000));
    expect(appended[0].salience).toBeGreaterThanOrEqual(0);
    expect(appended[0]).toMatchObject({ session_id: 's1', turn_id: 7, source: 'user_input', failure: 0 });
  });

  it('400 on invalid source, 200 deduped on blank content', async () => {
    let r = fakeRes();
    await handlerFor(setup().registry, 'POST', '/api/obs/capture')!(wrap('/api/obs/capture', { sessionID: 's1', source: 'nope', content: 'x' }), r.res);
    await settle();
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ ok: false, error: 'sessionID and valid source required' });

    r = fakeRes();
    await handlerFor(setup().registry, 'POST', '/api/obs/capture')!(wrap('/api/obs/capture', { sessionID: 's1', source: 'user_input', content: '   ' }), r.res);
    await settle();
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true, id: null, deduped: true, turnId: 0 });
  });

  it('recursion guards: internal session and pipeline-prompt content', async () => {
    let r = fakeRes();
    await handlerFor(setup({ internal: true }).registry, 'POST', '/api/obs/capture')!(wrap('/api/obs/capture', { sessionID: 's1', source: 'user_input', content: 'x' }), r.res);
    await settle();
    expect(JSON.parse(r.body)).toEqual({ ok: true, id: null, deduped: true, turnId: 0, internal: true });

    r = fakeRes();
    await handlerFor(setup().registry, 'POST', '/api/obs/capture')!(
      wrap('/api/obs/capture', { sessionID: 's1', source: 'user_input', content: 'Analyze the following agent observations: ...' }), r.res,
    );
    await settle();
    expect(JSON.parse(r.body)).toEqual({ ok: true, id: null, deduped: true, turnId: 0, filtered: true });
  });

  it('oversized body (>1MB) aborts silently — destroyed, no response written', async () => {
    const { registry, appended } = setup();
    let destroyed = false;
    const r = fakeRes();
    const req = fakeReq({
      url: '/api/obs/capture',
      method: 'POST',
      body: 'x'.repeat(1_000_001),
      destroy: () => { destroyed = true; },
    });
    await handlerFor(registry, 'POST', '/api/obs/capture')!(req, r.res);
    await settle();
    expect(destroyed).toBe(true);
    expect(r.ended).toBe(false);
    expect(appended).toHaveLength(0);
  });

  it('invalid JSON and db failures fail open with 200 { ok:false }', async () => {
    let r = fakeRes();
    await handlerFor(setup().registry, 'POST', '/api/obs/capture')!(wrap('/api/obs/capture', 'not-json'), r.res);
    await settle();
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(false);

    r = fakeRes();
    await handlerFor(setup({ appendThrows: true }).registry, 'POST', '/api/obs/capture')!(
      wrap('/api/obs/capture', { sessionID: 's1', source: 'user_input', content: 'x' }), r.res,
    );
    await settle();
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: false, error: 'db down' });
  });

  it('user_input drives scan prefetch + snapshot refresh + dream-query handoff', async () => {
    const { registry, prefetched, snapshots, deleted } = setup({ dreamQueries: ['q1', 'q2'] });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/obs/capture')!(
      wrap('/api/obs/capture', { sessionID: 's1', source: 'user_input', content: 'hello world' }), r.res,
    );
    await settle();
    expect(prefetched[0]).toEqual(['s1', 'hello world']);
    expect(prefetched.slice(1)).toEqual([['s1', 'q1'], ['s1', 'q2']]);
    expect(snapshots).toEqual(['s1']);
    expect(deleted).toEqual([['dream-queries', 's1']]);
  });

  it('non user_input sources skip prefetch/snapshot and use currentTurnId', async () => {
    const { registry, prefetched, snapshots, appended } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/obs/capture')!(
      wrap('/api/obs/capture', { sessionID: 's1', source: 'tool_result', content: 'tool output', failure: true }), r.res,
    );
    await settle();
    expect(prefetched).toHaveLength(0);
    expect(snapshots).toHaveLength(0);
    expect(appended[0]).toMatchObject({ source: 'tool_result', failure: 1, turn_id: 7 });
  });
});
