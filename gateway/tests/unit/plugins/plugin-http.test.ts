import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { PluginHost } from '../../../src/plugins/package-host';
import { createPluginPackageContext } from '../../../src/plugins/package-context';
import {
  createPluginHttpRecorder,
  createPluginHttpRegistry,
  type PluginHttpResponseWriter,
} from '../../../src/plugins/plugin-http';

const silentLog = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as any;

const TMP_DIRS: string[] = [];

function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  TMP_DIRS.push(dir);
  return dir;
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writePackage(root: string, name: string, body: string): string {
  const pkgDir = path.join(root, name);
  writeFile(path.join(pkgDir, 'plugin.json'), JSON.stringify({ name }));
  writeFile(path.join(pkgDir, 'index.js'), body);
  return pkgDir;
}

function mkHost(pluginsDir: string, options: ConstructorParameters<typeof PluginHost>[2] = {}): PluginHost {
  return new PluginHost(
    pluginsDir,
    (name, bag) => createPluginPackageContext(name, { projectDir: '/p', gatewayPort: 3000, bag }),
    options,
  );
}

async function* bodyOf(...parts: string[]): AsyncIterable<Buffer> {
  for (const part of parts) yield Buffer.from(part);
}

interface CapturedResponse extends PluginHttpResponseWriter {
  status: number;
  headers: Record<string, string>;
  chunks: Buffer[];
  ended: boolean;
  text(): string;
}

function captureResponse(): CapturedResponse {
  const response: CapturedResponse = {
    status: 0,
    headers: {},
    chunks: [],
    ended: false,
    writeHead(status, headers) {
      response.status = status;
      response.headers = headers ?? {};
    },
    write(chunk) {
      response.chunks.push(Buffer.from(chunk as any));
    },
    end(chunk) {
      if (chunk !== undefined) response.chunks.push(Buffer.from(chunk as any));
      response.ended = true;
    },
    text() {
      return Buffer.concat(response.chunks).toString('utf8');
    },
  };
  return response;
}

function dispatchCtx(projectDir = '/repo', sessionID?: string) {
  return sessionID === undefined ? { projectDir } : { projectDir, sessionID };
}

afterAll(() => {
  for (const dir of TMP_DIRS) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('plugin http registry', () => {
  it('dispatches a package route with ticket context and rejects traversal', async () => {
    const reg = createPluginHttpRegistry({ log: silentLog });
    const seen: Record<string, unknown> = {};
    reg.register('demo', 'GET', '/files', async (req) => {
      seen.method = req.method;
      seen.path = req.path;
      seen.query = req.query.get('q');
      seen.header = req.headers['x-demo'];
      seen.sessionID = req.sessionID;
      seen.projectDir = req.projectDir;
      return {
        status: 201,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dir: req.projectDir }),
      };
    });

    expect(reg.routes()).toEqual([{ package: 'demo', method: 'GET', path: '/files', ws: false }]);
    expect(() => reg.register('demo', 'GET', '/../x', async () => ({}))).toThrow(/\.\./);

    const res = captureResponse();
    const handled = await reg.dispatch(
      'demo',
      {
        method: 'GET',
        path: '/files',
        query: new URLSearchParams('q=1'),
        headers: { 'x-demo': 'yes' },
        body: bodyOf(),
      },
      res,
      dispatchCtx('/repo', 'ses_1'),
    );

    expect(handled).toBe(true);
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.text()).toBe('{"dir":"/repo"}');
    expect(seen).toEqual({
      method: 'GET',
      path: '/files',
      query: '1',
      header: 'yes',
      sessionID: 'ses_1',
      projectDir: '/repo',
    });
  });

  it('rejects duplicate, malformed and unsupported registrations', () => {
    const reg = createPluginHttpRegistry({ log: silentLog });
    reg.register('demo', 'get', '/files', async () => ({}));

    expect(() => reg.register('demo', 'GET', '/files', async () => ({}))).toThrow(/duplicate/i);
    expect(() => reg.register('demo', 'GET', 'files', async () => ({}))).toThrow(/start with/i);
    expect(() => reg.register('demo', 'HEAD', '/files', async () => ({}))).toThrow(/method/i);
    expect(() => reg.register('demo', 'GET', '/a:b', async () => ({}))).toThrow(/:/);
    expect(() => reg.register('demo', 'GET', '/q?x=1', async () => ({}))).toThrow(/\?/);
    expect(() => reg.register('demo', 'GET', '/files', null as any)).toThrow(/handler/i);

    expect(reg.routes()).toEqual([{ package: 'demo', method: 'GET', path: '/files', ws: false }]);
  });

  it('does not handle an unknown package, method or path', async () => {
    const reg = createPluginHttpRegistry({ log: silentLog });
    reg.register('demo', 'GET', '/files', async () => ({ body: 'ok' }));
    const res = captureResponse();

    expect(await reg.dispatch('demo', { method: 'POST', path: '/files' }, res, dispatchCtx())).toBe(false);
    expect(await reg.dispatch('demo', { method: 'GET', path: '/other' }, res, dispatchCtx())).toBe(false);
    expect(await reg.dispatch('other', { method: 'GET', path: '/files' }, res, dispatchCtx())).toBe(false);
    expect(res.ended).toBe(false);
  });

  it('returns 204 when a handler produces no body and 413 when the body exceeds the cap', async () => {
    const reg = createPluginHttpRegistry({ log: silentLog });
    reg.register('demo', 'POST', '/empty', async () => undefined);
    reg.register('demo', 'POST', '/upload', async (req) => {
      for await (const _chunk of req.body) { /* consume */ }
      return { body: 'ok' };
    }, { maxBodyBytes: 4 });

    const empty = captureResponse();
    expect(await reg.dispatch('demo', { method: 'POST', path: '/empty' }, empty, dispatchCtx())).toBe(true);
    expect(empty.status).toBe(204);
    expect(empty.ended).toBe(true);

    const upload = captureResponse();
    expect(await reg.dispatch(
      'demo',
      { method: 'POST', path: '/upload', body: bodyOf('1234', '5678') },
      upload,
      dispatchCtx(),
    )).toBe(true);
    expect(upload.status).toBe(413);
    expect(silentLog.warn).toHaveBeenCalledWith(expect.stringContaining('body too large'));
  });

  it('maps handler errors to a logged 500 without leaking the message', async () => {
    const reg = createPluginHttpRegistry({ log: silentLog });
    reg.register('demo', 'GET', '/boom', async () => { throw new Error('secret detail'); });
    const res = captureResponse();

    expect(await reg.dispatch('demo', { method: 'GET', path: '/boom' }, res, dispatchCtx())).toBe(true);
    expect(res.status).toBe(500);
    expect(res.text()).toBe('{"error":"plugin handler failed"}');
    expect(silentLog.warn).toHaveBeenCalledWith(expect.stringContaining('secret detail'));
  });

  it('retire removes routes and closes live websockets', async () => {
    const reg = createPluginHttpRegistry({ log: silentLog });
    reg.registerWs('demo', '/term', (ws, ctx) => {
      ws.send(JSON.stringify(ctx));
    });

    const server = http.createServer();
    server.on('upgrade', (req, socket, head) => {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const relative = pathname.replace('/api/plugins/demo/ws', '');
      if (!reg.upgrade('demo', relative, req, socket, head, { projectDir: '/repo', sessionID: 'ses_9' })) {
        socket.destroy();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;

    const client = new WebSocket(`ws://127.0.0.1:${port}/api/plugins/demo/ws/term`);
    try {
      const hello = await new Promise<string>((resolve, reject) => {
        client.once('message', (data) => resolve(String(data)));
        client.once('error', reject);
      });
      expect(JSON.parse(hello)).toEqual({ projectDir: '/repo', sessionID: 'ses_9' });

      const closed = new Promise<number>((resolve) => client.once('close', (code) => resolve(code)));
      reg.retire('demo');
      expect(reg.routes()).toEqual([]);
      expect(await closed).toBe(1001);

      expect(reg.upgrade('demo', '/term', {} as any, {} as any, Buffer.alloc(0), { projectDir: '/repo' })).toBe(false);
    } finally {
      try { client.terminate(); } catch { /* already closed */ }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('plugin http recorder', () => {
  it('validates registrations and seals once activate returns', () => {
    const recorder = createPluginHttpRecorder('demo');

    recorder.api.route('GET', '/files', async () => ({}));
    expect(() => recorder.api.route('get', '/files', async () => ({}))).toThrow(/duplicate/i);
    expect(() => recorder.api.ws('/term/:id', () => {})).toThrow(/:/);
    expect(() => recorder.api.route('TRACE', '/files', async () => ({}))).toThrow(/method/i);

    expect(recorder.entries).toHaveLength(1);
    recorder.seal();
    expect(() => recorder.api.route('POST', '/late', async () => ({}))).toThrow(/activate/);
    expect(() => recorder.api.ws('/late', () => {})).toThrow(/activate/);
  });
});

describe('PluginHost http commit seam', () => {
  let dir: string;
  let host: PluginHost | undefined;

  beforeEach(() => {
    dir = mkTmp('mafw-http-');
    delete (globalThis as any).__mafwHttpMarker;
  });

  afterEach(() => {
    host?.stop();
    host = undefined;
  });

  it('registers routes only after commit and retires them on removal', async () => {
    const body = (marker: string) => `
module.exports = { name: 'demo', async activate(ctx) {
  ctx.http.route('GET', '/ping', async (req) => ({ body: '${marker}:' + req.projectDir }));
  ctx.http.ws('/term', () => {});
  return { usage: { name: 'demo', type: 'api', async fetch() { return null; } } };
} };
`;
    const pkgDir = writePackage(dir, 'demo', body('v1'));
    host = mkHost(dir);
    await host.init();

    const reg = host.getHttpRegistry();
    expect(reg.routes()).toEqual([
      { package: 'demo', method: 'GET', path: '/ping', ws: false },
      { package: 'demo', method: 'WS', path: '/term', ws: true },
    ]);
    const res = captureResponse();
    expect(await reg.dispatch('demo', { method: 'GET', path: '/ping' }, res, dispatchCtx('/repo', 's1'))).toBe(true);
    expect(res.text()).toBe('v1:/repo');

    // Deleted package: commit retires its routes.
    fs.rmSync(pkgDir, { recursive: true, force: true });
    await host.reload();
    expect(reg.routes()).toEqual([]);
    expect(await reg.dispatch('demo', { method: 'GET', path: '/ping' }, captureResponse(), dispatchCtx())).toBe(false);
  });

  it('does not expose a pending revision until applyPending commits it', async () => {
    // The package body reads its route path from a global: jest caches modules
    // across `require.cache` eviction, so a changed *body* would not be
    // re-evaluated. The file content still changes, which is what drives the
    // host's fingerprint → pending activation.
    const body = `
module.exports = { name: 'rt', async activate(ctx) {
  const marker = globalThis.__mafwHttpMarker || 'v1';
  ctx.http.route('GET', '/' + marker, async () => ({ body: marker }));
  return { runtime: { name: 'rt', async createRuntime() { return { name: 'rt', capabilities: {} }; } } };
} };
`;
    const file = path.join(dir, 'rt.js');
    writeFile(file, body);
    host = mkHost(dir, { activeRuntime: () => 'rt' });
    await host.init();

    const reg = host.getHttpRegistry();
    expect(reg.routes()).toEqual([{ package: 'rt', method: 'GET', path: '/v1', ws: false }]);

    (globalThis as any).__mafwHttpMarker = 'v2';
    fs.appendFileSync(file, '\n// v2\n');
    await host.reload();
    expect(host.getPending('rt')).not.toBeNull();
    // Old revision still serves; the new one is not reachable before commit.
    expect(reg.routes()).toEqual([{ package: 'rt', method: 'GET', path: '/v1', ws: false }]);

    const applied = await host.applyPending('rt');
    expect(applied.applied).toBe(true);
    expect(reg.routes()).toEqual([{ package: 'rt', method: 'GET', path: '/v2', ws: false }]);
    delete (globalThis as any).__mafwHttpMarker;
  });

  it('checkPackage validates ctx.http but never registers real routes', async () => {
    host = mkHost(dir);
    await host.init();

    const candidateRoot = mkTmp('mafw-http-candidate-');
    const candidate = writePackage(candidateRoot, 'checked', `
module.exports = { name: 'checked', async activate(ctx) {
  ctx.http.route('GET', '/probe', async () => ({ body: 'ok' }));
  return { usage: { name: 'checked', type: 'api', async fetch() { return null; } } };
} };
`);

    const checked = await host.checkPackage(candidate);
    expect(checked).toMatchObject({ ok: true, name: 'checked' });
    expect(host.getHttpRegistry().routes()).toEqual([]);

    const bad = writePackage(candidateRoot, 'bad', `
module.exports = { name: 'bad', async activate(ctx) {
  ctx.http.route('GET', '/../escape', async () => ({ body: 'ok' }));
  return { usage: { name: 'bad', type: 'api', async fetch() { return null; } } };
} };
`);
    const rejected = await host.checkPackage(bad);
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toMatch(/\.\./);
  });
});
