/**
 * Task 4 — plugin Web surface gateway routes.
 *
 * Handler-level tests over real HTTP servers so status codes, headers, cookies,
 * streamed bodies and websocket handshakes are asserted on the wire (matching
 * the existing route-test style). The SSE test drives the captured broadcast
 * writer directly: the route must only forward `plugin:<pkg>:*` frames.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachWave2Handlers } from '../../../src/routes/wave2-handlers';
import {
  DEFAULT_PLUGIN_HTTP_MAX_BODY_BYTES,
  createPluginHttpRegistry,
} from '../../../src/plugins/plugin-http';
import { createPluginWebTicketStore } from '../../../src/plugins/plugin-web-ticket';
import {
  handlePluginApiRoute,
  handlePluginWebAsset,
  handlePluginWebEvents,
  handlePluginWebTicket,
  handlePluginWsUpgrade,
  parsePluginApiUrl,
  parsePluginWebAssetUrl,
  parsePluginWsUrl,
  pluginWebEventFilter,
  pluginWebOriginAllowed,
  resolvePluginWebProjectDir,
  type PluginWebRouteDeps,
} from '../../../src/routes/plugin-web';

const silentLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;

let tmpRoot: string;
let pkgDir: string;

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-plugin-web-routes-'));
  pkgDir = path.join(tmpRoot, 'demo');
  writeFile(path.join(pkgDir, 'web', 'index.html'), '<!doctype html><title>demo</title>');
  writeFile(path.join(pkgDir, 'web', 'app', 'app.js'), 'console.log(1)');
  writeFile(path.join(pkgDir, 'web', 'font.woff2'), 'w2');
  writeFile(path.join(pkgDir, 'web', 'blob.bin'), 'x');
  writeFile(path.join(pkgDir, 'web', '.env'), 'SECRET=1');
});

afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
});

interface TestDeps extends PluginWebRouteDeps {
  tickets: ReturnType<typeof createPluginWebTicketStore>;
  registry: ReturnType<typeof createPluginHttpRegistry>;
}

function makeDeps(over: Partial<PluginWebRouteDeps> = {}): TestDeps {
  const tickets = (over.tickets as TestDeps['tickets']) ?? createPluginWebTicketStore();
  const registry = createPluginHttpRegistry({ log: silentLog });
  return {
    isActivePackage: (name) => name === 'demo',
    packageDir: (name) => (name === 'demo' ? pkgDir : null),
    listProjects: () => ['/repo'],
    listWorktreeDirs: () => [],
    httpRegistry: () => registry,
    isLoopback: () => true,
    defaultProjectDir: () => '/repo',
    attachEventStream: () => () => undefined,
    ...over,
    tickets,
    registry,
  } as TestDeps;
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

interface WireResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(
  port: number,
  method: string,
  requestPath: string,
  options: { body?: string | Buffer; headers?: Record<string, string> } = {},
): Promise<WireResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: requestPath,
        method,
        headers: {
          ...(options.headers ?? {}),
          ...(options.body !== undefined
            ? { 'Content-Length': Buffer.byteLength(options.body) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      if (predicate()) return resolve();
      if (Date.now() > deadline) return reject(new Error('waitUntil timed out'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

function servePluginWeb(deps: PluginWebRouteDeps): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const ticket = req.url?.match(/^\/api\/plugins\/([^/]+)\/web-ticket(?:\?|$)/);
      if (req.method === 'POST' && ticket) {
        await handlePluginWebTicket(req, res, deps, { name: decodeURIComponent(ticket[1]) });
        return;
      }
      const events = req.url?.match(/^\/api\/plugins\/([^/]+)\/events(?:\?|$)/);
      if (req.method === 'GET' && events) {
        await handlePluginWebEvents(req, res, deps, { name: decodeURIComponent(events[1]) });
        return;
      }
      const asset = parsePluginWebAssetUrl(req.url);
      if (req.method === 'GET' && asset) {
        await handlePluginWebAsset(req, res, deps, { name: asset.name });
        return;
      }
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err?.message ?? String(err) }));
      }
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

function servePluginApi(deps: PluginWebRouteDeps): http.Server {
  return http.createServer(async (req, res) => {
    const parsed = parsePluginApiUrl(req.url);
    if (!parsed) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    await handlePluginApiRoute(req, res, deps, parsed.name, parsed.path);
  });
}

describe('plugin web project scope', () => {
  it('accepts projects, worktrees and directories below either', () => {
    const repo = fs.mkdtempSync(path.join(tmpRoot, 'scope-repo-'));
    const sub = path.join(repo, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    const worktree = fs.mkdtempSync(path.join(tmpRoot, 'scope-wt-'));
    const worktreeSub = path.join(worktree, 'src');
    fs.mkdirSync(worktreeSub, { recursive: true });
    const scope = { projects: [repo], worktrees: [worktree] };

    expect(resolvePluginWebProjectDir(scope, repo)).toBe(repo);
    expect(resolvePluginWebProjectDir(scope, path.join(repo, '..', path.basename(repo)))).toBe(repo);
    expect(resolvePluginWebProjectDir(scope, sub)).toBe(fs.realpathSync(sub));
    expect(resolvePluginWebProjectDir(scope, worktree)).toBe(worktree);
    expect(resolvePluginWebProjectDir(scope, worktreeSub)).toBe(fs.realpathSync(worktreeSub));

    expect(resolvePluginWebProjectDir(scope, path.join(tmpRoot, 'nope'))).toBeNull();
    expect(resolvePluginWebProjectDir(scope, '')).toBeNull();
    expect(resolvePluginWebProjectDir(scope, '/etc')).toBeNull();
    // A sibling that merely shares a prefix is not a subdirectory.
    expect(resolvePluginWebProjectDir({ projects: [repo] }, `${repo}-other`)).toBeNull();
    // Without worktree knowledge the worktree is rejected.
    expect(resolvePluginWebProjectDir({ projects: [repo] }, worktree)).toBeNull();
  });
});

describe('plugin web origin check', () => {
  const fakeReq = (headers: Record<string, string>) => ({ headers } as unknown as http.IncomingMessage);

  it('accepts the gateway origin and non-browser clients', () => {
    expect(pluginWebOriginAllowed(fakeReq({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }))).toBe(true);
    expect(pluginWebOriginAllowed(fakeReq({ host: '127.0.0.1:3000' }))).toBe(true);
    expect(pluginWebOriginAllowed(fakeReq({ host: '127.0.0.1:3000', 'sec-fetch-site': 'same-origin' }))).toBe(true);
  });

  it('rejects foreign, null and cross-site browser requests', () => {
    expect(pluginWebOriginAllowed(fakeReq({ host: '127.0.0.1:3000', origin: 'http://evil.test' }))).toBe(false);
    expect(pluginWebOriginAllowed(fakeReq({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3999' }))).toBe(false);
    expect(pluginWebOriginAllowed(fakeReq({ host: '127.0.0.1:3000', origin: 'null' }))).toBe(false);
    expect(pluginWebOriginAllowed(fakeReq({ host: '127.0.0.1:3000', 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(pluginWebOriginAllowed(fakeReq({ host: '127.0.0.1:3000', origin: 'file:///C:/x' }))).toBe(false);
    expect(pluginWebOriginAllowed(fakeReq({ origin: 'http://127.0.0.1:3000' }))).toBe(false);
  });
});

describe('plugin web ticket route', () => {
  let server: http.Server;
  let port: number;

  afterEach(async () => {
    await closeServer(server);
  });

  it('issues a project-bound ticket and sets the path-scoped cookie', async () => {
    const deps = makeDeps();
    server = servePluginWeb(deps);
    port = await listen(server);

    const res = await request(port, 'POST', '/api/plugins/demo/web-ticket', {
      body: JSON.stringify({ projectDir: '/repo', sessionID: 'ses_1' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.ticket).toMatch(/^[0-9a-f]{48}$/);
    expect(payload.expiresAt).toBeGreaterThan(Date.now());

    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`mafw_plugin_ticket=${payload.ticket}`);
    expect(cookie).toContain('Path=/api/plugins/demo/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    // The ticket is a credential: this response must not be CORS-readable.
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');

    expect(deps.tickets.verify('demo', payload.ticket)).toEqual({
      projectDir: '/repo',
      sessionID: 'ses_1',
    });
  });

  it('rejects a ticket for an unregistered project', async () => {
    server = servePluginWeb(makeDeps());
    port = await listen(server);

    const res = await request(port, 'POST', '/api/plugins/demo/web-ticket', {
      body: JSON.stringify({ projectDir: '/etc' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toContain('registered');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('accepts a canonical-equivalent project directory', async () => {
    const deps = makeDeps({ listProjects: () => ['/repo'] });
    server = servePluginWeb(deps);
    port = await listen(server);

    const res = await request(port, 'POST', '/api/plugins/demo/web-ticket', {
      body: JSON.stringify({ projectDir: '/repo/../repo' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(deps.tickets.verify('demo', JSON.parse(res.body).ticket)?.projectDir).toBe('/repo');
  });

  it('is loopback-only and requires an active package', async () => {
    server = servePluginWeb(makeDeps({ isLoopback: () => false }));
    port = await listen(server);
    const remote = await request(port, 'POST', '/api/plugins/demo/web-ticket', {
      body: JSON.stringify({ projectDir: '/repo' }),
    });
    expect(remote.status).toBe(403);
    await closeServer(server);

    server = servePluginWeb(makeDeps({ isActivePackage: () => false }));
    port = await listen(server);
    const inactive = await request(port, 'POST', '/api/plugins/demo/web-ticket', {
      body: JSON.stringify({ projectDir: '/repo' }),
    });
    expect(inactive.status).toBe(404);
  });

  it('rejects malformed bodies without leaking parser internals', async () => {
    server = servePluginWeb(makeDeps());
    port = await listen(server);

    const res = await request(port, 'POST', '/api/plugins/demo/web-ticket', {
      body: '{not json',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toContain('invalid JSON');
  });

  it('accepts a subdirectory of a registered project and a known worktree directory', async () => {
    const repo = fs.mkdtempSync(path.join(tmpRoot, 'repo-'));
    const sub = path.join(repo, 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    const worktree = fs.mkdtempSync(path.join(tmpRoot, 'repo-wt-'));
    const deps = makeDeps({ listProjects: () => [repo], listWorktreeDirs: () => [worktree] });
    server = servePluginWeb(deps);
    port = await listen(server);

    const inside = await request(port, 'POST', '/api/plugins/demo/web-ticket', {
      body: JSON.stringify({ projectDir: sub, sessionID: 'ses_wt' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(inside.status).toBe(200);
    const insideBinding = deps.tickets.verify('demo', JSON.parse(inside.body).ticket);
    // Subdir sessions (monorepo benches) bind their own directory, canonicalized.
    expect(insideBinding?.projectDir).toBe(fs.realpathSync(sub));
    expect(insideBinding?.sessionID).toBe('ses_wt');

    const wt = await request(port, 'POST', '/api/plugins/demo/web-ticket', {
      body: JSON.stringify({ projectDir: worktree }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(wt.status).toBe(200);
    const wtBinding = deps.tickets.verify('demo', JSON.parse(wt.body).ticket);
    // Worktrees sit beside the project, so they are accepted explicitly.
    expect(wtBinding?.projectDir).toBe(worktree);

    // Still not a blank cheque: an unrelated directory stays a 400.
    const outside = await request(port, 'POST', '/api/plugins/demo/web-ticket', {
      body: JSON.stringify({ projectDir: path.join(tmpRoot, 'elsewhere') }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(outside.status).toBe(400);
  });

  it('rejects a ticket mint for a foreign browser Origin', async () => {
    server = servePluginWeb(makeDeps());
    port = await listen(server);

    for (const headers of [
      { Origin: 'http://evil.test' },
      { Origin: 'null' },
      { Origin: 'http://127.0.0.1:3999' },
      { 'Sec-Fetch-Site': 'cross-site' },
      // DNS rebinding: Origin and Host agree, so only the loopback-host rule
      // stops the mint (the socket peer is loopback).
      { Host: 'evil.example:3000', Origin: 'http://evil.example:3000' },
    ]) {
      const res = await request(port, 'POST', '/api/plugins/demo/web-ticket', {
        body: JSON.stringify({ projectDir: '/repo' }),
        headers: { 'Content-Type': 'application/json', ...headers },
      });
      expect(res.status).toBe(403);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});

describe('plugin web asset route', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    server = servePluginWeb(makeDeps());
    port = await listen(server);
  });

  afterEach(async () => {
    await closeServer(server);
  });

  it('serves nested assets with the MIME whitelist, CSP and no-store', async () => {
    const res = await request(port, 'GET', '/api/plugins/demo/ui/app/app.js?revision=b1%3A2');

    expect(res.status).toBe(200);
    expect(res.body).toBe('console.log(1)');
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'self'");
    expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
  });

  it('strips the query string and defaults the base URL to index.html', async () => {
    const withQuery = await request(port, 'GET', '/api/plugins/demo/ui?revision=b1%3A2');
    expect(withQuery.status).toBe(200);
    expect(withQuery.body).toContain('<title>demo</title>');
  });

  it('404s unknown extensions instead of serving them as text/plain', async () => {
    const res = await request(port, 'GET', '/api/plugins/demo/ui/blob.bin');
    expect(res.status).toBe(404);
  });

  it('serves the extended MIME table', async () => {
    const res = await request(port, 'GET', '/api/plugins/demo/ui/font.woff2');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('font/woff2');
  });

  it('404s traversal, dotfiles, missing files and inactive packages', async () => {
    expect((await request(port, 'GET', '/api/plugins/demo/ui/..%2findex.html')).status).toBe(404);
    expect((await request(port, 'GET', '/api/plugins/demo/ui/.env')).status).toBe(404);
    expect((await request(port, 'GET', '/api/plugins/demo/ui/missing.html')).status).toBe(404);
    expect((await request(port, 'GET', '/api/plugins/other/ui/index.html')).status).toBe(404);
  });

  it('rejects a ticket issued for another package even on loopback', async () => {
    const deps = makeDeps();
    const foreign = deps.tickets.issue('other', { projectDir: '/repo' });
    server.close();
    server = servePluginWeb(deps);
    port = await listen(server);

    const res = await request(port, 'GET', '/api/plugins/demo/ui/index.html', {
      headers: { Cookie: `mafw_plugin_ticket=${foreign.ticket}` },
    });
    expect(res.status).toBe(403);
  });
});

describe('plugin web events route', () => {
  it('filters by package and optional session', () => {
    const session = pluginWebEventFilter('demo', 's1');
    expect(session('data: {"type":"plugin:demo:x","sessionID":"s1"}\n\n')).toBe(true);
    expect(session('id: 3\ndata: {"type":"plugin:demo:x","sessionID":"s2"}\n\n')).toBe(false);
    expect(session('data: {"type":"plugin:other:x","sessionID":"s1"}\n\n')).toBe(false);
    expect(session('data: not-json\n\n')).toBe(false);
    expect(session(': ping\n\n')).toBe(false);

    const global = pluginWebEventFilter('demo');
    expect(global('data: {"type":"plugin:demo:x"}\n\n')).toBe(true);
    expect(global('data: {"type":"plugin:demo:x","sessionID":"s9"}\n\n')).toBe(true);
  });

  it('opens an SSE stream and forwards only this package/session frames', async () => {
    let write: ((frame: string, seq: number | null) => void) | undefined;
    let cleaned = 0;
    const deps = makeDeps({
      attachEventStream: (_res, sink) => {
        write = sink;
        return () => { cleaned += 1; };
      },
    });
    const ticket = deps.tickets.issue('demo', { projectDir: '/repo', sessionID: 's1' });
    const server = servePluginWeb(deps);
    const port = await listen(server);

    const text: string[] = [];
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: '/api/plugins/demo/events?sessionID=s1',
      headers: { Cookie: `mafw_plugin_ticket=${ticket.ticket}` },
    }, (res) => {
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toContain('text/event-stream');
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => text.push(chunk));
    });
    const joined = (): string => text.join('');

    await waitUntil(() => joined().includes('"type":"connected"'));
    expect(joined()).toContain('"package":"demo"');

    write?.('data: {"type":"plugin:demo:hit","sessionID":"s1","properties":{"n":1}}\n\n', 1);
    write?.('data: {"type":"plugin:demo:hit","sessionID":"s2","properties":{"n":2}}\n\n', 2);
    write?.('data: {"type":"plugin:other:hit","sessionID":"s1","properties":{"n":3}}\n\n', 3);
    write?.('id: 4\ndata: {"type":"plugin:demo:hit","sessionID":"s1","properties":{"n":4}}\n\n', 4);

    await waitUntil(() => (joined().match(/plugin:demo:hit/g) ?? []).length >= 2);
    const body = joined();
    expect(body).toContain('"n":1');
    expect(body).toContain('"n":4');
    expect(body).not.toContain('"n":2');
    expect(body).not.toContain('"n":3');

    req.destroy();
    await waitUntil(() => cleaned === 1);
    await closeServer(server);
  });

  it('requires the ticket even on loopback and 404s inactive packages', async () => {
    const server = servePluginWeb(makeDeps());
    const port = await listen(server);

    const denied = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.get({ hostname: '127.0.0.1', port, path: '/api/plugins/demo/events' }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
    });
    expect(denied.status).toBe(403);
    expect(JSON.parse(denied.body).error).toContain('ticket');
    await closeServer(server);

    const inactiveServer = servePluginWeb(makeDeps({ isActivePackage: () => false }));
    const inactivePort = await listen(inactiveServer);
    const inactive = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.get(
        { hostname: '127.0.0.1', port: inactivePort, path: '/api/plugins/demo/events' },
        (res) => { res.resume(); resolve({ status: res.statusCode ?? 0 }); },
      );
      req.on('error', reject);
    });
    expect(inactive.status).toBe(404);
    await closeServer(inactiveServer);
  });
});

describe('plugin API pass-through', () => {
  it('parses namespaces and paths', () => {
    expect(parsePluginApiUrl('/api/plugins/demo/api/files?q=1')).toEqual({ name: 'demo', path: '/files' });
    expect(parsePluginApiUrl('/api/plugins/demo/api')).toEqual({ name: 'demo', path: '' });
    expect(parsePluginApiUrl('/api/plugins/demo/ui/files')).toBeNull();
  });

  it('requires the ticket even on loopback for execution routes', async () => {
    const deps = makeDeps();
    deps.registry.register('demo', 'GET', '/state', async (req) => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectDir: req.projectDir, sessionID: req.sessionID ?? null }),
    }));
    const server = servePluginApi(deps);
    const port = await listen(server);

    // Loopback alone is not authorization: any web page can reach the port.
    const denied = await request(port, 'GET', '/api/plugins/demo/api/state');
    expect(denied.status).toBe(403);
    expect(JSON.parse(denied.body).error).toContain('ticket');

    const ticket = deps.tickets.issue('demo', { projectDir: '/ticket-repo' });
    const res = await request(port, 'GET', '/api/plugins/demo/api/state', {
      headers: { Cookie: `mafw_plugin_ticket=${ticket.ticket}` },
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ projectDir: '/ticket-repo', sessionID: null });
    await closeServer(server);
  });

  it('uses the ticket binding for projectDir/sessionID', async () => {
    const deps = makeDeps({ defaultProjectDir: () => '/wrong' });
    const ticket = deps.tickets.issue('demo', { projectDir: '/ticket-repo', sessionID: 'ses_9' });
    deps.registry.register('demo', 'GET', '/state', async (req) => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectDir: req.projectDir, sessionID: req.sessionID ?? null }),
    }));
    const server = servePluginApi(deps);
    const port = await listen(server);

    const res = await request(port, 'GET', '/api/plugins/demo/api/state', {
      headers: { Cookie: `mafw_plugin_ticket=${ticket.ticket}` },
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ projectDir: '/ticket-repo', sessionID: 'ses_9' });
    await closeServer(server);
  });

  it('accepts the x-mafw-plugin-ticket header for non-loopback clients', async () => {
    const deps = makeDeps({ isLoopback: () => false });
    const ticket = deps.tickets.issue('demo', { projectDir: '/repo', sessionID: 's2' });
    deps.registry.register('demo', 'GET', '/state', async (req) => ({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectDir: req.projectDir, sessionID: req.sessionID ?? null }),
    }));
    const server = servePluginApi(deps);
    const port = await listen(server);

    expect((await request(port, 'GET', '/api/plugins/demo/api/state')).status).toBe(403);
    const res = await request(port, 'GET', '/api/plugins/demo/api/state', {
      headers: { 'x-mafw-plugin-ticket': ticket.ticket },
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ projectDir: '/repo', sessionID: 's2' });

    const foreign = deps.tickets.issue('other', { projectDir: '/repo' });
    const cross = await request(port, 'GET', '/api/plugins/demo/api/state', {
      headers: { 'x-mafw-plugin-ticket': foreign.ticket },
    });
    expect(cross.status).toBe(403);
    await closeServer(server);
  });

  it('404s unknown routes and inactive packages (with a valid ticket)', async () => {
    const deps = makeDeps();
    const ticket = deps.tickets.issue('demo', { projectDir: '/repo' });
    const server = servePluginApi(deps);
    const port = await listen(server);

    const missing = await request(port, 'GET', '/api/plugins/demo/api/nope', {
      headers: { Cookie: `mafw_plugin_ticket=${ticket.ticket}` },
    });
    expect(missing.status).toBe(404);
    expect(JSON.parse(missing.body).error).toContain('no plugin route');

    await closeServer(server);
    const inactiveServer = servePluginApi(makeDeps({ isActivePackage: () => false }));
    const inactivePort = await listen(inactiveServer);
    expect((await request(inactivePort, 'GET', '/api/plugins/demo/api/state')).status).toBe(404);
    await closeServer(inactiveServer);
  });

  it('streams an async iterable response without buffering it', async () => {
    const deps = makeDeps();
    const ticket = deps.tickets.issue('demo', { projectDir: '/repo' });
    deps.registry.register('demo', 'GET', '/stream', async () => ({
      headers: { 'content-type': 'application/octet-stream' },
      body: (async function* () {
        for (let i = 0; i < 64; i += 1) yield Buffer.from('x');
      })(),
    }));
    const server = servePluginApi(deps);
    const port = await listen(server);

    const res = await request(port, 'GET', '/api/plugins/demo/api/stream', {
      headers: { Cookie: `mafw_plugin_ticket=${ticket.ticket}` },
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe('x'.repeat(64));
    expect(res.headers['transfer-encoding']).toBe('chunked');
    expect(res.headers['content-length']).toBeUndefined();
    await closeServer(server);
  });

  it('pins the default 32 MiB body cap', () => {
    expect(DEFAULT_PLUGIN_HTTP_MAX_BODY_BYTES).toBe(32 * 1024 * 1024);
  });

  it('answers 413 and drains the request when a route body cap is exceeded', async () => {
    const deps = makeDeps();
    const ticket = deps.tickets.issue('demo', { projectDir: '/repo' });
    deps.registry.register('demo', 'POST', '/small', async (req) => {
      for await (const _chunk of req.body) { /* drain */ }
      return { status: 200, body: 'ok' };
    }, { maxBodyBytes: 1024 });

    let completed = false;
    const server = http.createServer(async (req, res) => {
      req.on('end', () => { completed = true; });
      const parsed = parsePluginApiUrl(req.url);
      if (!parsed) { res.writeHead(404); res.end(); return; }
      await handlePluginApiRoute(req, res, deps, parsed.name, parsed.path);
    });
    const port = await listen(server);

    const res = await request(port, 'POST', '/api/plugins/demo/api/small', {
      body: 'y'.repeat(64 * 1024),
      headers: {
        'Content-Type': 'text/plain',
        Cookie: `mafw_plugin_ticket=${ticket.ticket}`,
      },
    });
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body).error).toContain('body too large');

    // A drained request reaches its end event instead of resetting the socket.
    await waitUntil(() => completed);
    await closeServer(server);
  });
});

describe('plugin websocket upgrade', () => {
  function startWsServer(deps: PluginWebRouteDeps): http.Server {
    const server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    server.on('upgrade', (req, socket, head) => {
      if (handlePluginWsUpgrade(deps, req, socket, head)) return;
      socket.destroy();
    });
    return server;
  }

  function openSocket(port: number, requestPath: string, headers: Record<string, string> = {}): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${requestPath}`, { headers });
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }

  function socketFailure(port: number, requestPath: string, headers: Record<string, string> = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ws failure timed out')), 2000);
      const done = (message: string): void => { clearTimeout(timer); resolve(message); };
      const ws = new WebSocket(`ws://127.0.0.1:${port}${requestPath}`, { headers });
      ws.once('unexpected-response', (_req, res) => done(`status ${res.statusCode}`));
      ws.once('error', (err) => done(err.message));
    });
  }

  it('parses ws URLs', () => {
    expect(parsePluginWsUrl('/api/plugins/demo/ws/feed')).toEqual({ name: 'demo', path: '/feed' });
    expect(parsePluginWsUrl('/api/plugins/demo/ws')).toEqual({ name: 'demo', path: '' });
    expect(parsePluginWsUrl('/api/ws')).toBeNull();
  });

  it('upgrades with the ticket context and echoes through the registry handler', async () => {
    const deps = makeDeps();
    const ticket = deps.tickets.issue('demo', { projectDir: '/ticket-repo' });
    deps.registry.registerWs('demo', '/echo', (ws, ctx) => {
      ws.on('message', (data) => {
        if (String(data) === 'ctx') ws.send(JSON.stringify(ctx));
        else ws.send(String(data));
      });
    });
    const server = startWsServer(deps);
    const port = await listen(server);

    const ws = await openSocket(port, '/api/plugins/demo/ws/echo', {
      cookie: `mafw_plugin_ticket=${ticket.ticket}`,
    });
    const next = (): Promise<string> => new Promise((resolve) => ws.once('message', (d) => resolve(String(d))));
    ws.send('ctx');
    expect(JSON.parse(await next())).toEqual({ projectDir: '/ticket-repo' });

    ws.send('ping');
    expect(await next()).toBe('ping');
    ws.terminate();
    await closeServer(server);
  });

  it('uses the ticket binding (cookie or header) for the ws context', async () => {
    const deps = makeDeps({ defaultProjectDir: () => '/wrong' });
    const ticket = deps.tickets.issue('demo', { projectDir: '/ticket-repo', sessionID: 'ses_7' });
    deps.registry.registerWs('demo', '', (ws, ctx) => {
      ws.on('message', () => ws.send(JSON.stringify(ctx)));
    });
    const server = startWsServer(deps);
    const port = await listen(server);

    const ws = await openSocket(port, '/api/plugins/demo/ws', {
      cookie: `mafw_plugin_ticket=${ticket.ticket}`,
    });
    const first = new Promise<string>((resolve) => ws.once('message', (d) => resolve(String(d))));
    ws.send('ctx');
    expect(JSON.parse(await first)).toEqual({ projectDir: '/ticket-repo', sessionID: 'ses_7' });
    ws.terminate();
    await closeServer(server);
  });

  it('rejects missing/cross-package tickets even on loopback and unknown routes', async () => {
    const deniedDeps = makeDeps();
    deniedDeps.registry.registerWs('demo', '/echo', () => {});
    const deniedServer = startWsServer(deniedDeps);
    const deniedPort = await listen(deniedServer);
    // Loopback is not authorization: a page from any site can reach it.
    expect(await socketFailure(deniedPort, '/api/plugins/demo/ws/echo')).toContain('403');
    await closeServer(deniedServer);

    const deps = makeDeps();
    deps.registry.registerWs('demo', '/echo', () => {});
    const ticket = deps.tickets.issue('demo', { projectDir: '/repo' });
    const foreign = deps.tickets.issue('other', { projectDir: '/repo' });
    const server = startWsServer(deps);
    const port = await listen(server);
    expect(await socketFailure(port, '/api/plugins/demo/ws/echo', {
      cookie: `mafw_plugin_ticket=${foreign.ticket}`,
    })).toContain('403');
    expect(await socketFailure(port, '/api/plugins/demo/ws/missing', {
      cookie: `mafw_plugin_ticket=${ticket.ticket}`,
    })).toContain('404');
    await closeServer(server);
  });

  it('rejects a foreign browser Origin even with a valid ticket', async () => {
    const deps = makeDeps();
    const ticket = deps.tickets.issue('demo', { projectDir: '/repo' });
    deps.registry.registerWs('demo', '/term', (ws, ctx) => ws.send(JSON.stringify(ctx)));
    const server = startWsServer(deps);
    const port = await listen(server);
    const cookie = `mafw_plugin_ticket=${ticket.ticket}`;

    expect(await socketFailure(port, '/api/plugins/demo/ws/term', {
      cookie,
      origin: 'http://evil.test',
    })).toContain('403');

    // The gateway's own origin (the desktop webview page) is accepted.
    const ok = await openSocket(port, '/api/plugins/demo/ws/term', {
      cookie,
      origin: `http://127.0.0.1:${port}`,
    });
    ok.terminate();
    await closeServer(server);
  });
});

describe('route catalog', () => {
  it('registers the three plugin web operations', () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    expect(registry.match('POST', '/api/plugins/demo/web-ticket')?.def.operationId).toBe('plugins.webTicket');
    expect(registry.match('GET', '/api/plugins/demo/ui')?.def.operationId).toBe('plugins.webAsset');
    expect(registry.match('GET', '/api/plugins/demo/events')?.def.operationId).toBe('plugins.webEvents');
  });

  it('attaches the handlers through the Wave 2 wiring', () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachWave2Handlers(registry, {
      runtimeDeps: () => ({} as any),
      restartAgentDeps: () => ({} as any),
      conformanceDeps: () => ({} as any),
      pluginHubDeps: () => ({ hub: { dirs: {} } } as any),
      pluginPackageDeps: () => ({} as any),
      pluginWebDeps: () => ({} as any),
      dryEventDeps: () => ({} as any),
      runtimeSwitchBlocked: () => false,
      beginRuntimeSwitch: () => undefined,
      endRuntimeSwitch: () => undefined,
    });

    const attached = registry.attachedOperationIds();
    expect(attached.has('plugins.webTicket')).toBe(true);
    expect(attached.has('plugins.webAsset')).toBe(true);
    expect(attached.has('plugins.webEvents')).toBe(true);
    expect(registry.match('POST', '/api/plugins/demo/web-ticket')?.def.handler).toBeDefined();
  });
});
