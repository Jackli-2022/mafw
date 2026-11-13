// Phase D1 Task F2: goals-inline registry wiring — six legacy branches → seven ops
// (respond / timeline / retry / plan + plan-approval / validate / complete). The
// load-bearing quirk is the joint plan branch: the two registry ops must both call
// handleGoalPlan with the RAW req.url (its internal dispatch depends on it) and
// pre-read the body only for POST.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Principal } from '../../../src/core/auth';
import { ensureGoalState, writeGoalState } from '../../../src/core/goal/state-v3';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachGoalRoutes, type GoalsInlineRouteDeps } from '../../../src/routes/goals-inline';

/** E7-1: human-only routes (plan approval, goal question answers) need a resolved human principal. */
const HUMAN: Principal = { kind: 'human', method: 'human-token' };

function fakeReq(opts: { method: string; url: string; body?: string; principal?: Principal }): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    ...(opts.principal ? { mafwPrincipal: opts.principal } : {}),
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

function setup(over: Partial<GoalsInlineRouteDeps> = {}) {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  const mafwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-goal-routes-'));
  const deps: GoalsInlineRouteDeps = {
    mafwDir: () => mafwDir,
    goalDriver: () => null,
    goalDriverMafwDirCache: () => new Map<string, string>(),
    findGoalStatePath: () => null,
    loadRequest: async () => null,
    getGatewayDb: () => ({ listNodeRuns: () => [], getGoalOutcome: () => null } as any),
    handleValidate: async () => ({ ok: true }),
    handleComplete: async () => ({ ok: true }),
    ...over,
  };
  attachGoalRoutes(registry, deps);
  return { registry, mafwDir };
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('goals-inline registry wiring (D1 Task F2)', () => {
  it('all seven catalog ops have handlers attached (no silent 404)', () => {
    const { registry } = setup();
    const expectOps: Array<[string, string, string]> = [
      ['POST', '/api/goals/g1/questions/q1/respond', 'goals.respondQuestion'],
      ['GET', '/api/goals/g1/timeline', 'goals.timeline'],
      ['POST', '/api/goals/g1/nodes/12/retry', 'goals.retryNode'],
      ['GET', '/api/goals/g1/plan', 'goals.plan'],
      ['POST', '/api/goals/g1/plan-approval', 'goals.planApproval'],
      ['POST', '/api/work/g1/validate', 'goals.validate'],
      ['POST', '/api/work/g1/complete', 'goals.complete'],
    ];
    for (const [method, url, op] of expectOps) {
      expect(registry.match(method as never, url)?.def.operationId).toBe(op);
      expect(handlerFor(registry, method, url)).toBeDefined();
    }
    // goals.sessions is wave1 territory — attachGoalRoutes must leave it untouched.
    expect(registry.attachedOperationIds().has('goals.sessions')).toBe(false);
  });

  it('respond: invalid JSON → 400 bad_request before touching the ledger', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/goals/g1/questions/q1/respond')!(
      fakeReq({ method: 'POST', url: '/api/goals/g1/questions/q1/respond', body: '{', principal: HUMAN }), r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ status: 'bad_request', error: 'Invalid JSON' });
  });

  it('respond: unknown question → 404 not_found (no driver call)', async () => {
    const calls: any[] = [];
    const { registry } = setup({
      goalDriver: () => ({
        handleCancel: (g: string, q: string) => { calls.push(['cancel', g, q]); return true; },
        handleAnswer: (g: string, q: string, a: string) => { calls.push(['answer', g, q, a]); return true; },
      }) as any,
    });
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/goals/g1/questions/q1/respond')!(
      fakeReq({ method: 'POST', url: '/api/goals/g1/questions/q1/respond', body: JSON.stringify({ answer: 'x' }), principal: HUMAN }), r.res,
    );
    // Unknown question → 404 (ledger from the empty temp dir).
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body)).toEqual({ status: 'not_found' });
    expect(calls).toEqual([]);
  });

  it('timeline: delegates to handleGoalTimeline with the raw url (404 on unknown goal)', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/goals/g1/timeline')!(
      fakeReq({ method: 'GET', url: '/api/goals/g1/timeline' }), r.res,
    );
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body)).toEqual({ error: 'goal state not found' });
  });

  it('retry: unknown run → 404 node run not found', async () => {
    const { registry } = setup();
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/goals/g1/nodes/12/retry')!(
      fakeReq({ method: 'POST', url: '/api/goals/g1/nodes/12/retry', body: JSON.stringify({ confirm: true }) }), r.res,
    );
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body)).toEqual({ error: 'node run not found' });
  });

  it('retry: canonical digit runId reaches handleNodeRetry and retries the run', async () => {
    const retried: any[] = [];
    const { registry } = setup({
      getGatewayDb: () => ({
        listNodeRuns: () => [{ id: 12, goal_id: 'g1', node: 'plan', status: 'failed', loop: 1 }],
        getGoalOutcome: () => null,
      }) as any,
      goalDriver: () => ({
        retryNodeRun: async (g: string, runId: number) => { retried.push([g, runId]); return { runId }; },
      }) as any,
    });
    const r = fakeRes();
    const handled = await handlerFor(registry, 'POST', '/api/goals/g1/nodes/12/retry')!(
      fakeReq({ method: 'POST', url: '/api/goals/g1/nodes/12/retry', body: JSON.stringify({}) }), r.res,
    );
    expect(handled).not.toBe(false);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ success: true, runId: 12 });
    expect(retried).toEqual([['g1', 12]]);
  });

  // Review fix round 1: the registry template `:runId` accepts ANY segment and
  // match() strips query/trailing slash, so the handler's own digit-locked regex
  // can miss. Legacy fell through to the dashboard for these shapes; the handler
  // must return false (no 500, no response) so dispatchAuthorized does the same.
  it('retry: non-digit runId → handled=false (legacy fall-through, no TypeError 500)', async () => {
    const { registry } = setup();
    const r = fakeRes();
    const handled = await handlerFor(registry, 'POST', '/api/goals/g1/nodes/abc/retry')!(
      fakeReq({ method: 'POST', url: '/api/goals/g1/nodes/abc/retry', body: JSON.stringify({ confirm: true }) }), r.res,
    );
    expect(handled).toBe(false);
    expect(r.status).toBe(200);
    expect(r.body).toBe('');
  });

  it('retry: digit runId with a query string → handled=false (fall-through)', async () => {
    const { registry } = setup();
    const r = fakeRes();
    const handled = await handlerFor(registry, 'POST', '/api/goals/g1/nodes/12/retry?x=1')!(
      fakeReq({ method: 'POST', url: '/api/goals/g1/nodes/12/retry?x=1', body: JSON.stringify({}) }), r.res,
    );
    expect(handled).toBe(false);
    expect(r.body).toBe('');
  });

  it('retry: trailing-slash URL → handled=false (fall-through)', async () => {
    const { registry } = setup();
    const r = fakeRes();
    const handled = await handlerFor(registry, 'POST', '/api/goals/g1/nodes/12/retry/')!(
      fakeReq({ method: 'POST', url: '/api/goals/g1/nodes/12/retry/', body: JSON.stringify({}) }), r.res,
    );
    expect(handled).toBe(false);
    expect(r.body).toBe('');
  });

  // Review fix wave: the body read must sit AFTER the digit gate. Reading first
  // drained the stream for URLs the handler declines, so the request that fell
  // through to the proxy arrived body-less (legacy never reached this branch and
  // left the body intact). Pin "declined ⇒ zero bytes consumed".
  it('retry: fall-through does not consume the request body', async () => {
    const { registry } = setup();
    let drained = false;
    const req = fakeReq({ method: 'POST', url: '/api/goals/g1/nodes/abc/retry', body: '{"confirm":true}' });
    const originalOn = (req as any).on.bind(req);
    (req as any).on = (ev: string, fn: unknown) => {
      if (ev === 'data' || ev === 'end') drained = true;
      return originalOn(ev, fn);
    };
    const r = fakeRes();
    const handled = await handlerFor(registry, 'POST', '/api/goals/g1/nodes/abc/retry')!(req, r.res);
    expect(handled).toBe(false);
    expect(drained).toBe(false);
    expect(r.body).toBe('');
  });

  describe('plan / plan-approval joint delegation', () => {
    function planSetup() {
      const mafwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-plan-wiring-'));
      fs.mkdirSync(path.join(mafwDir, 'goals'), { recursive: true });
      ensureGoalState(mafwDir, 'g1', { projectDir: 'C:/p', maxRounds: 3 });
      const wavesPath = path.join(mafwDir, 'waves.json');
      fs.writeFileSync(wavesPath, JSON.stringify({ status: 'ready', waves: [{ id: 'w1', title: 't', tasks: ['a'], riskNote: 'r' }] }), 'utf-8');
      // The module's loadState closure reads the goal state file (mafwDir cache →
      // loadGoalState), so the plan-review surface is persisted, not injected.
      writeGoalState(mafwDir, 'g1', {
        wavePlanPath: wavesPath,
        planReview: 'manual' as const,
        planApproval: { id: 'pa_1', status: 'pending' as const, round: 1 },
      } as any);
      const calls: any[] = [];
      const { registry } = setup({
        mafwDir: () => mafwDir,
        goalDriverMafwDirCache: () => new Map([['g1', mafwDir]]),
        loadRequest: async () => ({ title: 'Goal 1' }),
        goalDriver: () => ({
          approvePlan: async (g: string, approvalId?: string) => { calls.push(['approve', g, approvalId]); return true; },
          rejectPlan: async (g: string, feedback: string, approvalId?: string) => { calls.push(['reject', g, feedback, approvalId]); return true; },
        }) as any,
        findGoalStatePath: () => null,
      });
      return { registry, calls, mafwDir, wavesPath };
    }

    it('GET /api/goals/:id/plan reaches handleGoalPlan with the raw url → 200 waves', async () => {
      const { registry } = planSetup();
      const r = fakeRes();
      const handled = await handlerFor(registry, 'GET', '/api/goals/g1/plan')!(
        fakeReq({ method: 'GET', url: '/api/goals/g1/plan' }), r.res,
      );
      // handleGoalPlan matched the raw url (otherwise handled would be false and
      // no response would have been written).
      expect(handled).not.toBe(false);
      expect(r.status).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.planReview).toBe('manual');
      expect(body.planApproval.status).toBe('pending');
      expect(body.waves.waves).toHaveLength(1);
    });

    it('POST /api/goals/:id/plan-approval pre-reads the body and approves', async () => {
      const { registry, calls } = planSetup();
      const r = fakeRes();
      await handlerFor(registry, 'POST', '/api/goals/g1/plan-approval')!(
        fakeReq({ method: 'POST', url: '/api/goals/g1/plan-approval', body: JSON.stringify({ approve: true, approvalId: 'pa_1' }), principal: HUMAN }), r.res,
      );
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ success: true });
      expect(calls).toEqual([['approve', 'g1', 'pa_1']]);
    });

    it('POST invalid JSON → body {} → reject-without-feedback 400 (legacy parse fallback)', async () => {
      const { registry, calls } = planSetup();
      const r = fakeRes();
      await handlerFor(registry, 'POST', '/api/goals/g1/plan-approval')!(
        fakeReq({ method: 'POST', url: '/api/goals/g1/plan-approval', body: '{', principal: HUMAN }), r.res,
      );
      expect(r.status).toBe(400);
      expect(JSON.parse(r.body)).toEqual({ error: 'reject requires feedback' });
      expect(calls).toEqual([]);
    });

    it('GET on an unknown goal → 404 goal state not found', async () => {
      const { registry } = planSetup();
      const r = fakeRes();
      await handlerFor(registry, 'GET', '/api/goals/nope/plan')!(
        fakeReq({ method: 'GET', url: '/api/goals/nope/plan' }), r.res,
      );
      expect(r.status).toBe(404);
      expect(JSON.parse(r.body)).toEqual({ error: 'goal state not found' });
    });
  });

  it('validate: forwards goalId + parsed body to handleValidate (200 verbatim)', async () => {
    const seen: any[] = [];
    const { registry } = setup({
      handleValidate: async (goalId: string, data?: any) => { seen.push([goalId, data]); return { validated: true }; },
    });
    const r = fakeRes();
    await handlerFor(registry, 'POST', '/api/work/g1/validate')!(
      fakeReq({ method: 'POST', url: '/api/work/g1/validate', body: JSON.stringify({ projectDir: 'C:/p' }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ validated: true });
    expect(seen).toEqual([['g1', { projectDir: 'C:/p' }]]);
  });

  it('validate: "Goal already exists" → 409, other errors → 400', async () => {
    let { registry } = setup({
      handleValidate: async () => { throw new Error('Goal already exists'); },
    });
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/work/g1/validate')!(
      fakeReq({ method: 'POST', url: '/api/work/g1/validate', body: '{}' }), r.res,
    );
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body)).toEqual({ error: 'Goal already exists' });

    ({ registry } = setup({
      handleValidate: async () => { throw new Error('bad payload'); },
    }));
    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/work/g1/validate')!(
      fakeReq({ method: 'POST', url: '/api/work/g1/validate', body: '{}' }), r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ error: 'bad payload' });
  });

  it('complete: forwards goalId + parsed body to handleComplete; errors → 400', async () => {
    const seen: any[] = [];
    let { registry } = setup({
      handleComplete: async (goalId: string, data?: any) => { seen.push([goalId, data]); return { completed: true }; },
    });
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/work/g1/complete')!(
      fakeReq({ method: 'POST', url: '/api/work/g1/complete', body: JSON.stringify({ score: 9 }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ completed: true });
    expect(seen).toEqual([['g1', { score: 9 }]]);

    ({ registry } = setup({
      handleComplete: async () => { throw new Error('nope'); },
    }));
    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/work/g1/complete')!(
      fakeReq({ method: 'POST', url: '/api/work/g1/complete', body: '{}' }), r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body)).toEqual({ error: 'nope' });
  });
});
