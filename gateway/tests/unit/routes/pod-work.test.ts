import * as http from 'http';
import { attachPodHandlers } from '../../../src/routes/pod-handlers';
import { handlePodWork } from '../../../src/routes/pod-work';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import type { PodGoalView } from '../../../src/core/pod/pod-view';

function mockRes() {
  const res: any = {
    status: 0,
    body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string };
}

function goal(index: number, bucket: PodGoalView['bucket']): PodGoalView {
  return {
    id: `pg-${index}`,
    podId: 'pod_1',
    goalId: `g-${index}`,
    status: bucket === 'queued' ? 'queued' : bucket === 'ended' ? 'done' : 'active',
    title: `Goal ${index}`,
    phase: null,
    verdict: null,
    stage: { owner: 'team', kind: bucket === 'needs_you' ? 'plan_approval' : 'working' },
    bucket,
    resultReady: bucket === 'result_ready',
    sourceRef: null,
    strategy: null,
    assessment: null,
    currentAssignment: null,
    activeRevision: 1,
    revision: 1,
    priority: 0,
    enqueuedAt: '2026-11-03T00:00:00.000Z',
    startedAt: null,
    endedAt: null,
  };
}

function makeDeps(goals: PodGoalView[], found = true) {
  const detail = {
    pod: { id: 'pod_1', projectDir: '/project', name: 'Project' },
    members: [],
    goals,
    tasks: [],
    sessions: [],
  };
  return {
    pods: { lookup: jest.fn(() => found ? detail as any : null) },
    goals: { views: jest.fn(() => goals) },
  } as any;
}

async function call(url: string, deps: any) {
  const res = mockRes();
  const handled = await handlePodWork({ method: 'GET' } as any, res, url, deps);
  return { handled, res, json: res.body ? JSON.parse(res.body) : null };
}

describe('GET /api/projects/:projectId/work', () => {
  test('groups every Goal and derives counts from the same arrays', async () => {
    const goals = [
      goal(1, 'needs_you'),
      goal(2, 'queued'),
      goal(3, 'in_progress'),
      goal(4, 'result_ready'),
      goal(5, 'ended'),
    ];
    const deps = makeDeps(goals);
    const out = await call('/api/projects/project-1/work', deps);

    expect(out.handled).toBe(true);
    expect(out.res.status).toBe(200);
    expect(out.json.total).toBe(5);
    for (const bucket of ['needs_you', 'queued', 'in_progress', 'result_ready', 'ended']) {
      expect(out.json.counts[bucket]).toBe(out.json.groups[bucket].length);
    }
    expect(out.json.groups.needs_you[0].goalId).toBe('g-1');
    expect(deps.pods.lookup).toHaveBeenCalledWith('project-1');
  });

  test('returns 200 of Goals without truncation', async () => {
    const goals = Array.from({ length: 200 }, (_, index) => goal(index, 'ended'));
    const out = await call('/api/projects/project-1/work', makeDeps(goals));
    expect(out.json.total).toBe(200);
    expect(out.json.groups.ended).toHaveLength(200);
  });

  test('returns 404 without ensuring a missing Pod', async () => {
    const deps = makeDeps([], false);
    const out = await call('/api/projects/missing/work', deps);
    expect(out.handled).toBe(true);
    expect(out.res.status).toBe(404);
    expect(deps.pods.lookup).toHaveBeenCalledWith('missing');
    expect(deps.pods.ensure).toBeUndefined();
  });

  test('registers the catalog handler', () => {
    const ids: string[] = [];
    const registry = { attachHandler: (id: string) => { ids.push(id); } } as any;
    const deps = makeDeps([]);
    attachPodHandlers(registry, deps);
    expect(buildRouteCatalog().some((route) => route.operationId === 'work.overview')).toBe(true);
    expect(ids).toContain('work.overview');
  });
});
