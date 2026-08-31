import * as http from 'http';

// Minimal router that handles the restart-agent endpoint
function createServer(deps: {
  caps: () => any;
  recovering: () => boolean;
  recoverServe: jest.Mock;
}): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url?.match(/^\/api\/runtime\/restart-agent(?:\?|$)/)) {
      const caps = deps.caps();
      if (!caps.agentProcessApi) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Runtime does not support agent process restart (agentProcessApi=false)` }));
        return;
      }
      if (deps.recovering()) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Agent restart already in progress' }));
        return;
      }
      try {
        await deps.recoverServe();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, mode: 'owned-respawn' }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

function postJson(server: http.Server, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '0' },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode!, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('POST /api/runtime/restart-agent', () => {
  let server: http.Server;

  afterEach((done) => {
    if (server?.listening) server.close(done);
    else done();
  });

  it('returns 200 and calls recoverServe when agentProcessApi=true', async () => {
    const deps = {
      caps: () => ({ agentProcessApi: true }),
      recovering: () => false,
      recoverServe: jest.fn().mockResolvedValue(undefined),
    };
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/runtime/restart-agent');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, mode: 'owned-respawn' });
    expect(deps.recoverServe).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when agentProcessApi=false', async () => {
    const deps = {
      caps: () => ({ agentProcessApi: false }),
      recovering: () => false,
      recoverServe: jest.fn(),
    };
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/runtime/restart-agent');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('agentProcessApi=false');
    expect(deps.recoverServe).not.toHaveBeenCalled();
  });

  it('returns 409 when restart already in progress', async () => {
    const deps = {
      caps: () => ({ agentProcessApi: true }),
      recovering: () => true,
      recoverServe: jest.fn(),
    };
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/runtime/restart-agent');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already in progress');
    expect(deps.recoverServe).not.toHaveBeenCalled();
  });

  it('returns 500 when recoverServe throws', async () => {
    const deps = {
      caps: () => ({ agentProcessApi: true }),
      recovering: () => false,
      recoverServe: jest.fn().mockRejectedValue(new Error('serve spawn failed')),
    };
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/runtime/restart-agent');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('serve spawn failed');
  });
});
