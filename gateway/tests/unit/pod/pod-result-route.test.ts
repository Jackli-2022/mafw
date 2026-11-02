import { PodError } from '../../../src/core/pod/pod-store';
import { handlePods } from '../../../src/routes/pods';

function makeRes() {
  const out = { status: 0, body: '' };
  const res: any = {
    writeHead: (status: number) => { out.status = status; return res; },
    end: (chunk?: any) => { out.body = chunk == null ? '' : String(chunk); },
  };
  return { res, out };
}

function deps() {
  const detail = {
    pod: { id: 'pod_1', projectDir: 'C:/p', status: 'active', name: 'P' },
    members: [], sessions: [], tasks: [], goals: [], attention: [],
  };
  return {
    pods: { get: () => detail, lookup: () => detail, ensure: async () => detail, updateStatus: () => detail },
    goals: {
      list: () => [], promote: async () => false,
      views: () => [], attention: () => [],
      result: (_podId: string, goalId: string) => {
        if (goalId !== 'g1') throw new PodError(404, 'not found');
        return {
          goalId, verdict: 'FAIL', resultReady: true, goalAcceptance: ['ok'],
          tasks: [{ taskId: 'w1-t1', result: 'fail', evidence: 'test failed' }],
          reviewFeedback: 'fix', receipt: null, artifacts: [],
        };
      },
    },
    tasks: { list: () => [] },
    messages: { list: () => [] },
    memory: {},
    cost: async () => ({}), transcript: async () => ({}),
  } as any;
}

async function get(url: string) {
  const { res, out } = makeRes();
  await handlePods({ method: 'GET', url } as any, res, url, deps());
  return out;
}

describe('GET pod goal result', () => {
  test('returns accepted goal evidence with a 404 for unknown goals', async () => {
    const ok = await get('/api/pods/pod_1/goals/g1/result');
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ goalId: 'g1', verdict: 'FAIL', tasks: [{ taskId: 'w1-t1' }] });
    const missing = await get('/api/pods/pod_1/goals/foreign/result');
    expect(missing.status).toBe(404);
  });
});
