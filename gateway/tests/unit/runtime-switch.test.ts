import * as http from 'http';
import { handleRuntimeSwitch } from '../../src/routes/runtime-switch';

function postJson(server: http.Server, path: string, body: any): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method: 'POST',
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

function createServer(deps: any): http.Server {
  return http.createServer(async (req, res) => {
    const match = req.url?.match(/^\/api\/runtime\/switch(?:\?|$)/);
    if (match && req.method === 'POST') {
      await handleRuntimeSwitch(req, res, deps);
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

function makeRuntime(name: string) {
  return { name, capabilities: { eventStream: true } };
}

function makeDeps(overrides: any = {}) {
  const rt = makeRuntime('pi');
  return {
    loader: { get: jest.fn((n: string) => (n === 'pi' ? {} : undefined)), getState: jest.fn(() => [{ file: 'builtin:pi', name: 'pi', status: 'ok' }]) },
    persist: jest.fn().mockReturnValue({ changed: ['runtime'] }),
    getCurrent: jest.fn(() => makeRuntime('opencode')),
    runtimeName: jest.fn(() => 'opencode'),
    runtimeCaps: jest.fn(() => ({ eventStream: true })),
    envOverride: jest.fn(() => false),
    createRuntime: jest.fn().mockResolvedValue(rt),
    onSwitched: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('POST /api/runtime/switch (hot-swap)', () => {
  let server: http.Server;
  const envBackup = process.env.MAFW_RUNTIME_PLUGIN;

  beforeEach(() => { delete process.env.MAFW_RUNTIME_PLUGIN; });
  afterAll(() => {
    if (envBackup === undefined) delete process.env.MAFW_RUNTIME_PLUGIN;
    else process.env.MAFW_RUNTIME_PLUGIN = envBackup;
  });

  afterEach((done) => {
    if (server?.listening) server.close(done);
    else done();
  });

  it('switches to a known plugin: persists, recreates runtime, wires it in', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/runtime/switch', { plugin: 'pi' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      active: { name: 'pi', capabilities: { eventStream: true } },
      envOverride: false,
    });
    expect(deps.persist).toHaveBeenCalledWith({ runtime: { plugin: 'pi' } });
    expect(deps.loader.get).toHaveBeenCalledWith('pi');
    expect(deps.createRuntime).toHaveBeenCalled();
    expect(deps.onSwitched).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'pi' }),
      expect.objectContaining({ name: 'opencode' }),
    );
  });

  it('rejects an unknown plugin with 400 and does not persist or create', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/runtime/switch', { plugin: 'no-such-runtime' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Runtime plugin 'no-such-runtime' not found");
    expect(res.body.available).toEqual(['pi']);
    expect(deps.persist).not.toHaveBeenCalled();
    expect(deps.createRuntime).not.toHaveBeenCalled();
  });

  it('accepts opencode and empty plugin (builtin default) without loader check', async () => {
    const deps = makeDeps();
    deps.createRuntime.mockResolvedValue(makeRuntime('opencode'));
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/runtime/switch', { plugin: 'opencode' });
    expect(res.status).toBe(200);
    expect(res.body.active.name).toBe('opencode');
    expect(deps.loader.get).not.toHaveBeenCalled();
    expect(deps.persist).toHaveBeenCalledWith({ runtime: { plugin: 'opencode' } });
  });

it('reports envOverride when MAFW_RUNTIME_PLUGIN is set', async () => {
    const deps = makeDeps({ envOverride: jest.fn(() => true) });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/runtime/switch', { plugin: '' });
    expect(res.status).toBe(200);
    expect(res.body.envOverride).toBe(true);
  });

  it('returns 500 when runtime creation fails', async () => {
    const deps = makeDeps({ createRuntime: jest.fn().mockRejectedValue(new Error('create failed')) });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/runtime/switch', { plugin: 'pi' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'create failed' });
    expect(deps.onSwitched).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed JSON', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const addr = server.address() as { port: number };
    const data = '{not json';
    const raw = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: addr.port, path: '/api/runtime/switch', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      }, (res) => {
        let chunks = '';
        res.on('data', (c) => chunks += c);
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(chunks) }));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });

    expect(raw.status).toBe(400);
    expect(deps.persist).not.toHaveBeenCalled();
  });
});