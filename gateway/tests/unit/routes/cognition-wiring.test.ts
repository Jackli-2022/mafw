// Phase D1 Task 2: cognition registry wiring. The catalog declares the three
// cognition routes (shadow entries); attachCognitionRoutes hangs the handlers.
// A leaky attach would silently 404 the route (background-jobs precedent), so
// the wiring is asserted here: loopback guard parity + handler delegation.
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachCognitionRoutes } from '../../../src/routes/cognition';

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
  // Deliver the body synchronously after the handler subscribes.
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

const gate = {
  gateToolCall: () => ({ decision: 'allow' }),
  gatePrompt: () => ({ decision: 'allow' }),
  applyToolResultRedact: (_s: string, _t: string, content: unknown[]) => content,
};

function registryWithCognition(): RouteRegistry {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachCognitionRoutes(registry, { gate: () => gate });
  return registry;
}

function handlerFor(registry: RouteRegistry, method: string, url: string) {
  const matched = registry.match(method as never, url);
  return matched?.def.handler;
}

describe('cognition registry wiring (D1 Task 2)', () => {
  it('the catalog routes have handlers attached (no silent 404)', () => {
    const registry = registryWithCognition();
    expect(handlerFor(registry, 'POST', '/api/cognition/gate')).toBeDefined();
    expect(handlerFor(registry, 'POST', '/api/cognition/rewrite')).toBeDefined();
    expect(handlerFor(registry, 'GET', '/api/cognition/rules')).toBeDefined();
  });

  it('non-loopback requests get 403 exactly like the legacy branch', async () => {
    const registry = registryWithCognition();
    const handler = handlerFor(registry, 'POST', '/api/cognition/gate')!;
    const req = fakeReq({ url: '/api/cognition/gate', method: 'POST', remoteAddress: '203.0.113.5', body: '{}' });
    const r = fakeRes();
    await handler(req, r.res);
    expect(r.status).toBe(403);
    expect(r.body).toContain('forbidden');
  });

  it('loopback gate POST delegates to the cognition handler', async () => {
    const registry = registryWithCognition();
    const handler = handlerFor(registry, 'POST', '/api/cognition/gate')!;
    const req = fakeReq({
      url: '/api/cognition/gate', method: 'POST',
      body: JSON.stringify({ sessionID: 's1', kind: 'prompt', text: 'hi' }),
    });
    const r = fakeRes();
    await handler(req, r.res);
    expect(r.status).toBe(200);
    expect(r.body).toContain('allow');
  });

  it('loopback rules GET returns the validated rule list', async () => {
    const registry = registryWithCognition();
    const handler = handlerFor(registry, 'GET', '/api/cognition/rules')!;
    const req = fakeReq({ url: '/api/cognition/rules', method: 'GET' });
    const r = fakeRes();
    await handler(req, r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toHaveProperty('rules');
    expect(JSON.parse(r.body)).toHaveProperty('errors');
  });
});
