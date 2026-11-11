// Phase D1 Task G: dashboard shadow wiring — four exact (method, path) pairs from
// handleDashboardAPI (goals.list / dashboard.stats / memory.add / memory.setSticky)
// attached onto existing shadow catalog entries. R5: the joint branch and
// handleDashboardAPI are RETAINED, so its non-exact shapes (method-agnostic
// /api/stats*, goals.get/loops phantoms, /api/memory catch-all) still fall through.
// Load-bearing quirk: no writeHead → error bodies are HTTP 200.
const mockSetSticky = jest.fn();
const mockSetPinned = jest.fn();

jest.mock('../../../src/memory/harmonic-file-store', () => ({
  HarmonicUnitFileStore: class {
    setSticky(...args: unknown[]) { return mockSetSticky(...args); }
    setPinned(...args: unknown[]) { return mockSetPinned(...args); }
  },
}));

import type { IncomingMessage, ServerResponse } from 'http';
import { log } from '../../../src/core/utils/logger';
import { resetDedupStatsForTest } from '../../../src/memory/dedup-guard';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachDashboardRoutes, type DashboardRouteDeps } from '../../../src/routes/dashboard';

function fakeReq(opts: { method: string; url: string; body?: string }): IncomingMessage {
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

function fakeRes(): { res: ServerResponse; status: number; body: string; writeHeadCalls: () => number } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '', heads: 0 };
  out.res = {
    writeHead: (status: number) => { out.status = status; out.heads++; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return { res: out.res, get status() { return out.status; }, get body() { return out.body; }, writeHeadCalls: () => out.heads } as any;
}

function setup(over: Partial<DashboardRouteDeps> = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  const deps: DashboardRouteDeps = {
    activeGoals: () => new Map<string, any>(),
    registeredProjectsSize: () => 0,
    sseClientsSize: () => 0,
    serveRunning: () => false,
    trajectoryStore: () => null,
    memoryService: () => null,
    ...over,
  };
  attachDashboardRoutes(registry, deps);
  return { registry };
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

beforeEach(() => {
  mockSetSticky.mockReset();
  mockSetPinned.mockReset();
  resetDedupStatsForTest();
});

describe('dashboard registry wiring (D1 Task G)', () => {
  it('the four shadow entries gain handlers (and stay on their catalog operationIds)', () => {
    const { registry } = setup();
    const expectOps: Array<[string, string, string]> = [
      ['GET', '/api/goals', 'goals.list'],
      ['GET', '/api/stats', 'dashboard.stats'],
      ['POST', '/api/memory/add', 'memory.add'],
      ['POST', '/api/memory/pin', 'memory.setSticky'],
    ];
    for (const [method, url, op] of expectOps) {
      expect(registry.match(method as never, url)?.def.operationId).toBe(op);
      expect(handlerFor(registry, method, url)).toBeDefined();
    }
    // R5: the non-exact shapes the retained dashboard catch-all still owns
    // must NOT match an attached handler.
    expect(handlerFor(registry, 'GET', '/api/stats/overview')).toBeUndefined();
    expect(handlerFor(registry, 'POST', '/api/stats')).toBeUndefined();
    expect(handlerFor(registry, 'GET', '/api/goals/g1/loops')).toBeUndefined();
  });

  it('goals.list maps active goal states verbatim (error falsy → null)', async () => {
    const activeGoals = new Map<string, any>([
      ['g1', { goalId: 'g1', phase: 'execute', loop: 2, nextAction: 'build', error: '', updatedAt: '2026-01-01T00:00:00.000Z' }],
      ['g2', { goalId: 'g2', phase: null, loop: 1, nextAction: 'plan', error: 'boom', updatedAt: '2026-01-02T00:00:00.000Z' }],
    ]);
    const { registry } = setup({ activeGoals: () => activeGoals });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/goals')!(fakeReq({ method: 'GET', url: '/api/goals' }), r.res);
    expect(r.status).toBe(200);
    expect(r.writeHeadCalls()).toBe(0);
    expect(JSON.parse(r.body)).toEqual({
      goals: [
        { goalId: 'g1', phase: 'execute', loop: 2, nextAction: 'build', error: null, updatedAt: '2026-01-01T00:00:00.000Z' },
        { goalId: 'g2', phase: null, loop: 1, nextAction: 'plan', error: 'boom', updatedAt: '2026-01-02T00:00:00.000Z' },
      ],
    });
  });

  it('dashboard.stats returns counters and merges tokens when a trajectory store exists', async () => {
    const activeGoals = new Map<string, any>([['g1', {}]]);
    const { registry } = setup({
      activeGoals: () => activeGoals,
      registeredProjectsSize: () => 3,
      sseClientsSize: () => 2,
      serveRunning: () => true,
      trajectoryStore: () => ({
        getGlobalTokenSummary: () => ({ totalTokens: { input: 7 }, totalCost: 0.5, turnCount: 4 }),
      }) as any,
    });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/stats')!(fakeReq({ method: 'GET', url: '/api/stats' }), r.res);
    expect(r.status).toBe(200);
    expect(r.writeHeadCalls()).toBe(0);
    expect(JSON.parse(r.body)).toEqual({
      activeGoals: 1,
      registeredProjects: 3,
      sseClients: 2,
      serveRunning: true,
      tokens: { totalTokens: { input: 7 }, totalCost: 0.5, turnCount: 4 },
    });
  });

  it('dashboard.stats without a store returns the base shape only', async () => {
    const { registry } = setup({ serveRunning: () => false });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/stats')!(fakeReq({ method: 'GET', url: '/api/stats' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({
      activeGoals: 0,
      registeredProjects: 0,
      sseClients: 0,
      serveRunning: false,
    });
  });

  it('dashboard.stats token-summary failure logs the exact warn line and falls back to base', async () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    const { registry } = setup({
      trajectoryStore: () => ({ getGlobalTokenSummary: () => { throw new Error('db locked'); } }) as any,
    });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/stats')!(fakeReq({ method: 'GET', url: '/api/stats' }), r.res);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({
      activeGoals: 0,
      registeredProjects: 0,
      sseClients: 0,
      serveRunning: false,
    });
    expect(warn).toHaveBeenCalledWith('[Stats] token summary failed: db locked');
    warn.mockRestore();
  });

  it('memory.add rejects missing content with an always-200 error body', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/add')!(
      fakeReq({ method: 'POST', url: '/api/memory/add', body: JSON.stringify({ memoryType: 'semantic' }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(r.writeHeadCalls()).toBe(0);
    expect(JSON.parse(r.body)).toEqual({ success: false, error: 'content and valid memoryType required' });
  });

  it('memory.add rejects an invalid memoryType the same way', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/add')!(
      fakeReq({ method: 'POST', url: '/api/memory/add', body: JSON.stringify({ content: 'x', memoryType: 'bogus' }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ success: false, error: 'content and valid memoryType required' });
  });

  it('memory.add skips a verbatim re-submit via the exact-hash guard', async () => {
    const { registry } = setup();
    const body = JSON.stringify({ content: 'exact-hash dedup probe', memoryType: 'semantic' });
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/add')!(
      fakeReq({ method: 'POST', url: '/api/memory/add', body }), r.res,
    );
    // first pass records the hash, then stops at the memoryService gate
    expect(JSON.parse(r.body)).toEqual({ success: false, error: 'memoryService not ready' });

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/add')!(
      fakeReq({ method: 'POST', url: '/api/memory/add', body }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ success: true, deduped: true, reason: 'exact-hash' });
  });

  it('memory.setSticky requires an id (200 body, not 4xx)', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/pin')!(
      fakeReq({ method: 'POST', url: '/api/memory/pin', body: JSON.stringify({ pinned: true }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(r.writeHeadCalls()).toBe(0);
    expect(JSON.parse(r.body)).toEqual({ success: false, error: 'id required' });
  });

  it('memory.setSticky reports a missing memory with the legacy message', async () => {
    mockSetPinned.mockReturnValue(false);
    const { registry } = setup({ memoryService: () => ({ harmonicIndex: {} }) as any });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/pin')!(
      fakeReq({ method: 'POST', url: '/api/memory/pin', body: JSON.stringify({ id: 'nope', pinned: true }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ success: false, error: 'memory not found: nope' });
    expect(mockSetPinned).toHaveBeenCalledWith('nope', true);
  });

  it('memory.setSticky gives sticky precedence over pinned and defaults to 7 days', async () => {
    mockSetSticky.mockReturnValue(true);
    const { registry } = setup({ memoryService: () => ({ harmonicIndex: {} }) as any });
    const before = Date.now();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/pin')!(
      fakeReq({
        method: 'POST',
        url: '/api/memory/pin',
        body: JSON.stringify({ id: 'mem-1', pinned: true, sticky: true }),
      }),
      r.res,
    );
    expect(r.status).toBe(200);
    expect(mockSetPinned).not.toHaveBeenCalled();
    expect(mockSetSticky).toHaveBeenCalledTimes(1);
    const [id, until] = mockSetSticky.mock.calls[0];
    expect(id).toBe('mem-1');
    const days = (new Date(until as string).getTime() - before) / 86400e3;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    const body = JSON.parse(r.body);
    expect(body).toEqual({ success: true, id: 'mem-1', sticky: true, sticky_until: until });
  });

  it('memory.setSticky honours stickyDays and sticky:false (until null → omitted)', async () => {
    mockSetSticky.mockReturnValue(true);
    const { registry } = setup({ memoryService: () => ({ harmonicIndex: {} }) as any });
    const before = Date.now();
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/pin')!(
      fakeReq({
        method: 'POST',
        url: '/api/memory/pin',
        body: JSON.stringify({ id: 'mem-2', sticky: true, stickyDays: 3 }),
      }),
      r.res,
    );
    const days = (new Date(mockSetSticky.mock.calls[0][1] as string).getTime() - before) / 86400e3;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);

    mockSetSticky.mockClear();
    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/pin')!(
      fakeReq({ method: 'POST', url: '/api/memory/pin', body: JSON.stringify({ id: 'mem-2', sticky: false }) }), r.res,
    );
    expect(mockSetSticky).toHaveBeenCalledWith('mem-2', null);
    expect(JSON.parse(r.body)).toEqual({ success: true, id: 'mem-2', sticky: false });
  });

  it('memory.add / memory.setSticky log the legacy warn lines when the body is not JSON', async () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    const { registry } = setup();
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/add')!(
      fakeReq({ method: 'POST', url: '/api/memory/add', body: '{not json' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).success).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[Scheduler\] \/api\/memory\/add failed: /));

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/pin')!(
      fakeReq({ method: 'POST', url: '/api/memory/pin', body: '{not json' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).success).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[Scheduler\] \/api\/memory\/pin failed: /));
    warn.mockRestore();
  });

  // ── E4-6b: disk critical → memory.add 拒写（spec §4.2 / §6）─────────────
  it('memory.add returns the disk_low body without touching memoryService when disk is critical', async () => {
    const memoryService = jest.fn(() => ({}) as any);
    const { registry } = setup({
      memoryService,
      pressure: () => ({ disk: 'critical', degraded: ['disk_critical'] }),
    });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/add')!(
      fakeReq({ method: 'POST', url: '/api/memory/add', body: JSON.stringify({ content: 'held back', memoryType: 'semantic' }) }),
      r.res,
    );
    expect(r.status).toBe(200);
    expect(r.writeHeadCalls()).toBe(0);
    expect(JSON.parse(r.body)).toEqual({ success: false, error: 'disk space critical', code: 'disk_low' });
    expect(memoryService).not.toHaveBeenCalled();
  });

  it('memory.add also gates on degraded containing disk_critical (even if disk reads ok)', async () => {
    const memoryService = jest.fn(() => null);
    const { registry } = setup({
      memoryService,
      pressure: () => ({ disk: 'ok', degraded: ['disk_critical'] }),
    });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/add')!(
      fakeReq({ method: 'POST', url: '/api/memory/add', body: JSON.stringify({ content: 'held back', memoryType: 'semantic' }) }),
      r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ success: false, error: 'disk space critical', code: 'disk_low' });
    expect(memoryService).not.toHaveBeenCalled();
  });

  it('memory.add validation still wins over the pressure gate (invalid input keeps its error)', async () => {
    const { registry } = setup({
      pressure: () => ({ disk: 'critical', degraded: ['disk_critical'] }),
    });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/add')!(
      fakeReq({ method: 'POST', url: '/api/memory/add', body: JSON.stringify({ memoryType: 'semantic' }) }),
      r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ success: false, error: 'content and valid memoryType required' });
  });

  it('memory.add invalid authority wins over the pressure gate', async () => {
    const { registry } = setup({
      pressure: () => ({ disk: 'critical', degraded: ['disk_critical'] }),
    });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/add')!(
      fakeReq({
        method: 'POST',
        url: '/api/memory/add',
        body: JSON.stringify({ content: 'authority probe', memoryType: 'semantic', authority: 'bogus' }),
      }),
      r.res,
    );
    expect(JSON.parse(r.body)).toEqual({
      success: false,
      error: 'invalid authority: bogus (user|agent|tool|pipeline)',
    });
  });

  it('memory.add only gates on disk (heap critical alone still writes)', async () => {
    const { registry } = setup({
      pressure: () => ({ disk: 'ok', degraded: ['heap_critical'] }),
    });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/memory/add')!(
      fakeReq({ method: 'POST', url: '/api/memory/add', body: JSON.stringify({ content: 'heap pressure only', memoryType: 'semantic' }) }),
      r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ success: false, error: 'memoryService not ready' });
  });

  it('memory.add keeps existing behavior when pressure is ok or unknown', async () => {
    const pressures = [
      () => ({ disk: 'ok', degraded: [] as string[] }),
      () => null,
    ];
    for (const [i, pressure] of pressures.entries()) {
      const { registry } = setup({ pressure });
      const r = fakeRes();
      await handlerFor(registry, 'POST', '/api/memory/add')!(
        fakeReq({ method: 'POST', url: '/api/memory/add', body: JSON.stringify({ content: `write freely ${i}`, memoryType: 'semantic' }) }),
        r.res,
      );
      expect(JSON.parse(r.body)).toEqual({ success: false, error: 'memoryService not ready' });
    }
  });
});
