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
import { PLUGIN_UI_LIMITS } from '@mafw/plugin-contract';

import { pluginInspectTool } from '../src/tools/plugin-inspect';
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
