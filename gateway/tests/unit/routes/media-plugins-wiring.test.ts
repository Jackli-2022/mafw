// Phase D1 Task H1: GET /api/media/plugins + POST /api/media/plugins/reload —
// verbatim loader-state projection (file/name/status/error/modalities). The loader
// is created after boot, so both handlers go through a live getter; an
// uninitialised loader keeps the legacy `?.` semantics (empty list / no-op reload).
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachMediaPluginRoutes, type MediaPluginsRouteDeps } from '../../../src/routes/media-plugins';

function fakeReq(opts: { method: string; url: string }): IncomingMessage {
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
    for (const fn of listeners['data'] ?? []) fn('');
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
    setHeader: () => {},
  } as unknown as ServerResponse;
  return { res: out.res, get status() { return out.status; }, get body() { return out.body; }, get headers() { return out.headers; } } as any;
}

function setup(over: Partial<MediaPluginsRouteDeps> = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachMediaPluginRoutes(registry, { mediaPluginLoader: () => undefined, ...over });
  return registry;
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

const state = () => [
  { file: 'a.ts', name: 'a', status: 'ok', error: undefined, modalities: ['image'], extra: 'dropped' },
  { file: 'b.ts', name: 'b', status: 'error', error: 'bad name', modalities: [], extra: 'dropped' },
];

describe('media plugins registry wiring (D1 Task H1)', () => {
  it('binds both halves of the pair', () => {
    const registry = setup();
    expect(registry.match('GET', '/api/media/plugins')?.def.operationId).toBe('media.plugins');
    expect(registry.match('POST', '/api/media/plugins/reload')?.def.operationId).toBe('media.pluginsReload');
    expect(handlerFor(registry, 'GET', '/api/media/plugins')).toBeDefined();
    expect(handlerFor(registry, 'POST', '/api/media/plugins/reload')).toBeDefined();
  });

  it('media.plugins projects the five fields only', async () => {
    const registry = setup({ mediaPluginLoader: () => ({ getState: state, reload: async () => {} }) as any });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/media/plugins')!(fakeReq({ method: 'GET', url: '/api/media/plugins' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({
      plugins: [
        { file: 'a.ts', name: 'a', status: 'ok', modalities: ['image'] },
        { file: 'b.ts', name: 'b', status: 'error', error: 'bad name', modalities: [] },
      ],
    });
  });

  it('media.pluginsReload reloads then returns {ok:true, plugins}', async () => {
    const reload = jest.fn(async () => {});
    const registry = setup({ mediaPluginLoader: () => ({ getState: state, reload }) as any });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/media/plugins/reload')!(
      fakeReq({ method: 'POST', url: '/api/media/plugins/reload' }),
      r.res,
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(r.status).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.plugins).toHaveLength(2);
  });

  it('keeps the uninitialised-loader semantics (empty list / no-op reload)', async () => {
    const registry = setup();
    const rGet = fakeRes();
    await handlerFor(registry, 'GET', '/api/media/plugins')!(fakeReq({ method: 'GET', url: '/api/media/plugins' }), rGet.res);
    expect(JSON.parse(rGet.body)).toEqual({ plugins: [] });

    const rPost = fakeRes();
    await handlerFor(registry, 'POST', '/api/media/plugins/reload')!(
      fakeReq({ method: 'POST', url: '/api/media/plugins/reload' }),
      rPost.res,
    );
    expect(JSON.parse(rPost.body)).toEqual({ ok: true, plugins: [] });
  });
});
