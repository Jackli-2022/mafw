import { Readable } from 'stream';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handlePods } from '../../../src/routes/pods';
import { GoalConflictError } from '../../../src/core/goal/goal-intake';

function makeRes() {
  const out = { status: 0, body: '' };
  const res: any = {
    writeHead: (status: number) => { out.status = status; return res; },
    end: (chunk?: any) => { out.body = chunk == null ? '' : String(chunk); },
  };
  return { res, out };
}

function makeReq(body: unknown, method = 'POST'): any {
  const req: any = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  return req;
}

function makeDeps(overrides: any = {}) {
  const calls = { create: [] as any[], enqueue: [] as any[] };
  const goalView = {
    id: 'pg1', podId: 'pod_1', goalId: 'g1', status: 'active',
    title: 'Fix Pod', phase: 'PLANNING', verdict: null as any,
    stage: { owner: 'person', kind: 'plan_approval', action: { type: 'open_plan_review', goalId: 'g1' } },
    resultReady: false, enqueuedAt: 't', startedAt: 't', endedAt: null,
  };
  const detail = {
    pod: { id: 'pod_1', projectDir: 'C:/project', status: 'active', activeGoalId: 'g1', name: 'Project' },
    members: [], sessions: [], tasks: [],
    goals: [goalView],
    attention: [{ id: 'g1:plan_approval', goalId: 'g1', kind: 'plan_approval', title: 'Fix Pod', action: goalView.stage.action }],
  };
  const deps: any = {
    pods: { get: () => detail, lookup: () => detail, ensure: async () => detail, updateStatus: () => detail },
    tasks: { list: () => [] },
    messages: { list: () => [], send: jest.fn(), markRead: jest.fn() },
    goals: {
      views: () => [goalView],
      attention: () => detail.attention,
      enqueueGoal: async (goalId: string, projectDir?: string) => {
        calls.enqueue.push({ goalId, projectDir });
        return { status: 'started', podId: 'pod_1', queueReason: null };
      },
    },
    memory: { renderContext: () => null, writeMemory: jest.fn(), readMemoryFile: jest.fn() },
    access: { requireMember: () => ({ id: 'm_lead', role: 'lead' }) },
    cost: async () => ({ spentUsd: 0, limitUsd: 0 }),
    transcript: async () => ({}),
    newGoalId: () => 'goal-generated',
    intake: {
      create: (input: any) => {
        calls.create.push(input);
        return { goalId: input.goalId, charterPath: '/c.md', requestPath: '/r.json', projectDir: input.projectDir };
      },
    },
    ...overrides,
  };
  return { deps, calls, detail, goalView };
}

async function send(deps: any, url: string, body: unknown = {}, method = 'GET') {
  const { res, out } = makeRes();
  await handlePods(makeReq(body, method), res, url, deps);
  return out;
}

describe('Pod Goal create and detail views', () => {
  test('POST /api/pods/:podId/goals returns started and queueReason', async () => {
    const { deps, calls } = makeDeps();
    const out = await send(deps, '/api/pods/pod_1/goals', {
      title: 'Fix Pod', objective: 'Truthful status', acceptance: ['tests pass'],
    }, 'POST');
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toMatchObject({
      goalId: 'goal-generated',
      status: 'started',
      queueReason: null,
      goal: { title: 'Fix Pod' },
    });
    expect(calls.create[0]).toMatchObject({
      goalId: 'goal-generated',
      projectDir: 'C:/project',
      authorization: { source: 'desktop', requestMode: 'explicit' },
      autoStart: false,
    });
    expect(calls.enqueue).toEqual([{ goalId: 'goal-generated', projectDir: 'C:/project' }]);
  });

  test('a duplicate goal is a 409, not a 500', async () => {
    const { deps, calls } = makeDeps({
      intake: {
        create: () => { throw new GoalConflictError('goal-generated'); },
      },
    });
    const out = await send(deps, '/api/pods/pod_1/goals', { title: 'Dup', objective: 'x' }, 'POST');
    expect(out.status).toBe(409);
    expect(calls.enqueue).toHaveLength(0);
  });

  test('a failed enqueue removes the intake files it just created', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-goal-orphan-'));
    const charterPath = path.join(dir, 'goal.md');
    const requestPath = path.join(dir, 'goal.json');
    fs.writeFileSync(charterPath, 'charter');
    fs.writeFileSync(requestPath, '{}');
    const { deps } = makeDeps({
      intake: {
        create: (input: any) => ({ goalId: input.goalId, charterPath, requestPath, projectDir: input.projectDir }),
      },
      goals: {
        views: () => [],
        attention: () => [],
        enqueueGoal: async () => { throw new Error('queue offline'); },
      },
    });
    const out = await send(deps, '/api/pods/pod_1/goals', { title: 'Orphan', objective: 'x' }, 'POST');
    expect(out.status).toBe(500);
    expect(fs.existsSync(charterPath)).toBe(false);
    expect(fs.existsSync(requestPath)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('GET detail exposes goal views and attention precisely once', async () => {
    const { deps } = makeDeps();
    const out = await send(deps, '/api/pods/pod_1');
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).goals[0]).toMatchObject({
      title: 'Fix Pod', stage: { owner: 'person', kind: 'plan_approval' },
    });
    expect(JSON.parse(out.body).attention).toHaveLength(1);
  });

  test('POST requires objective or charter and uses Lead when an actor is supplied', async () => {
    const { deps, calls } = makeDeps();
    const bad = await send(deps, '/api/pods/pod_1/goals', { title: 'No body' }, 'POST');
    expect(bad.status).toBe(400);
    expect(calls.create).toHaveLength(0);

    await send(deps, '/api/pods/pod_1/goals', {
      title: 'With actor', objective: 'x', actorSessionID: 'ses_lead',
    }, 'POST');
    expect(calls.create[0].authorization.source).toBe('desktop');
  });
});
