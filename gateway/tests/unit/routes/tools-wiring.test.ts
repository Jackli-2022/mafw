// Phase D1 Task 3b: tools registry wiring (loopback-only parity).
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachToolsRoutes } from '../../../src/routes/tools';

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

function registryWithTools() {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachToolsRoutes(registry, {
    buildFactory: () => () => [],
    emitEvent: () => {},
  });
  return registry;
}

function handlerFor(registry: RouteRegistry, method: string, url: string) {
  return registry.match(method as never, url)?.def.handler;
}

describe('tools registry wiring (D1 Task 3b)', () => {
  it('catalog routes have handlers attached (no silent 404)', () => {
    const registry = registryWithTools();
    expect(handlerFor(registry, 'GET', '/api/tools')).toBeDefined();
    expect(handlerFor(registry, 'POST', '/api/tools/execute')).toBeDefined();
  });

  it('non-loopback list gets 403', async () => {
    const registry = registryWithTools();
    const handler = handlerFor(registry, 'GET', '/api/tools')!;
    const req = fakeReq({ url: '/api/tools', method: 'GET', remoteAddress: '203.0.113.9' });
    const r = fakeRes();
    await handler(req, r.res);
    expect(r.status).toBe(403);
    expect(r.body).toContain('forbidden');
  });

  it('loopback list returns the tool spec manifest', async () => {
    const registry = registryWithTools();
    const handler = handlerFor(registry, 'GET', '/api/tools')!;
    const req = fakeReq({ url: '/api/tools', method: 'GET' });
    const r = fakeRes();
    await handler(req, r.res);
    expect(r.status).toBe(200);
    const parsed = JSON.parse(r.body);
    expect(Array.isArray(parsed.tools)).toBe(true);
    expect(parsed.tools.length).toBeGreaterThan(0);
  });

  it('loopback execute with missing name → 400 (validation parity)', async () => {
    const registry = registryWithTools();
    const handler = handlerFor(registry, 'POST', '/api/tools/execute')!;
    const req = fakeReq({ url: '/api/tools/execute', method: 'POST', body: JSON.stringify({ sessionID: 's1' }) });
    const r = fakeRes();
    await handler(req, r.res);
    expect(r.status).toBe(400);
    expect(r.body).toContain('name is required');
  });
});
