// Phase D1 Task C2: chat registry wiring — /api/chat fire-and-forget promptAsync and
// /api/chat/enriched (its own inline enrichment copy; 409 hold-queue gate first).
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachChatRoutes } from '../../../src/routes/chat';

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

function fakeRes(): { res: ServerResponse; status: number; body: string } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

function setup(opts: { suspended?: string; promptError?: unknown; runtime?: boolean; memory?: any[] } = {}) {
  const created: any[] = [];
  const prompted: any[] = [];
  const merged: any[] = [];
  const runtime = {
    session: {
      create: async (input: any) => { created.push(input); return { id: 's-new' }; },
      promptAsync: async (input: any) => {
        prompted.push(input);
        if (opts.promptError) return { error: opts.promptError };
        return { response: { status: 200 } };
      },
    },
  } as any;
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachChatRoutes(registry, {
    registeredProjects: () => new Map([['p1', { projectDir: '/proj/p1' }]]),
    projectDir: () => '/proj/default',
    runtime: () => (opts.runtime === false ? null : runtime),
    shouldHoldQueue: (sid) => (opts.suspended === sid ? true : undefined),
    memoryService: () => ({
      mergedSearch: async (q: string, k: number) => { merged.push([q, k]); return opts.memory ?? []; },
    }) as any,
  });
  return { registry, created, prompted, merged };
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('chat registry wiring (D1 Task C2)', () => {
  it('both catalog routes have handlers attached (no silent 404)', () => {
    const { registry } = setup();
    expect(handlerFor(registry, 'POST', '/api/chat')).toBeDefined();
    expect(handlerFor(registry, 'POST', '/api/chat/enriched')).toBeDefined();
  });

  it('/api/chat creates a session in the first registered project and prompts', async () => {
    const { registry, created, prompted } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/chat')!(
      fakeReq({ url: '/api/chat', method: 'POST', body: JSON.stringify({ message: 'hi' }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ sessionID: 's-new' });
    expect(created[0]).toEqual({ directory: '/proj/p1' });
    expect(prompted[0].parts).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('/api/chat 400 without message, 503 without runtime, 500 on promptAsync error', async () => {
    let r = fakeRes();
    await handlerFor(setup().registry, 'POST', '/api/chat')!(
      fakeReq({ url: '/api/chat', method: 'POST', body: '{}' }), r.res,
    );
    expect(r.status).toBe(400);

    r = fakeRes();
    await handlerFor(setup({ runtime: false }).registry, 'POST', '/api/chat')!(
      fakeReq({ url: '/api/chat', method: 'POST', body: JSON.stringify({ message: 'hi' }) }), r.res,
    );
    expect(r.status).toBe(503);

    r = fakeRes();
    await handlerFor(setup({ promptError: { message: 'boom' } }).registry, 'POST', '/api/chat')!(
      fakeReq({ url: '/api/chat', method: 'POST', body: JSON.stringify({ message: 'hi' }) }), r.res,
    );
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body).error).toBe('promptAsync failed: boom');
  });

  it('enriched 409 before any session work when the run queue is held', async () => {
    const { registry, created, merged } = setup({ suspended: 's-live' });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/chat/enriched')!(
      fakeReq({ url: '/api/chat/enriched', method: 'POST', body: JSON.stringify({ message: 'hi', sessionID: 's-live' }) }), r.res,
    );
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body).error).toBe('session is suspended; resume or discard the run first');
    expect(created).toHaveLength(0);
    expect(merged).toHaveLength(0);
  });

  it('enriched injects memory context and reuses an existing sessionID', async () => {
    const { registry, created, prompted, merged } = setup({ memory: [{ source: 't1', type: 'fact', content: 'likes tea' }] });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/chat/enriched')!(
      fakeReq({
        url: '/api/chat/enriched',
        method: 'POST',
        body: JSON.stringify({ message: 'hi', sessionID: 's-live', parts: [{ type: 'file', url: 'f1' }], agent: 'builder', model: { providerID: 'p', modelID: 'm' } }),
      }),
      r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ sessionID: 's-live' });
    expect(created).toHaveLength(0);
    expect(merged[0]).toEqual(['hi', 5]);
    const parts = prompted[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe('text');
    expect(parts[0].text).toContain('likes tea');
    expect(parts[0].text.endsWith('\n\nhi')).toBe(true);
    expect(parts[1]).toEqual({ type: 'file', url: 'f1' });
    expect(prompted[0].agent).toBe('builder');
    expect(prompted[0].model).toEqual({ providerID: 'p', modelID: 'm' });
  });

  it('enriched with no memory hits sends the raw message and creates a session when needed', async () => {
    const { registry, created, prompted } = setup({ memory: [] });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/chat/enriched')!(
      fakeReq({ url: '/api/chat/enriched', method: 'POST', body: JSON.stringify({ message: 'hi' }) }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ sessionID: 's-new' });
    expect(created[0]).toEqual({ directory: '/proj/p1' });
    expect(prompted[0].parts).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('stamps the client channel from x-mafw-client', async () => {
    const { registry, prompted } = setup({ memory: [] });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/chat/enriched')!(
      fakeReq({
        url: '/api/chat/enriched', method: 'POST',
        headers: { 'x-mafw-client': 'mobile' },
        body: JSON.stringify({ message: 'hi' }),
      }),
      r.res,
    );
    const parts = prompted[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[1]).toMatchObject({ type: 'text', synthetic: true });
    expect(parts[1].text).toBe('<client-channel>手机端</client-channel>');
  });

  it('does not stamp twice when the reminder already carries the channel', async () => {
    const { registry, prompted } = setup({ memory: [] });
    const reminder = {
      type: 'text',
      text: '<latest-reminder>2026-11-18 周三 14:32 · 中文 · 渠道：桌面端</latest-reminder>',
      synthetic: true,
    };
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/chat/enriched')!(
      fakeReq({
        url: '/api/chat/enriched', method: 'POST',
        headers: { 'x-mafw-client': 'desktop' },
        body: JSON.stringify({ message: 'hi', parts: [reminder] }),
      }),
      r.res,
    );
    const parts = prompted[0].parts;
    expect(parts).toHaveLength(2);
    expect(JSON.stringify(parts)).not.toContain('<client-channel>');
  });

  it('leaves a client without a channel header unstamped', async () => {
    const { registry, prompted } = setup({ memory: [] });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/chat/enriched')!(
      fakeReq({ url: '/api/chat/enriched', method: 'POST', body: JSON.stringify({ message: 'hi' }) }), r.res,
    );
    expect(prompted[0].parts).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('enriched accepts parts-only bodies and 400s when both are missing', async () => {
    const { registry, prompted } = setup({ memory: [] });
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/chat/enriched')!(
      fakeReq({ url: '/api/chat/enriched', method: 'POST', body: JSON.stringify({ parts: [{ type: 'file', url: 'f2' }] }) }), r.res,
    );
    expect(r.status).toBe(200);
    // message is undefined → falsy enrichedMessage → only the extra part rides along.
    expect(prompted[0].parts).toEqual([{ type: 'file', url: 'f2' }]);

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/chat/enriched')!(
      fakeReq({ url: '/api/chat/enriched', method: 'POST', body: '{}' }), r.res,
    );
    expect(r.status).toBe(400);
  });
});
