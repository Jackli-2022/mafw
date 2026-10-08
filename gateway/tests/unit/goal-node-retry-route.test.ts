import { handleNodeRetry } from '../../src/routes/goal-node-retry';

function fakeRes() {
  let b = ''; let s = 0;
  const res = { writeHead(st: number) { s = st; }, end(d: string) { b = d; } } as any;
  return { res, get body() { return b; }, get status() { return s; } };
}

describe('POST /api/goals/:id/nodes/:runId/retry', () => {
  it('execute 节点缺 confirm → 409（destructive 门）', async () => {
    const fr = fakeRes();
    await handleNodeRetry({ method: 'POST', url: '/api/goals/g1/nodes/5/retry' } as any, fr.res, '/api/goals/g1/nodes/5/retry', {
      body: {},
      getNodeRun: () => ({ id: 5, goal_id: 'g1', node: 'execute', status: 'failed', loop: 1 }),
      retryNodeRun: async () => { throw new Error('should not reach'); },
    } as any);
    expect(fr.status).toBe(409);
    expect(JSON.parse(fr.body).error).toContain('confirm');
  });

  it('execute 节点带 confirm=true → 放行', async () => {
    const fr = fakeRes();
    await handleNodeRetry({ method: 'POST', url: '/api/goals/g1/nodes/5/retry' } as any, fr.res, '/api/goals/g1/nodes/5/retry', {
      body: { confirm: true },
      getNodeRun: () => ({ id: 5, goal_id: 'g1', node: 'execute', status: 'failed', loop: 1 }),
      retryNodeRun: async () => ({ runId: 7 }),
    } as any);
    expect(fr.status).toBe(200);
    expect(JSON.parse(fr.body).runId).toBe(7);
  });

  it('succeeded 行不可重试 → 400', async () => {
    const fr = fakeRes();
    await handleNodeRetry({ method: 'POST', url: '/api/goals/g1/nodes/5/retry' } as any, fr.res, '/api/goals/g1/nodes/5/retry', {
      body: {},
      getNodeRun: () => ({ id: 5, goal_id: 'g1', node: 'review', status: 'succeeded', loop: 1 }),
      retryNodeRun: async () => { throw new Error('x'); },
    } as any);
    expect(fr.status).toBe(400);
  });
});
