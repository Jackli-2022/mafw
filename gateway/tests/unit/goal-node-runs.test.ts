import { GatewayDatabase } from '../../src/memory/gateway-db';

describe('goal_node_runs', () => {
  let db: GatewayDatabase;
  beforeEach(() => { db = new GatewayDatabase(':memory:'); });
  afterEach(() => { db.close(); });

  it('insert → running 行带 id', () => {
    const id = db.insertNodeRun({
      goalId: 'g1', projectId: 'C:/p', loop: 1, node: 'plan',
      attempt: 1, sessionId: 'ses_1', startedAt: '2026-10-08T00:00:00Z',
    });
    expect(typeof id).toBe('number');
    const rows = db.listNodeRuns('g1');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('running');
    expect(rows[0].session_id).toBe('ses_1');
  });

  it('finishNodeRun 更新状态/产物（不覆盖 attempt）', () => {
    const id = db.insertNodeRun({
      goalId: 'g1', projectId: 'C:/p', loop: 1, node: 'review',
      attempt: 1, sessionId: 'ses_1', startedAt: '2026-10-08T00:00:00Z',
    });
    db.finishNodeRun(id, {
      status: 'succeeded', finishedAt: '2026-10-08T00:05:00Z',
      outcome: 'PASS', tokensInput: 100, tokensOutput: 50, costUsd: 0.01,
    });
    const row = db.listNodeRuns('g1').find((r) => r.id === id)!;
    expect(row.status).toBe('succeeded');
    expect(row.outcome).toBe('PASS');
    expect(row.attempt).toBe(1);
    expect(row.tokens_input).toBe(100);
    expect(row.cost_usd).toBeCloseTo(0.01);
  });

  it('watchdog 重试 = 新行新 attempt，失败历史保留', () => {
    const id1 = db.insertNodeRun({
      goalId: 'g1', projectId: 'C:/p', loop: 1, node: 'execute',
      attempt: 1, sessionId: 'ses_1', startedAt: '2026-10-08T00:00:00Z',
    });
    db.finishNodeRun(id1, { status: 'timeout', finishedAt: '2026-10-08T00:30:00Z', error: 'timeout' });
    db.insertNodeRun({
      goalId: 'g1', projectId: 'C:/p', loop: 1, node: 'execute',
      attempt: 2, sessionId: 'ses_2', startedAt: '2026-10-08T00:31:00Z',
    });
    const rows = db.listNodeRuns('g1');
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'timeout')).toHaveLength(1);
  });

  it('latestNodeAttempt 取该 (goal,loop,node) 最新行', () => {
    db.insertNodeRun({ goalId: 'g1', projectId: 'C:/p', loop: 1, node: 'execute', attempt: 1, sessionId: 's1', startedAt: 't1' });
    db.insertNodeRun({ goalId: 'g1', projectId: 'C:/p', loop: 1, node: 'execute', attempt: 2, sessionId: 's2', startedAt: 't2' });
    expect(db.latestNodeAttempt('g1', 1, 'execute')!.attempt).toBe(2);
    expect(db.latestNodeAttempt('g1', 1, 'plan')).toBeNull();
  });
});
