// Phase D1 Task D1: sessions core registry wiring — ten legacy branches
// (create / get / deleteLegacy / abort / background / promptAsync / prompt /
// queue list+clear+cancel). Quirks that must survive: session.get's 404
// {error:'not found'} miss (E10-3; body unchanged, status no longer 200),
// prompt's 409 suspended arm, queue cancel's 404 miss, deleteLegacy's own
// cleanup set (R4 — NOT session.delete's), and the background delegation into
// routes/session-background.ts.
import type { IncomingMessage, ServerResponse } from 'http';
import * as path from 'path';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachSessionsCoreRoutes } from '../../../src/routes/sessions-core';

function fakeReq(opts: { url: string; method: string; body?: string; headers?: Record<string, string> }): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: opts.headers ?? {},
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
    end: (payload?: unknown) => { out.body = String(payload ?? ''); out.ended = true; },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

interface SetupOpts {
  sdkSessionGet?: (id: string) => Promise<any>;
  holdSessions?: string[];
  snapshotThrows?: boolean;
  runtime?: any;
}

function setup(opts: SetupOpts = {}) {
  const calls: string[] = [];
  const prompted: Array<{ message: any; parts: any[] }> = [];
  const promptedSync: any[][] = [];
  const held = new Set(opts.holdSessions ?? []);
  const emitArgs: Array<[string, string, string | undefined]> = [];
  const queueItems: any[] = [{ id: 'q1', text: 'hello' }];

  const sdk = {
    create: async (directory?: string, metadata?: any) => {
      calls.push(`create:${directory ?? '-'}`);
      return { id: 'new1', directory };
    },
    get: opts.sdkSessionGet ?? (async (id: string) => (id === 'known' ? { id: 'known', title: 'T' } : null)),
    delete: async (id: string) => { calls.push(`sdk.delete:${id}`); },
    prompt: async (sessionID: string, parts: any[], system: any, outputSchema: any, o: any) => {
      promptedSync.push(parts);
      calls.push(`sdk.prompt:${sessionID}:${parts.length}:${o.thinkingLevel ?? '-'}:${o.variant ?? '-'}`);
      return { ok: true };
    },
    promptAsync: async (sessionID: string, message: any, parts: any, agent: any, model: any, outputSchema: any, o: any) => {
      prompted.push({ message, parts });
      calls.push(`sdk.promptAsync:${sessionID}:${o.delivery ?? '-'}:${o.idempotencyKey ?? '-'}:${o.expectReply ?? '-'}`);
    },
  };

  const queue = {
    list: (sessionID: string) => queueItems.slice(),
    clear: (sessionID: string) => { calls.push(`queue.clear:${sessionID}`); const removed = queueItems.splice(0); return removed; },
    cancel: (sessionID: string, itemId: string) => {
      calls.push(`queue.cancel:${sessionID}:${itemId}`);
      return itemId === 'q1' ? { id: itemId } : undefined;
    },
  };

  const db = {
    kvGet: (scope: string, id: string) => ({ scope, id, dir: '/wt' }),
    kvSet: () => {},
    kvDelete: () => {},
  };

  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachSessionsCoreRoutes(registry, {
    getGatewayDb: () => db as any,
    resolvedProjectDir: () => 'C:/proj',
    sdkSession: () => sdk,
    runtime: () => opts.runtime ?? null,
    podService: () => ({
      snapshotSession: async (sessionID: string) => {
        if (opts.snapshotThrows) throw new Error('missing');
        calls.push(`pod.snapshot:${sessionID}`);
      },
      finalizeMissingSession: (sessionID: string) => { calls.push(`pod.finalize:${sessionID}`); },
    }),
    instructionSync: () => ({ forget: (sessionID: string) => { calls.push(`instructionSync.forget:${sessionID}`); } }),
    discovery: () => ({ forget: (sessionID: string) => { calls.push(`discovery.forget:${sessionID}`); } }),
    trajectoryStore: () => ({ deleteSession: (sessionID: string) => { calls.push(`trajectory.delete:${sessionID}`); } }),
    identityRegistry: () => ({ get: () => undefined }),
    identityState: () => ({ bind: () => {} }),
    runCoordinator: () => ({ shouldHoldQueue: (sessionID: string) => held.has(sessionID) }),
    busySessions: () => ({ has: (sessionID: string) => held.has(sessionID) }),
    sessionQueue: () => queue,
    enqueueQueuedPrompt: async (o: any, source: string) => {
      calls.push(`enqueue:${o.sessionID}:${source}:${String(o.expectReply)}`);
      return { queued: true, itemId: 'q2', position: 2 };
    },
    attachBudgetGuardForPrompt: (sessionID: string, maxTurns?: number, maxCostUsd?: number) => {
      calls.push(`budget:${sessionID}:${maxTurns ?? '-'}:${maxCostUsd ?? '-'}`);
    },
    emitQueueUpdated: (sessionID: string, kind: any, _items: any[], itemId?: string) => {
      calls.push(`emit:${sessionID}:${kind}${itemId ? `:${itemId}` : ''}`);
      emitArgs.push([sessionID, kind, itemId]);
    },
  });

  return { registry, calls, queueItems, emitArgs, prompted, promptedSync };
}

/** Registry dispatch always passes matched params — mirror it here (the legacy
 *  branches captured ids from their own regex). */
const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('sessions core registry wiring (D1 Task D1)', () => {
  it('all ten catalog routes have handlers attached (no silent 404)', () => {
    const { registry } = setup();
    const expectOps: Array<[string, string, string]> = [
      ['POST', '/api/session', 'session.create'],
      ['GET', '/api/sessions/s1', 'session.get'],
      ['DELETE', '/api/session/s1', 'session.deleteLegacy'],
      ['POST', '/api/session/s1/abort', 'session.abort'],
      ['POST', '/api/session/s1/background', 'session.background'],
      ['POST', '/api/session/s1/promptAsync', 'session.promptAsync'],
      ['POST', '/api/session/s1/prompt', 'session.prompt'],
      ['GET', '/api/session/s1/queue', 'session.queue.list'],
      ['DELETE', '/api/session/s1/queue', 'session.queue.clear'],
      ['DELETE', '/api/session/s1/queue/q1', 'session.queue.cancel'],
    ];
    for (const [method, url, op] of expectOps) {
      expect(registry.match(method as never, url)?.def.operationId).toBe(op);
      expect(handlerFor(registry, method, url)).toBeDefined();
    }
    // Registry params arrive decoded and named per catalog (id / itemId).
    expect(registry.match('DELETE', '/api/session/s%201/queue/q%201')!.params).toEqual({ id: 's 1', itemId: 'q 1' });
  });

  it('create delegates to handleSessionCreate with the absolute directory (E1-5: no fallback)', async () => {
    const { registry, calls } = setup();
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/session')!(
      fakeReq({ url: '/api/session', method: 'POST', body: JSON.stringify({ directory: path.resolve('x') }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ id: 'new1', directory: path.resolve('x') });
    expect(calls).toEqual([`create:${path.resolve('x')}`]);

    // E1-5：缺 directory 不再回退到 resolvedProjectDir —— 400 且不调 runtime。
    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/session')!(
      fakeReq({ url: '/api/session', method: 'POST', body: JSON.stringify({}) }), r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ error: 'directory must be an absolute path' });
    expect(calls).toEqual([`create:${path.resolve('x')}`]);
  });

  it('get: runtime projection first, then SDK fallback', async () => {
    const runtime = {
      session: { get: async ({ sessionID }: any) => (sessionID === 'rt1' ? { id: 'rt1', title: 'R' } : null) },
    };
    const { registry } = setup({ runtime });
    let r = fakeRes();
    await handlerFor(registry, 'GET', '/api/sessions/rt1')!(fakeReq({ url: '/api/sessions/rt1', method: 'GET' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).id).toBe('rt1');

    r = fakeRes();
    await handlerFor(registry, 'GET', '/api/sessions/known')!(fakeReq({ url: '/api/sessions/known', method: 'GET' }), r.res);
    expect(JSON.parse(r.body).id).toBe('known');
  });

  it('get: a miss is 404 {error:not found} (body kept, status aligned with SessionSchema)', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/sessions/missing')!(fakeReq({ url: '/api/sessions/missing', method: 'GET' }), r.res);
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body)).toEqual({ error: 'not found' });
  });

  it('deleteLegacy runs its own five-step cleanup set in order (R4)', async () => {
    const { registry, calls } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'DELETE', '/api/session/s1')!(fakeReq({ url: '/api/session/s1', method: 'DELETE' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ status: 'ok' });
    expect(calls).toEqual([
      'pod.snapshot:s1',
      'sdk.delete:s1',
      'instructionSync.forget:s1',
      'discovery.forget:s1',
      'trajectory.delete:s1',
    ]);
    // The already-registered session.delete twin (DELETE /api/sessions/:id) is
    // a different route with a different cleanup set — never intercepted here
    // (sessions-core attaches only session.deleteLegacy, not session.delete).
    const twin = registry.match('DELETE', '/api/sessions/s1')!;
    expect(twin.def.operationId).toBe('session.delete');
    expect(twin.def.handler).toBeUndefined();
  });

  it('deleteLegacy falls back to finalizeMissingSession when the pod snapshot throws', async () => {
    const { registry, calls } = setup({ snapshotThrows: true });
    const r = fakeRes();
    await handlerFor(registry, 'DELETE', '/api/session/s1')!(fakeReq({ url: '/api/session/s1', method: 'DELETE' }), r.res);
    expect(calls[0]).toBe('pod.finalize:s1');
    expect(calls).toContain('sdk.delete:s1');
    expect(JSON.parse(r.body)).toEqual({ status: 'ok' });
  });

  it('abort is 503 without a runtime, else forwards to runtime.session.abort', async () => {
    let { registry } = setup();
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/session/s1/abort')!(fakeReq({ url: '/api/session/s1/abort', method: 'POST' }), r.res);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toBe('LLM client not available');

    const aborted: string[] = [];
    registry = setup({ runtime: { session: { abort: async ({ sessionID }: any) => { aborted.push(sessionID); } } } }).registry;
    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/session/s1/abort')!(fakeReq({ url: '/api/session/s1/abort', method: 'POST' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
    expect(aborted).toEqual(['s1']);
  });

  it('background delegates to handleSessionBackground (capability gate + POST re-check intact)', async () => {
    const bg: string[] = [];
    const runtime = {
      access: { can: (c: string) => c === 'session.background' },
      session: { background: async ({ sessionID }: any) => { bg.push(sessionID); } },
    };
    const { registry } = setup({ runtime });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/session/s1/background')!(
      fakeReq({ url: '/api/session/s1/background', method: 'POST' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({});
    expect(bg).toEqual(['s1']);
  });

  it('background returns the neutral 503 when the runtime surface is unavailable', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/session/s1/background')!(
      fakeReq({ url: '/api/session/s1/background', method: 'POST' }), r.res,
    );
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toBe("runtime surface 'session.background' is not available");
  });

  it('background propagates the delegate false on a trailing-slash URL (no hung request)', async () => {
    // RouteRegistry.match() strips trailing slashes, so POST /api/session/s1/background/
    // reaches this handler while handleSessionBackground's own anchored regex returns
    // false. That false must reach dispatchAuthorized (only literal false falls back
    // to the legacy chain) and no response may be written here.
    const { registry } = setup({
      runtime: { access: { can: () => true }, session: { background: async () => { throw new Error('must not run'); } } },
    });
    const r = fakeRes();
    const handled = await handlerFor(registry, 'POST', '/api/session/s1/background/')!(
      fakeReq({ url: '/api/session/s1/background/', method: 'POST' }), r.res,
    );
    expect(handled).toBe(false);
    expect(r.ended).toBe(false);
  });

  it('promptAsync queue short-circuit: suspended sends enqueue instead of prompting', async () => {
    const { registry, calls } = setup({ holdSessions: ['s1'] });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/session/s1/promptAsync')!(
      fakeReq({
        url: '/api/session/s1/promptAsync',
        method: 'POST',
        body: JSON.stringify({ message: 'hi', expectReply: false, variant: 'v1' }),
      }),
      r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ status: 'ok', queued: true, itemId: 'q2', position: 2 });
    // expectReply comes from the second JSON.parse (double-parse quirk preserved).
    expect(calls).toEqual(['enqueue:s1:http:false']);
  });

  it('promptAsync rejects budget fields combined with queue delivery (400)', async () => {
    const { registry, calls } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/session/s1/promptAsync')!(
      fakeReq({
        url: '/api/session/s1/promptAsync',
        method: 'POST',
        body: JSON.stringify({ message: 'hi', delivery: 'queue', maxTurns: 3 }),
      }),
      r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toContain('cannot carry maxTurns/maxCostUsd');
    expect(calls).toEqual([]);
  });

  it('promptAsync attaches the budget guard BEFORE prompting and forwards delivery options', async () => {
    const { registry, calls } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/session/s1/promptAsync')!(
      fakeReq({
        url: '/api/session/s1/promptAsync',
        method: 'POST',
        body: JSON.stringify({ parts: [{ type: 'text', text: 'x' }], maxTurns: 4, idempotencyKey: 'k1', delivery: 'steer' }),
      }),
      r.res,
    );
    expect(r.status).toBe(200);
    expect(calls).toEqual(['budget:s1:4:-', 'sdk.promptAsync:s1:steer:k1:-']);
  });

  it('prompt: suspended is 409 before any body read / SDK call', async () => {
    const { registry, calls } = setup({ holdSessions: ['susp'] });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/session/susp/prompt')!(
      fakeReq({ url: '/api/session/susp/prompt', method: 'POST', body: JSON.stringify({ parts: [] }) }), r.res,
    );
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body).error).toBe('session is suspended; resume or discard the run first');
    expect(calls).toEqual([]);
  });

  it('prompt forwards parts/system/outputSchema/thinkingLevel/variant', async () => {
    const { registry, calls } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/session/s1/prompt')!(
      fakeReq({
        url: '/api/session/s1/prompt',
        method: 'POST',
        body: JSON.stringify({ parts: [{ type: 'text', text: 'a' }], thinkingLevel: 'high', variant: 'v2' }),
      }),
      r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
    expect(calls).toEqual(['sdk.prompt:s1:1:high:v2']);
  });

  it('promptAsync stamps the tui channel as a separate part', async () => {
    const { registry, prompted } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/session/s1/promptAsync')!(
      fakeReq({
        url: '/api/session/s1/promptAsync',
        method: 'POST',
        headers: { 'x-mafw-client': 'tui' },
        body: JSON.stringify({ message: 'hi' }),
      }),
      r.res,
    );
    expect(r.status).toBe(200);
    expect(prompted[0].message).toBe('hi');
    expect(prompted[0].parts).toHaveLength(1);
    expect(prompted[0].parts[0].text).toBe('<client-channel>终端</client-channel>');
  });

  it('prompt stamps the channel on the parts array', async () => {
    const { registry, promptedSync } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/session/s1/prompt')!(
      fakeReq({
        url: '/api/session/s1/prompt',
        method: 'POST',
        headers: { 'x-mafw-client': 'mobile' },
        body: JSON.stringify({ parts: [{ type: 'text', text: 'a' }] }),
      }),
      r.res,
    );
    expect(r.status).toBe(200);
    expect(promptedSync[0]).toHaveLength(2);
    expect(promptedSync[0][1].text).toBe('<client-channel>手机端</client-channel>');
  });

  it('queue list returns the queue snapshot', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/session/s1/queue')!(
      fakeReq({ url: '/api/session/s1/queue', method: 'GET' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).items).toHaveLength(1);
  });

  it('queue clear wipes the queue, emits queueUpdated(clear) and reports the count', async () => {
    const { registry, calls } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'DELETE', '/api/session/s1/queue')!(
      fakeReq({ url: '/api/session/s1/queue', method: 'DELETE' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ cleared: 1 });
    expect(calls).toEqual(['queue.clear:s1', 'emit:s1:clear']);
  });

  it('queue cancel: 404 on an unknown item, emit(queueUpdated:cancel) on success', async () => {
    const { registry, calls } = setup();
    let r = fakeRes();
    await handlerFor(registry, 'DELETE', '/api/session/s1/queue/q9')!(
      fakeReq({ url: '/api/session/s1/queue/q9', method: 'DELETE' }), r.res,
    );
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body).error).toBe('queue item not found: q9');
    expect(calls).toEqual(['queue.cancel:s1:q9']);

    r = fakeRes();
    await handlerFor(registry, 'DELETE', '/api/session/s1/queue/q1')!(
      fakeReq({ url: '/api/session/s1/queue/q1', method: 'DELETE' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ cancelled: 'q1' });
    expect(calls).toEqual(['queue.cancel:s1:q9', 'queue.cancel:s1:q1', 'emit:s1:cancel:q1']);
  });
});
