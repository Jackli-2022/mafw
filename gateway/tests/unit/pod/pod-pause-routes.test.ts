import { Readable } from 'stream';
import { handlePods } from '../../../src/routes/pods';

function makeRes() {
  const out = { status: 0, body: '' };
  const res: any = {
    writeHead: (status: number) => { out.status = status; return res; },
    end: (chunk?: any) => { out.body = chunk == null ? '' : String(chunk); },
  };
  return { res, out };
}
function makeReq(body: unknown, method: string): any {
  const req: any = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  return req;
}

function makeDeps() {
  const calls: any[] = [];
  const detail = {
    pod: { id: 'pod_1', status: 'paused', projectDir: 'C:/p', activeGoalId: 'g1', name: 'P' },
    members: [], sessions: [], tasks: [], goals: [], attention: [],
  };
  const deps: any = {
    pods: {
      get: () => detail,
      updateStatus: () => { calls.push(['updateStatus']); return detail; },
      lookup: () => detail, ensure: async () => detail,
    },
    goals: {
      list: () => [], promote: async () => false,
      views: () => [], attention: () => [],
      resume: async () => { calls.push(['resume']); return true; },
      cancelQueued: (_podId: string, goalId: string) => {
        calls.push(['cancel', goalId]);
        return { id: 'pg2', podId: 'pod_1', goalId, status: 'aborted', verdict: 'CANCELLED' };
      },
    },
    tasks: { list: () => [] },
    messages: { list: () => [] },
    memory: {},
    cost: async () => ({}), transcript: async () => ({}),
  };
  return { deps, calls };
}

async function call(deps: any, url: string, body: unknown, method: string) {
  const { res, out } = makeRes();
  await handlePods(makeReq(body, method), res, url, deps);
  return out;
}

describe('pod pause/cancel routes', () => {
  test('PATCH active resumes through the goal service', async () => {
    const { deps, calls } = makeDeps();
    const out = await call(deps, '/api/pods/pod_1', { status: 'active' }, 'PATCH');
    expect(out.status).toBe(200);
    expect(calls).toEqual([['resume']]);
  });

  test('PATCH paused persists pause status', async () => {
    const { deps, calls } = makeDeps();
    await call(deps, '/api/pods/pod_1', { status: 'paused' }, 'PATCH');
    expect(calls).toEqual([['updateStatus']]);
  });

  test('DELETE queued goal cancels without starting it', async () => {
    const { deps, calls } = makeDeps();
    const out = await call(deps, '/api/pods/pod_1/goals/g2', {}, 'DELETE');
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).goal).toMatchObject({ goalId: 'g2', status: 'aborted', verdict: 'CANCELLED' });
    expect(calls).toEqual([['cancel', 'g2']]);
  });
});
