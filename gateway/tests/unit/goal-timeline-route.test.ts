import { handleGoalTimeline } from '../../src/routes/goal-timeline';

function fakeRes() {
  let b = ''; let s = 0;
  const res = { writeHead(st: number) { s = st; }, end(d: string) { b = d; } } as any;
  return { res, get body() { return b; }, get status() { return s; } };
}

describe('GET /api/goals/:id/timeline', () => {
  const state = {
    version: '3', goalId: 'g1', phase: 'REVIEWING', round: 2, loop: 2, maxRounds: 3,
    reviewVerdict: null, reviewReportPath: null, reviewFeedback: '', wavePlanPath: 'w', receiptPath: 'r',
    lastError: null, nodeSession: { id: 's9', phase: 'review', startedAt: 't', attempt: 1, runId: 9 },
    pendingQuestion: null, userResponse: null, sameSigCount: 0, stateVersion: 1,
    nextNode: 'review', nextAction: 'RUNNING_review', artifacts: {}, currentWave: 1, totalWaves: 2,
    sessions: {}, updatedAt: 't', projectDir: 'C:/p', mafwDir: 'C:/m',
  };
  const runs = [{
    id: 1, goal_id: 'g1', project_id: 'C:/p', loop: 1, node: 'plan', attempt: 1, session_id: 's1',
    status: 'succeeded', started_at: '2026-10-08T00:00:00Z', finished_at: '2026-10-08T00:05:00Z',
    outcome: 'waves=2', error: null, tokens_input: 10, tokens_output: 5, cost_usd: 0.1,
  }];

  it('聚合 state + node_runs 富化 duration/outcome', async () => {
    const fr = fakeRes();
    const handled = await handleGoalTimeline({ method: 'GET', url: '/api/goals/g1/timeline' } as any, fr.res, '/api/goals/g1/timeline', {
      loadState: () => state, listNodeRuns: () => runs,
      loadRequest: () => ({ title: 'T' }), getOutcome: () => null,
    } as any);
    expect(handled).toBe(true);
    const j = JSON.parse(fr.body);
    expect(j.goal.title).toBe('T');
    expect(j.goal.round).toBe(2);
    expect(j.nodes[0]).toMatchObject({ node: 'plan', status: 'succeeded', durationMs: 300_000, loop: 1 });
    expect(j.artifacts.wavesPath).toBe('w');
  });

  it('state 缺失 → 404', async () => {
    const fr = fakeRes();
    await handleGoalTimeline({ method: 'GET', url: '/api/goals/nope/timeline' } as any, fr.res, '/api/goals/nope/timeline', {
      loadState: () => null, listNodeRuns: () => [], loadRequest: () => null, getOutcome: () => null,
    } as any);
    expect(JSON.parse(fr.body).error).toBeDefined();
  });
});
