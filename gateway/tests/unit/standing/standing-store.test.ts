import Database from 'better-sqlite3';
import { StandingGoalStore } from '../../../src/core/standing/standing-store';

describe('StandingGoalStore', () => {
  test('stores a standing goal and dedupes runs by trigger key', () => {
    const db = new Database(':memory:');
    const store = new StandingGoalStore(db);
    const goal = store.insertGoal({
      id: 'sg1',
      projectDir: '/p',
      title: 'Review PRs',
      objective: 'Review every PR',
      template: { taskType: 'research' },
      triggers: [{ id: 'cron1', type: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Shanghai' }],
      state: 'active',
      concurrency: 1,
      cooldownMs: 60_000,
      budget: { perRunCostUsd: 1, perDayCostUsd: 5 },
      approval: 'plan',
      createdBy: null,
      now: '2026-11-10T00:00:00.000Z',
    });

    expect(store.getGoal('sg1')).toMatchObject({ title: 'Review PRs', state: 'active' });
    const runInput = {
      id: 'r1',
      standingGoalId: goal.id,
      triggerType: 'cron' as const,
      triggerKey: 'sg1:cron:2026-11-10T01:00:00.000Z',
      payload: {},
      status: 'queued' as const,
      mode: null,
      rationale: null,
      goalId: null,
      sessionId: null,
      worktree: null,
      result: null,
      costUsd: null,
      tokens: null,
      now: '2026-11-10T01:00:01.000Z',
    };
    store.insertRun(runInput);
    expect(store.findRunByTriggerKey('sg1', 'sg1:cron:2026-11-10T01:00:00.000Z')?.id).toBe('r1');
    expect(() => store.insertRun({ ...runInput, id: 'r2' })).toThrow();
    expect(store.listRuns('sg1')).toHaveLength(1);
  });

  test('updates state, run status and appends audit events', () => {
    const db = new Database(':memory:');
    const store = new StandingGoalStore(db);
    store.insertGoal({
      id: 'sg1', projectDir: '/p', title: 'Daily', objective: 'Report',
      template: {}, triggers: [], state: 'active', concurrency: 1, cooldownMs: 0,
      budget: {}, approval: 'auto', createdBy: null, now: '2026-11-10T00:00:00.000Z',
    });
    expect(store.setGoalState('sg1', 'paused', '2026-11-10T00:01:00.000Z').state).toBe('paused');
    expect(store.updateGoal('sg1', { title: 'Daily 2' }, '2026-11-10T00:02:00.000Z').title).toBe('Daily 2');

    store.insertRun({
      id: 'r1', standingGoalId: 'sg1', triggerType: 'manual', triggerKey: 'k1',
      payload: {}, status: 'queued', mode: null, rationale: null, goalId: null,
      sessionId: null, worktree: null, result: null, costUsd: null, tokens: null,
      now: '2026-11-10T00:03:00.000Z',
    });
    expect(store.updateRun('r1', { status: 'running', startedAt: '2026-11-10T00:03:01.000Z' }).status).toBe('running');
    store.appendRunEvent('r1', 'started', { mode: 'report' }, '2026-11-10T00:03:02.000Z');
  });
});
