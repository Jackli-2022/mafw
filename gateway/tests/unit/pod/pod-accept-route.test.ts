import * as http from 'http';
import { PodError } from '../../../src/core/pod/pod-store';
import { handlePods } from '../../../src/routes/pods';

const pod = {
  id: 'pod_1', projectDir: '/proj', name: 'Project', status: 'idle', configJson: '{}',
  activeGoalId: null, createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
};
const detail = { pod, members: [], goals: [], tasks: [], sessions: [] };

function mockRes() {
  const res: any = {
    status: 0,
    body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string };
}

function mockReq(method: string, body?: any): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = {
    method,
    on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); },
  };
  setImmediate(() => {
    if (body !== undefined) for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as http.IncomingMessage;
}

function makeDeps(overrides: Record<string, any> = {}) {
  const deps: any = {
    pods: {
      ensure: jest.fn(async () => detail),
      get: jest.fn(() => detail),
      updateStatus: jest.fn(),
      lookup: jest.fn(() => detail),
    },
    tasks: { list: jest.fn(() => []) },
    messages: { list: jest.fn(() => []) },
    goals: {
      list: jest.fn(() => []),
      promote: jest.fn(async () => true),
      acceptResult: jest.fn(async () => ({
        podId: 'pod_1', goalId: 'g1', revision: 1,
        branch: 'mafw/g1-r1', mergeCommit: 'abc123', mergedAt: '2026-11-09T01:00:00.000Z',
      })),
    },
    memory: { renderContext: jest.fn(), writeMemory: jest.fn(), readMemoryFile: jest.fn() },
    cost: jest.fn(async () => ({ spentUsd: 0, limitUsd: 0 })),
    transcript: jest.fn(async () => ({})),
  };
  return { ...deps, ...overrides };
}

async function call(deps: any, body: any, method = 'POST') {
  const res = mockRes();
  const handled = await handlePods(mockReq(method, body), res, '/api/pods/pod_1/goals/g1/accept', deps);
  return { handled, res, json: res.body ? JSON.parse(res.body) : null };
}

describe('POST /api/pods/:podId/goals/:goalId/accept', () => {
  it('accepts a confirmed human request and returns the merge result', async () => {
    const deps = makeDeps();
    const out = await call(deps, { revision: 1, confirm: true });
    expect(out.handled).toBe(true);
    expect(out.res.status).toBe(200);
    expect(out.json).toMatchObject({ revision: 1, branch: 'mafw/g1-r1', mergeCommit: 'abc123' });
    expect(deps.goals.acceptResult).toHaveBeenCalledWith('pod_1', 'g1', {
      revision: 1,
      force: false,
      riskAcknowledged: false,
    });
  });

  it('requires confirm:true', async () => {
    const deps = makeDeps();
    const out = await call(deps, { revision: 1 });
    expect(out.res.status).toBe(400);
    expect(deps.goals.acceptResult).not.toHaveBeenCalled();
  });

  it('rejects an agent actor instead of letting it merge', async () => {
    const deps = makeDeps();
    const out = await call(deps, { revision: 1, confirm: true, actorSessionID: 'ses_agent' });
    expect(out.res.status).toBe(403);
    expect(deps.goals.acceptResult).not.toHaveBeenCalled();
  });

  it('maps a stale revision to 409', async () => {
    const deps = makeDeps();
    deps.goals.acceptResult = jest.fn(async () => { throw new PodError(409, 'stale revision'); });
    const out = await call(deps, { revision: 1, confirm: true });
    expect(out.res.status).toBe(409);
    expect(out.json.error).toContain('stale revision');
  });

  it('maps a merge conflict to 409 without inventing a merge', async () => {
    const deps = makeDeps();
    deps.goals.acceptResult = jest.fn(async () => { throw new PodError(409, 'worktree merge conflict'); });
    const out = await call(deps, { revision: 1, confirm: true });
    expect(out.res.status).toBe(409);
    expect(out.json.error).toContain('merge conflict');
  });
});
