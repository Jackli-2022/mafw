/**
 * E7-1 — remaining human-only routes (spec docs/superpowers/specs/2026-11-13-gateway-e7-deferred-cleanup-design.md §3 E7-1).
 *
 * E5a closed the human gates on pod accept / review items / decisions / goal-run
 * approval. These are the deferred mutations: plan approval, triage
 * confirm/reject/dismiss, lead boundary accept/merge/undo, approvals.respond,
 * permissions.reply and the question answer paths (goals.respondQuestion,
 * questions.reply/reject). Every one of them is a user decision in the desktop
 * UI, so a service/local/anonymous/missing principal must get the stable
 * `human_principal_required` 403 — while read-only / advisory paths
 * (GET plan, triage list/propose, boundary list/observe) stay ordinary routes.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Principal } from '../../../src/core/auth';
import { ensureGoalState } from '../../../src/core/goal/state-v3';
import { QuestionLedger } from '../../../src/core/manager/question-ledger';
import { handleGoalPlan } from '../../../src/routes/goal-plan';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachGoalRoutes } from '../../../src/routes/goals-inline';
import { attachTriageRoutes } from '../../../src/routes/triage';
import { attachLeadBoundaryRoutes } from '../../../src/routes/lead-boundaries';
import { attachApprovalsRoutes } from '../../../src/routes/approvals';
import { attachQuestionsPermissionsRoutes } from '../../../src/routes/questions-permissions';
import { attachWave1Handlers, type Wave1Gateway } from '../../../src/routes/wave1-handlers';

const HUMAN: Principal = { kind: 'human', method: 'human-token' };
const DEVICE: Principal = { kind: 'human', method: 'device-token', deviceId: 'dev-1' };

const DENIED_PRINCIPALS: Array<[string, Principal | undefined]> = [
  ['missing principal', undefined],
  ['service', { kind: 'service', method: 'api-token' }],
  ['local', { kind: 'local', method: 'loopback' }],
  ['anonymous', { kind: 'anonymous', method: 'none' }],
];

const DENIED_CODE = 'human_principal_required';
const DENIED_BODY = { error: 'human principal required', code: DENIED_CODE };

function mockRes() {
  const res: any = {
    // Routes that only `res.end(...)` (list surfaces) rely on Node's implicit 200.
    status: 200,
    body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
    setHeader() { return this; },
    get headersSent() { return this.status !== 0; },
  };
  return res as ServerResponse & { status: number; body: string };
}

function mockReq(method: string, body?: unknown, principal?: Principal): IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = {
    method,
    url: '/',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); },
  };
  if (principal) req.mafwPrincipal = principal;
  setImmediate(() => {
    if (body !== undefined) for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as IncomingMessage;
}

function registryWith(attach: (registry: RouteRegistry) => void): RouteRegistry {
  const registry = new RouteRegistry();
  registry.register(...buildRouteCatalog());
  attach(registry);
  return registry;
}

async function drive(
  registry: RouteRegistry,
  method: string,
  url: string,
  opts: { body?: unknown; principal?: Principal } = {},
): Promise<{ status: number; json: any }> {
  const matched = registry.match(method as never, url);
  expect(matched?.def.handler).toBeDefined();
  const res = mockRes();
  const req = mockReq(method, opts.body, opts.principal);
  // Handlers that still re-match `req.url` internally (triage.dismiss, goal-plan)
  // see the same URL the registry matched.
  (req as any).url = url;
  await matched!.def.handler!(req, res, matched!.params);
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
}

// ---------------------------------------------------------------------------
// POST /api/goals/:id/plan-approval
// ---------------------------------------------------------------------------

function planDeps() {
  const mafwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-e7-plan-'));
  fs.mkdirSync(path.join(mafwDir, 'goals'), { recursive: true });
  const wavesPath = path.join(mafwDir, 'waves.json');
  fs.writeFileSync(wavesPath, JSON.stringify({ status: 'ready', waves: [{ id: 'w1', title: 't', tasks: ['a'], riskNote: 'r' }] }), 'utf-8');
  const state = {
    ...ensureGoalState(mafwDir, 'g1', { projectDir: 'C:/p', maxRounds: 3 }),
    wavePlanPath: wavesPath,
    planReview: 'manual' as const,
    planApproval: { id: 'pa_1', status: 'pending' as const, round: 1 },
    mafwDir,
  };
  return {
    mafwDir,
    deps: {
      body: { approve: true, approvalId: 'pa_1' },
      loadState: (goalId: string) => (goalId === 'g1' ? (state as any) : null),
      approvePlan: jest.fn(async () => true),
      rejectPlan: jest.fn(async () => true),
    },
  };
}

async function drivePlan(
  body: unknown,
  principal: Principal | undefined,
  method: 'GET' | 'POST' = 'POST',
  url = '/api/goals/g1/plan-approval',
) {
  const { deps } = planDeps();
  const res = mockRes();
  await handleGoalPlan(
    mockReq(method, body, principal),
    res,
    url,
    { ...deps, body } as any,
  );
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null, deps };
}

describe('POST /api/goals/:id/plan-approval is human-only', () => {
  test.each(DENIED_PRINCIPALS)('denies a %s with the stable code', async (_label, principal) => {
    const out = await drivePlan({ approve: true, approvalId: 'pa_1' }, principal);

    expect(out.status).toBe(403);
    expect(out.json).toEqual(DENIED_BODY);
    expect(out.deps.approvePlan).not.toHaveBeenCalled();
    expect(out.deps.rejectPlan).not.toHaveBeenCalled();
  });

  test('admits a human principal and approves', async () => {
    const out = await drivePlan({ approve: true, approvalId: 'pa_1' }, HUMAN);

    expect(out.status).toBe(200);
    expect(out.json).toEqual({ success: true });
    expect(out.deps.approvePlan).toHaveBeenCalledTimes(1);
  });

  test('admits a device principal', async () => {
    const out = await drivePlan({ approve: true, approvalId: 'pa_1' }, DEVICE);
    expect(out.status).toBe(200);
  });

  test('GET /api/goals/:id/plan stays read-only (no principal required)', async () => {
    const out = await drivePlan(undefined, undefined, 'GET', '/api/goals/g1/plan');

    expect(out.status).toBe(200);
    expect(out.json.waves.waves).toHaveLength(1);
    expect(out.deps.approvePlan).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// triage.confirm / triage.reject / triage.propose / triage.list
// ---------------------------------------------------------------------------

function triageSetup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-e7-triage-'));
  const confirmTriage = jest.fn();
  const rejectTriage = jest.fn(() => true);
  const proposeTriageDecision = jest.fn(() => ({ success: true, message: 'ok' }));
  const registry = registryWith((r) => attachTriageRoutes(r, {
    automationEngine: () => ({
      getTriageItems: () => [],
      getTriageItem: () => ({
        state: 'PENDING_CONFIRMATION',
        automationId: 'auto-1',
        proposedGoal: { title: 'T', boundaries: ['b'], estimatedLoops: 3 },
      }),
      confirmTriage,
      rejectTriage,
      proposeTriageDecision,
    }),
    skillInstallDeps: () => ({}),
    mafwDir: () => dir,
    ledger: () => ({ append: () => {} }),
  }));
  return { registry, confirmTriage, rejectTriage, proposeTriageDecision };
}

describe('triage.confirm / triage.reject are human-only', () => {
  const cases: Array<[string, string]> = [
    ['confirm', '/api/triage/auto-1/confirm'],
    ['reject', '/api/triage/auto-1/reject'],
  ];

  test.each(cases)('%s denies every non-human principal', async (_label, url) => {
    for (const [label, principal] of DENIED_PRINCIPALS) {
      const { registry, confirmTriage, rejectTriage } = triageSetup();
      const out = await drive(registry, 'POST', url, { principal });

      expect({ url, label, status: out.status, json: out.json }).toEqual({
        url,
        label,
        status: 403,
        json: DENIED_BODY,
      });
      expect(confirmTriage).not.toHaveBeenCalled();
      expect(rejectTriage).not.toHaveBeenCalled();
    }
  });

  test('confirm admits a human principal', async () => {
    const { registry, confirmTriage } = triageSetup();
    const out = await drive(registry, 'POST', '/api/triage/auto-1/confirm', { principal: HUMAN });

    expect(out.status).toBe(200);
    expect(out.json.status).toBe('confirmed');
    expect(confirmTriage).toHaveBeenCalledTimes(1);
  });

  test('reject admits a human principal', async () => {
    const { registry, rejectTriage } = triageSetup();
    const out = await drive(registry, 'POST', '/api/triage/auto-1/reject', { principal: HUMAN });

    expect(out.status).toBe(200);
    expect(out.json).toEqual({ status: 'rejected' });
    expect(rejectTriage).toHaveBeenCalledWith('auto-1');
  });

  test('triage.propose stays an ordinary route (agent suggestion path)', async () => {
    const { registry, proposeTriageDecision } = triageSetup();
    const out = await drive(registry, 'POST', '/api/triage/auto-1/propose', {
      body: { suggestion: 'confirm', reason: 'fits', priority: 'medium' },
    });

    expect(out.status).toBe(200);
    expect(out.json.success).toBe(true);
    expect(proposeTriageDecision).toHaveBeenCalledTimes(1);
  });

  test('triage.list stays an ordinary route', async () => {
    const { registry } = triageSetup();
    const out = await drive(registry, 'GET', '/api/triage');
    expect(out.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// triage.dismiss (wave1 closure)
// ---------------------------------------------------------------------------

function wave1Setup() {
  const rejectTriage = jest.fn(() => true);
  const registry = registryWith((r) => attachWave1Handlers(r, {
    getGatewayDb: () => ({ listGoalSessions: () => [] }),
    runtime: null,
    automationEngine: { rejectTriage },
    ledger: { append: () => {} },
  } as unknown as Wave1Gateway));
  return { registry, rejectTriage };
}

describe('triage.dismiss is human-only', () => {
  test.each(DENIED_PRINCIPALS)('denies a %s with the stable code', async (_label, principal) => {
    const { registry, rejectTriage } = wave1Setup();
    const out = await drive(registry, 'POST', '/api/triage/t1/dismiss', { principal });

    expect(out.status).toBe(403);
    expect(out.json).toEqual(DENIED_BODY);
    expect(rejectTriage).not.toHaveBeenCalled();
  });

  test('admits a human principal', async () => {
    const { registry, rejectTriage } = wave1Setup();
    const out = await drive(registry, 'POST', '/api/triage/t1/dismiss', { principal: HUMAN });

    expect(out.status).toBe(200);
    expect(out.json).toEqual({ status: 'dismissed' });
    expect(rejectTriage).toHaveBeenCalledWith('t1');
  });
});

// ---------------------------------------------------------------------------
// lead.boundaries accept / merge / undo (list / observe stay open)
// ---------------------------------------------------------------------------

function leadSetup() {
  const service = {
    list: jest.fn(() => [{ id: 'b1', status: 'proposed' }]),
    accept: jest.fn(() => ({ id: 'b1', status: 'accepted' })),
    merge: jest.fn(() => ({ id: 'b1', status: 'merged' })),
    undo: jest.fn(() => ({ id: 'b1', status: 'undone' })),
  };
  const observe = jest.fn(() => ({ id: 'b1', status: 'proposed' }));
  const registry = registryWith((r) => attachLeadBoundaryRoutes(r, { service, observe }));
  return { registry, service, observe };
}

describe('lead boundary mutations are human-only', () => {
  const cases: Array<[string, string, keyof ReturnType<typeof leadSetup>['service']]> = [
    ['accept', '/api/lead/topics/t1/boundaries/b1/accept', 'accept'],
    ['merge', '/api/lead/topics/t1/boundaries/b1/merge', 'merge'],
    ['undo', '/api/lead/topics/t1/boundaries/b1/undo', 'undo'],
  ];

  test.each(cases)('%s denies every non-human principal', async (_label, url, method) => {
    for (const [label, principal] of DENIED_PRINCIPALS) {
      const { registry, service } = leadSetup();
      const out = await drive(registry, 'POST', url, { principal });

      expect({ url, label, status: out.status, json: out.json }).toEqual({
        url,
        label,
        status: 403,
        json: DENIED_BODY,
      });
      expect(service[method]).not.toHaveBeenCalled();
    }
  });

  test.each(cases)('%s admits a human principal', async (_label, url, method) => {
    const { registry, service } = leadSetup();
    const out = await drive(registry, 'POST', url, { principal: HUMAN });

    expect(out.status).toBe(200);
    expect(service[method]).toHaveBeenCalledWith('t1', 'b1');
  });

  test('list stays an ordinary route', async () => {
    const { registry, service } = leadSetup();
    const out = await drive(registry, 'GET', '/api/lead/topics/t1/boundaries');

    expect(out.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith('t1');
  });

  test('observe stays an ordinary route (advisory proposal must not need a human)', async () => {
    const { registry, observe } = leadSetup();
    const out = await drive(registry, 'POST', '/api/lead/boundaries/observe', {
      body: { sessionID: 'ses_1', text: 'topic boundary' },
    });

    expect(out.status).toBe(200);
    expect(out.json.proposed).toBe(true);
    expect(observe).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// approvals.respond
// ---------------------------------------------------------------------------

function approvalsSetup() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-e7-approvals-'));
  fs.mkdirSync(path.join(projectDir, 'user-questions'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'user-questions', 'q-1.json'),
    JSON.stringify({ question: 'Q' }),
    'utf-8',
  );
  const registry = registryWith((r) => attachApprovalsRoutes(r, {
    registeredProjects: () => new Map([[projectDir, { mafwDir: projectDir }]]),
    allowlistStore: () => ({ list: () => [], add: async () => ({ ok: true, entries: [] }), remove: async () => ({ ok: true, entries: [] }) }) as any,
    permissionRules: () => ({ list: () => [], add: async () => ({ ok: true }), remove: async () => ({ ok: true }) }) as any,
  }));
  return { registry, projectDir };
}

describe('approvals.respond is human-only', () => {
  test.each(DENIED_PRINCIPALS)('denies a %s with the stable code', async (_label, principal) => {
    const { registry, projectDir } = approvalsSetup();
    const out = await drive(registry, 'POST', '/api/approvals/q-1/respond', {
      body: { answer: 'yes' },
      principal,
    });

    expect(out.status).toBe(403);
    expect(out.json).toEqual(DENIED_BODY);
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, 'user-questions', 'q-1.json'), 'utf-8')).answered).toBeUndefined();
  });

  test('admits a human principal and writes the answer', async () => {
    const { registry, projectDir } = approvalsSetup();
    const out = await drive(registry, 'POST', '/api/approvals/q-1/respond', {
      body: { answer: 'yes' },
      principal: HUMAN,
    });

    expect(out.status).toBe(200);
    expect(out.json).toEqual({ status: 'ok', decision: 'answered' });
    expect(JSON.parse(fs.readFileSync(path.join(projectDir, 'user-questions', 'q-1.json'), 'utf-8')))
      .toMatchObject({ answered: true, answer: 'yes' });
  });

  test('approvals.list stays an ordinary route', async () => {
    const { registry } = approvalsSetup();
    const out = await drive(registry, 'GET', '/api/approvals');
    expect(out.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// permissions.reply (permissions.replyRuntime stays internal/open)
// ---------------------------------------------------------------------------

function permissionsSetup() {
  const permissionReply = jest.fn(async () => true);
  const registry = registryWith((r) => attachQuestionsPermissionsRoutes(r, {
    capGuard: () => false,
    capGuardQuestion: () => false,
    serveUrl: () => 'http://127.0.0.1:3000',
    currentProjectDir: () => 'C:/repo',
    projectDir: () => 'C:/repo',
    runtime: () => ({
      access: { can: () => true },
      session: {
        permissionList: async () => [{ id: 'r1', sessionID: 's1' }],
        permissionReply,
      },
    }) as any,
    registeredProjects: () => new Map(),
    permissionRules: () => ({ match: () => null, add: () => {}, list: () => [] }) as any,
  }));
  return { registry, permissionReply };
}

describe('permissions.reply is human-only', () => {
  test.each(DENIED_PRINCIPALS)('denies a %s with the stable code', async (_label, principal) => {
    const { registry, permissionReply } = permissionsSetup();
    const out = await drive(registry, 'POST', '/api/permissions/r1/reply', {
      body: { reply: 'once' },
      principal,
    });

    expect(out.status).toBe(403);
    expect(out.json).toEqual(DENIED_BODY);
    expect(permissionReply).not.toHaveBeenCalled();
  });

  test('admits a human principal and replies', async () => {
    const { registry, permissionReply } = permissionsSetup();
    const out = await drive(registry, 'POST', '/api/permissions/r1/reply', {
      body: { reply: 'once' },
      principal: HUMAN,
    });

    expect(out.status).toBe(200);
    expect(out.json).toEqual({ status: 'ok' });
    expect(permissionReply).toHaveBeenCalledTimes(1);
  });

  test('permissions.list stays an ordinary route', async () => {
    const { registry } = permissionsSetup();
    const out = await drive(registry, 'GET', '/api/permissions');
    expect(out.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// questions.reply / questions.reject (runtime question answers)
// ---------------------------------------------------------------------------

function questionsSetup() {
  const reply = jest.fn(async () => true);
  const reject = jest.fn(async () => true);
  const question = { list: async () => [], reply, reject };
  const registry = registryWith((r) => attachQuestionsPermissionsRoutes(r, {
    capGuard: () => false,
    capGuardQuestion: () => false,
    serveUrl: () => 'http://127.0.0.1:3000',
    currentProjectDir: () => 'C:/repo',
    projectDir: () => 'C:/repo',
    runtime: () => ({ session: { question } }) as any,
    registeredProjects: () => new Map(),
    permissionRules: () => ({ match: () => null, add: () => {}, list: () => [] }) as any,
  }));
  return { registry, reply, reject };
}

describe('questions.reply / questions.reject are human-only', () => {
  test.each(DENIED_PRINCIPALS)('reply denies a %s with the stable code', async (_label, principal) => {
    const { registry, reply, reject } = questionsSetup();
    const out = await drive(registry, 'POST', '/api/questions/q1/reply', {
      body: { answers: [['a']] },
      principal,
    });

    expect(out.status).toBe(403);
    expect(out.json).toEqual(DENIED_BODY);
    expect(reply).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  test.each(DENIED_PRINCIPALS)('reject denies a %s with the stable code', async (_label, principal) => {
    const { registry, reply, reject } = questionsSetup();
    const out = await drive(registry, 'POST', '/api/questions/q1/reject', { principal });

    expect(out.status).toBe(403);
    expect(out.json).toEqual(DENIED_BODY);
    expect(reply).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  test('admits a human principal and replies', async () => {
    const { registry, reply } = questionsSetup();
    const out = await drive(registry, 'POST', '/api/questions/q1/reply', {
      body: { answers: [['yes']] },
      principal: HUMAN,
    });

    expect(out.status).toBe(200);
    expect(out.json).toEqual({ status: 'ok' });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0][0]).toMatchObject({ requestID: 'q1', answers: [['yes']] });
  });

  test('admits a device principal and rejects', async () => {
    const { registry, reject } = questionsSetup();
    const out = await drive(registry, 'POST', '/api/questions/q1/reject', { principal: DEVICE });

    expect(out.status).toBe(200);
    expect(out.json).toEqual({ status: 'ok' });
    expect(reject).toHaveBeenCalledWith(expect.objectContaining({ requestID: 'q1' }));
  });

  test('questions.list stays an ordinary route', async () => {
    const { registry } = questionsSetup();
    const out = await drive(registry, 'GET', '/api/questions');
    expect(out.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// goals.respondQuestion (human answer / cancel)
// ---------------------------------------------------------------------------

function goalsRespondSetup() {
  const mafwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-e7-goalq-'));
  new QuestionLedger(mafwDir).appendQuestionEvent({
    type: 'asked',
    questionId: 'q1',
    goalId: 'g1',
    questions: ['Which way?'],
  });
  const handleCancel = jest.fn();
  const handleAnswer = jest.fn();
  const registry = registryWith((r) => attachGoalRoutes(r, {
    mafwDir: () => mafwDir,
    goalDriver: () => ({ handleCancel, handleAnswer }) as any,
    goalDriverMafwDirCache: () => new Map<string, string>(),
    findGoalStatePath: () => null,
    loadRequest: async () => null,
    getGatewayDb: () => ({ listNodeRuns: () => [], getGoalOutcome: () => null }) as any,
    handleValidate: async () => ({ ok: true }),
    handleComplete: async () => ({ ok: true }),
  }));
  return { registry, handleCancel, handleAnswer, mafwDir };
}

describe('goals.respondQuestion is human-only', () => {
  const URL = '/api/goals/g1/questions/q1/respond';

  test.each(DENIED_PRINCIPALS)('denies a %s with the stable code', async (_label, principal) => {
    const { registry, handleCancel, handleAnswer, mafwDir } = goalsRespondSetup();
    const out = await drive(registry, 'POST', URL, { body: { answer: 'left' }, principal });

    expect(out.status).toBe(403);
    expect(out.json).toEqual(DENIED_BODY);
    expect(handleCancel).not.toHaveBeenCalled();
    expect(handleAnswer).not.toHaveBeenCalled();
    // Ledger untouched — the question is still pending.
    expect(new QuestionLedger(mafwDir).getQuestionState('q1')).toBe('pending');
  });

  test('denied request does not consume the body (guard runs before read)', async () => {
    const { registry } = goalsRespondSetup();
    const matched = registry.match('POST' as never, URL)!;
    let drained = false;
    const req: any = mockReq('POST', { answer: 'x' });
    const originalOn = req.on.bind(req);
    req.on = (ev: string, fn: unknown) => {
      if (ev === 'data' || ev === 'end') drained = true;
      return originalOn(ev, fn);
    };
    const res = mockRes();
    await matched.def.handler!(req, res, matched.params);
    expect(res.status).toBe(403);
    expect(drained).toBe(false);
  });

  test('admits a human principal and records the answer', async () => {
    const { registry, handleAnswer } = goalsRespondSetup();
    const out = await drive(registry, 'POST', URL, { body: { answer: 'left' }, principal: HUMAN });

    expect(out.status).toBe(200);
    expect(out.json).toEqual({ status: 'accepted' });
    expect(handleAnswer).toHaveBeenCalledWith('g1', 'q1', 'left');
  });

  test('admits a device principal and cancels', async () => {
    const { registry, handleCancel } = goalsRespondSetup();
    const out = await drive(registry, 'POST', URL, { body: { type: 'cancel' }, principal: DEVICE });

    expect(out.status).toBe(200);
    expect(out.json).toEqual({ status: 'accepted', action: 'cancelled' });
    expect(handleCancel).toHaveBeenCalledWith('g1', 'q1');
  });
});
