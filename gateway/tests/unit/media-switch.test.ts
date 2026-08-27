import * as http from 'http';
import { handleMediaSwitch } from '../../src/routes/media-switch';

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

/**
 * Models the gateway Config state: persist merges overrides into `cur`
 * (mirroring config.persistOverrides deepMerge), and currentMedia reads the
 * merged state back — the same ordering as real wiring.
 */
function makeMediaState() {
  const cur: any = {
    engine: undefined,
    image: { engine: undefined, model: '' },
    video: { engine: undefined, model: '' },
    audio: { engine: undefined, model: '' },
  };
  const persist = jest.fn((overrides: Record<string, any>) => {
    const media = overrides.media || {};
    if (media.engine !== undefined) cur.engine = media.engine;
    for (const k of ['image', 'video', 'audio']) {
      if (media[k]) cur[k] = { ...cur[k], ...media[k] };
    }
    return { changed: ['media'] };
  });
  return { cur, persist };
}

function createServer(deps: any): http.Server {
  return http.createServer(async (req, res) => {
    const match = req.url?.match(/^\/api\/media\/switch(?:\?|$)/);
    if (match && req.method === 'POST') {
      await handleMediaSwitch(req, res, deps);
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

function makeDeps(overrides: any = {}) {
  const state = makeMediaState();
  return {
    persist: state.persist,
    reloadPlugins: jest.fn().mockResolvedValue(undefined),
    availableEngines: jest.fn(() => ['qwen-vl', 'gemini-vision']),
    currentMedia: () => state.cur,
    state,
    ...overrides,
  };
}

describe('POST /api/media/switch', () => {
  let server: http.Server;

  afterEach((done) => {
    if (server?.listening) server.close(done);
    else done();
  });

  it('persists a per-modality override and hot-reloads plugins', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/media/switch', { video: { engine: 'qwen-vl' } });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.media.video.engine).toBe('qwen-vl');
    expect(deps.persist).toHaveBeenCalledWith({ media: { video: { engine: 'qwen-vl' } } });
    expect(deps.reloadPlugins).toHaveBeenCalled();
  });

  it('rejects an unknown engine with 400 and does not persist', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/media/switch', { engine: 'no-such-engine' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Media engine 'no-such-engine' not found");
    expect(res.body.available).toEqual(['qwen-vl', 'gemini-vision', 'pi']);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('accepts pi as default engine', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/media/switch', { engine: 'pi' });
    expect(res.status).toBe(200);
    expect(res.body.media.engine).toBe('pi');
  });

  it('returns 400 when no engine is specified', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/media/switch', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No engine specified');
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('supports multiple modalities in one call', async () => {
    const deps = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/media/switch', { image: { engine: 'gemini-vision' }, audio: { engine: 'pi' } });

    expect(res.status).toBe(200);
    expect(res.body.media.image.engine).toBe('gemini-vision');
    expect(res.body.media.audio.engine).toBe('pi');
    expect(res.body.media.video.engine).toBeUndefined();
  });
});