import * as http from 'http';
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

function mockReq(method: string): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = { method, on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); } };
  setImmediate(() => { for (const fn of listeners['end'] ?? []) fn(); });
  return req as http.IncomingMessage;
}

function makeDeps(overrides: Record<string, any> = {}) {
  const deps: any = {
    pods: { get: jest.fn(() => detail), ensure: jest.fn(async () => detail), lookup: jest.fn(() => detail) },
    tasks: { list: jest.fn(() => []) },
    messages: { list: jest.fn(() => []) },
    goals: {
      list: jest.fn(() => []),
      worktreeDiff: jest.fn(async () => ({
        goalId: 'g1',
        revision: 1,
        branch: 'mafw/g1-r1',
        baseRef: 'main',
        files: [{ file: 'feature.txt', patch: '@@ -0,0 +1 @@\n+feature', additions: 1, deletions: 0, status: 'A' }],
      })),
    },
    memory: { renderContext: jest.fn(), writeMemory: jest.fn(), readMemoryFile: jest.fn() },
    cost: jest.fn(async () => ({ spentUsd: 0, limitUsd: 0 })),
    transcript: jest.fn(async () => ({})),
  };
  return { ...deps, ...overrides };
}

async function call(deps: any, path: string) {
  const res = mockRes();
  const handled = await handlePods(mockReq('GET'), res, path, deps);
  return { handled, res, json: res.body ? JSON.parse(res.body) : null };
}

describe('GET /api/pods/:podId/goals/:goalId/worktree/diff', () => {
  it('returns per-file patches for the active revision', async () => {
    const deps = makeDeps();
    const out = await call(deps, '/api/pods/pod_1/goals/g1/worktree/diff?revision=1');
    expect(out.handled).toBe(true);
    expect(out.res.status).toBe(200);
    expect(out.json).toMatchObject({
      branch: 'mafw/g1-r1',
      baseRef: 'main',
      files: [{ file: 'feature.txt', additions: 1, status: 'A' }],
    });
    expect(deps.goals.worktreeDiff).toHaveBeenCalledWith('pod_1', 'g1', { revision: 1 });
  });

  it('defaults to the active revision', async () => {
    const deps = makeDeps();
    const out = await call(deps, '/api/pods/pod_1/goals/g1/worktree/diff');
    expect(out.res.status).toBe(200);
    expect(deps.goals.worktreeDiff).toHaveBeenCalledWith('pod_1', 'g1', {});
  });

  it('rejects a malformed revision', async () => {
    const deps = makeDeps();
    const out = await call(deps, '/api/pods/pod_1/goals/g1/worktree/diff?revision=nope');
    expect(out.res.status).toBe(400);
    expect(deps.goals.worktreeDiff).not.toHaveBeenCalled();
  });

  it('is unavailable when the gateway cannot read worktree diffs', async () => {
    const deps = makeDeps({ goals: { list: jest.fn(() => []) } });
    const out = await call(deps, '/api/pods/pod_1/goals/g1/worktree/diff');
    expect(out.res.status).toBe(503);
  });
});
