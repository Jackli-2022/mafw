import * as http from 'http';
import { handleManagerRotate, ManagerRotateDeps } from '../../src/routes/manager-rotate';

function createServer(deps: ManagerRotateDeps): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url?.match(/^\/api\/manager\/session\/rotate(?:\?|$)/)) {
      await handleManagerRotate(req, res, deps);
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

function postJson(server: http.Server, path: string, body: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode!, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function makeDeps(over: Partial<ManagerRotateDeps> = {}) {
  const calls: string[] = [];
  const deps: ManagerRotateDeps = {
    getManagerSession: (_pd) => ({ sessionId: 'ses_old' }),
    lock: async (_pd, fn) => fn(),
    ensure: async (pd) => { calls.push(`ensure:${pd}`); return 'ses_init'; },
    downgrade: async (sid) => { calls.push(`downgrade:${sid}`); },
    create: async (pd) => { calls.push(`create:${pd}`); return 'ses_new'; },
    ...over,
  };
  return { deps, calls };
}

describe('POST /api/manager/session/rotate', () => {
  let server: http.Server;

  afterEach((done) => {
    if (server?.listening) server.close(done);
    else done();
  });

  it('rotates: downgrade old then create new', async () => {
    const { deps, calls } = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/manager/session/rotate', { projectDir: 'C:/p' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, sessionId: 'ses_new', previousSessionId: 'ses_old', created: 'rotated' });
    expect(calls).toEqual(['downgrade:ses_old', 'create:C:/p']);
  });

  it('falls back to ensure (initial) when no existing session', async () => {
    const { deps, calls } = makeDeps({ getManagerSession: () => null });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/manager/session/rotate', { projectDir: 'C:/p' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, sessionId: 'ses_init', created: 'initial' });
    expect(calls).toEqual(['ensure:C:/p']);
  });

  it('continues rotate when downgrade fails (fail-open)', async () => {
    const { deps, calls } = makeDeps({ downgrade: async () => { throw new Error('disk full'); } });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/manager/session/rotate', { projectDir: 'C:/p' });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe('ses_new');
    expect(calls).toEqual(['create:C:/p']);
  });

  it('returns 400 when projectDir missing', async () => {
    const { deps } = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/manager/session/rotate', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('projectDir');
  });

  it('returns 500 when create fails', async () => {
    const { deps } = makeDeps({ create: async () => { throw new Error('serve down'); } });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/manager/session/rotate', { projectDir: 'C:/p' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('serve down');
  });
});
