import * as http from 'http';
import { handleModelConfigGet, handleModelConfigUpdate } from '../../src/routes/model-config';

const AVAILABLE = [
  { providerID: 'xiaomi', providerName: 'xiaomi', models: [{ id: 'mimo-v2.5', name: 'MiMo V2.5' }] },
  { providerID: 'alibaba-cn', providerName: 'alibaba-cn', models: [{ id: 'qwen3.7-max', name: 'Qwen3.7 Max' }] },
];

function makeDeps(overrides: any = {}) {
  // Track persisted overrides so currentConfig reflects post-persist state
  let persistedRecall: any = { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' };
  let persistedMedia: any = { provider: 'xiaomi', model: 'mimo-v2.5', image: { provider: '', model: '' }, video: { provider: '', model: '' }, audio: { provider: '', model: '' } };
  return {
    persist: jest.fn().mockImplementation((o: any) => {
      if (o.recall) persistedRecall = o.recall.workerModel;
      if (o.media) {
        if (o.media.provider !== undefined) persistedMedia = { ...persistedMedia, ...o.media };
        else persistedMedia = { ...persistedMedia, ...o.media };
      }
      return { changed: ['recall'] };
    }),
    listProviders: jest.fn().mockResolvedValue(AVAILABLE),
    currentConfig: jest.fn(() => ({
      recall: { workerModel: persistedRecall },
      media: persistedMedia,
    })),
    invalidateScanService: jest.fn(),
    ...overrides,
  };
}

function createServer(deps: any): http.Server {
  return http.createServer(async (req, res) => {
    const match = req.url?.match(/^\/api\/model-config(?:\?|$)/);
    if (match && req.method === 'GET') { await handleModelConfigGet(req, res, deps); return; }
    if (match && req.method === 'POST') { await handleModelConfigUpdate(req, res, deps); return; }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

async function request(server: http.Server, method: string, body?: any): Promise<{ status: number; body: any }> {
  const addr = server.address() as { port: number };
  const data = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: addr.port, path: '/api/model-config?x=1', method,
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

describe('GET /api/model-config', () => {
  let server: http.Server;
  afterEach((done) => { if (server?.listening) server.close(done); else done(); });

  it('returns recall + media + available list', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'GET');
    expect(res.status).toBe(200);
    expect(res.body.recall).toEqual({ workerModel: { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' } });
    expect(res.body.media.provider).toBe('xiaomi');
    expect(res.body.available).toEqual(AVAILABLE);
  });

  it('returns available:null when provider list unavailable (fail-open signal)', async () => {
    const deps = makeDeps({ listProviders: jest.fn().mockResolvedValue(null) });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'GET');
    expect(res.body.available).toBeNull();
  });
});

describe('POST /api/model-config', () => {
  let server: http.Server;
  afterEach((done) => { if (server?.listening) server.close(done); else done(); });

  it('updates recall workerModel: persists wrapper shape, invalidates scan service, echoes new state', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { recall: { providerID: 'xiaomi', modelID: 'mimo-v2.5' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.recall).toEqual({ workerModel: { providerID: 'xiaomi', modelID: 'mimo-v2.5' } });
    expect(deps.persist).toHaveBeenCalledWith({ recall: { workerModel: { providerID: 'xiaomi', modelID: 'mimo-v2.5' } } });
    expect(deps.invalidateScanService).toHaveBeenCalledTimes(1);
  });

  it('updates media image model: persists {media:{image}}, does NOT invalidate scan service', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { media: { image: { provider: 'xiaomi', model: 'mimo-v2.5' } } });
    expect(res.status).toBe(200);
    expect(deps.persist).toHaveBeenCalledWith({ media: { image: { provider: 'xiaomi', model: 'mimo-v2.5' } } });
    expect(deps.invalidateScanService).not.toHaveBeenCalled();
  });

  it('rejects unknown model with 400 + available, no persist', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { recall: { providerID: 'xiaomi', modelID: 'no-such-model' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not found');
    expect(res.body.available).toEqual(AVAILABLE);
    expect(deps.persist).not.toHaveBeenCalled();
    expect(deps.invalidateScanService).not.toHaveBeenCalled();
  });

  it('rejects unknown provider for media modality with 400', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { media: { video: { provider: 'nope', model: 'm' } } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Provider 'nope' not found");
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('empty-string values bypass strict validation (clear path) and persist', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { media: { image: { provider: '', model: '' } } });
    expect(res.status).toBe(200);
    expect(deps.persist).toHaveBeenCalledWith({ media: { image: { provider: '', model: '' } } });
  });

  it('fail-open: accepts unvalidatable values when provider list is null', async () => {
    const deps = makeDeps({ listProviders: jest.fn().mockResolvedValue(null) });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { recall: { providerID: 'custom', modelID: 'custom-model' } });
    expect(res.status).toBe(200);
    expect(deps.persist).toHaveBeenCalled();
  });

  it('empty body returns 400 No model config specified', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No model config specified');
  });

  it('recall with missing modelID returns 400 even when list unavailable', async () => {
    const deps = makeDeps({ listProviders: jest.fn().mockResolvedValue(null) });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { recall: { providerID: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('providerID and modelID');
  });

  it('malformed JSON returns 400', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', undefined); // empty body string → JSON.parse fails
    expect(res.status).toBe(400);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('invalidateScanService throw does not fail the request (fail-open)', async () => {
    const deps = makeDeps({ invalidateScanService: jest.fn(() => { throw new Error('boom'); }) });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { recall: { providerID: 'xiaomi', modelID: 'mimo-v2.5' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('persist throw returns 500', async () => {
    const deps = makeDeps({ persist: jest.fn(() => { throw new Error('disk full'); }) });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const res = await request(server, 'POST', { recall: { providerID: 'xiaomi', modelID: 'mimo-v2.5' } });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('disk full');
  });
});
