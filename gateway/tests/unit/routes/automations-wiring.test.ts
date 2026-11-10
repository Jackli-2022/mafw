// Phase D1 Task C1: automation registry wiring — six legacy branches (draft / list /
// get / toggle / remove / history). The legacy chain used one shared regex for
// GET/PUT/DELETE on :id; registry static-segment priority must keep /draft ahead of
// /:id without the ordering comment.
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachAutomationRoutes } from '../../../src/routes/automations';

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

function setup(opts: { cachedRules?: string[] } = {}) {
  const ledgers: any[] = [];
  const toggled: Array<[string, boolean]> = [];
  const deleted: string[] = [];
  const drafted: any[] = [];
  const historyCalls: Array<[string | undefined, number]> = [];
  const cachedRules = opts.cachedRules ?? ['r1'];
  const rules = [{ id: 'r1', enabled: true }];
  const engine = {
    getRules: () => rules,
    getRule: (id: string) => rules.find((r) => r.id === id),
    getNextTriggers: () => ({ next5: opts.cachedRules ?? ['2026-11-11T00:00:00Z'] }),
    draftRule: (rule: any) => { drafted.push(rule); return { id: rule.id, valid: true, errors: [] }; },
    toggleRule: (id: string, enabled: boolean) => { toggled.push([id, enabled]); return true; },
    deleteRule: (id: string) => { deleted.push(id); return true; },
  } as any;
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachAutomationRoutes(registry, {
    automationEngine: () => engine,
    ledger: () => ({
      append: (e) => ledgers.push(e),
      getHistory: (ruleId, limit) => { historyCalls.push([ruleId, limit as number]); return [{ ruleId }]; },
    }),
  });
  return { registry, ledgers, toggled, deleted, drafted, historyCalls };
}

/** Registry dispatch always passes matched params — mirror it here (the legacy
 *  branches captured the id from their own regex). */
const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('automation registry wiring (D1 Task C1)', () => {
  it('all six catalog routes have handlers attached (no silent 404)', () => {
    const { registry } = setup();
    expect(handlerFor(registry, 'POST', '/api/automations/draft')).toBeDefined();
    expect(handlerFor(registry, 'GET', '/api/automations')).toBeDefined();
    expect(handlerFor(registry, 'GET', '/api/automations/r1')).toBeDefined();
    expect(handlerFor(registry, 'PUT', '/api/automations/r1')).toBeDefined();
    expect(handlerFor(registry, 'DELETE', '/api/automations/r1')).toBeDefined();
    expect(handlerFor(registry, 'GET', '/api/automations/r1/history')).toBeDefined();
  });

  it('/api/automations/draft wins over /:id structurally (static-segment priority)', () => {
    const { registry } = setup();
    expect(registry.match('POST', '/api/automations/draft')!.def.operationId).toBe('automations.draft');
    // No GET /draft route exists → the :id handler receives id "draft" (legacy parity).
    const get = registry.match('GET', '/api/automations/draft')!;
    expect(get.def.operationId).toBe('automations.get');
    expect(get.params.id).toBe('draft');
    // The history route has more static segments than :id.
    expect(registry.match('GET', '/api/automations/r1/history')!.def.operationId).toBe('automations.history');
  });

  it('draft forces enabled=false and writes the rule_drafted ledger line', async () => {
    const { registry, ledgers, drafted } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/automations/draft')!(
      fakeReq({ url: '/api/automations/draft', method: 'POST', body: JSON.stringify({ id: 'r2', enabled: true, trigger: { schedule: '0 * * * *' } }) }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ id: 'r2', valid: true, errors: [] });
    expect(drafted[0]).toMatchObject({ id: 'r2', enabled: false, trigger: { type: 'cron', schedule: '0 * * * *', timezone: 'UTC' } });
    expect(ledgers[0]).toMatchObject({ event: 'AUTOMATION_TRIGGERED', ruleId: 'r2', reason: 'rule_drafted' });
  });

  it('draft returns 503 when the engine is absent (not 500)', async () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachAutomationRoutes(registry, { automationEngine: () => undefined, ledger: () => undefined });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/automations/draft')!(
      fakeReq({ url: '/api/automations/draft', method: 'POST', body: JSON.stringify({ id: 'x' }) }), r.res,
    );
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toBe('Automation engine not available');
  });

  it('list enriches each rule with next5 + recent history (limit 3)', async () => {
    const { registry, historyCalls } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/automations')!(fakeReq({ url: '/api/automations', method: 'GET' }), r.res);
    const body = JSON.parse(r.body);
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0].nextTriggers).toEqual(['2026-11-11T00:00:00Z']);
    expect(body.rules[0].recentHistory).toEqual([{ ruleId: 'r1' }]);
    expect(historyCalls[0]).toEqual(['r1', 3]);
  });

  it('single rule detail is 404 when unknown, else carries history (limit 10)', async () => {
    const { registry, historyCalls } = setup();
    let r = fakeRes();
    await handlerFor(registry, 'GET', '/api/automations/nope')!(fakeReq({ url: '/api/automations/nope', method: 'GET' }), r.res);
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body).error).toBe('Rule not found');

    r = fakeRes();
    await handlerFor(registry, 'GET', '/api/automations/r1')!(fakeReq({ url: '/api/automations/r1', method: 'GET' }), r.res);
    const body = JSON.parse(r.body);
    expect(body.id).toBe('r1');
    expect(body.history).toEqual([{ ruleId: 'r1' }]);
    expect(historyCalls.at(-1)).toEqual(['r1', 10]);
  });

  it('toggle passes the parsed enabled flag and logs enabled/disabled', async () => {
    const { registry, ledgers, toggled } = setup();
    let r = fakeRes();
    await handlerFor(registry, 'PUT', '/api/automations/r1')!(
      fakeReq({ url: '/api/automations/r1', method: 'PUT', body: JSON.stringify({ enabled: false }) }), r.res,
    );
    expect(toggled[0]).toEqual(['r1', false]);
    expect(JSON.parse(r.body)).toEqual({ status: 'toggled', enabled: false });
    expect(ledgers[0]).toMatchObject({ ruleId: 'r1', reason: 'disabled' });

    r = fakeRes();
    await handlerFor(registry, 'PUT', '/api/automations/r1')!(
      fakeReq({ url: '/api/automations/r1', method: 'PUT', body: 'not-json' }), r.res,
    );
    expect(r.status).toBe(400); // legacy try/catch → 400, not 500
  });

  it('delete writes the deleted ledger line', async () => {
    const { registry, ledgers, deleted } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'DELETE', '/api/automations/r1')!(fakeReq({ url: '/api/automations/r1', method: 'DELETE' }), r.res);
    expect(JSON.parse(r.body)).toEqual({ status: 'deleted' });
    expect(deleted[0]).toBe('r1');
    expect(ledgers[0]).toMatchObject({ ruleId: 'r1', reason: 'deleted' });
  });

  it('history honours ?limit= (default 20) with the id from registry params', async () => {
    const { registry, historyCalls } = setup();
    let r = fakeRes();
    await handlerFor(registry, 'GET', '/api/automations/r1/history?limit=5')!(
      fakeReq({ url: '/api/automations/r1/history?limit=5', method: 'GET' }), r.res,
    );
    expect(historyCalls[0]).toEqual(['r1', 5]);
    expect(JSON.parse(r.body).history).toEqual([{ ruleId: 'r1' }]);

    r = fakeRes();
    await handlerFor(registry, 'GET', '/api/automations/r1/history')!(
      fakeReq({ url: '/api/automations/r1/history', method: 'GET' }), r.res,
    );
    expect(historyCalls.at(-1)).toEqual(['r1', 20]);
  });
});
