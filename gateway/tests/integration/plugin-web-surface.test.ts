/**
 * Task 10 — end-to-end proof for the shipped `web-surface-demo` package.
 *
 * The reference package in `docs/examples/plugins/web-surface-demo` is checked
 * and installed through the real PackageManager/PluginHost stack (temporary
 * plugin home), then its two self-served endpoints are exercised over real
 * HTTP:
 *
 *   1. install → the committed client descriptor projects `ui.webSurfaces[]`
 *      with the validated entry, scope, rail entry and the gateway asset URL;
 *   2. `GET /api/plugins/web-surface-demo/api/files` (registered through
 *      `ctx.http`, backed by `ctx.files`) returns the *ticket-bound* project's
 *      file tree — never the gateway's launch directory;
 *   3. a ticket minted for another package is rejected with 403 even on
 *      loopback, and the same cookie cannot read assets either;
 *   4. the package registers exactly the routes it declares and its
 *      action/event refresh loop reaches the broadcast sink;
 *   5. activation fails closed when the declared `web/` entry is missing.
 *
 * The asset/ticket/API routes are the real handlers from
 * `gateway/src/routes/plugin-web.ts`, wired with the Host's committed-package
 * accessors (`isPackageCommitted` / `getCommittedPackageDir` /
 * `getHttpRegistry`) exactly like `index.ts` does (the gateway process itself
 * is a singleton and is covered by its own route tests).
 */
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { createPluginPackageContext } from '../../src/plugins/package-context';
import { PluginHost, type PluginHostOptions } from '../../src/plugins/package-host';
import { PackageManager } from '../../src/plugins/package-manager';
import { PackageStateStore } from '../../src/plugins/package-state-store';
import { createPluginWebTicketStore } from '../../src/plugins/plugin-web-ticket';
import type { PluginWebTicketStore } from '../../src/plugins/plugin-web-ticket';
import {
  handlePluginApiRoute,
  handlePluginWebAsset,
  handlePluginWebTicket,
  parsePluginApiUrl,
  parsePluginWebAssetUrl,
  type PluginWebRouteDeps,
} from '../../src/routes/plugin-web';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEMO_DIR = path.join(REPO_ROOT, 'docs', 'examples', 'plugins', 'web-surface-demo');
const PACKAGE = 'web-surface-demo';
const CHANGED_EVENT = 'plugin:web-surface-demo:changed';

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
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
  options: { body?: string; headers?: Record<string, string> } = {},
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

describe('web-surface-demo package (end-to-end)', () => {
  let base: string;
  let pluginDir: string;
  let projectDir: string;
  let otherProjectDir: string;
  let stateStore: PackageStateStore;
  let host: PluginHost;
  let manager: PackageManager;
  let frames: any[];
  let server: http.Server | null;
  let tickets: PluginWebTicketStore;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-plugin-web-demo-'));
    pluginDir = path.join(base, 'plugins');
    projectDir = path.join(base, 'project');
    otherProjectDir = path.join(base, 'other-project');
    fs.mkdirSync(pluginDir, { recursive: true });
    writeFile(path.join(projectDir, 'src', 'index.ts'), 'export const answer = 42;\n');
    writeFile(path.join(projectDir, 'aaa.txt'), 'alpha\n');
    writeFile(path.join(projectDir, 'zzz.md'), '# zed\n');
    writeFile(path.join(projectDir, '.env'), 'SECRET=1\n');
    fs.mkdirSync(otherProjectDir, { recursive: true });
    writeFile(path.join(otherProjectDir, 'other.txt'), 'other\n');

    frames = [];
    server = null;
    tickets = createPluginWebTicketStore();
    stateStore = new PackageStateStore(base);

    const options: PluginHostOptions = {
      activeRuntime: () => null,
      isDisabled: (name) => stateStore.isDisabled(name),
      canonicalTypes: new Set(['turn.completed']),
      broadcast: (event) => { frames.push(event); },
    };
    host = new PluginHost(
      pluginDir,
      (name) => createPluginPackageContext(name, {
        projectDir: otherProjectDir,
        gatewayPort: 3000,
        // No PTY channel in this suite: the demo must still activate and its
        // WS route must answer with a neutral error instead of crashing.
        terminal: () => undefined,
      }),
      options,
    );
    manager = new PackageManager({ pluginDir, host, stateStore });
  });

  afterEach(async () => {
    if (server) await closeServer(server);
    host.stop();
    fs.rmSync(base, { recursive: true, force: true });
  });

  async function installDemo() {
    await host.reload();
    const installed = await manager.installFromPath({ path: DEMO_DIR });
    expect(installed).toMatchObject({ name: PACKAGE, saved: true, application: 'applied' });
    return installed;
  }

  function plugin() {
    const found = host.getClientSnapshot().plugins.find((entry) => entry.name === PACKAGE);
    expect(found).toBeDefined();
    return found!;
  }

  function makeDeps(): PluginWebRouteDeps {
    return {
      isActivePackage: (name) => host.isPackageCommitted(name),
      packageDir: (name) => host.getCommittedPackageDir(name),
      listProjects: () => [projectDir, otherProjectDir],
      tickets,
      httpRegistry: () => host.getHttpRegistry(),
      isLoopback: () => true,
      // Deliberately a *different* directory: a request without a ticket must
      // not be answered with the demo's project.
      defaultProjectDir: () => otherProjectDir,
      attachEventStream: () => () => undefined,
    };
  }

  function serve(): Promise<number> {
    const deps = makeDeps();
    server = http.createServer(async (req, res) => {
      try {
        const ticket = req.url?.match(/^\/api\/plugins\/([^/]+)\/web-ticket(?:\?|$)/);
        if (req.method === 'POST' && ticket) {
          await handlePluginWebTicket(req, res, deps, { name: decodeURIComponent(ticket[1]) });
          return;
        }
        const api = parsePluginApiUrl(req.url);
        if (api) {
          await handlePluginApiRoute(req, res, deps, api.name, api.path);
          return;
        }
        const asset = parsePluginWebAssetUrl(req.url);
        if (req.method === 'GET' && asset) {
          await handlePluginWebAsset(req, res, deps, { name: asset.name });
          return;
        }
      } catch (err: any) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err?.message ?? String(err) }));
        }
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });
    return listen(server);
  }

  function mintTicket(port: number, body: Record<string, unknown>) {
    return request(port, 'POST', `/api/plugins/${PACKAGE}/web-ticket`, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('installs the demo and projects its web surface with a gateway URL', async () => {
    await host.reload();
    const check = await manager.checkPath(DEMO_DIR);
    expect(check).toMatchObject({ ok: true, name: PACKAGE, version: '1.0.0' });
    // A check never installs or publishes anything.
    expect(host.getClientSnapshot().plugins).toEqual([]);

    const installed = await installDemo();
    expect(fs.existsSync(path.join(pluginDir, PACKAGE, 'web', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(pluginDir, PACKAGE, 'web', 'app.js'))).toBe(true);

    const descriptor = plugin();
    expect(descriptor.revision).toBe(installed.activeRevision);
    expect(descriptor.ui.panels).toBeUndefined();
    // The committed projection carries the validated defaults, the rail entry
    // and the gateway asset URL — clients never rebuild package paths.
    expect(descriptor.ui.webSurfaces).toEqual([
      {
        id: 'explorer',
        title: 'Web Surface Demo',
        icon: 'folder',
        entry: 'index.html',
        scope: 'project',
        reloadOnSessionChange: true,
        rail: { icon: 'folder', order: 10, badge: true },
        url: `/api/plugins/${PACKAGE}/ui/index.html`,
      },
    ]);
  });

  it('serves the page assets and answers GET /files with the ticket-bound project', async () => {
    await installDemo();
    const port = await serve();

    const ticketRes = await mintTicket(port, { projectDir, sessionID: 'ses_demo' });
    expect(ticketRes.status).toBe(200);
    const { ticket } = JSON.parse(ticketRes.body);
    expect(typeof ticket).toBe('string');
    const cookie = String(ticketRes.headers['set-cookie']);
    expect(cookie).toContain(`mafw_plugin_ticket=${ticket}`);
    expect(cookie).toContain(`Path=/api/plugins/${PACKAGE}/`);
    expect(cookie).toContain('HttpOnly');

    const page = await request(port, 'GET', `/api/plugins/${PACKAGE}/ui/index.html?revision=boot:2`, {
      headers: { Cookie: `mafw_plugin_ticket=${ticket}` },
    });
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(String(page.headers['content-security-policy'])).toContain("script-src 'self'");
    expect(page.body).toContain('app.js');
    expect(page.body).toContain('Project files');

    const files = await request(port, 'GET', `/api/plugins/${PACKAGE}/api/files`, {
      headers: { Cookie: `mafw_plugin_ticket=${ticket}` },
    });
    expect(files.status).toBe(200);
    expect(files.headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(files.body);
    // Ticket context wins over the loopback default (otherProjectDir).
    expect(body.projectDir).toBe(projectDir);
    expect(body.entries.map((entry: any) => entry.name)).toEqual(['src', 'aaa.txt', 'zzz.md']);
    expect(body.entries.map((entry: any) => entry.kind)).toEqual(['dir', 'file', 'file']);
    expect(body.entries[1].size).toBe(Buffer.byteLength('alpha\n'));
    // ctx.files hides dot entries; the page never sees .env.
    expect(files.body).not.toContain('.env');

    // The same route without the cookie falls back to the injected default.
    const fallback = await request(port, 'GET', `/api/plugins/${PACKAGE}/api/files`);
    expect(fallback.status).toBe(200);
    expect(JSON.parse(fallback.body).projectDir).toBe(otherProjectDir);
  });

  it('rejects a ticket minted for another package, even on loopback', async () => {
    await installDemo();
    const port = await serve();

    const foreign = tickets.issue('other-package', { projectDir });
    // The store itself is package-bound...
    expect(tickets.verify(PACKAGE, foreign.ticket)).toBeNull();
    expect(tickets.verify('other-package', foreign.ticket)).toEqual({ projectDir });

    // ...and presenting it to this package is a 403, not a loopback downgrade.
    const api = await request(port, 'GET', `/api/plugins/${PACKAGE}/api/files`, {
      headers: { 'x-mafw-plugin-ticket': foreign.ticket },
    });
    expect(api.status).toBe(403);

    const asset = await request(port, 'GET', `/api/plugins/${PACKAGE}/ui/index.html`, {
      headers: { 'x-mafw-plugin-ticket': foreign.ticket },
    });
    expect(asset.status).toBe(403);
  });

  it('registers exactly the declared routes and emits the refresh event', async () => {
    await installDemo();

    const routes = host.getHttpRegistry().routes().filter((route) => route.package === PACKAGE);
    expect(routes).toEqual([
      { package: PACKAGE, method: 'GET', path: '/files', ws: false },
      { package: PACKAGE, method: 'WS', path: '/term', ws: true },
    ]);

    const listed = await host.invokeAction(PACKAGE, 'listFiles', { projectDir }) as any;
    expect(listed.projectDir).toBe(projectDir);
    expect(listed.entries.map((entry: any) => entry.name)).toEqual(['src', 'aaa.txt', 'zzz.md']);

    const emitted = await host.invokeAction(PACKAGE, 'emitChanged', { source: 'integration' });
    expect(emitted).toEqual({ emitted: true, refreshes: 1 });

    const changed = frames.filter((frame) => frame.type === CHANGED_EVENT);
    expect(changed).toHaveLength(1);
    expect(changed[0].properties).toMatchObject({ source: 'integration', refreshes: 1 });
    expect(typeof changed[0].properties?.at).toBe('string');
  });

  it('fails closed when the declared web entry is missing', async () => {
    const broken = path.join(base, 'broken-source');
    fs.cpSync(DEMO_DIR, broken, { recursive: true });
    fs.rmSync(path.join(broken, 'web', 'index.html'));

    const check = await manager.checkPath(broken);
    expect(check.ok).toBe(false);
    expect(check.error).toContain('web surface "explorer"');
    expect(check.error).toContain('index.html');
    // A rejected candidate publishes nothing.
    expect(host.getClientSnapshot().plugins).toEqual([]);
  });
});
