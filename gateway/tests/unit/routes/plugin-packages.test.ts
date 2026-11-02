/**
 * Task 6 — unified plugin package REST routes.
 *
 * Handler-level tests: a real HTTP server maps the six package endpoints plus
 * the legacy Hub toggle endpoints so status codes and JSON bodies are asserted
 * through the wire (matching the existing plugins-routes test style).
 */
import * as http from 'http';
import { PackageManagerError } from '../../../src/plugins/package-manager';
import { PluginActionError } from '../../../src/plugins/plugin-actions';
import {
  handlePluginClient,
  handlePluginPackageInstall,
  handlePluginPackageCheck,
  handlePluginApply,
  handlePluginReload,
  handlePluginInvokeAction,
  type PluginPackagesRouteDeps,
} from '../../../src/routes/plugin-packages';
import {
  handlePluginsEnable,
  handlePluginsDisable,
  handlePluginsDelete,
  handlePluginsList,
  type PluginsRouteDeps,
} from '../../../src/routes/plugins';

function request(
  server: http.Server,
  method: string,
  p: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: p,
      method,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        : undefined,
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode!, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function createPackageServer(deps: PluginPackagesRouteDeps): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url?.match(/^\/api\/plugins\/client(?:\?|$)/)) {
      await handlePluginClient(req, res, deps); return;
    }
    if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/packages\/install(?:\?|$)/)) {
      await handlePluginPackageInstall(req, res, deps); return;
    }
    if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/check(?:\?|$)/)) {
      await handlePluginPackageCheck(req, res, deps); return;
    }
    const apply = req.url?.match(/^\/api\/plugins\/([^/]+)\/apply(?:\?|$)/);
    if (req.method === 'POST' && apply) {
      await handlePluginApply(req, res, deps, { name: decodeURIComponent(apply[1]) }); return;
    }
    const reload = req.url?.match(/^\/api\/plugins\/([^/]+)\/reload(?:\?|$)/);
    if (req.method === 'POST' && reload) {
      await handlePluginReload(req, res, deps, { name: decodeURIComponent(reload[1]) }); return;
    }
    const action = req.url?.match(/^\/api\/plugins\/([^/]+)\/actions\/([^/?]+)(?:\?|$)/);
    if (req.method === 'POST' && action) {
      await handlePluginInvokeAction(req, res, deps, {
        name: decodeURIComponent(action[1]),
        action: decodeURIComponent(action[2]),
      });
      return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  });
}

function createHubServer(deps: PluginsRouteDeps): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url?.match(/^\/api\/plugins(?:\?|$)/)) {
      await handlePluginsList(req, res, deps); return;
    }
    if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/enable(?:\?|$)/)) {
      await handlePluginsEnable(req, res, deps); return;
    }
    if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/disable(?:\?|$)/)) {
      await handlePluginsDisable(req, res, deps); return;
    }
    if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/delete(?:\?|$)/)) {
      await handlePluginsDelete(req, res, deps); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  });
}

function makeManager() {
  return {
    installFromPath: jest.fn(async () => ({
      name: 'acme', version: '1.0.0', activeRevision: 'boot:1', saved: true, application: 'applied',
    })),
    checkPath: jest.fn(async () => ({ ok: true, name: 'acme', version: '1.0.0', contributions: ['ui', 'actions'] })),
    applyPending: jest.fn(async (name: string) => ({
      name, version: '1.0.0', activeRevision: 'boot:3', saved: true, enabled: true, application: 'applied',
    })),
    reload: jest.fn(async (name: string) => ({
      name, version: '1.0.0', activeRevision: 'boot:2', saved: true, enabled: true, application: 'applied',
    })),
    enable: jest.fn(async (name: string) => ({
      name, version: '1.0.0', activeRevision: 'boot:2', saved: true, enabled: true, application: 'applied',
    })),
    disable: jest.fn(async (name: string) => ({
      name, version: '1.0.0', activeRevision: 'boot:2', saved: true, enabled: false, application: 'applied',
    })),
    remove: jest.fn(async (name: string) => ({
      name, version: '1.0.0', saved: true, enabled: false, application: 'applied',
    })),
  };
}

const SNAPSHOT = {
  revision: 'boot:2',
  plugins: [
    {
      name: 'acme', version: '1.0.0', revision: 'boot:2',
      ui: { panels: [{ id: 'main', title: 'Acme', viewAction: 'load' }] },
      actions: [{ name: 'load', title: 'Load' }],
      events: [{ type: 'plugin:acme:tick' }],
    },
  ],
};

function makeDeps(manager = makeManager(), invokeAction?: jest.Mock): PluginPackagesRouteDeps {
  return {
    manager: () => manager as any,
    snapshot: () => SNAPSHOT as any,
    invokeAction: invokeAction as any,
  };
}

describe('plugin package routes', () => {
  let server: http.Server;

  afterEach((done) => {
    if (!server) { done(); return; }
    server.close(() => { server = undefined as any; done(); });
  });

  async function listen(deps: PluginPackagesRouteDeps): Promise<void> {
    server = createPackageServer(deps);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  }

  test('GET /api/plugins/client returns the committed snapshot', async () => {
    await listen(makeDeps());
    const res = await request(server, 'GET', '/api/plugins/client');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SNAPSHOT);
  });

  test('POST /api/plugins/packages/install forwards path/overwrite/requestId', async () => {
    const manager = makeManager();
    await listen(makeDeps(manager));
    const res = await request(server, 'POST', '/api/plugins/packages/install', {
      path: 'C:\\tmp\\acme', overwrite: true, requestId: 'req-1',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ name: 'acme', application: 'applied' }));
    expect(manager.installFromPath).toHaveBeenCalledWith({
      path: 'C:\\tmp\\acme', overwrite: true, requestId: 'req-1',
    });
  });

  test('POST /api/plugins/packages/install maps PackageManagerError.status', async () => {
    const manager = makeManager();
    manager.installFromPath.mockRejectedValue(new PackageManagerError(409, 'package already installed: acme'));
    await listen(makeDeps(manager));
    const res = await request(server, 'POST', '/api/plugins/packages/install', { path: 'C:\\tmp\\acme' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('package already installed: acme');
  });

  test('install rejects malformed JSON and malformed bodies with 400', async () => {
    await listen(makeDeps());
    const addr = server.address() as { port: number };
    const malformed: number = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: addr.port, path: '/api/plugins/packages/install', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': 7 },
      }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
      req.on('error', reject);
      req.end('{broken');
    });
    expect(malformed).toBe(400);
    const res = await request(server, 'POST', '/api/plugins/packages/install', { overwrite: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/overwrite/);
  });

  test('POST /api/plugins/check returns ok:false diagnostics as a 200 response', async () => {
    const manager = makeManager();
    manager.checkPath.mockResolvedValue({ ok: false, name: 'acme', error: 'invalid contributions: x' } as any);
    await listen(makeDeps(manager));
    const res = await request(server, 'POST', '/api/plugins/check', { path: 'C:\\tmp\\acme' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: false, name: 'acme', error: 'invalid contributions: x' });
  });

  test('POST /api/plugins/:name/apply applies the pending revision', async () => {
    const manager = makeManager();
    await listen(makeDeps(manager));
    const res = await request(server, 'POST', '/api/plugins/acme/apply');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ name: 'acme', activeRevision: 'boot:3' }));
    expect(manager.applyPending).toHaveBeenCalledWith('acme');
  });

  test('POST /api/plugins/:name/apply maps missing package to 404', async () => {
    const manager = makeManager();
    manager.applyPending.mockRejectedValue(new PackageManagerError(404, 'package not found: nope'));
    await listen(makeDeps(manager));
    const res = await request(server, 'POST', '/api/plugins/nope/apply');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('package not found: nope');
  });

  test('POST /api/plugins/:name/reload reports the refreshed revision', async () => {
    const manager = makeManager();
    await listen(makeDeps(manager));
    const res = await request(server, 'POST', '/api/plugins/acme/reload');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ name: 'acme', activeRevision: 'boot:2' }));
    expect(manager.reload).toHaveBeenCalledWith('acme');
  });

  test('POST /api/plugins/:name/actions/:action returns output with package/revision', async () => {
    const invoke = jest.fn(async () => ({ title: 'Acme' }));
    await listen(makeDeps(makeManager(), invoke));
    const res = await request(server, 'POST', '/api/plugins/acme/actions/load', {
      input: { id: 1 }, sessionID: 's1', revision: 'boot:2',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ package: 'acme', action: 'load', revision: 'boot:2', output: { title: 'Acme' } });
    expect(invoke).toHaveBeenCalledWith('acme', 'load', { id: 1 }, {
      sessionID: 's1', revision: 'boot:2',
    });
  });

  test('stale action revision maps PluginActionError.status (409)', async () => {
    const invoke = jest.fn(async () => {
      throw new PluginActionError('stale-revision', 'plugin action "acme:load" belongs to a superseded revision');
    });
    await listen(makeDeps(makeManager(), invoke));
    const res = await request(server, 'POST', '/api/plugins/acme/actions/load', {
      input: {}, revision: 'boot:1',
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'plugin action "acme:load" belongs to a superseded revision',
      code: 'stale-revision',
    });
  });

  test('unknown action maps 404 and invalid action body maps 400', async () => {
    const invoke = jest.fn(async () => {
      throw new PluginActionError('unknown-action', 'unknown plugin action "acme:nope"');
    });
    await listen(makeDeps(makeManager(), invoke));
    const missing = await request(server, 'POST', '/api/plugins/acme/actions/nope', { input: {} });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('unknown-action');
    const bad = await request(server, 'POST', '/api/plugins/acme/actions/load', { sessionID: 5 });
    expect(bad.status).toBe(400);
  });

  test('package routes report 503 when the manager is unavailable', async () => {
    await listen({ manager: () => undefined, snapshot: () => SNAPSHOT as any });
    const install = await request(server, 'POST', '/api/plugins/packages/install', { path: 'C:\\tmp\\acme' });
    expect(install.status).toBe(503);
    const check = await request(server, 'POST', '/api/plugins/check', { path: 'C:\\tmp\\acme' });
    expect(check.status).toBe(503);
    const apply = await request(server, 'POST', '/api/plugins/acme/apply');
    expect(apply.status).toBe(503);
  });
});

describe('plugin hub routes — package mode', () => {
  let server: http.Server;

  afterEach((done) => {
    if (!server) { done(); return; }
    server.close(() => { server = undefined as any; done(); });
  });

  function makeDeps(manager = makeManager()): PluginsRouteDeps {
    return {
      hub: { dirs: {} as any } as any,
      getManager: () => manager as any,
    };
  }

  async function listen(deps: PluginsRouteDeps): Promise<void> {
    server = createHubServer(deps);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  }

  test('enable/disable/delete accept {package} and call the manager', async () => {
    const manager = makeManager();
    await listen(makeDeps(manager));
    const enable = await request(server, 'POST', '/api/plugins/enable', { package: 'acme' });
    expect(enable.status).toBe(200);
    expect(enable.body.enabled).toBe(true);
    expect(manager.enable).toHaveBeenCalledWith('acme');

    const disable = await request(server, 'POST', '/api/plugins/disable', { package: 'acme' });
    expect(disable.status).toBe(200);
    expect(disable.body.enabled).toBe(false);
    expect(manager.disable).toHaveBeenCalledWith('acme');

    const remove = await request(server, 'POST', '/api/plugins/delete', { package: 'acme' });
    expect(remove.status).toBe(200);
    expect(remove.body).toEqual(expect.objectContaining({ name: 'acme', saved: true }));
    expect(manager.remove).toHaveBeenCalledWith('acme');
  });

  test('package-mode mutation maps PackageManagerError.status', async () => {
    const manager = makeManager();
    manager.enable.mockRejectedValue(new PackageManagerError(404, 'package not found: nope'));
    await listen(makeDeps(manager));
    const res = await request(server, 'POST', '/api/plugins/enable', { package: 'nope' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('package not found: nope');
  });

  test('legacy {type, filename} bodies still work unchanged', async () => {
    const manager = makeManager();
    const deps = makeDeps(manager);
    const hub = deps.hub as any;
    hub.dirs = {
      runtime: 'C:\\tmp\\runtime', media: 'C:\\tmp\\media',
      usage: 'C:\\tmp\\usage', ui: 'C:\\tmp\\ui',
    };
    await listen(deps);
    // Package-mode manager must not be touched when the legacy shape is used.
    const res = await request(server, 'POST', '/api/plugins/enable', { type: 'runtime', filename: 'nope.js' });
    expect([404]).toContain(res.status);
    expect(manager.enable).not.toHaveBeenCalled();
    expect(res.body.error).toMatch(/not found/);
  });

  test('mixed {package} + {type,filename} bodies are rejected with 400', async () => {
    await listen(makeDeps());
    const res = await request(server, 'POST', '/api/plugins/disable', {
      package: 'acme', type: 'runtime', filename: 'acme.js',
    });
    expect(res.status).toBe(400);
  });

  test('GET /api/plugins merges disabled packages and exposes revision', async () => {
    const deps: PluginsRouteDeps = {
      hub: { dirs: {} as any } as any,
      packages: () => [
        {
          name: 'acme', source: 'acme', status: 'disabled', enabled: false,
          contributions: [], pendingRevision: 'boot:9',
        },
      ],
      packageRevision: () => 'boot:2',
    };
    await listen(deps);
    const res = await request(server, 'GET', '/api/plugins');
    expect(res.status).toBe(200);
    expect(res.body.packages).toEqual([
      {
        name: 'acme', source: 'acme', status: 'disabled', enabled: false,
        contributions: [], pendingRevision: 'boot:9',
      },
    ]);
    expect(res.body.revision).toBe('boot:2');
  });
});
