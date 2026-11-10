// Phase D1 Task A3: /api/merge-memory registry wiring — validation runs before the
// lazy MCP-handler import (so a bad request never drags the MCP graph in).
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachMergeMemoryRoutes } from '../../../src/routes/merge-memory';

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

function fakeRes(): { res: ServerResponse; status: number; body: string } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

function registryWithMerge() {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachMergeMemoryRoutes(registry, { memory: () => ({}) });
  return registry;
}

describe('merge-memory registry wiring (D1 Task A3)', () => {
  it('catalog route has a handler attached (no silent 404)', () => {
    const registry = registryWithMerge();
    expect(registry.match('POST' as never, '/api/merge-memory')?.def.handler).toBeDefined();
  });

  it('missing sourceWorktree → 400 { ok:false } without importing the MCP handler', async () => {
    const registry = registryWithMerge();
    const handler = registry.match('POST' as never, '/api/merge-memory')!.def.handler!;
    const r = fakeRes();
    await handler(fakeReq({ method: 'POST', url: '/api/merge-memory', body: JSON.stringify({}) }), r.res);
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ ok: false, error: 'sourceWorktree is required' });
  });

  it('invalid JSON → 500 { ok:false } (wrapper try/catch parity)', async () => {
    const registry = registryWithMerge();
    const handler = registry.match('POST' as never, '/api/merge-memory')!.def.handler!;
    const r = fakeRes();
    await handler(fakeReq({ method: 'POST', url: '/api/merge-memory', body: '{' }), r.res);
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body).ok).toBe(false);
  });
});
