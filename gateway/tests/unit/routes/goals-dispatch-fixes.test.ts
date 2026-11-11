/**
 * E1-4 goals.get 单对象 + goals.control 可达（spec §E1-4，rulings R5/R6）。
 *
 * 两个缺陷：
 *  1. `GET /api/goals/:id` 没有 handler → 落进 dashboard `/api/goals` 前缀兜底，
 *     返回**列表**（SDK `goals.get()` 拿到 `{goals:[...]}`）。
 *  2. `POST /api/goals/control` 同样没有 handler → 被同一兜底吞掉，transport 的
 *     `/control` 分支永远看不到它（R6 的"死臂"）。
 *
 * 本测试驱动**真实组合**：catalog registry + 新 attach 函数 + 真实
 * createRequestListener（auth → registry dispatch → dashboard 兜底），只把
 * dashboardDispatch / goal state / control deps 换成记录器。
 *
 * R5 残留保持：`/api/goals/:id/loops` 仍回落 dashboard 兜底并保持现状形状。
 */
import * as http from 'http';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { createRequestListener, type TransportDeps } from '../../../src/http/transport';
import { dispatchAuthorized } from '../../../src/routes/registry-dispatch';
import { attachGoalGetRoute } from '../../../src/routes/goal-get';
import { attachGoalControlCommandRoute } from '../../../src/routes/goal-control';

const GOAL_ID = 'goal-1';
const GOAL_STATE = {
  goalId: GOAL_ID,
  phase: 'EXECUTE',
  loop: 2,
  currentWave: 1,
  totalWaves: 3,
  nextAction: 'WAIT_PHASE_COMPLETE',
  lastError: null,
  updatedAt: '2026-11-11T00:00:00.000Z',
};

function makeRegistry() {
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  // 收录真实 state（fake FS 探测 + fake 解析），与 goals-inline 的查找口径一致。
  attachGoalGetRoute(registry, {
    findGoalStatePath: (goalId) => (goalId === GOAL_ID
      ? { statePath: path.resolve('fake-state', `${goalId}.json`), info: { mafwDir: path.resolve('fake-mafw') } }
      : null),
    goalDriverMafwDirCache: () => new Map<string, string>(),
    loadGoalState: (_mafwDir, goalId) => (goalId === GOAL_ID ? { ...GOAL_STATE } : null),
    activeGoals: () => new Map<string, any>(),
  });
  const control = {
    patchState: jest.fn(async () => {}),
    destroyAllSessions: jest.fn(async () => {}),
    getActiveGoal: jest.fn(() => ({ loop: 2 })),
    registeredProjects: jest.fn(() => [] as Array<[string, { mafwDir: string }]>),
    getGatewayDb: jest.fn(() => ({}) as any),
    archiveGoal: jest.fn(async () => {}),
  };
  attachGoalControlCommandRoute(registry, control);
  return { registry, control };
}

function makeListener(registry: RouteRegistry, dashboard: jest.Mock, control: Record<string, jest.Mock>) {
  const deps: TransportDeps = {
    cors: () => ({ origin: '*', methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS', headers: 'Content-Type' }),
    apiToken: () => '',
    dispatchAuthorized: (req, res) => dispatchAuthorized({ registry, apiToken: '' }, req, res),
    pluginWebWildcard: async () => false,
    fileHistory: async () => false,
    mediaAgent: () => undefined,
    mcpEndpoint: () => undefined,
    mcpStreamable: () => undefined,
    spaRoot: () => '/nonexistent-dashboard-root',
    dashboardDispatch: dashboard,
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
    control: control as unknown as TransportDeps['control'],
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
  return createRequestListener(deps);
}

function request(
  listener: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  opts: { method: string; path: string; body?: unknown },
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => { void listener(req, res); });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const raw = opts.body === undefined ? '' : JSON.stringify(opts.body);
      const req = http.request({
        hostname: '127.0.0.1',
        port: addr.port,
        path: opts.path,
        method: opts.method,
        headers: raw ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } : {},
      }, (res) => {
        let chunks = '';
        res.on('data', (c) => chunks += c);
        res.on('end', () => {
          server.close();
          let body: any = chunks;
          try { body = JSON.parse(chunks); } catch { /* keep text */ }
          resolve({ status: res.statusCode ?? 0, body });
        });
      });
      req.on('error', (err) => { server.close(); reject(err); });
      if (raw) req.write(raw);
      req.end();
    });
  });
}

function dashboardRecorder() {
  return jest.fn(async (req: IncomingMessage) => ({
    status: 200,
    body: { goals: [{ goalId: 'list-only', phase: 'PLANNING', loop: 0, path: req.url }] },
  }));
}

describe('GET /api/goals/:id（E1-4 a：单对象）', () => {
  it('已知 goal → 单对象（goalId/phase/loop/…），不是列表', async () => {
    const { registry, control } = makeRegistry();
    const dashboard = dashboardRecorder();
    const res = await request(makeListener(registry, dashboard, control), { method: 'GET', path: `/api/goals/${GOAL_ID}` });

    expect(res.status).toBe(200);
    expect(res.body.goalId).toBe(GOAL_ID);
    expect(res.body.phase).toBe('EXECUTE');
    expect(res.body.loop).toBe(2);
    expect(res.body.nextAction).toBe('WAIT_PHASE_COMPLETE');
    expect(res.body.updatedAt).toBe(GOAL_STATE.updatedAt);
    expect(res.body.goals).toBeUndefined();
    expect(dashboard).not.toHaveBeenCalled();
  });

  it('未知 goal → 404（不再回落列表）', async () => {
    const { registry, control } = makeRegistry();
    const dashboard = dashboardRecorder();
    const res = await request(makeListener(registry, dashboard, control), { method: 'GET', path: '/api/goals/nope' });

    expect(res.status).toBe(404);
    expect(String(res.body?.error)).toMatch(/not found/i);
    expect(dashboard).not.toHaveBeenCalled();
  });
});

describe('POST /api/goals/control（E1-4 b）', () => {
  it('PAUSE 到达 control handler 并返回其结果（不是 goals 列表）', async () => {
    const { registry, control } = makeRegistry();
    const dashboard = dashboardRecorder();
    const res = await request(makeListener(registry, dashboard, control), {
      method: 'POST',
      path: '/api/goals/control',
      body: { action: 'PAUSE', goalId: GOAL_ID },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.body.goals).toBeUndefined();
    expect(control.patchState).toHaveBeenCalledWith(GOAL_ID, { nextAction: 'PAUSED' });
    expect(dashboard).not.toHaveBeenCalled();
  });

  it('ABORT 走同一语义（destroys sessions + patch + archive）', async () => {
    const { registry, control } = makeRegistry();
    const dashboard = dashboardRecorder();
    const res = await request(makeListener(registry, dashboard, control), {
      method: 'POST',
      path: '/api/goals/control',
      body: { action: 'ABORT', goalId: GOAL_ID },
    });

    expect(res.status).toBe(200);
    expect(control.destroyAllSessions).toHaveBeenCalledWith(GOAL_ID);
    expect(control.patchState).toHaveBeenCalledWith(GOAL_ID, { nextAction: 'FAILED', planApproval: null });
    expect(control.archiveGoal).toHaveBeenCalledWith(GOAL_ID, expect.objectContaining({ verdict: 'CANCELLED' }));
    expect(dashboard).not.toHaveBeenCalled();
  });
});

describe('POST /control 旧路径（E1-4 c：回归锚）', () => {
  it('legacy /control 仍到达同一 control handler', async () => {
    const { registry, control } = makeRegistry();
    const dashboard = dashboardRecorder();
    const res = await request(makeListener(registry, dashboard, control), {
      method: 'POST',
      path: '/control',
      body: { action: 'PAUSE', goalId: GOAL_ID },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(control.patchState).toHaveBeenCalledWith(GOAL_ID, { nextAction: 'PAUSED' });
    expect(dashboard).not.toHaveBeenCalled();
  });
});

describe('GET /api/goals/:id/loops（E1-4 d：R5 残留兜底不变）', () => {
  it('仍未实现 → dashboard 兜底，保持列表形状', async () => {
    const { registry, control } = makeRegistry();
    const dashboard = dashboardRecorder();
    const res = await request(makeListener(registry, dashboard, control), {
      method: 'GET',
      path: `/api/goals/${GOAL_ID}/loops`,
    });

    expect(res.status).toBe(200);
    expect(dashboard).toHaveBeenCalledTimes(1);
    expect(Array.isArray(res.body.goals)).toBe(true);
    expect(res.body.goals[0].goalId).toBe('list-only');
    expect(res.body.goals[0].path).toBe(`/api/goals/${GOAL_ID}/loops`);
  });
});
