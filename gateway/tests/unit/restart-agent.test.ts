import * as http from 'http';
import { handleRestartAgent, RestartAgentDeps } from '../../src/routes/restart-agent';
import { handleRestartAgent as handleRestartAgentTool } from '../../src/mcp/handlers/restart-agent';

function makeDeps(overrides: Partial<RestartAgentDeps> = {}): { deps: RestartAgentDeps; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      capabilities: () => ({ agentProcessApi: true }),
      isRecovering: () => false,
      isSwitching: () => false,
      begin: () => calls.push('begin'),
      end: () => calls.push('end'),
      restartAgent: async () => { calls.push('restart'); return { mode: 'owned-respawn' }; },
      ...overrides,
    },
  };
}

function createServer(deps: RestartAgentDeps): http.Server {
  return http.createServer(async (req, res) => {
    if (req.url?.match(/^\/api\/runtime\/restart-agent(?:\?|$)/) && req.method === 'POST') {
      await handleRestartAgent(req, res, deps);
      return;
    }
    res.writeHead(404); res.end();
  });
}

async function post(server: http.Server): Promise<{ status: number; body: any }> {
  const addr = server.address() as { port: number };
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path: '/api/runtime/restart-agent',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let c = '';
      res.on('data', d => c += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode!, body: JSON.parse(c) });
        } catch {
          resolve({ status: res.statusCode!, body: c });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('POST /api/runtime/restart-agent', () => {
  let server: http.Server;
  afterEach(done => { if (server?.listening) server.close(done); else done(); });

  it('200 owned: begin → restart → end, returns mode', async () => {
    const { deps, calls } = makeDeps();
    server = createServer(deps);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const res = await post(server);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, mode: 'owned-respawn' });
    expect(calls).toEqual(['begin', 'restart', 'end']);
  });

  it('503 when capability absent (external / in-process runtime)', async () => {
    const { deps, calls } = makeDeps({ capabilities: () => ({ agentProcessApi: false }) });
    server = createServer(deps);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const res = await post(server);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/does not own the agent process/);
    expect(calls).toEqual([]);
  });

  it('409 while recovering', async () => {
    const { deps, calls } = makeDeps({ isRecovering: () => true });
    server = createServer(deps);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const res = await post(server);
    expect(res.status).toBe(409);
    expect(calls).toEqual([]);
  });

  it('409 while runtime switching', async () => {
    const { deps, calls } = makeDeps({ isSwitching: () => true });
    server = createServer(deps);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const res = await post(server);
    expect(res.status).toBe(409);
    expect(calls).toEqual([]);
  });

  it('500 when restart throws; end() still runs', async () => {
    const { deps, calls } = makeDeps({
      restartAgent: async () => { throw new Error('spawn failed'); },
    });
    server = createServer(deps);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const res = await post(server);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('spawn failed');
    expect(calls).toEqual(['begin', 'end']);
  });
});

describe('mafw_restart_agent MCP tool handler', () => {
  it('returns success payload', async () => {
    const res = await handleRestartAgentTool({}, { restartAgent: async () => ({ mode: 'owned-respawn' }) } as any);
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toEqual({ mode: 'owned-respawn' });
  });

  it('surfaces unsupported runtimes as error', async () => {
    const res = await handleRestartAgentTool({}, {} as any);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toMatch(/not available/);
  });
});
