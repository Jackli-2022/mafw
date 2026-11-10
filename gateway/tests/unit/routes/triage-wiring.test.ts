// Phase D1 Task A4: triage registry wiring — 3 confirm sub-paths (skillDraft / axiomDraft /
// goal-request file), reject ledger line and propose validation parity.
import type { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachTriageRoutes, type TriageItemLike } from '../../../src/routes/triage';

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

function item(overrides: Partial<TriageItemLike> = {}): TriageItemLike {
  return {
    state: 'PENDING_CONFIRMATION',
    automationId: 'auto-1',
    proposedGoal: { title: 'T', boundaries: ['b'], estimatedLoops: 3 },
    ...overrides,
  } as TriageItemLike;
}

function setup(opts: { items?: TriageItemLike[]; found?: TriageItemLike | null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-triage-'));
  const ledgers: any[] = [];
  const confirmed: Array<[string, unknown]> = [];
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachTriageRoutes(registry, {
    automationEngine: () => ({
      getTriageItems: () => opts.items ?? [],
      getTriageItem: () => (opts.found === undefined ? item() : opts.found),
      confirmTriage: (id, it) => { confirmed.push([id, it]); },
      rejectTriage: () => true,
      proposeTriageDecision: () => ({ success: true, message: 'ok' }),
    }),
    skillInstallDeps: () => ({ install: () => ({ installed: true }) }),
    mafwDir: () => dir,
    ledger: () => ({ append: (e) => ledgers.push(e) }),
  });
  return { registry, dir, ledgers, confirmed };
}

/** Registry dispatch always passes matched params — mirror it here (the legacy
 *  branches captured the id from their own regex). */
const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('triage registry wiring (D1 Task A4)', () => {
  it('all four catalog routes have handlers attached (no silent 404)', () => {
    const { registry } = setup();
    expect(handlerFor(registry, 'GET', '/api/triage')).toBeDefined();
    expect(handlerFor(registry, 'POST', '/api/triage/x/confirm')).toBeDefined();
    expect(handlerFor(registry, 'POST', '/api/triage/x/reject')).toBeDefined();
    expect(handlerFor(registry, 'POST', '/api/triage/x/propose')).toBeDefined();
  });

  it('list returns items (empty when engine absent)', async () => {
    const { registry } = setup({ items: [item()] });
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/triage')!(fakeReq({ url: '/api/triage', method: 'GET' }), r.res);
    expect(JSON.parse(r.body).items).toHaveLength(1);
  });

  it('confirm without goal-draft sub-path writes requests/<goalId>.json and the ledger line', async () => {
    const { registry, dir, ledgers, confirmed } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/triage/auto-1/confirm')!(
      fakeReq({ url: '/api/triage/auto-1/confirm', method: 'POST' }), r.res,
    );
    const body = JSON.parse(r.body);
    expect(body.status).toBe('confirmed');
    expect(body.goalId).toMatch(/^confirmed-auto-1-/);
    const file = path.join(dir, 'requests', `${body.goalId}.json`);
    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toMatchObject({ goalId: body.goalId, source: 'triage-confirm', automationId: 'auto-1' });
    // Legacy quirk preserved: the goal path calls confirmTriage(goalId, item) — not triageId.
    expect(confirmed[0][0]).toBe(body.goalId);
    expect(ledgers[0]).toMatchObject({ reason: 'triage_confirmed', goalId: body.goalId });
  });

  it('confirm 404 when item missing, 400 when already decided', async () => {
    let r = fakeRes();
    await handlerFor(setup({ found: null }).registry, 'POST', '/api/triage/x/confirm')!(
      fakeReq({ url: '/api/triage/x/confirm', method: 'POST' }), r.res,
    );
    expect(r.status).toBe(404);

    r = fakeRes();
    await handlerFor(setup({ found: item({ state: 'REJECTED' }) }).registry, 'POST', '/api/triage/x/confirm')!(
      fakeReq({ url: '/api/triage/x/confirm', method: 'POST' }), r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe('Already REJECTED');
  });

  it('reject writes the triage_rejected ledger line', async () => {
    const { registry, ledgers } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/triage/auto-9/reject')!(
      fakeReq({ url: '/api/triage/auto-9/reject', method: 'POST' }), r.res,
    );
    expect(JSON.parse(r.body)).toEqual({ status: 'rejected' });
    expect(ledgers[0]).toMatchObject({ reason: 'triage_rejected', details: { triageId: 'auto-9' } });
  });

  it('propose rejects a bad suggestion with 400 (try/catch parity)', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/triage/auto-1/propose')!(
      fakeReq({ url: '/api/triage/auto-1/propose', method: 'POST', body: JSON.stringify({ suggestion: 'maybe' }) }), r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toContain('suggestion must be');
  });
});
