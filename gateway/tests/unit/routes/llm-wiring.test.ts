// Phase D1 Task H1: POST /api/llm/compress — the legacy inline branch bridged to
// MafwScheduler.handleCompress. This pins the bridge signature, the 200 pass-through
// with no Content-Type header (legacy quirk), and the single 400 catch arm.
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachLlmRoutes, type LlmRouteDeps } from '../../../src/routes/llm';

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
    setHeader: (key: string, value: unknown) => { out.headers[key] = value; },
  } as unknown as ServerResponse;
  return { res: out.res, get status() { return out.status; }, get body() { return out.body; }, get headers() { return out.headers; } } as any;
}

function setup(over: Partial<LlmRouteDeps> = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  const deps: LlmRouteDeps = { compress: async () => ({ narrative: 'ok' }), ...over };
  attachLlmRoutes(registry, deps);
  return { registry, deps };
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('llm/compress registry wiring (D1 Task H1)', () => {
  it('binds llm.compress', () => {
    const { registry } = setup();
    expect(registry.match('POST', '/api/llm/compress')?.def.operationId).toBe('llm.compress');
    expect(handlerFor(registry, 'POST', '/api/llm/compress')).toBeDefined();
  });

  it('bridges observations + optional model to the compress dep and passes the result through', async () => {
    const compress = jest.fn(async () => ({ narrative: 'n', facts: ['f'], concepts: ['c'], energy: 0.5 }));
    const { registry } = setup({ compress });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/llm/compress')!(
      fakeReq({ method: 'POST', url: '/api/llm/compress', body: JSON.stringify({ observations: ['a', 'b'], model: 'gpt-x' }) }),
      r.res,
    );
    expect(compress).toHaveBeenCalledWith(['a', 'b'], 'gpt-x');
    expect(r.status).toBe(200);
    expect(r.headers['Content-Type']).toBeUndefined();
    expect(JSON.parse(r.body)).toEqual({ narrative: 'n', facts: ['f'], concepts: ['c'], energy: 0.5 });
  });

  it('keeps the 400 arm for a missing/!array observations field (legacy throw)', async () => {
    const compress = jest.fn();
    const { registry } = setup({ compress });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/llm/compress')!(
      fakeReq({ method: 'POST', url: '/api/llm/compress', body: JSON.stringify({ observations: 'nope' }) }),
      r.res,
    );
    expect(compress).not.toHaveBeenCalled();
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ error: 'observations array required' });
  });

  it('keeps the 400 arm for malformed JSON', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/llm/compress')!(
      fakeReq({ method: 'POST', url: '/api/llm/compress', body: '<xml/>' }),
      r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBeTruthy();
  });
});
