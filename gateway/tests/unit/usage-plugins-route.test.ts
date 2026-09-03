import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { PluginLoader } from '../../src/usage/plugin-loader';
import {
  handleUsagePluginCreate, handleUsagePluginDelete, handleUsagePluginsList,
  handleUsagePluginSourceGet, handleUsagePluginSourcePut, handleUsagePluginTest,
  UsagePluginsDeps,
} from '../../src/routes/usage-plugins';

const CLEANUP: string[] = [];
function tmpDir(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  CLEANUP.push(d);
  return d;
}
afterAll(() => {
  for (const d of CLEANUP) fs.rmSync(d, { recursive: true, force: true });
});

function makeDeps(overrides: any = {}) {
  const dir = tmpDir('mafw-usage-route-');
  const builtinDir = tmpDir('mafw-usage-builtin-');
  fs.writeFileSync(path.join(builtinDir, 'deepseek.js'), `module.exports = { name: 'deepseek', fetch: async () => null };`);
  const disabled: string[] = overrides.disabled ?? [];
  const loader = new PluginLoader(dir, ['deepseek'], { builtinPluginsDir: builtinDir, disabledPlugins: disabled });
  const deps: UsagePluginsDeps = {
    loader,
    pluginsDir: dir,
    getDisabled: () => disabled,
    getPluginConfig: (n) => (n === 'withcfg' ? { endpoint: 'https://x' } : null),
    readBuiltinSource: (n) => (n === 'deepseek' ? `module.exports = { name: 'deepseek', fetch: async () => null };` : null),
    runAdapter: async (n) => ({ ok: true, result: { name: n, windows: [{ window: 'balance', used: 1, limit: 10, unit: '$', pct: 10 }] } }),
    builtinNames: () => ['deepseek'],
  };
  return { deps, dir, loader };
}

function createServer(deps: UsagePluginsDeps): http.Server {
  return http.createServer(async (req, res) => {
    const u = req.url || '';
    let m: RegExpMatchArray | null;
    if (u.match(/^\/api\/usage\/plugins(?:\?|$)/) && req.method === 'GET') { await handleUsagePluginsList(req, res, deps); return; }
    if (u.match(/^\/api\/usage\/plugins\/create$/) && req.method === 'POST') { await handleUsagePluginCreate(req, res, deps); return; }
    if ((m = u.match(/^\/api\/usage\/plugins\/([^/]+)\/source$/)) && req.method === 'GET') { await handleUsagePluginSourceGet(req, res, deps, decodeURIComponent(m[1])); return; }
    if ((m = u.match(/^\/api\/usage\/plugins\/([^/]+)\/source$/)) && req.method === 'PUT') { await handleUsagePluginSourcePut(req, res, deps, decodeURIComponent(m[1])); return; }
    if ((m = u.match(/^\/api\/usage\/plugins\/([^/]+)\/test$/)) && req.method === 'POST') { await handleUsagePluginTest(req, res, deps, decodeURIComponent(m[1])); return; }
    if ((m = u.match(/^\/api\/usage\/plugins\/([^/]+)$/)) && req.method === 'DELETE') { await handleUsagePluginDelete(req, res, deps, decodeURIComponent(m[1])); return; }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

async function request(server: http.Server, method: string, p: string, body?: any): Promise<{ status: number; body: any }> {
  const addr = server.address() as { port: number };
  const data = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: addr.port, path: p, method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
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

describe('usage plugins routes', () => {
  let server: http.Server;
  afterEach((done) => { if (server?.listening) server.close(done); else done(); });

  it('create from template writes file and reloads', async () => {
    const { deps, dir } = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', '/api/usage/plugins/create', {
      template: 'balance-api',
      values: { name: 'my-gw', endpoint: 'https://x', usedPath: 'u', limitPath: 'l' },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(fs.existsSync(path.join(dir, 'my-gw.js'))).toBe(true);
    const list = await request(server, 'GET', '/api/usage/plugins');
    const entry = list.body.plugins.find((p: any) => p.name === 'my-gw');
    expect(entry.origin).toBe('user');
    expect(entry.configSchema).toHaveLength(4);
    expect(entry.config).toBeNull();
    expect(list.body.templates).toHaveLength(4);
    expect(list.body.builtins).toContain('deepseek');
  });

  it('create rejects bad name / duplicate / builtin name', async () => {
    const { deps } = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const bad = await request(server, 'POST', '/api/usage/plugins/create', { name: 'X Y', source: 'module.exports={}' });
    expect(bad.status).toBe(400);
    const ok = await request(server, 'POST', '/api/usage/plugins/create', { name: 'dup', source: 'module.exports={name:"dup",fetch:async()=>null};' });
    expect(ok.status).toBe(200);
    const dup = await request(server, 'POST', '/api/usage/plugins/create', { name: 'dup', source: 'module.exports={};' });
    expect(dup.status).toBe(409);
    const builtin = await request(server, 'POST', '/api/usage/plugins/create', { name: 'deepseek', source: 'module.exports={};' });
    expect(builtin.status).toBe(409);
  });

  it('list enriches origin/config/disabled and reports builtin origin', async () => {
    const { deps, dir } = makeDeps({ disabled: ['off'] });
    fs.writeFileSync(path.join(dir, 'withcfg.js'), `module.exports = { name: 'withcfg', fetch: async () => null };`);
    fs.writeFileSync(path.join(dir, 'off.js'), `module.exports = { name: 'off', fetch: async () => null };`);
    await deps.loader.reload();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'GET', '/api/usage/plugins');
    const withcfg = res.body.plugins.find((p: any) => p.name === 'withcfg');
    expect(withcfg.config).toEqual({ endpoint: 'https://x' });
    const off = res.body.plugins.find((p: any) => p.name === 'off');
    expect(off.disabled).toBe(true);
    const deepseek = res.body.plugins.find((p: any) => p.name === 'deepseek');
    expect(deepseek.origin).toBe('builtin');
  });

  it('source get/put/delete only for user files', async () => {
    const { deps, dir } = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const created = await request(server, 'POST', '/api/usage/plugins/create', { name: 'g1', source: 'module.exports={name:"g1",fetch:async()=>null};' });
    expect(created.status).toBe(200);
    const get = await request(server, 'GET', '/api/usage/plugins/g1/source');
    expect(get.status).toBe(200);
    expect(get.body.source).toContain('g1');
    const put = await request(server, 'PUT', '/api/usage/plugins/g1/source', { source: 'module.exports={name:"g1",fetch:async()=>null};' });
    expect(put.status).toBe(200);
    const putBad = await request(server, 'PUT', '/api/usage/plugins/g1/source', { source: 'module.exports = {' });
    expect(putBad.status).toBe(400);
    const getBuiltin = await request(server, 'GET', '/api/usage/plugins/deepseek/source');
    expect(getBuiltin.status).toBe(403);
    expect(getBuiltin.body.builtin).toBe(true);
    const delBuiltin = await request(server, 'DELETE', '/api/usage/plugins/deepseek');
    expect(delBuiltin.status).toBe(403);
    const del = await request(server, 'DELETE', '/api/usage/plugins/g1');
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(dir, 'g1.js'))).toBe(false);
  });

  it('test returns adapter result', async () => {
    const { deps } = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', '/api/usage/plugins/zzz/test');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
