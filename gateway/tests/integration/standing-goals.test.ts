import Database from 'better-sqlite3';
import { StandingGoalStore } from '../../src/core/standing/standing-store';
import { StandingGoalService } from '../../src/core/standing/standing-service';

const base = {
  projectDir: '/p',
  title: 'Daily report',
  objective: 'Report the project state',
  template: { taskType: 'research' as const },
};

function integrationHarness(over: { cost?: number } = {}) {
  const db = new Database(':memory:');
  const store = new StandingGoalStore(db);
  let seq = 0;
  const now = '2026-11-10T00:00:00.000Z';

  if (over.cost !== undefined) {
    store.insertGoal({
      id: 'seed-goal',
      projectDir: base.projectDir,
      title: 'seed',
      objective: 'seed',
      template: {},
      triggers: [],
      state: 'active',
      concurrency: 1,
      cooldownMs: 0,
      budget: {},
      approval: 'auto',
      createdBy: null,
      now,
    });
    store.insertRun({
      id: 'seed-run',
      standingGoalId: 'seed-goal',
      triggerType: 'manual',
      triggerKey: 'seed-manual',
      payload: {},
      status: 'done',
      mode: 'report',
      rationale: 'seed',
      goalId: null,
      sessionId: null,
      worktree: null,
      result: null,
      costUsd: over.cost,
      tokens: null,
      now,
    });
  }

  const cronJobs = new Map<string, { schedule: string; timezone: string }>();
  const broadcast = jest.fn();
  const createTriage = jest.fn(async () => ({
    sessionId: 'ses_integration',
    output: { mode: 'report', rationale: 'periodic project report' },
  }));
  const createGoal = jest.fn(async () => ({ goalId: `goal_${++seq}` }));

  const service = new StandingGoalService({
    store,
    now: () => now,
    newId: (prefix) => (prefix === 'standing-goal' ? 'sg-integration' : `${prefix}_${++seq}`),
    registerCron: (input) => {
      cronJobs.set(input.key, { schedule: input.schedule, timezone: input.timezone });
      return { nextRunAt: '2026-11-11T01:00:00.000Z' };
    },
    unregisterCron: (key) => {
      cronJobs.delete(key);
    },
    enabled: () => true,
    broadcast,
    createTriage,
    createGoal,
  });

  return { db, store, service, cronJobs, broadcast, createTriage, createGoal };
}

describe('standing goals integration', () => {
  test('cron trigger -> run -> triage report -> run history', async () => {
    const h = integrationHarness();
    const goal = h.service.create({
      ...base,
      triggers: [{ id: 'c1', type: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Shanghai' }],
    });

    expect(h.cronJobs.has(`standing-goal:${goal.id}:c1`)).toBe(true);
    expect(goal.nextRunAt).toBe('2026-11-11T01:00:00.000Z');

    const run = await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z');
    expect(run).toMatchObject({ mode: 'report', status: 'running', triggerType: 'cron' });
    expect(h.createGoal).toHaveBeenCalledWith(expect.objectContaining({ mode: 'report' }));
    expect(h.service.listRuns(goal.id)[0]).toMatchObject({ triggerType: 'cron', mode: 'report' });
    h.db.close();
  });

  test('budget exhaustion pauses the standing goal and raises attention', async () => {
    const h = integrationHarness({ cost: 10 });
    const goal = h.service.create({
      ...base,
      triggers: [{ id: 'c1', type: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Shanghai' }],
      budget: { perDayCostUsd: 1 },
    });

    const run = await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z');
    expect(run).toBeNull();
    expect(h.store.getGoal(goal.id)?.state).toBe('paused');
    expect(h.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'goal_run.budget_exhausted' }));
    expect(h.createTriage).not.toHaveBeenCalled();
    h.db.close();
  });

  test('manual run stays available with the event layer off', async () => {
    const h = integrationHarness();
    const goal = h.service.create({
      ...base,
      triggers: [{ id: 'm1', type: 'manual' }],
    });

    const run = await h.service.runNow(goal.id);
    expect(run).toMatchObject({ status: 'running', mode: 'report' });
    h.db.close();
  });
});
