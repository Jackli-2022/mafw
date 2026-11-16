import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachObsRoutes } from '../../../src/routes/obs';

function fakeReq(url: string, body: unknown): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req = {
    method: 'POST',
    url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    destroy: () => {},
    on(ev: string, fn: (c?: unknown) => void) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return req;
    },
  };
  process.nextTick(() => {
    for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
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

const handlerFor = (registry: RouteRegistry, url: string) => {
  const m = registry.match('POST' as never, url);
  if (!m?.def.handler) return undefined;
  return (req: IncomingMessage, res: ServerResponse) => m.def.handler!(req, res, m.params);
};

const settle = () => new Promise((r) => setImmediate(r));

function setup(opts: { currentTurn?: number | null } = {}) {
  const boundaries: any[] = [];
  const pending: any[] = [];
  const consumed: any[] = [];
  const turn = opts.currentTurn == null ? null : {
    trace_id: 't1t_7', session_id: 's1', turn_seq: opts.currentTurn, created_at: 0,
    archived_at: null, encoding_salience: null, legacy_ambiguous: 0,
  };
  const db = {
    beginTurn: () => turn,
    currentTurn: () => turn,
    append: () => 'obs-1',
    consumePendingEpisodeBoundary: (sessionID: string, turnSeq: number) => {
      consumed.push([sessionID, turnSeq]);
      return { sessionId: sessionID, afterTurn: turnSeq - 1, source: 'user', createdAt: 1 };
    },
    recordEpisodeBoundary: (b: any) => { boundaries.push(b); },
    setPendingEpisodeBoundary: (sessionID: string, payload: any) => { pending.push([sessionID, payload]); },
    kvGet: () => undefined,
    kvDelete: () => {},
  } as any;
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachObsRoutes(registry, {
    internalSessionRoles: () => ({ has: () => false }),
    getGatewayDb: () => db,
    getScanService: () => null,
    scheduleSnapshotRefresh: () => {},
  });
  return { registry, boundaries, pending, consumed };
}

describe('obs episode boundary route', () => {
  it('is attached', () => {
    expect(handlerFor(setup().registry, '/api/obs/episode-boundary')).toBeDefined();
  });

  it('queues next_user_turn as a pending flag', async () => {
    const { registry, pending, boundaries } = setup({ currentTurn: 7 });
    const r = fakeRes();
    await handlerFor(registry, '/api/obs/episode-boundary')!(
      fakeReq('/api/obs/episode-boundary', { sessionID: 's1', scope: 'next_user_turn', reason: 'user_declared' }),
      r.res,
    );
    await settle();
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true, pending: true });
    expect(pending).toEqual([['s1', expect.objectContaining({ reason: 'user_declared' })]]);
    expect(boundaries).toHaveLength(0);
  });

  it('resolves start_new and end_current against the current turn', async () => {
    let r = fakeRes();
    await handlerFor(setup({ currentTurn: 7 }).registry, '/api/obs/episode-boundary')!(
      fakeReq('/api/obs/episode-boundary', { sessionID: 's1', scope: 'start_new' }),
      r.res,
    );
    await settle();
    expect(JSON.parse(r.body).boundary).toMatchObject({ afterTurn: 6, source: 'agent' });

    r = fakeRes();
    await handlerFor(setup({ currentTurn: 7 }).registry, '/api/obs/episode-boundary')!(
      fakeReq('/api/obs/episode-boundary', { sessionID: 's1', scope: 'end_current' }),
      r.res,
    );
    await settle();
    expect(JSON.parse(r.body).boundary).toMatchObject({ afterTurn: 7, source: 'agent' });
  });

  it('ignores start_new when the session has no completed turn', async () => {
    const r = fakeRes();
    await handlerFor(setup({ currentTurn: null }).registry, '/api/obs/episode-boundary')!(
      fakeReq('/api/obs/episode-boundary', { sessionID: 's1', scope: 'start_new' }),
      r.res,
    );
    await settle();
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true, ignored: true });
  });

  it('rejects an invalid scope', async () => {
    const r = fakeRes();
    await handlerFor(setup({ currentTurn: 7 }).registry, '/api/obs/episode-boundary')!(
      fakeReq('/api/obs/episode-boundary', { sessionID: 's1', scope: 'nope' }),
      r.res,
    );
    await settle();
    expect(r.status).toBe(400);
  });

  it('capture consumes a pending boundary only on user_input', async () => {
    const { registry, consumed } = setup({ currentTurn: 7 });
    const r = fakeRes();
    await handlerFor(registry, '/api/obs/capture')!(
      fakeReq('/api/obs/capture', { sessionID: 's1', source: 'user_input', content: 'new topic' }),
      r.res,
    );
    await settle();
    expect(consumed).toEqual([['s1', 7]]);
    expect(JSON.parse(r.body).episodeBoundary).toMatchObject({ afterTurn: 6 });

    const tool = fakeRes();
    await handlerFor(registry, '/api/obs/capture')!(
      fakeReq('/api/obs/capture', { sessionID: 's1', source: 'tool_result', content: 'tool output' }),
      tool.res,
    );
    await settle();
    expect(consumed).toHaveLength(1);
  });
});
