import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handlePluginsList, handlePluginsInstall, handlePluginsDisable, handlePluginsDelete } from '../../src/routes/plugins';

const MOD = Buffer.from('module.exports = { name: "foo", createRuntime: async () => ({}), fetch: async () => null };', 'utf-8');

function postJson(server: http.Server, p: string, body: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: addr.port, path: p, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode!, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function postRaw(server: http.Server, p: string, bytes: Buffer): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request({
      hostname: '127.0.0.1', port: addr.port, path: p, method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode!, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(bytes);
    req.end();
  });
}

function makeDeps() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-hub-routes-'));
  const dirs = {
    runtime: path.join(root, 'runtime-plugins'),
    media: path.join(root, 'media-plugins'),
    usage: path.join(root, 'usage-plugins'),
    ui: path.join(root, 'ui-plugins'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return { hub: { dirs, reload: () => {} } as any };
}

function createServer(deps: any): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url?.match(/^\/api\/plugins(?:\?|$)/)) {
      await handlePluginsList(req, res, deps); return;
    }
    if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/install(?:\?|$)/)) {
      await handlePluginsInstall(req, res, deps); return;
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

describe('plugins routes', () => {
  let server: http.Server;
  let deps: ReturnType<typeof makeDeps>;
  beforeEach(async () => {
    deps = makeDeps(); server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  });
  afterEach((done) => { server.close(() => done()); });

  test('install then list shows the plugin', async () => {
    const inst = await postRaw(server, '/api/plugins/install?filename=foo.js&type=runtime', MOD);
    expect(inst.status).toBe(200);
    expect(inst.body).toEqual(expect.objectContaining({ name: 'foo', status: 'enabled' }));
    const list = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const addr = server.address() as { port: number };
      http.get({ hostname: '127.0.0.1', port: addr.port, path: '/api/plugins' }, (res) => {
        let chunks = ''; res.on('data', (c) => chunks += c);
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(chunks) }));
      }).on('error', reject);
    });
    expect(list.status).toBe(200);
    expect(list.body.plugins).toEqual([expect.objectContaining({ type: 'runtime', name: 'foo' })]);
  });

  test('install validation failure → 400 with error body', async () => {
    const res = await postRaw(server, '/api/plugins/install?filename=..%2Fx.js&type=runtime', MOD);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  test('disable then delete round-trip', async () => {
    await postRaw(server, '/api/plugins/install?filename=foo.js&type=usage', MOD);
    const dis = await postJson(server, '/api/plugins/disable', { type: 'usage', filename: 'foo.js' });
    expect(dis.status).toBe(200);
    expect(dis.body.status).toBe('disabled');
    const del = await postJson(server, '/api/plugins/delete', { type: 'usage', filename: 'foo.js.disabled' });
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });
  });

  test('install without filename → 400', async () => {
    const addr = server.address() as { port: number };
    const status: number = await new Promise((resolve) => {
      const req = http.request({ hostname: '127.0.0.1', port: addr.port, path: '/api/plugins/install', method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': 7 } }, (res) => {
        res.resume(); res.on('end', () => resolve(res.statusCode!));
      });
      req.end('{broken');
    });
    expect(status).toBe(400);
  });

  test('list 响应携带 packages 键（缺省空数组）', async () => {
    const list = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const addr = server.address() as { port: number };
      http.get({ hostname: '127.0.0.1', port: addr.port, path: '/api/plugins' }, (res) => {
        let chunks = ''; res.on('data', (c) => chunks += c);
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(chunks) }));
      }).on('error', reject);
    });
    expect(list.status).toBe(200);
    expect(list.body.packages).toEqual([]);
  });

  test('list 响应透传 getPackages()', async () => {
    deps.hub.getPackages = () => [{ name: 'acme', status: 'ok' }];
    const list = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const addr = server.address() as { port: number };
      http.get({ hostname: '127.0.0.1', port: addr.port, path: '/api/plugins' }, (res) => {
        let chunks = ''; res.on('data', (c) => chunks += c);
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(chunks) }));
      }).on('error', reject);
    });
    expect(list.body.packages).toEqual([{ name: 'acme', status: 'ok' }]);
  });
});
