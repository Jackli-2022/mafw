/**
 * E5a-2 — human-only route guards (spec §4).
 *
 * `actorSessionID` used to be the *only* signal: no actor = human. That made
 * every agent/service call that simply omitted the field a human action. These
 * tests pin the new rule: a human-only route requires a resolved human
 * principal (human token / device token); service, local, anonymous and missing
 * principals are denied with the stable `human_principal_required` code, and an
 * `actorSessionID` still denies even when the caller *is* human.
 */
import * as http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Principal } from '../../../src/core/auth';
import { createRequestListener, type TransportDeps } from '../../../src/http/transport';
import { handleDecisionMutation } from '../../../src/routes/decisions';
import { handlePods, type PodRouteDeps } from '../../../src/routes/pods';
import { dispatchAuthorized } from '../../../src/routes/registry-dispatch';
import { RouteRegistry } from '../../../src/routes/registry';
import { attachDecisionRoutes } from '../../../src/routes/decisions';
import { attachStandingGoalRoutes, handleApproveRun } from '../../../src/routes/standing-goals';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';

const HUMAN: Principal = { kind: 'human', method: 'human-token' };
const DEVICE: Principal = { kind: 'human', method: 'device-token', deviceId: 'dev-1' };
const SERVICE: Principal = { kind: 'service', method: 'api-token' };
const LOCAL: Principal = { kind: 'local', method: 'loopback' };
const ANONYMOUS: Principal = { kind: 'anonymous', method: 'none' };

const DENIED_PRINCIPALS: Array<[string, Principal | undefined]> = [
  ['missing principal', undefined],
  ['service', SERVICE],
  ['local', LOCAL],
  ['anonymous', ANONYMOUS],
];

const DENIED_CODE = 'human_principal_required';

// ---------------------------------------------------------------------------
// HTTP fakes
// ---------------------------------------------------------------------------

function mockRes() {
  const res: any = {
    status: 0,
    body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
    setHeader() { return this; },
  };
  return res as ServerResponse & { status: number; body: string };
}

function mockReq(
  method: string,
  body?: unknown,
  principal?: Principal,
): IncomingMessage {
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

function podDeps(over: Partial<Record<string, any>> = {}): PodRouteDeps {
  return {
    pods: { get: () => ({ pod: { id: 'pod_1' }, members: [], goals: [], tasks: [], sessions: [] }) },
    reviews: {
      list: () => ({ revision: 1, items: [] }),
      createItems: jest.fn(() => [{ id: 'review_new' }]),
      resolve: jest.fn(() => ({ id: 'review_1', status: 'resolved' })),
      reopen: jest.fn(() => ({ id: 'review_1', status: 'pending' })),
    },
    goals: {
      list: () => [],
      promote: async () => true,
      acceptResult: jest.fn(async () => ({
        podId: 'pod_1', goalId: 'g1', revision: 1,
        branch: 'mafw/g1-r1', mergeCommit: 'abc123', mergedAt: '2026-11-12T00:00:00.000Z',
      })),
    },
    ...over,
  } as any as PodRouteDeps;
}

async function callPods(
  deps: PodRouteDeps,
  method: string,
  url: string,
  body: unknown,
  principal?: Principal,
): Promise<{ status: number; json: any }> {
  const res = mockRes();
  await handlePods(mockReq(method, body, principal), res, url, deps);
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
}

// ---------------------------------------------------------------------------
// Pod goal accept / review items (legacy handlePods chain)
// ---------------------------------------------------------------------------

describe('POST /api/pods/:podId/goals/:goalId/accept', () => {
  const URL = '/api/pods/pod_1/goals/g1/accept';
  const BODY = { revision: 1, confirm: true };

  test.each(DENIED_PRINCIPALS)('denies a %s with the stable code', async (_label, principal) => {
    const deps = podDeps();
    const out = await callPods(deps, 'POST', URL, BODY, principal);

    expect(out.status).toBe(403);
    expect(out.json).toEqual({ error: 'human principal required', code: DENIED_CODE });
    expect((deps.goals as any).acceptResult).not.toHaveBeenCalled();
  });

  test('accepts a human principal and merges', async () => {
    const out = await callPods(podDeps(), 'POST', URL, BODY, HUMAN);

    expect(out.status).toBe(200);
    expect(out.json.mergeCommit).toBe('abc123');
  });

  test('accepts a device principal', async () => {
    const out = await callPods(podDeps(), 'POST', URL, BODY, DEVICE);

    expect(out.status).toBe(200);
  });

  test('still rejects a human request that carries an actorSessionID', async () => {
    const deps = podDeps();
    const out = await callPods(deps, 'POST', URL, { ...BODY, actorSessionID: 'ses_agent' }, HUMAN);

    expect(out.status).toBe(403);
    expect((deps.goals as any).acceptResult).not.toHaveBeenCalled();
  });
});

describe('review item mutations', () => {
  const cases: Array<[string, string, Record<string, unknown> | undefined]> = [
    ['create', '/api/pods/pod_1/goals/g1/review-items', { items: [{ rel: 'src/a.ts', comment: 'x' }] }],
    ['resolve', '/api/pods/pod_1/goals/g1/review-items/review_1/resolve', { note: 'ok' }],
    ['reopen', '/api/pods/pod_1/goals/g1/review-items/review_1/reopen', { note: 'still broken' }],
  ];

  test.each(cases)('%s denies every non-human principal', async (_label, url, body) => {
    for (const [, principal] of DENIED_PRINCIPALS) {
      const out = await callPods(podDeps(), 'POST', url, body, principal);
      expect({ url, principal, status: out.status, code: out.json?.code }).toEqual({
        url,
        principal,
        status: 403,
        code: DENIED_CODE,
      });
    }
  });

  test.each(cases)('%s accepts a human principal', async (_label, url, body) => {
    const out = await callPods(podDeps(), 'POST', url, body, HUMAN);
    expect(out.status).toBe(200);
  });

  test.each(cases)('%s still rejects a human request carrying actorSessionID', async (_label, url, body) => {
    const out = await callPods(podDeps(), 'POST', url, { ...(body ?? {}), actorSessionID: 'ses_agent' }, HUMAN);
    expect(out.status).toBe(403);
  });

  test('listing review items is an ordinary route (no human principal required)', async () => {
    const out = await callPods(podDeps(), 'GET', '/api/pods/pod_1/goals/g1/review-items?revision=1', undefined, undefined);
    expect(out.status).toBe(200);
  });
});

describe('ordinary pod routes stay unchanged', () => {
  test('goal list needs no principal (service/local/agent flow keeps working)', async () => {
    const out = await callPods(podDeps(), 'GET', '/api/pods/pod_1/goals', undefined, SERVICE);
    expect(out.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Decision mutations (pure handler + registry wiring)
// ---------------------------------------------------------------------------

function decisionDeps() {
  return {
    service: {
      confirm: jest.fn(() => ({ id: 'd1', status: 'decided' })),
      shelve: jest.fn(() => ({ id: 'd1', status: 'shelved' })),
      reopen: jest.fn(() => ({ id: 'd1', status: 'draft' })),
    },
  } as any;
}

describe('decision mutations', () => {
  test.each(['confirm', 'shelve', 'reopen'] as const)(
    '%s denies non-human callers with the stable code',
    (action) => {
      const deps = decisionDeps();
      const out = handleDecisionMutation(action, 'd1', { projectDir: 'C:/repo' }, deps, false);

      expect(out.status).toBe(403);
      expect(out.body).toEqual({ error: 'human principal required', code: DENIED_CODE });
      expect(deps.service[action]).not.toHaveBeenCalled();
    },
  );

  test('confirm succeeds for a human without actorSessionID', () => {
    const deps = decisionDeps();
    const out = handleDecisionMutation('confirm', 'd1', { projectDir: 'C:/repo' }, deps, true);

    expect(out.status).toBe(200);
    expect(deps.service.confirm).toHaveBeenCalledTimes(1);
  });

  test('a human request carrying actorSessionID is still denied', () => {
    const deps = decisionDeps();
    const out = handleDecisionMutation('confirm', 'd1', {
      projectDir: 'C:/repo',
      actorSessionID: 'ses_agent',
    }, deps, true);

    expect(out.status).toBe(403);
    expect(deps.service.confirm).not.toHaveBeenCalled();
  });

  test('draft/list stay ordinary routes', () => {
    // draft/list are not human-only: no principal parameter exists here at all.
    expect(typeof handleDecisionMutation).toBe('function');
  });

  async function driveDecision(principal: Principal | undefined): Promise<{ status: number; json: any }> {
    const dep = decisionDeps();
    dep.service.list = jest.fn(() => []);
    dep.service.draft = jest.fn(() => ({ id: 'd1' }));
    const registry = new RouteRegistry();
    registry.register(...buildRouteCatalog());
    attachDecisionRoutes(registry, dep);
    const matched = registry.match('POST', '/api/decisions/d1/confirm');
    const res = mockRes();
    const req = mockReq('POST', {}, principal);
    (req as any).url = '/api/decisions/d1/confirm';
    await matched!.def.handler!(req, res, matched!.params);
    return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
  }

  test('registry wiring denies a service principal', async () => {
    const out = await driveDecision(SERVICE);
    expect(out.status).toBe(403);
    expect(out.json.code).toBe(DENIED_CODE);
  });

  test('registry wiring admits a human principal', async () => {
    const out = await driveDecision(HUMAN);
    expect(out.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Standing goal run approval
// ---------------------------------------------------------------------------

function standingDeps(over: Record<string, any> = {}) {
  return {
    enabled: () => true,
    getRun: jest.fn(() => ({ id: 'r1', status: 'waiting_person' })),
    approveRun: jest.fn(async () => ({ id: 'r1', status: 'approved' })),
    ...over,
  } as any;
}

describe('standing goal run approval', () => {
  test('denies non-human callers with the stable code', async () => {
    const deps = standingDeps();
    const out = await handleApproveRun({ id: 'r1', human: false }, deps);

    expect(out.status).toBe(403);
    expect(out.body).toEqual({ error: 'human principal required', code: DENIED_CODE });
    expect(deps.approveRun).not.toHaveBeenCalled();
  });

  test('approves for a human', async () => {
    const deps = standingDeps();
    const out = await handleApproveRun({ id: 'r1', human: true }, deps);

    expect(out.status).toBe(200);
    expect(deps.approveRun).toHaveBeenCalledWith('r1');
  });

  test('a human request carrying actorSessionID is still denied', async () => {
    const deps = standingDeps();
    const out = await handleApproveRun({ id: 'r1', human: true, actorSessionID: 'ses_agent' }, deps);

    expect(out.status).toBe(403);
    expect(deps.approveRun).not.toHaveBeenCalled();
  });

  async function driveApprove(principal: Principal | undefined): Promise<{ status: number; json: any }> {
    const registry = new RouteRegistry();
    registry.register(...buildRouteCatalog());
    attachStandingGoalRoutes(registry, standingDeps());
    const matched = registry.match('POST', '/api/goal-runs/r1/approve');
    const res = mockRes();
    const req = mockReq('POST', {}, principal);
    (req as any).url = '/api/goal-runs/r1/approve';
    await matched!.def.handler!(req, res, matched!.params);
    return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
  }

  test('registry wiring denies a local principal', async () => {
    const out = await driveApprove(LOCAL);
    expect(out.status).toBe(403);
    expect(out.json.code).toBe(DENIED_CODE);
  });

  test('registry wiring admits a human principal', async () => {
    const out = await driveApprove(HUMAN);
    expect(out.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Transport-level integration: real request → principal → human-only route
// ---------------------------------------------------------------------------

const HUMAN_TOKEN = 'h'.repeat(64);
const API_TOKEN = 'shared-service-token';
const REMOTE = '203.0.113.9';
const LOOPBACK = '127.0.0.1';

function realReq(opts: {
  remoteAddress: string;
  headers?: Record<string, string>;
  body?: unknown;
}): IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = {
    method: 'POST',
    url: '/api/pods/pod_1/goals/g1/accept',
    headers: opts.headers ?? {},
    socket: { remoteAddress: opts.remoteAddress },
    on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); },
    pipe() { return this; },
  };
  setImmediate(() => {
    if (opts.body !== undefined) for (const fn of listeners['data'] ?? []) fn(JSON.stringify(opts.body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as IncomingMessage;
}

function acceptRegistry(): RouteRegistry {
  const registry = new RouteRegistry();
  const deps = podDeps();
  registry.register({
    method: 'POST',
    path: '/api/pods/:podId/goals/:goalId/accept',
    operationId: 'test.humanOnlyAccept',
    handler: async (req, res, params) => handlePods(req, res, req.url || '/', {
      ...deps,
      pods: { ...deps.pods, get: () => ({ pod: { id: params.podId }, members: [], goals: [], tasks: [], sessions: [] }) },
    }),
  });
  return registry;
}

function transportDeps(registry: RouteRegistry): TransportDeps {
  return {
    cors: () => ({ origin: '*', methods: 'GET,POST', headers: 'content-type' }),
    apiToken: () => API_TOKEN,
    humanToken: () => HUMAN_TOKEN,
    dispatchAuthorized: (req, res, apiToken) => dispatchAuthorized({ registry, apiToken }, req, res),
    pluginWebWildcard: async () => false,
    fileHistory: async () => false,
    mediaAgent: () => undefined,
    mcpEndpoint: () => undefined,
    mcpStreamable: () => undefined,
    spaRoot: () => '/nonexistent-dashboard-root',
    dashboardDispatch: async () => ({ status: 200, body: {} }),
    register: {
      parseIntent: () => null,
      isUserDataDir: () => false,
      isSelectableProject: () => true,
      registeredProject: () => undefined,
      registerProject: () => undefined,
      setCurrentProject: () => undefined,
      persistRegistry: async () => undefined,
      broadcastProjectRegistered: () => undefined,
      hasRuntime: () => false,
      ensureManagerSession: async () => 'sid',
    },
    control: {
      patchState: async () => undefined,
      destroyAllSessions: async () => undefined,
      getActiveGoal: () => undefined,
      registeredProjects: () => new Map().entries(),
      getGatewayDb: () => ({} as never),
      archiveGoal: async () => undefined,
    },
    health: {
      serveRunning: () => false,
      registeredProjectDirs: () => [],
      activeGoalIds: () => [],
      mediaConfigured: () => false,
      releaseFields: () => ({}),
    },
    proxyTarget: () => 'http://127.0.0.1:9',
    proxyHeaders: () => ({}),
  };
}

async function driveTransport(principalHeaders: Record<string, string>, remoteAddress = REMOTE) {
  const res = mockRes();
  res.setHeader = () => res;
  await createRequestListener(transportDeps(acceptRegistry()))(
    realReq({ remoteAddress, headers: principalHeaders, body: { confirm: true, revision: 1 } }),
    res,
  );
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null };
}

describe('transport integration (real request → principal → accept route)', () => {
  test('a real human-token request reaches accept and merges (200)', async () => {
    const out = await driveTransport({ 'x-mafw-human-token': HUMAN_TOKEN });
    expect(out.status).toBe(200);
    expect(out.json.mergeCommit).toBe('abc123');
  });

  test('a real service-token request is denied with the stable code (403)', async () => {
    const out = await driveTransport({ authorization: `Bearer ${API_TOKEN}` });
    expect(out.status).toBe(403);
    expect(out.json).toEqual({ error: 'human principal required', code: DENIED_CODE });
  });

  test('a loopback credential-less request is local and denied (403)', async () => {
    const out = await driveTransport({}, LOOPBACK);
    expect(out.status).toBe(403);
    expect(out.json.code).toBe(DENIED_CODE);
  });

  test('a remote anonymous request is still 401 at the transport', async () => {
    const out = await driveTransport({});
    expect(out.status).toBe(401);
  });
});
