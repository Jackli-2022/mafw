import * as http from 'http';
import { handleEmbeddingConfigGet, handleEmbeddingConfigUpdate, EmbeddingConfigDeps } from '../../src/routes/embedding-config';

function makeDeps(overrides: Partial<EmbeddingConfigDeps> = {}) {
  let persisted: any = {
    provider: 'local',
    engine: 'onnx',
    model: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
    dimensions: 1024,
    threads: 2,
    llamacpp: { gpu: 'cpu', threads: 2, contextSize: 2048 },
  };
  const calls = { reinit: 0, backfill: 0 };
  const deps: EmbeddingConfigDeps & { calls: typeof calls } = {
    calls,
    currentConfig: () => JSON.parse(JSON.stringify(persisted)),
    persist: (o: any) => {
      const e = o?.memory?.embedding ?? {};
      persisted = {
        ...persisted,
        ...e,
        llamacpp: { ...persisted.llamacpp, ...(e.llamacpp ?? {}) },
      };
      return { changed: ['memory'] };
    },
    reinit: () => { calls.reinit++; return { active: persisted.provider === 'off' ? null : `local:${persisted.model}` }; },
    runtimeState: () => ({
      active: persisted.provider === 'off' ? null : `local:${persisted.model}`,
      vectors: 100,
      indexEntries: 100,
      coverage: 1,
    }),
    scheduleBackfill: () => { calls.backfill++; },
    ...overrides,
  };
  return deps;
}

function createServer(deps: EmbeddingConfigDeps): http.Server {
  return http.createServer(async (req, res) => {
    const match = req.url?.match(/^\/api\/memory\/embedding-config(?:\?|$)/);
    if (match && req.method === 'GET') { await handleEmbeddingConfigGet(req, res, deps); return; }
    if (match && req.method === 'POST') { await handleEmbeddingConfigUpdate(req, res, deps); return; }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

async function request(server: http.Server, method: string, body?: any): Promise<{ status: number; body: any }> {
  const addr = server.address() as { port: number };
  const data = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: addr.port, path: '/api/memory/embedding-config?x=1', method,
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

describe('embedding-config route', () => {
  let server: http.Server;
  afterEach((done) => { if (server?.listening) server.close(done); else done(); });

  it('GET returns current + runtime + available options', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const r = await request(server, 'GET');
    expect(r.status).toBe(200);
    expect(r.body.current.engine).toBe('onnx');
    expect(r.body.runtime.coverage).toBe(1);
    expect(r.body.available.gpus).toEqual(['cpu', 'vulkan', 'cuda']);
  });

  it('POST switches engine: persists + reinits + schedules backfill', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const r = await request(server, 'POST', { engine: 'llamacpp', llamacpp: { gpu: 'cuda' } });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.current.engine).toBe('llamacpp');
    expect(r.body.current.llamacpp.gpu).toBe('cuda');
    expect(deps.calls.reinit).toBe(1);
    expect(deps.calls.backfill).toBe(1);
  });

  it('POST provider=off reinits but skips backfill', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const r = await request(server, 'POST', { provider: 'off' });
    expect(r.status).toBe(200);
    expect(r.body.runtime.active).toBeNull();
    expect(deps.calls.reinit).toBe(1);
    expect(deps.calls.backfill).toBe(0);
  });

  it('POST rejects invalid enum values', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const r = await request(server, 'POST', { engine: 'warp', llamacpp: { gpu: 'metal' } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/engine/);
    expect(r.body.error).toMatch(/gpu/);
    expect(deps.calls.reinit).toBe(0);
  });

  it('POST rejects out-of-range threads/contextSize', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const r = await request(server, 'POST', { threads: 0, llamacpp: { contextSize: 100 } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/threads/);
    expect(r.body.error).toMatch(/contextSize/);
  });

  it('POST with empty body is rejected', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const r = await request(server, 'POST', {});
    expect(r.status).toBe(400);
  });
});
