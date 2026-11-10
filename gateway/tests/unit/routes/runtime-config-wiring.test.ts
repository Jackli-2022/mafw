// Phase D3 Task 2: GET/PATCH /api/runtime-config — the last inline legacy branch
// migrated to the RouteRegistry (catalog phantom entries `runtime.config.get` /
// `runtime.config.update` finally get handlers).
//
// The bodies moved verbatim from index.ts, so the envelopes/statuses/log lines
// pinned here are the legacy contract, not new design:
//   - GET  → `{ config }` (runtimeHost.config.get() ?? {});
//   - PATCH→ `{ status: 'ok', config: result ?? null }` (native merge semantics);
//   - no runtime at all → 503 `{ error: 'LLM client not available' }`;
//   - capGuard first (provider.config / provider.config.update) → neutral 503;
//   - any throw → 500 `{ error: message }` + the `[OpenCodeConfig] …` log line.
// Query strings are stripped by RouteRegistry.match (same tolerance as the old
// `^/api/runtime-config(?:\?|$)` regex); the deleted alias `/api/opencode-config`
// no longer matches anything.
import type { IncomingMessage, ServerResponse } from 'http';
import { log } from '../../../src/core/utils/logger';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachRuntimeConfigRoutes, type RuntimeConfigRouteDeps } from '../../../src/routes/runtime-config';

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

function setup(overrides: Partial<RuntimeConfigRouteDeps> = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  const deps: RuntimeConfigRouteDeps = {
    capGuard: () => false,
    runtime: () => ({ access: { can: () => true } }),
    runtimeHost: () => ({ config: { get: async () => ({}), update: async () => null } } as any),
    ...overrides,
  };
  attachRuntimeConfigRoutes(registry, deps);
  return { registry, deps };
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('runtime-config registry wiring (D3 Task 2)', () => {
  it('binds the phantom catalog entries instead of throwing on unknown operationIds', () => {
    const { registry } = setup();
    expect(registry.match('GET', '/api/runtime-config')?.def.operationId).toBe('runtime.config.get');
    expect(registry.match('PATCH', '/api/runtime-config')?.def.operationId).toBe('runtime.config.update');
    expect(handlerFor(registry, 'GET', '/api/runtime-config')).toBeDefined();
    expect(handlerFor(registry, 'PATCH', '/api/runtime-config')).toBeDefined();
  });

  it('keeps query-string tolerance and drops the deleted legacy alias', () => {
    const { registry } = setup();
    expect(registry.match('GET', '/api/runtime-config?projectDir=x')?.def.operationId).toBe('runtime.config.get');
    expect(registry.match('PATCH', '/api/runtime-config?x=1')?.def.operationId).toBe('runtime.config.update');
    expect(registry.match('GET', '/api/opencode-config')).toBeNull();
    expect(registry.match('POST', '/api/runtime-config')).toBeNull();
  });

  it('GET returns the `{ config }` envelope from runtimeHost.config.get()', async () => {
    const { registry } = setup({
      runtimeHost: () => ({ config: { get: async () => ({ theme: 'dark' }) } } as any),
    });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/runtime-config')!(fakeReq({ method: 'GET', url: '/api/runtime-config' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ config: { theme: 'dark' } });
  });

  it('GET falls back to `{ config: {} }` when runtimeHost is absent', async () => {
    const { registry } = setup({ runtimeHost: () => null });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/runtime-config')!(fakeReq({ method: 'GET', url: '/api/runtime-config' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ config: {} });
  });

  it('no runtime → 503 `LLM client not available` (both verbs)', async () => {
    const { registry } = setup({ runtime: () => null });
    for (const method of ['GET', 'PATCH']) {
      const r = fakeRes();
      await handlerFor(registry, method, '/api/runtime-config')!(
        fakeReq({ method, url: '/api/runtime-config', body: '{}' }),
        r.res,
      );
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body)).toEqual({ error: 'LLM client not available' });
    }
  });

  it('gates each verb on its own surface before touching the config', async () => {
    const seen: string[] = [];
    const getCalls = jest.fn(async () => ({}));
    const { registry } = setup({
      capGuard: (res, surface) => {
        seen.push(surface);
        res.writeHead(503);
        res.end(JSON.stringify({ error: `runtime surface '${surface}' is not available` }));
        return true;
      },
      runtimeHost: () => ({ config: { get: getCalls, update: jest.fn() } } as any),
    });
    for (const method of ['GET', 'PATCH']) {
      const r = fakeRes();
      await handlerFor(registry, method, '/api/runtime-config')!(
        fakeReq({ method, url: '/api/runtime-config', body: '{}' }),
        r.res,
      );
      expect(r.status).toBe(503);
    }
    expect(seen).toEqual(['provider.config', 'provider.config.update']);
    expect(getCalls).not.toHaveBeenCalled();
  });

  it('PATCH parses the body, merges natively and returns `{ status, config }`', async () => {
    const update = jest.fn(async (patch: unknown) => ({ merged: patch }));
    const { registry } = setup({ runtimeHost: () => ({ config: { get: async () => ({}), update } } as any) });
    const r = fakeRes();
    await handlerFor(registry, 'PATCH', '/api/runtime-config')!(
      fakeReq({ method: 'PATCH', url: '/api/runtime-config', body: '{"model":{"id":"m1"}}' }),
      r.res,
    );
    expect(update).toHaveBeenCalledWith({ model: { id: 'm1' } });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ status: 'ok', config: { merged: { model: { id: 'm1' } } } });
  });

  it('PATCH normalises a null update result to `config: null`', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'PATCH', '/api/runtime-config')!(
      fakeReq({ method: 'PATCH', url: '/api/runtime-config', body: '{}' }),
      r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ status: 'ok', config: null });
  });

  it('bad JSON and adapter failures keep the legacy 500 + log line', async () => {
    const errorSpy = jest.spyOn(log, 'error').mockImplementation(() => undefined as any);
    try {
      const { registry } = setup();
      const badJson = fakeRes();
      await handlerFor(registry, 'PATCH', '/api/runtime-config')!(
        fakeReq({ method: 'PATCH', url: '/api/runtime-config', body: '{not json' }),
        badJson.res,
      );
      expect(badJson.status).toBe(500);
      expect(JSON.parse(badJson.body).error).toBeTruthy();
      expect(errorSpy).toHaveBeenCalledWith('[OpenCodeConfig] update error:', expect.any(String));

      errorSpy.mockClear();
      const getFails = setup({
        runtimeHost: () => ({ config: { get: async () => { throw new Error('boom'); } } } as any),
      });
      const getRes = fakeRes();
      await handlerFor(getFails.registry, 'GET', '/api/runtime-config')!(
        fakeReq({ method: 'GET', url: '/api/runtime-config' }),
        getRes.res,
      );
      expect(getRes.status).toBe(500);
      expect(JSON.parse(getRes.body)).toEqual({ error: 'boom' });
      expect(errorSpy).toHaveBeenCalledWith('[OpenCodeConfig] get error:', 'boom');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('reads runtime/runtimeHost through live getters (adopt-after-attach)', async () => {
    let runtime: any = { access: { can: () => true } };
    let host: any = { config: { get: async () => ({ version: 1 }) } };
    const { registry } = setup({ runtime: () => runtime, runtimeHost: () => host });
    const first = fakeRes();
    await handlerFor(registry, 'GET', '/api/runtime-config')!(fakeReq({ method: 'GET', url: '/api/runtime-config' }), first.res);
    expect(JSON.parse(first.body)).toEqual({ config: { version: 1 } });

    host = { config: { get: async () => ({ version: 2 }) } };
    const second = fakeRes();
    await handlerFor(registry, 'GET', '/api/runtime-config')!(fakeReq({ method: 'GET', url: '/api/runtime-config' }), second.res);
    expect(JSON.parse(second.body)).toEqual({ config: { version: 2 } });

    runtime = null;
    const third = fakeRes();
    await handlerFor(registry, 'GET', '/api/runtime-config')!(fakeReq({ method: 'GET', url: '/api/runtime-config' }), third.res);
    expect(third.status).toBe(503);
  });
});
