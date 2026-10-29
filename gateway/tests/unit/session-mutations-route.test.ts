import * as http from 'http';
import { handleSessionMutations } from '../../src/routes/session-mutations';

function createServer(deps: {
  getCapabilities: jest.Mock;
  getClient: jest.Mock;
  forgetDiscovery?: jest.Mock;
  beforeDelete?: jest.Mock;
}): http.Server {
  return http.createServer(async (req, res) => {
    const handled = await handleSessionMutations(req, res, {
      getCapabilities: deps.getCapabilities,
      getClient: deps.getClient,
      forgetDiscovery: deps.forgetDiscovery,
      beforeDelete: deps.beforeDelete,
    });
    if (!handled) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
    }
  });
}

function send(server: http.Server, method: string, path: string, body?: object): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
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

describe('handleSessionMutations', () => {
  let server: http.Server;

  const okDeps = () => ({
    getCapabilities: jest.fn().mockReturnValue({ sessionApi: true }),
    getClient: jest.fn().mockReturnValue({ session: { delete: jest.fn(), update: jest.fn() } }),
  });

  afterEach((done) => {
    if (server?.listening) server.close(done);
    else done();
  });

  it('DELETE /api/sessions/:id calls session.delete and returns 200', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    const deps = okDeps();
    deps.getClient.mockReturnValue({ session: { delete: del, update: jest.fn() } });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'DELETE', '/api/sessions/ses_1?x=1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(del).toHaveBeenCalledWith({ sessionID: 'ses_1' });
  });

  it('DELETE runs beforeDelete before session.delete', async () => {
    const order: string[] = [];
    const del = jest.fn(async () => { order.push('delete'); });
    const beforeDelete = jest.fn(async () => { order.push('snapshot'); });
    const deps = okDeps();
    deps.getClient.mockReturnValue({ session: { delete: del, update: jest.fn() } });
    server = createServer({ ...deps, beforeDelete });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'DELETE', '/api/sessions/ses_snapshot');

    expect(res.status).toBe(200);
    expect(beforeDelete).toHaveBeenCalledWith('ses_snapshot');
    expect(order).toEqual(['snapshot', 'delete']);
  });

  it('DELETE forgets discovery state for the deleted session', async () => {
    const forgetDiscovery = jest.fn();
    const deps = okDeps();
    deps.getClient.mockReturnValue({ session: { delete: jest.fn().mockResolvedValue(undefined), update: jest.fn() } });
    server = createServer({ ...deps, forgetDiscovery });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'DELETE', '/api/sessions/ses_forget');
    expect(res.status).toBe(200);
    expect(forgetDiscovery).toHaveBeenCalledWith('ses_forget');
  });

  it('PATCH /api/sessions/:id with title calls session.update with flat args and returns 200', async () => {
    const update = jest.fn().mockResolvedValue({});
    const deps = okDeps();
    deps.getClient.mockReturnValue({ session: { delete: jest.fn(), update } });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'PATCH', '/api/sessions/ses_1', { title: '  新标题  ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ sessionID: 'ses_1', title: '新标题' });
  });

  it('PATCH with empty/missing title returns 400', async () => {
    const update = jest.fn();
    const deps = okDeps();
    deps.getClient.mockReturnValue({ session: { delete: jest.fn(), update } });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'PATCH', '/api/sessions/ses_1', {});
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 503 when sessionApi capability is missing', async () => {
    server = createServer({ getCapabilities: jest.fn().mockReturnValue({ sessionApi: false }), getClient: jest.fn() });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'DELETE', '/api/sessions/ses_1');
    expect(res.status).toBe(503);
  });

  it('returns 503 when client is unavailable', async () => {
    server = createServer({ getCapabilities: jest.fn().mockReturnValue({ sessionApi: true }), getClient: jest.fn().mockReturnValue(null) });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'DELETE', '/api/sessions/ses_1');
    expect(res.status).toBe(503);
  });

  it('returns 500 when serve call rejects', async () => {
    server = createServer({
      getCapabilities: jest.fn().mockReturnValue({ sessionApi: true }),
      getClient: jest.fn().mockReturnValue({
        session: { delete: jest.fn().mockRejectedValue(new Error('not found')), update: jest.fn() },
      }),
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'DELETE', '/api/sessions/ses_1');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('not found');
  });

  it('returns 503 when runtime lacks session.update (declared sessionApi but method absent)', async () => {
    const deps = okDeps();
    deps.getClient.mockReturnValue({ session: { delete: jest.fn() } }); // 无 update
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'PATCH', '/api/sessions/ses_1', { title: 'x' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/update/);
  });

  it('returns false for unrelated routes', async () => {
    server = createServer({ getCapabilities: jest.fn(), getClient: jest.fn() });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await send(server, 'GET', '/api/sessions');
    expect(res.status).toBe(404);
  });
});
