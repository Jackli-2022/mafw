// Phase D1 Task H1: GET/PUT /api/config — method split on the same path, PUT
// persistence path + hot-reload + restartRequired report. No deps: both bodies
// read the module-level config singleton (same object the old index.ts branch did).
import type { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { config } from '../../../src/config';
import { log } from '../../../src/core/utils/logger';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachConfigRoutes } from '../../../src/routes/config';

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

function setup() {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachConfigRoutes(registry);
  return registry;
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('config registry wiring (D1 Task H1)', () => {
  it('binds GET and PUT on the same catalog path to config.get / config.set', () => {
    const registry = setup();
    expect(registry.match('GET', '/api/config')?.def.operationId).toBe('config.get');
    expect(registry.match('PUT', '/api/config')?.def.operationId).toBe('config.set');
    expect(handlerFor(registry, 'GET', '/api/config')).toBeDefined();
    expect(handlerFor(registry, 'PUT', '/api/config')).toBeDefined();
  });

  it('config.get returns config.raw verbatim as JSON (no writeHead)', async () => {
    const registry = setup();
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/config')!(fakeReq({ method: 'GET', url: '/api/config' }), r.res);
    expect(r.headers['Content-Type']).toBe('application/json');
    expect(r.body).toBe(JSON.stringify(config.raw));
  });

  it('config.set dumps overrides to <data-root>/config.yaml then hot-reloads', async () => {
    const registry = setup();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-config-'));
    const resolvePath = jest.spyOn(config, 'resolvePath').mockReturnValue(dir);
    const reload = jest.spyOn(config, 'reload').mockReturnValue({ changed: ['server'], restartRequired: ['server.apiPort'] });
    const warnSpy = jest.spyOn(log, 'warn').mockImplementation(() => undefined as any);
    try {
      const overrides = { server: { apiPort: 3999 }, nested: { list: [1, 2] } };
      const r = fakeRes();
      await handlerFor(registry, 'PUT', '/api/config')!(
        fakeReq({ method: 'PUT', url: '/api/config', body: JSON.stringify(overrides) }),
        r.res,
      );
      expect(resolvePath).toHaveBeenCalled();
      expect(reload).toHaveBeenCalled();
      const written = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf-8');
      expect(yaml.load(written)).toEqual(overrides);
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ success: true, restartRequired: ['server.apiPort'] });
      expect(warnSpy).toHaveBeenCalledWith('[Config] PUT saved, restart required for: server.apiPort');
    } finally {
      resolvePath.mockRestore();
      reload.mockRestore();
      warnSpy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('config.set omits the restart warning when nothing is required', async () => {
    const registry = setup();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-config-'));
    const resolvePath = jest.spyOn(config, 'resolvePath').mockReturnValue(dir);
    const reload = jest.spyOn(config, 'reload').mockReturnValue({ changed: [], restartRequired: [] });
    const warnSpy = jest.spyOn(log, 'warn').mockImplementation(() => undefined as any);
    try {
      const r = fakeRes();
      await handlerFor(registry, 'PUT', '/api/config')!(
        fakeReq({ method: 'PUT', url: '/api/config', body: JSON.stringify({ a: 1 }) }),
        r.res,
      );
      expect(JSON.parse(r.body)).toEqual({ success: true, restartRequired: [] });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      resolvePath.mockRestore();
      reload.mockRestore();
      warnSpy.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('config.set keeps the 400 arm (bad JSON) and logs verbatim', async () => {
    const registry = setup();
    const errorSpy = jest.spyOn(log, 'error').mockImplementation(() => undefined as any);
    try {
      const r = fakeRes();
      await handlerFor(registry, 'PUT', '/api/config')!(
        fakeReq({ method: 'PUT', url: '/api/config', body: '{not json' }),
        r.res,
      );
      expect(r.status).toBe(400);
      expect(JSON.parse(r.body).error).toBeTruthy();
      expect(errorSpy).toHaveBeenCalledWith('[Config] PUT error:', expect.any(String));
    } finally {
      errorSpy.mockRestore();
    }
  });
});
