// Phase D1 Task A2: mafw-commands registry wiring â€?409 hold-queue gate stays in the
// route (before delegation), body JSON errors still escape to the outer 500 handler.
import type { IncomingMessage, ServerResponse } from 'http';
import { MafwCommandRegistry } from '../../../src/commands/registry';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachMafwCommandRoutes } from '../../../src/routes/mafw-commands';

function fakeReq(opts: { url: string; method: string; body?: string }): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    on(ev: string, fn: (c?: unknown) => void) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return req;
    },
  };
  process.nextTick(() => {
    for (const fn of listeners['data'] ?? []) fn(opts.body ?? '');
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

function makeRegistry(): MafwCommandRegistry {
  const r = new MafwCommandRegistry();
  r.register({ name: 'echo', description: 'd', category: 'custom', kind: 'custom' },
    async (ctx) => ({ ok: true, text: `echo:${ctx.args}@${ctx.projectDir}` }));
  return r;
}

function setup(overrides: { hold?: boolean } = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  const calls: string[] = [];
  attachMafwCommandRoutes(registry, {
    getRegistry: () => makeRegistry(),
    registeredProjects: () => new Map([['/proj-a', { projectDir: '/proj-a' }]]),
    projectDir: () => '/fallback',
    shouldHoldQueue: (sid) => { calls.push(sid); return overrides.hold ?? false; },
  });
  const handlerFor = (method: string, url: string) => registry.match(method as never, url)?.def.handler;
  return { handlerFor, calls };
}

describe('mafw-commands registry wiring (D1 Task A2)', () => {
  it('catalog routes have handlers attached (no silent 404)', () => {
    const { handlerFor } = setup();
    expect(handlerFor('POST', '/api/mafw-commands/run')).toBeDefined();
    expect(handlerFor('GET', '/api/mafw-commands')).toBeDefined();
  });

  it('run resolves projectDir from registeredProjects (legacy fallback order)', async () => {
    const { handlerFor } = setup();
    const r = fakeRes();
    await handlerFor('POST', '/api/mafw-commands/run')!(
      fakeReq({ url: '/api/mafw-commands/run', method: 'POST', body: JSON.stringify({ command: 'echo', args: 'hi', sessionID: 's1' }) }),
      r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true, text: 'echo:hi@/proj-a' });
  });

  it('held queue â†?409 before delegation', async () => {
    const { handlerFor, calls } = setup({ hold: true });
    const r = fakeRes();
    await handlerFor('POST', '/api/mafw-commands/run')!(
      fakeReq({ url: '/api/mafw-commands/run', method: 'POST', body: JSON.stringify({ command: 'echo', sessionID: 's1' }) }),
      r.res,
    );
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body).error).toContain('session is suspended');
    expect(calls).toEqual(['s1']);
  });

  it('invalid JSON still throws (outer 500 handler owns it)', async () => {
    const { handlerFor } = setup();
    const handler = handlerFor('POST', '/api/mafw-commands/run')!;
    await expect(handler(fakeReq({ url: '/api/mafw-commands/run', method: 'POST', body: 'not-json' }), fakeRes().res))
      .rejects.toThrow();
  });

  it('list returns command metadata', async () => {
    const { handlerFor } = setup();
    const r = fakeRes();
    await handlerFor('GET', '/api/mafw-commands')!(fakeReq({ url: '/api/mafw-commands', method: 'GET' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).commands.map((c: any) => c.name)).toEqual(['echo']);
  });
});
