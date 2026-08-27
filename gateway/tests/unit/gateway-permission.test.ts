import * as http from 'http';
import { handlePermissionReply } from '../../src/routes/permission';

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

function createServer(runtime: any): http.Server {
  return http.createServer(async (req, res) => {
    const permMatch = req.url?.match(/^\/api\/sessions\/([^/]+)\/permissions\/([^/]+)(?:\?|$)/);
    if (permMatch && req.method === 'POST') {
      await handlePermissionReply(runtime, req, res, permMatch[1], permMatch[2]);
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

describe('POST /api/sessions/:sessionID/permissions/:requestId', () => {
  let server: http.Server;

  afterEach((done) => {
    if (server?.listening) server.close(done);
    else done();
  });

  it('should call runtime.session.permissionReply and return 200', async () => {
    const permissionReply = jest.fn().mockResolvedValue(true);
    const runtime = { session: { permissionReply } };
    server = createServer(runtime);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/sessions/session-1/permissions/req-1', { approved: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(permissionReply).toHaveBeenCalledWith('session-1', 'req-1', true);
  });

  it('should return 404 when permissionReply returns false', async () => {
    const permissionReply = jest.fn().mockResolvedValue(false);
    const runtime = { session: { permissionReply } };
    server = createServer(runtime);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/sessions/session-1/permissions/req-1', { approved: false });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Permission request not found' });
  });

  it('should return 503 when runtime does not support permissionReply', async () => {
    const runtime = { session: {} };
    server = createServer(runtime);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/sessions/session-1/permissions/req-1', { approved: true });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Runtime does not support permissionReply' });
  });

  it('should return 503 when runtime is null', async () => {
    server = createServer(null);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/sessions/session-1/permissions/req-1', { approved: true });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Runtime does not support permissionReply' });
  });

  it('should return 400 when approved is not a boolean', async () => {
    const permissionReply = jest.fn().mockResolvedValue(true);
    const runtime = { session: { permissionReply } };
    server = createServer(runtime);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/sessions/session-1/permissions/req-1', { approved: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'approved must be a boolean' });
    expect(permissionReply).not.toHaveBeenCalled();
  });

  it('should return 500 when permissionReply throws', async () => {
    const permissionReply = jest.fn().mockRejectedValue(new Error('internal failure'));
    const runtime = { session: { permissionReply } };
    server = createServer(runtime);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/sessions/session-1/permissions/req-1', { approved: true });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal failure' });
  });
});
