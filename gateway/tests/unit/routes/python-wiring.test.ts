// Phase D1 Task 3a: python kernel registry wiring (loopback-only parity).
// Same no-silent-404 assertion pattern as cognition-wiring.test.ts.
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachPythonRoutes } from '../../../src/routes/python';

function fakeReq(opts: { url: string; method: string; remoteAddress?: string; body?: string }): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: opts.remoteAddress ?? '127.0.0.1' },
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
  const out = { res: null as unknown as ServerResponse, status: 0, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

function makeKernels() {
  const kernels = new Map<string, { execute: (code: string) => Promise<unknown>; restart: () => Promise<void> }>();
  return {
    get: (sid: string) => kernels.get(sid) ?? {
      execute: async (code: string) => ({ stdout: `ran:${code}`, stderr: '', result: null }),
      restart: async () => {},
    },
    restart: async (sid: string) => { kernels.delete(sid); },
    status: (sid: string) => ({ running: true, sessionID: sid }),
  };
}

function registryWithPython() {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachPythonRoutes(registry, { kernels: () => makeKernels() });
  return registry;
}

function handlerFor(registry: RouteRegistry, method: string, url: string) {
  return registry.match(method as never, url)?.def.handler;
}

describe('python registry wiring (D1 Task 3a)', () => {
  it('catalog routes have handlers attached (no silent 404)', () => {
    const registry = registryWithPython();
    expect(handlerFor(registry, 'POST', '/api/python/execute')).toBeDefined();
    expect(handlerFor(registry, 'POST', '/api/python/restart')).toBeDefined();
    expect(handlerFor(registry, 'GET', '/api/python/status')).toBeDefined();
  });

  it('non-loopback execute gets 403', async () => {
    const registry = registryWithPython();
    const handler = handlerFor(registry, 'POST', '/api/python/execute')!;
    const req = fakeReq({ url: '/api/python/execute', method: 'POST', remoteAddress: '10.1.2.3', body: '{}' });
    const r = fakeRes();
    await handler(req, r.res);
    expect(r.status).toBe(403);
    expect(r.body).toContain('forbidden');
  });

  it('kernels missing → 503; loopback execute delegates to the kernel', async () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachPythonRoutes(registry, { kernels: () => null });
    const handler = handlerFor(registry, 'POST', '/api/python/execute')!;
    const req = fakeReq({ url: '/api/python/execute', method: 'POST', body: JSON.stringify({ sessionID: 's1', code: '1+1' }) });
    let r = fakeRes();
    await handler(req, r.res);
    expect(r.status).toBe(503);
    expect(r.body).toContain('PyKernel not initialized');

    // With kernels present: delegation works.
    const registry2 = registryWithPython();
    const handler2 = handlerFor(registry2, 'POST', '/api/python/execute')!;
    const req2 = fakeReq({ url: '/api/python/execute', method: 'POST', body: JSON.stringify({ sessionID: 's1', code: '1+1' }) });
    r = fakeRes();
    await handler2(req2, r.res);
    expect(r.status).toBe(200);
    expect(r.body).toContain('ran:1+1');
  });

  it('missing sessionID → 400 (validation parity)', async () => {
    const registry = registryWithPython();
    const handler = handlerFor(registry, 'POST', '/api/python/execute')!;
    const req = fakeReq({ url: '/api/python/execute', method: 'POST', body: JSON.stringify({ code: 'x' }) });
    const r = fakeRes();
    await handler(req, r.res);
    expect(r.status).toBe(400);
    expect(r.body).toContain('sessionID and code are required');
  });
});
