/**
 * Creator tools — read-only plugin contract inspection (Task 2) and the native
 * approval bridge (Task 3).
 *
 * The Creator agent may be wrong about the host contract: slots, widget names
 * and limits are validated by `@mafw/plugin-contract`, not by memory. These
 * tests pin that `mafw_plugin_inspect` answers from the public snapshot and the
 * three read-only gateway endpoints only — no actions, no writes, no approvals.
 *
 * `approveCreatorOperation` is the other half: every Creator code-execution or
 * write must go through the host's native `ask` unless the session is
 * `full-access`, and "cannot ask" must fail closed instead of mutating.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PLUGIN_UI_LIMITS } from '@mafw/plugin-contract';

import { pluginInspectTool } from '../src/tools/plugin-inspect';
import { fingerprintDraft } from '../src/tools/plugin-draft';
import { runDraftTests } from '../src/tools/plugin-test-runner';
import { pluginManagerTool } from '../src/tools/plugin-manager';
import { PLUGIN_PUBLIC_CONTRACT } from '../src/tools/plugin-public-contract';
import {
  CREATOR_PERMISSION,
  approveCreatorOperation,
} from '../src/tools/plugin-approval';
import {
  pluginGatewayGet,
  pluginGatewayPost,
  type PluginToolContext,
} from '../src/tools/plugin-common';

// ---------------------------------------------------------------- helpers

const realFetch = global.fetch;

const ctx: PluginToolContext = { sessionID: 'ses_creator' };

function jsonResponse(data: unknown, status = 200): any {
  const body = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

interface FetchRoutes {
  inventory?: unknown;
  client?: unknown;
  experience?: unknown;
}

function installFetch(routes: FetchRoutes = {}): { calls: string[] } {
  const calls: string[] = [];
  global.fetch = jest.fn(async (url: any) => {
    const target = String(url);
    calls.push(target);
    if (target.includes('/api/experience/actions')) {
      return jsonResponse(routes.experience ?? { experienceVersion: 'test', actions: {} });
    }
    if (target.includes('/api/plugins/client')) {
      return jsonResponse(routes.client ?? { revision: 'boot:1', plugins: [] });
    }
    if (target.includes('/api/plugins')) {
      return jsonResponse(routes.inventory ?? { plugins: [], packages: [], revision: 'boot:1' });
    }
    return jsonResponse({ error: 'unexpected endpoint' }, 404);
  }) as any;
  return { calls };
}

/** Serves one session-permission mode from `GET /api/session/<id>/config`. */
function mockSessionMode(mode: string): { calls: Array<{ url: string; init: any }> } {
  const calls: Array<{ url: string; init: any }> = [];
  global.fetch = jest.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/config')) return jsonResponse({ mode });
    return jsonResponse({ error: 'unexpected endpoint' }, 404);
  }) as any;
  return { calls };
}

/**
 * Serves one package entry from both endpoints the package projection reads.
 *
 * Extra keys (a runtime name, a host handler) are deliberately spread into both
 * payloads: the projection must drop everything the public contract does not
 * declare.
 */
function mockPluginFetch(entry: Record<string, unknown>): { calls: string[] } {
  return installFetch({
    inventory: {
      plugins: [],
      packages: [{ ...entry, status: 'ok', contributions: ['ui', 'actions'] }],
      revision: 'boot:1',
    },
    client: { revision: 'boot:1', plugins: [{ ...entry, revision: 'boot:1' }] },
  });
}

/** Full public package fixture (used by the query-kind coverage test). */
function acmeEntry(): Record<string, unknown> {
  return {
    name: 'acme',
    version: '1.2.0',
    revision: 'boot:7',
    title: 'Acme',
    description: 'demo package',
    ui: {
      panels: [{ id: 'acme.panel', title: 'Acme', viewAction: 'view' }],
      toolCards: [{ id: 'acme.card', tools: ['bash'], viewAction: 'card' }],
      configPages: [{
        id: 'acme.config',
        title: 'Config',
        schema: { type: 'object', properties: {} },
        loadAction: 'load',
        saveAction: 'save',
      }],
      messageWindows: [{
        id: 'acme.window',
        title: 'Window',
        triggerEvent: 'plugin:acme:ping',
        viewAction: 'window',
      }],
    },
    actions: [{ name: 'view', title: 'View', inputSchema: { type: 'object' } }],
    events: [{ type: 'plugin:acme:ping', title: 'Ping', scope: 'session' }],
    diagnostics: [{ level: 'warning', message: 'demo warning' }],
    pendingRevision: 'boot:8',
    // Host-private fields that must never reach the agent.
    runtimeName: 'opencode',
    handler: () => 1,
    source: '/home/user/.mafw/plugins/acme',
    fingerprint: 'deadbeef',
  };
}

function parse(result: any): any {
  return JSON.parse(result.output);
}

beforeEach(() => {
  jest.useRealTimers();
});

afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
});

// ------------------------------------------------------ public contract

test('slots and widgetSchema expose the public contract only', async () => {
  installFetch();
  const slots: any = await pluginInspectTool.execute({ query: 'slots' }, ctx);
  expect(JSON.parse(slots.output).slots).toEqual([
    'panels', 'toolCards', 'configPages', 'messageWindows',
  ]);
  const schema: any = await pluginInspectTool.execute({ query: 'widgetSchema' }, ctx);
  expect(JSON.parse(schema.output).limits.maxWidgets).toBe(256);
});

test('the public snapshot stays in sync with @mafw/plugin-contract', () => {
  expect(PLUGIN_PUBLIC_CONTRACT.limits).toEqual(PLUGIN_UI_LIMITS);
  expect(PLUGIN_PUBLIC_CONTRACT.slots).toEqual([
    'panels', 'toolCards', 'configPages', 'messageWindows',
  ]);
  expect(PLUGIN_PUBLIC_CONTRACT.widgetTypes).toEqual([
    'text', 'code', 'kv', 'tags', 'list', 'row', 'image', 'link', 'markdown',
    'progress', 'action',
  ]);
});

// ------------------------------------------------------- package filter

test('package projection never leaks runtime names or handlers', async () => {
  mockPluginFetch({ runtimeName: 'opencode', handler: () => 1, name: 'acme' });
  const result: any = await pluginInspectTool.execute(
    { query: 'package', packageName: 'acme' }, ctx,
  );
  expect(result.output).toContain('acme');
  expect(result.output).not.toContain('runtimeName');
  expect(result.output).not.toContain('handler');
});

test('package returns the public inventory and client projections', async () => {
  installFetch({
    inventory: {
      plugins: [],
      packages: [{
        name: 'acme',
        version: '1.2.0',
        status: 'ok',
        contributions: ['ui', 'actions'],
        revision: 'boot:7',
        pendingRevision: 'boot:8',
        source: '/home/user/.mafw/plugins/acme',
        fingerprint: 'deadbeef',
      }],
      revision: 'boot:1',
    },
    client: { revision: 'boot:1', plugins: [acmeEntry()] },
  });
  const body = parse(await pluginInspectTool.execute({ query: 'package', packageName: 'acme' }, ctx));

  expect(body.package).toBe('acme');
  expect(body.found).toBe(true);
  expect(body.inventory).toEqual({
    name: 'acme',
    version: '1.2.0',
    status: 'ok',
    contributions: ['ui', 'actions'],
    activeRevision: 'boot:7',
    pendingRevision: 'boot:8',
    diagnostics: [],
  });
  expect(body.client.name).toBe('acme');
  expect(body.client.ui.configPages[0].loadAction).toBe('load');
  expect(body.client.actions[0].name).toBe('view');
  expect(body.client.events[0].type).toBe('plugin:acme:ping');
  expect(body.client.diagnostics).toEqual([{ level: 'warning', message: 'demo warning' }]);
  // Host-private inventory fields (source, fingerprint) are not public.
  expect(body.inventory.source).toBeUndefined();
  expect(body.inventory.fingerprint).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain('.mafw/plugins');
});

test('an unknown package returns an empty package result', async () => {
  mockPluginFetch(acmeEntry());
  const body = parse(await pluginInspectTool.execute({ query: 'package', packageName: 'ghost' }, ctx));
  expect(body).toEqual({ package: 'ghost', found: false, inventory: null, client: null });
});

test('package without packageName is a readable error, not a crash', async () => {
  installFetch();
  const result: any = await pluginInspectTool.execute({ query: 'package' }, ctx);
  expect(result.isError).toBe(true);
  expect(result.output).toContain('packageName');
});

test('a gateway failure surfaces as one readable error result', async () => {
  global.fetch = jest.fn(async () => jsonResponse({ error: 'plugin endpoint unavailable' }, 404)) as any;
  const result: any = await pluginInspectTool.execute({ query: 'clientDescriptors' }, ctx);
  expect(result.isError).toBe(true);
  expect(result.output).toBe(
    'GET /api/plugins/client failed: HTTP 404 plugin endpoint unavailable',
  );
});

// ----------------------------------------------------- client projections

test('clientDescriptors projects UI, actions, events and diagnostics', async () => {
  mockPluginFetch(acmeEntry());
  const body = parse(await pluginInspectTool.execute({ query: 'clientDescriptors' }, ctx));
  expect(body.revision).toBe('boot:1');
  expect(body.plugins).toHaveLength(1);
  const plugin = body.plugins[0];
  expect(plugin.name).toBe('acme');
  expect(plugin.ui.panels[0].id).toBe('acme.panel');
  expect(plugin.ui.toolCards[0].tools).toEqual(['bash']);
  expect(plugin.ui.configPages[0].saveAction).toBe('save');
  expect(plugin.ui.messageWindows[0].triggerEvent).toBe('plugin:acme:ping');
  expect(plugin.actions[0].name).toBe('view');
  expect(plugin.events[0].scope).toBe('session');
  expect(plugin.diagnostics).toHaveLength(1);
  expect(body.plugins[0].runtimeName).toBeUndefined();
  expect(body.plugins[0].handler).toBeUndefined();
  expect(body.plugins[0].source).toBeUndefined();
});

test('actions and events are flattened with the owning package name', async () => {
  mockPluginFetch(acmeEntry());
  const actions = parse(await pluginInspectTool.execute({ query: 'actions' }, ctx));
  expect(actions.revision).toBe('boot:1');
  expect(actions.actions).toEqual([{
    package: 'acme',
    name: 'view',
    title: 'View',
    inputSchema: { type: 'object' },
  }]);

  const events = parse(await pluginInspectTool.execute({ query: 'events' }, ctx));
  expect(events.events).toEqual([{
    package: 'acme',
    type: 'plugin:acme:ping',
    title: 'Ping',
    scope: 'session',
  }]);
});

// ------------------------------------------------------------ experience

test('experience returns the public response with runtime names stripped', async () => {
  const { calls } = installFetch({
    experience: {
      experienceVersion: '2026.11.1',
      minClientVersion: '2026.11.0',
      runtimeName: 'opencode',
      actions: {
        'prompt.steer': {
          supported: true,
          enabled: true,
          semantics: { runtimeName: 'opencode', nested: { runtimeName: 'pi', keep: 1 } },
        },
      },
    },
  });
  const result: any = await pluginInspectTool.execute({ query: 'experience' }, ctx);
  const payload = JSON.parse(result.output);

  expect(payload.experienceVersion).toBe('2026.11.1');
  expect(payload.minClientVersion).toBe('2026.11.0');
  expect(payload.actions['prompt.steer'].semantics.nested).toEqual({ keep: 1 });
  expect(result.output).not.toContain('runtimeName');
  expect(calls.some((c) => c.includes('/api/experience/actions?') && c.includes('sessionID=ses_creator'))).toBe(true);
});

// ---------------------------------------------------------- serialization

test('output serialization is stable across key insertion order', async () => {
  mockPluginFetch(acmeEntry());
  const first = (await pluginInspectTool.execute({ query: 'package', packageName: 'acme' }, ctx) as any).output;

  // Same values, reversed insertion order at both levels.
  const entry = acmeEntry();
  const reordered: Record<string, unknown> = {};
  for (const key of Object.keys(entry).reverse()) reordered[key] = entry[key];
  reordered.ui = Object.fromEntries(
    Object.entries(entry.ui as Record<string, unknown>).reverse(),
  );
  mockPluginFetch(reordered);
  const second = (await pluginInspectTool.execute({ query: 'package', packageName: 'acme' }, ctx) as any).output;

  expect(second).toBe(first);
});

test('caps oversized output at 128 KiB and marks it truncated', async () => {
  const huge = acmeEntry();
  (huge.actions as any[])[0].description = 'x'.repeat(200_000);
  mockPluginFetch(huge);

  const result: any = await pluginInspectTool.execute({ query: 'clientDescriptors' }, ctx);
  const body = JSON.parse(result.output);
  expect(body.truncated).toBe(true);
  expect(typeof body.preview).toBe('string');
  expect(Buffer.byteLength(result.output, 'utf8')).toBeLessThanOrEqual(128 * 1024);
  expect(result.metadata.truncated).toBe(true);
});

// --------------------------------------------------------- read-only rule

test('inspect only calls the three read-only gateway endpoints and never asks', async () => {
  const { calls } = mockPluginFetch(acmeEntry());
  const ask = jest.fn(async () => undefined);
  const readOnlyCtx: PluginToolContext = { ...ctx, ask };

  for (const query of ['slots', 'widgetSchema', 'package', 'clientDescriptors', 'actions', 'events', 'experience'] as const) {
    await pluginInspectTool.execute({ query, packageName: 'acme' }, readOnlyCtx);
  }

  expect(ask).not.toHaveBeenCalled();
  for (const call of calls) {
    expect(new URL(call).pathname).toMatch(/^\/api\/(plugins(\/client)?|experience\/actions)$/);
  }
});

// ------------------------------------------------------------- approvals

test('non-full-access asks with always empty', async () => {
  const ask = jest.fn(async () => undefined);
  mockSessionMode('read-only');
  await approveCreatorOperation({ ...ctx, ask }, {
    operation: 'install',
    patterns: ['install acme draft=acme overwrite=true fp=abcdef123456'],
  });
  expect(ask).toHaveBeenCalledTimes(1);
  expect(ask).toHaveBeenCalledWith({
    permission: 'mafw_plugin_manager',
    patterns: ['install acme draft=acme overwrite=true fp=abcdef123456'],
    always: [],
  });
});

test('full access skips the human prompt', async () => {
  const { calls } = mockSessionMode('full-access');
  const ask = jest.fn();
  await approveCreatorOperation({ ...ctx, ask }, { operation: 'check', patterns: ['check acme'] });
  expect(ask).not.toHaveBeenCalled();
  // The bypass still comes from the real session mode, not from guessing.
  expect(new URL(calls[0].url).pathname).toBe('/api/session/ses_creator/config');
});

test('unavailable approval fails closed', async () => {
  mockSessionMode('auto');
  await expect(approveCreatorOperation(ctx, { operation: 'check', patterns: ['check acme'] }))
    .rejects.toThrow('native approval unavailable');
});

test('auto mode still asks a human once with always empty', async () => {
  const ask = jest.fn(async () => undefined);
  mockSessionMode('auto');
  await approveCreatorOperation({ ...ctx, ask }, { operation: 'test', patterns: ['test acme'] });
  expect(ask).toHaveBeenCalledTimes(1);
  expect(ask).toHaveBeenCalledWith({
    permission: CREATOR_PERMISSION,
    patterns: ['test acme'],
    always: [],
  });
});

test('a rejected native ask propagates and is not retried', async () => {
  const ask = jest.fn(async () => { throw new Error('rejected by user'); });
  mockSessionMode('read-only');
  await expect(
    approveCreatorOperation({ ...ctx, ask }, { operation: 'install', patterns: ['install acme'] }),
  ).rejects.toThrow('rejected by user');
  expect(ask).toHaveBeenCalledTimes(1);
});

test('a failed mode lookup falls back to asking, not auto-allowing', async () => {
  const ask = jest.fn(async () => undefined);
  global.fetch = jest.fn(async () => jsonResponse({ error: 'config unavailable' }, 503)) as any;
  await approveCreatorOperation({ ...ctx, ask }, { operation: 'check', patterns: ['check acme'] });
  expect(ask).toHaveBeenCalledWith({
    permission: 'mafw_plugin_manager',
    patterns: ['check acme'],
    always: [],
  });
});

test('an unreachable gateway still asks; a missing ask still fails closed', async () => {
  const ask = jest.fn(async () => undefined);
  global.fetch = jest.fn(async () => { throw new Error('gateway down'); }) as any;
  await approveCreatorOperation({ ...ctx, ask }, { operation: 'check', patterns: ['check acme'] });
  expect(ask).toHaveBeenCalledTimes(1);

  await expect(
    approveCreatorOperation({ ...ctx, ask: undefined }, { operation: 'check', patterns: ['check acme'] }),
  ).rejects.toThrow('native approval unavailable');
});

test('a session without an id still asks instead of skipping approval', async () => {
  const ask = jest.fn(async () => undefined);
  const fetchMock = jest.fn(async () => jsonResponse({ mode: 'full-access' }));
  global.fetch = fetchMock as any;
  await approveCreatorOperation({ ...ctx, sessionID: '', ask }, {
    operation: 'check',
    patterns: ['check acme'],
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(ask).toHaveBeenCalledTimes(1);
});

// --------------------------------------------------------- gateway helper

test('pluginGatewayGet reads the port from the environment and parses JSON', async () => {
  const previous = process.env.MAFW_SERVER_API_PORT;
  process.env.MAFW_SERVER_API_PORT = '3999';
  try {
    const { calls } = installFetch({ inventory: { plugins: [], packages: [] } });
    const body: any = await pluginGatewayGet('/api/plugins', ctx);
    expect(body).toEqual({ plugins: [], packages: [] });
    expect(calls[0]).toBe('http://127.0.0.1:3999/api/plugins');
  } finally {
    if (previous === undefined) delete process.env.MAFW_SERVER_API_PORT;
    else process.env.MAFW_SERVER_API_PORT = previous;
  }
});

test('pluginGatewayGet raises a readable error for a non-2xx body', async () => {
  global.fetch = jest.fn(async () => jsonResponse({ error: 'boom' }, 503)) as any;
  await expect(pluginGatewayGet('/api/plugins', ctx)).rejects.toThrow(
    'GET /api/plugins failed: HTTP 503 boom',
  );
});

test('pluginGatewayGet times out after five seconds', async () => {
  jest.useFakeTimers();
  let seen: AbortSignal | undefined;
  global.fetch = jest.fn((_url: any, init: any) => new Promise((_resolve, reject) => {
    seen = init?.signal;
    seen?.addEventListener('abort', () => reject(new Error('aborted by client')));
  })) as any;

  const pending = pluginGatewayGet('/api/plugins', ctx);
  const settled = expect(pending).rejects.toThrow(/timed out after 5000ms/);
  jest.advanceTimersByTime(5000);
  await settled;
  expect(seen?.aborted).toBe(true);
});

test('pluginGatewayGet short-circuits an already-aborted caller signal', async () => {
  const fetchMock = jest.fn(async () => jsonResponse({ ok: true }));
  global.fetch = fetchMock as any;

  const controller = new AbortController();
  controller.abort();
  await expect(
    pluginGatewayGet('/api/plugins', { ...ctx, abort: controller.signal }),
  ).rejects.toThrow('GET /api/plugins aborted by caller');
  expect(fetchMock).not.toHaveBeenCalled();
});

test('pluginGatewayGet propagates a mid-flight caller abort', async () => {
  let seen: AbortSignal | undefined;
  global.fetch = jest.fn((_url: any, init: any) => new Promise((_resolve, reject) => {
    seen = init?.signal;
    seen?.addEventListener('abort', () => reject(new Error('aborted by client')));
  })) as any;

  const controller = new AbortController();
  const pending = pluginGatewayGet('/api/plugins', { ...ctx, abort: controller.signal });
  const settled = expect(pending).rejects.toThrow(/abort/i);
  controller.abort();
  await settled;
  expect(seen?.aborted).toBe(true);
});

test('pluginGatewayPost sends a JSON body and returns the parsed response', async () => {
  const calls: Array<{ url: string; init: any }> = [];
  global.fetch = jest.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ ok: true, echoed: JSON.parse(init.body) });
  }) as any;

  const body: any = await pluginGatewayPost('/api/plugins/check', { path: '/tmp/acme' }, ctx);
  expect(body).toEqual({ ok: true, echoed: { path: '/tmp/acme' } });
  expect(calls[0].init.method).toBe('POST');
  expect(calls[0].init.headers['Content-Type']).toBe('application/json');
  expect(calls[0].init.body).toBe('{"path":"/tmp/acme"}');
});

// =====================================================================
// Creator plugin manager (Task 4)
// =====================================================================

const tempProjects: string[] = [];

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-creator-'));
  tempProjects.push(dir);
  return dir;
}

interface DraftFixture {
  project: string;
  dir: string;
  indexPath: string;
}

/** Writes a minimal project-local draft package under `.mafw/plugin-drafts`. */
function writeDraft(
  project: string,
  name: string,
  opts: { manifestName?: string; tests?: 'pass' | 'fail' } = {},
): DraftFixture {
  const dir = path.join(project, '.mafw', 'plugin-drafts', name);
  fs.mkdirSync(dir, { recursive: true });
  const indexPath = path.join(dir, 'index.js');
  fs.writeFileSync(indexPath, `module.exports = { name: ${JSON.stringify(name)} };\n`);
  fs.writeFileSync(
    path.join(dir, 'plugin.json'),
    JSON.stringify({ name: opts.manifestName ?? name, version: '1.0.0' }),
  );
  if (opts.tests) {
    const body = opts.tests === 'pass'
      ? "test('ok', () => assert.ok(true));\n"
      : "test('bad', () => assert.equal(1, 2));\n";
    fs.writeFileSync(
      path.join(dir, 'draft.test.js'),
      `const test = require('node:test');\nconst assert = require('node:assert');\n${body}`,
    );
  }
  return { project, dir, indexPath };
}

function managerCtx(project: string, ask?: (input: any) => Promise<void>): PluginToolContext {
  return { sessionID: 'ses_creator', directory: project, ...(ask ? { ask } : {}) };
}

/** Native ask double that approves; typed so `mock.calls[0][0]` is an approval. */
function approvingAsk() {
  return jest.fn(async (_input: { permission: string; patterns: string[]; always: string[] }) => undefined);
}

function defaultInventory(): any {
  return {
    plugins: [],
    packages: [
      {
        name: 'acme',
        version: '1.0.0',
        status: 'ok',
        enabled: true,
        contributions: ['ui'],
        revision: 'boot:7',
        source: '/host/plugins/acme',
        fingerprint: 'deadbeef',
      },
      { name: 'other', version: '2.0.0', status: 'ok', enabled: true, contributions: [], revision: 'boot:7' },
    ],
    revision: 'boot:7',
  };
}

function defaultClientSnapshot(): any {
  return {
    revision: 'boot:7',
    plugins: [{
      name: 'acme',
      version: '1.0.0',
      revision: 'boot:7',
      title: 'Acme',
      ui: {
        panels: [{ id: 'acme.panel', title: 'Acme', viewAction: 'view', secret: 'drop' }],
        toolCards: [],
        configPages: [],
        messageWindows: [],
      },
      actions: [{ name: 'view', title: 'View', inputSchema: { type: 'object' }, handler: () => 1 }],
      events: [{ type: 'plugin:acme:ping', scope: 'session' }],
      diagnostics: [],
      // Host-private fields the projection must drop.
      runtimeName: 'opencode',
      source: '/host/plugins/acme',
    }],
  };
}

interface GatewayCall {
  url: string;
  path: string;
  method: string;
  body: any;
}

interface ManagerGatewayRoutes {
  mode?: string;
  inventory?: unknown;
  client?: unknown;
  check?: unknown;
  install?: unknown;
  enable?: unknown;
  disable?: unknown;
  remove?: unknown;
  reload?: unknown;
}

/** Serves the manager's gateway surface; records every call. */
function mockManagerGateway(routes: ManagerGatewayRoutes = {}): { calls: GatewayCall[] } {
  const calls: GatewayCall[] = [];
  global.fetch = jest.fn(async (url: any, init: any) => {
    const target = String(url);
    const parsed = new URL(target);
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: target, path: parsed.pathname, method: init?.method ?? 'GET', body });
    if (parsed.pathname.endsWith('/config')) return jsonResponse({ mode: routes.mode ?? 'read-only' });
    if (parsed.pathname === '/api/plugins/client') {
      return jsonResponse(routes.client ?? defaultClientSnapshot());
    }
    if (parsed.pathname === '/api/plugins') return jsonResponse(routes.inventory ?? defaultInventory());
    if (parsed.pathname === '/api/plugins/check') {
      return jsonResponse(routes.check ?? { ok: true, name: 'acme', version: '1.0.0', contributions: ['ui'] });
    }
    if (parsed.pathname === '/api/plugins/packages/install') {
      return jsonResponse(routes.install ?? {
        name: 'acme', version: '1.0.0', saved: true, application: 'applied', activeRevision: 'boot:8',
      });
    }
    if (parsed.pathname === '/api/plugins/enable') {
      return jsonResponse(routes.enable ?? {
        name: 'acme', saved: true, enabled: true, application: 'applied', activeRevision: 'boot:8',
      });
    }
    if (parsed.pathname === '/api/plugins/disable') {
      return jsonResponse(routes.disable ?? {
        name: 'acme', saved: true, enabled: false, application: 'applied', activeRevision: 'boot:8',
      });
    }
    if (parsed.pathname === '/api/plugins/delete') {
      return jsonResponse(routes.remove ?? {
        name: 'acme', saved: true, enabled: false, application: 'applied', activeRevision: 'boot:8',
      });
    }
    if (parsed.pathname === '/api/plugins/acme/reload') {
      return jsonResponse(routes.reload ?? {
        name: 'acme', saved: true, enabled: true, application: 'applied', activeRevision: 'boot:8',
      });
    }
    return jsonResponse({ error: `unexpected ${parsed.pathname}` }, 404);
  }) as any;
  return { calls };
}

/** Minimal ChildProcess double: emits data/close asynchronously, or hangs. */
function fakeChild(options: { chunks?: string[]; hang?: boolean; code?: number | null } = {}) {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  const add = (event: string, cb: (...args: any[]) => void) => {
    (handlers[event] ??= []).push(cb);
  };
  const child: any = {
    pid: 4242,
    stdout: { on: (event: string, cb: any) => add(`stdout:${event}`, cb) },
    stderr: { on: (event: string, cb: any) => add(`stderr:${event}`, cb) },
    on: (event: string, cb: any) => { add(event, cb); return child; },
    kill: jest.fn(() => true),
  };
  const emit = (event: string, ...args: any[]) => {
    for (const cb of handlers[event] ?? []) cb(...args);
  };
  if (!options.hang) {
    setTimeout(() => {
      for (const chunk of options.chunks ?? []) {
        emit('stdout:data', Buffer.from(chunk));
        emit('stderr:data', Buffer.from(chunk));
      }
      emit('close', options.code === undefined ? 0 : options.code, null);
    }, 0);
  }
  return child;
}

afterEach(() => {
  while (tempProjects.length > 0) {
    const dir = tempProjects.pop()!;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// -------------------------------------------------------------- read-only

test('read-only operations never ask and read only the inventory endpoints', async () => {
  const project = makeProject();
  const { calls } = mockManagerGateway();
  const ask = jest.fn();
  const toolCtx = managerCtx(project, ask);

  for (const args of [
    { operation: 'list' as const },
    { operation: 'status' as const, packageName: 'acme' },
    { operation: 'descriptor' as const, packageName: 'acme' },
  ]) {
    const result: any = await pluginManagerTool.execute(args, toolCtx);
    expect(result.isError).not.toBe(true);
  }

  expect(ask).not.toHaveBeenCalled();
  expect(calls.map((call) => call.path)).toEqual([
    '/api/plugins', '/api/plugins', '/api/plugins/client',
  ]);
});

test('list and status filter the exact package from the inventory', async () => {
  const project = makeProject();
  mockManagerGateway();
  const toolCtx = managerCtx(project);

  const list = parse(await pluginManagerTool.execute({ operation: 'list' }, toolCtx));
  expect(list.packages.map((pkg: any) => pkg.name)).toEqual(['acme', 'other']);
  // Host-private inventory fields stay out of the model context.
  expect(list.packages[0].source).toBeUndefined();
  expect(list.packages[0].fingerprint).toBeUndefined();
  expect(list.packages[0]).toMatchObject({ activeRevision: 'boot:7', enabled: true, status: 'ok' });

  const filtered = parse(await pluginManagerTool.execute(
    { operation: 'list', packageName: 'acme' }, toolCtx,
  ));
  expect(filtered.packages).toHaveLength(1);

  const status = parse(await pluginManagerTool.execute(
    { operation: 'status', packageName: 'acme' }, toolCtx,
  ));
  expect(status.package).toMatchObject({ name: 'acme', activeRevision: 'boot:7' });

  const missing: any = await pluginManagerTool.execute(
    { operation: 'status', packageName: 'ghost' }, toolCtx,
  );
  expect(missing.isError).toBe(true);
  expect(missing.output).toContain('ghost');
});

test('descriptor filters the exact package and drops host-private fields', async () => {
  const project = makeProject();
  mockManagerGateway();
  const toolCtx = managerCtx(project);

  const result: any = await pluginManagerTool.execute(
    { operation: 'descriptor', packageName: 'acme' }, toolCtx,
  );
  const body = parse(result);
  expect(body.revision).toBe('boot:7');
  expect(body.package.name).toBe('acme');
  expect(body.package.ui.panels).toEqual(['acme.panel']);
  expect(body.package.actions).toEqual(['view']);
  expect(body.package.events).toEqual(['plugin:acme:ping']);
  expect(result.output).not.toContain('runtimeName');
  expect(result.output).not.toContain('handler');

  const missing: any = await pluginManagerTool.execute(
    { operation: 'descriptor', packageName: 'ghost' }, toolCtx,
  );
  expect(missing.isError).toBe(true);
  expect(missing.output).toContain('ghost');
});

// ----------------------------------------------------------- draft safety

test('draft traversal is rejected before approval or HTTP', async () => {
  const project = makeProject();
  const fetchMock = jest.fn();
  global.fetch = fetchMock as any;
  const ask = jest.fn();

  const result: any = await pluginManagerTool.execute(
    { operation: 'check', draft: '../outside' }, managerCtx(project, ask),
  );

  expect(result.isError).toBe(true);
  expect(result.output).toContain('invalid draft');
  expect(ask).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('absolute, separator and reserved draft names are rejected before approval', async () => {
  const project = makeProject();
  const fetchMock = jest.fn();
  global.fetch = fetchMock as any;
  const ask = jest.fn();

  for (const draft of ['C:\\outside', '/etc/acme', 'a/b', '..', '.logs']) {
    const result: any = await pluginManagerTool.execute(
      { operation: 'check', draft }, managerCtx(project, ask),
    );
    expect([draft, result.isError]).toEqual([draft, true]);
    expect(result.output).toContain('invalid draft');
  }

  expect(ask).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('a symlinked draft that escapes the draft root is rejected before approval', async () => {
  const project = makeProject();
  const outside = makeProject();
  fs.mkdirSync(path.join(project, '.mafw', 'plugin-drafts'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'plugin.json'), JSON.stringify({ name: 'escape' }));
  fs.symlinkSync(
    outside,
    path.join(project, '.mafw', 'plugin-drafts', 'escape'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  const fetchMock = jest.fn();
  global.fetch = fetchMock as any;
  const ask = jest.fn();
  const result: any = await pluginManagerTool.execute(
    { operation: 'check', draft: 'escape' }, managerCtx(project, ask),
  );

  expect(result.isError).toBe(true);
  expect(result.output).toContain('invalid draft');
  expect(ask).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('a missing draft returns an actionable error', async () => {
  const project = makeProject();
  const fetchMock = jest.fn();
  global.fetch = fetchMock as any;
  const ask = jest.fn();

  const result: any = await pluginManagerTool.execute(
    { operation: 'install', draft: 'ghost' }, managerCtx(project, ask),
  );

  expect(result.isError).toBe(true);
  expect(result.output).toContain('draft not found');
  expect(result.output).toContain('ghost');
  expect(ask).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('plugin.json name must equal the draft directory', async () => {
  const project = makeProject();
  writeDraft(project, 'acme', { manifestName: 'other' });
  const fetchMock = jest.fn();
  global.fetch = fetchMock as any;
  const ask = jest.fn();

  const result: any = await pluginManagerTool.execute(
    { operation: 'check', draft: 'acme' }, managerCtx(project, ask),
  );

  expect(result.isError).toBe(true);
  expect(result.output).toContain('plugin.json name must equal draft directory');
  expect(ask).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('changed content between approval and execution aborts the install', async () => {
  const project = makeProject();
  const draft = writeDraft(project, 'acme');
  const { calls } = mockManagerGateway();
  const ask = jest.fn(async () => {
    await fs.promises.appendFile(draft.indexPath, '\n// changed\n');
  });

  const result: any = await pluginManagerTool.execute(
    { operation: 'install', draft: 'acme' }, managerCtx(project, ask),
  );

  expect(result.isError).toBe(true);
  expect(result.output).toContain('draft changed during approval');
  expect(calls.filter((call) => call.path === '/api/plugins/packages/install')).toEqual([]);
});

// -------------------------------------------------------------- approval

test('install asks with package fingerprint and uses the draft path', async () => {
  const project = makeProject();
  const draft = writeDraft(project, 'acme');
  const { calls } = mockManagerGateway();
  const ask = approvingAsk();

  const result: any = await pluginManagerTool.execute(
    { operation: 'install', draft: 'acme', overwrite: true, requestId: 'req-1' },
    managerCtx(project, ask),
  );

  expect(ask.mock.calls[0][0].patterns[0]).toMatch(/^install acme draft=acme overwrite=true fp=/);
  expect(ask.mock.calls[0][0].always).toEqual([]);
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/plugins/packages/install'),
    expect.objectContaining({ method: 'POST' }),
  );
  expect(result.isError).not.toBe(true);

  const install = calls.find((call) => call.path === '/api/plugins/packages/install')!;
  expect(install.body).toEqual({
    path: fs.realpathSync(draft.dir),
    overwrite: true,
    requestId: 'req-1',
  });
  expect(result.metadata).toMatchObject({
    operation: 'install',
    packageName: 'acme',
    application: 'applied',
    revision: 'boot:8',
  });
  expect(typeof parse(result).nextStep).toBe('string');
});

test('a pending install reports the user-only applyPending next step', async () => {
  const project = makeProject();
  writeDraft(project, 'acme');
  mockManagerGateway({
    install: {
      name: 'acme', saved: true, application: 'pending', activeRevision: 'boot:7', pendingRevision: 'boot:8',
    },
  });

  const result: any = await pluginManagerTool.execute(
    { operation: 'install', draft: 'acme' }, managerCtx(project, approvingAsk()),
  );

  expect(result.isError).not.toBe(true);
  const body = parse(result);
  expect(body.application).toBe('pending');
  expect(body.nextStep).toContain('applyPending');
  expect(result.metadata).toMatchObject({
    operation: 'install',
    application: 'pending',
    revision: 'boot:7',
    pendingRevision: 'boot:8',
  });
});

test('each code-execution and mutation operation asks exactly once', async () => {
  const project = makeProject();
  writeDraft(project, 'acme', { tests: 'pass' });

  for (const operation of ['check', 'test', 'install', 'enable', 'disable', 'remove', 'reload'] as const) {
    mockManagerGateway();
    const ask = approvingAsk();
    const args: any = ['enable', 'disable', 'remove', 'reload'].includes(operation)
      ? { operation, packageName: 'acme' }
      : { operation, draft: 'acme' };

    const result: any = await pluginManagerTool.execute(args, managerCtx(project, ask));

    expect([operation, result.isError ?? false]).toEqual([operation, false]);
    expect([operation, ask.mock.calls.length]).toEqual([operation, 1]);
    if (['enable', 'disable', 'remove', 'reload'].includes(operation)) {
      expect(ask.mock.calls[0][0]).toEqual({
        permission: 'mafw_plugin_manager',
        patterns: [`${operation} acme`],
        always: [],
      });
    }
  }
});

test('a denied approval makes no operation HTTP call', async () => {
  const project = makeProject();
  writeDraft(project, 'acme');
  const { calls } = mockManagerGateway();
  const ask = jest.fn(async (_input: any) => { throw new Error('rejected by user'); });

  const result: any = await pluginManagerTool.execute(
    { operation: 'install', draft: 'acme' }, managerCtx(project, ask),
  );

  expect(result.isError).toBe(true);
  expect(result.output).toContain('rejected by user');
  // The only request is the live session-mode lookup that preceded the prompt.
  expect(calls.filter((call) => !call.path.endsWith('/config'))).toEqual([]);
});

test('applyPending is rejected and never executed', async () => {
  const project = makeProject();
  writeDraft(project, 'acme');
  const fetchMock = jest.fn();
  global.fetch = fetchMock as any;
  const ask = jest.fn();

  const direct: any = await pluginManagerTool.execute(
    { operation: 'applyPending', draft: 'acme' } as any, managerCtx(project, ask),
  );
  expect(direct.isError).toBe(true);
  expect(direct.output).toContain('applyPending');
  expect(direct.output).toContain('Plugins');

  const smuggled: any = await pluginManagerTool.execute(
    { operation: 'install', draft: 'acme', applyPending: true } as any, managerCtx(project, ask),
  );
  expect(smuggled.isError).toBe(true);
  expect(smuggled.output).toContain('applyPending');

  expect(ask).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('missing names return actionable errors', async () => {
  const project = makeProject();
  global.fetch = jest.fn() as any;
  const ask = jest.fn();
  const toolCtx = managerCtx(project, ask);

  const noDraft: any = await pluginManagerTool.execute({ operation: 'install' }, toolCtx);
  expect(noDraft.isError).toBe(true);
  expect(noDraft.output).toContain('draft');

  const noPackage: any = await pluginManagerTool.execute({ operation: 'status' }, toolCtx);
  expect(noPackage.isError).toBe(true);
  expect(noPackage.output).toContain('packageName');

  const noPackageOnMutation: any = await pluginManagerTool.execute({ operation: 'enable' }, toolCtx);
  expect(noPackageOnMutation.isError).toBe(true);
  expect(noPackageOnMutation.output).toContain('packageName');

  expect(ask).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------- routing

test('install omits requestId when absent and sends a new one per iteration', async () => {
  const project = makeProject();
  const draft = writeDraft(project, 'acme');
  const { calls } = mockManagerGateway();
  const toolCtx = managerCtx(project, approvingAsk());

  await pluginManagerTool.execute({ operation: 'install', draft: 'acme' }, toolCtx);
  await pluginManagerTool.execute({ operation: 'install', draft: 'acme', requestId: 'req-2' }, toolCtx);
  await pluginManagerTool.execute({ operation: 'install', draft: 'acme', requestId: 'req-3' }, toolCtx);

  const bodies = calls
    .filter((call) => call.path === '/api/plugins/packages/install')
    .map((call) => call.body);
  expect(bodies[0]).toEqual({ path: fs.realpathSync(draft.dir) });
  expect(bodies[1].requestId).toBe('req-2');
  expect(bodies[2].requestId).toBe('req-3');
  expect(bodies[1].requestId).not.toBe(bodies[2].requestId);
});

test('check posts the draft path to /api/plugins/check', async () => {
  const project = makeProject();
  const draft = writeDraft(project, 'acme');
  const { calls } = mockManagerGateway();

  const result: any = await pluginManagerTool.execute(
    { operation: 'check', draft: 'acme' }, managerCtx(project, approvingAsk()),
  );

  expect(result.isError).not.toBe(true);
  const check = calls.find((call) => call.path === '/api/plugins/check')!;
  expect(check.method).toBe('POST');
  expect(check.body).toEqual({ path: fs.realpathSync(draft.dir) });
  expect(parse(result).draft).toBe('acme');
  expect(result.metadata).toMatchObject({ operation: 'check', packageName: 'acme', ok: true });
});

test('enable, disable, remove and reload use the existing routes', async () => {
  const project = makeProject();
  const expectations = [
    ['enable', '/api/plugins/enable'],
    ['disable', '/api/plugins/disable'],
    ['remove', '/api/plugins/delete'],
    ['reload', '/api/plugins/acme/reload'],
  ] as const;

  for (const [operation, route] of expectations) {
    const { calls } = mockManagerGateway();
    const result: any = await pluginManagerTool.execute(
      { operation, packageName: 'acme' }, managerCtx(project, approvingAsk()),
    );

    expect([operation, result.isError ?? false]).toEqual([operation, false]);
    const call = calls.find((entry) => !entry.path.endsWith('/config'))!;
    expect([operation, call.path, call.method]).toEqual([operation, route, 'POST']);
    if (operation === 'reload') expect(call.body).toBeUndefined();
    else expect(call.body).toEqual({ package: 'acme' });
    expect(result.metadata).toMatchObject({ operation, packageName: 'acme', application: 'applied' });
  }
});

// ------------------------------------------------------------- test runner

test('test runs the fixed runner, writes the full log, and never installs', async () => {
  const project = makeProject();
  writeDraft(project, 'acme', { tests: 'pass' });
  const { calls } = mockManagerGateway();

  const result: any = await pluginManagerTool.execute(
    { operation: 'test', draft: 'acme' }, managerCtx(project, approvingAsk()),
  );

  expect(result.isError).not.toBe(true);
  const body = parse(result);
  expect(body.passed).toBe(true);
  expect(body.exitCode).toBe(0);
  expect(body.timedOut).toBe(false);
  expect(body.logPath).toBe(path.join(project, '.mafw', 'plugin-drafts', '.logs', 'acme.log'));
  expect(fs.existsSync(body.logPath)).toBe(true);
  expect(fs.readFileSync(body.logPath, 'utf8').length).toBeGreaterThan(0);
  expect(calls.filter((call) => call.path === '/api/plugins/packages/install')).toEqual([]);
  expect(result.metadata).toMatchObject({ operation: 'test', packageName: 'acme', timedOut: false });
});

test('a failing draft test returns an error result without installing', async () => {
  const project = makeProject();
  writeDraft(project, 'acme', { tests: 'fail' });
  const { calls } = mockManagerGateway();

  const result: any = await pluginManagerTool.execute(
    { operation: 'test', draft: 'acme' }, managerCtx(project, approvingAsk()),
  );

  expect(result.isError).toBe(true);
  const body = parse(result);
  expect(body.passed).toBe(false);
  expect(body.exitCode).not.toBe(0);
  expect(calls.filter((call) => call.path === '/api/plugins/packages/install')).toEqual([]);
});

test('test runner uses node --test and caps oversized output', async () => {
  const project = makeProject();
  const draft = writeDraft(project, 'acme');
  const spawn = jest.fn(() => fakeChild({ chunks: ['x'.repeat(100)] }));

  const run = await runDraftTests(draft.dir, {
    spawn: spawn as any,
    timeoutMs: 50,
    maxBytes: 32,
  });

  expect(spawn).toHaveBeenCalledWith(
    process.execPath,
    ['--test'],
    expect.objectContaining({
      cwd: draft.dir,
      shell: false,
      // POSIX timeouts kill the process group; Windows uses taskkill /T.
      detached: process.platform !== 'win32',
    }),
  );
  expect(run.output.length).toBeLessThanOrEqual(32);
  expect(run.truncated).toBe(true);
  expect(run.exitCode).toBe(0);
  expect(run.timedOut).toBe(false);
});

test('a fake child that never exits is killed at the timeout', async () => {
  const project = makeProject();
  const draft = writeDraft(project, 'acme');
  const child = fakeChild({ hang: true });
  const spawn = jest.fn(() => child);
  const killGroup = jest.fn();

  const run = await runDraftTests(draft.dir, {
    spawn: spawn as any,
    timeoutMs: 20,
    killGroup,
  });

  expect(run.timedOut).toBe(true);
  expect(run.exitCode).toBeNull();
  expect(child.kill).toHaveBeenCalled();
  if (process.platform === 'win32') {
    // Windows tree kill goes through `taskkill /F /T`.
    expect(spawn.mock.calls.some((call: any[]) => call[0] === 'taskkill')).toBe(true);
    expect(killGroup).not.toHaveBeenCalled();
  } else {
    // POSIX: the detached leader's negative PID reaches node --test children.
    expect(killGroup).toHaveBeenCalledWith(child.pid);
  }
});

test('POSIX timeouts kill the whole detached process group', async () => {
  const project = makeProject();
  const draft = writeDraft(project, 'acme');
  const child = fakeChild({ hang: true });
  const spawn = jest.fn(() => child);
  const killGroup = jest.fn();

  // Forced platform: covers the POSIX branch on Windows CI too.
  const run = await runDraftTests(draft.dir, {
    spawn: spawn as any,
    timeoutMs: 20,
    killGroup,
    platform: 'linux',
  });

  expect(run.timedOut).toBe(true);
  expect(killGroup).toHaveBeenCalledWith(child.pid);
  expect(child.kill).toHaveBeenCalled();
  expect(spawn.mock.calls.some((call: any[]) => call[0] === 'taskkill')).toBe(false);
  expect((spawn.mock.calls[0] as any)[2].detached).toBe(true);
});

test('Windows timeouts use taskkill /F /T', async () => {
  const project = makeProject();
  const draft = writeDraft(project, 'acme');
  const child = fakeChild({ hang: true });
  const spawn = jest.fn(() => child);
  const killGroup = jest.fn();

  // Forced platform: covers the Windows branch on POSIX CI too.
  const run = await runDraftTests(draft.dir, {
    spawn: spawn as any,
    timeoutMs: 20,
    killGroup,
    platform: 'win32',
  });

  expect(run.timedOut).toBe(true);
  const taskkill = spawn.mock.calls.find((call: any[]) => call[0] === 'taskkill') as any[];
  expect(taskkill[1]).toEqual(['/pid', String(child.pid), '/F', '/T']);
  expect(killGroup).not.toHaveBeenCalled();
  expect((spawn.mock.calls[0] as any)[2].detached).toBe(false);
});

test('test runner strips secrets from the child environment', async () => {
  const project = makeProject();
  const draft = writeDraft(project, 'acme');
  const spawn = jest.fn(() => fakeChild({ chunks: [] }));
  const previous = process.env.MAFW_TEST_SECRET;
  process.env.MAFW_TEST_SECRET = 'top-secret';
  try {
    await runDraftTests(draft.dir, { spawn: spawn as any, timeoutMs: 50 });
  } finally {
    if (previous === undefined) delete process.env.MAFW_TEST_SECRET;
    else process.env.MAFW_TEST_SECRET = previous;
  }

  const env = (spawn.mock.calls[0] as any)[2].env;
  expect(env.NODE_ENV).toBe('test');
  expect(env.MAFW_TEST_SECRET).toBeUndefined();
  expect(env.PATH ?? env.Path).toBe(process.env.PATH ?? process.env.Path);
});

// ------------------------------------------------------------- fingerprint

test('fingerprintDraft is deterministic across projects and creation order', async () => {
  const project = makeProject();
  const draft = writeDraft(project, 'acme');

  const first = await fingerprintDraft(draft.dir);
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(await fingerprintDraft(draft.dir)).toBe(first);

  // Same relative paths and contents in a different project: same value.
  const other = writeDraft(makeProject(), 'acme');
  expect(await fingerprintDraft(other.dir)).toBe(first);

  // Creation order does not matter: remove and re-create the same file.
  const rewritten = fs.readFileSync(draft.indexPath, 'utf-8');
  fs.rmSync(draft.indexPath);
  fs.writeFileSync(draft.indexPath, rewritten);
  expect(await fingerprintDraft(draft.dir)).toBe(first);

  fs.writeFileSync(draft.indexPath, 'module.exports = 2;\n');
  expect(await fingerprintDraft(draft.dir)).not.toBe(first);
});

test('draft entries the install would copy are rejected, not skipped', async () => {
  const cases: Array<[string, string]> = [
    ['.git/config', 'x'],
    ['.git', 'gitdir: ../worktrees/acme'], // worktree-style .git file
    ['node_modules/dep/index.js', 'x'],
    ['scratch.tmp', 'x'],
    ['notes~', 'x'],
    ['.DS_Store', 'x'],
  ];

  for (const [rel, content] of cases) {
    const project = makeProject();
    const draft = writeDraft(project, 'acme');
    const target = path.join(draft.dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);

    // The approval fingerprint must cover exactly what install copies; these
    // entries are rejected instead of being hashed out of the approved set.
    await expect(fingerprintDraft(draft.dir))
      .rejects.toThrow(/not part of the approved install/);
  }
});

test('a draft containing install-only paths is rejected before approval or HTTP', async () => {
  const project = makeProject();
  const draft = writeDraft(project, 'acme');
  fs.mkdirSync(path.join(draft.dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(draft.dir, '.git', 'config'), 'x');

  const fetchMock = jest.fn();
  global.fetch = fetchMock as any;
  const ask = jest.fn();

  const result: any = await pluginManagerTool.execute(
    { operation: 'install', draft: 'acme' }, managerCtx(project, ask),
  );

  expect(result.isError).toBe(true);
  expect(result.output).toContain('not part of the approved install');
  expect(ask).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('fingerprintDraft enforces file count and size ceilings', async () => {
  const project = makeProject();
  const draft = writeDraft(project, 'acme');

  await expect(fingerprintDraft(draft.dir, { maxFiles: 1 })).rejects.toThrow(/too many files/);
  await expect(fingerprintDraft(draft.dir, { maxBytes: 8 })).rejects.toThrow(/too large/);
});
