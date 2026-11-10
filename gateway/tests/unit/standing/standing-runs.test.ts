import Database from 'better-sqlite3';
import { StandingGoalStore } from '../../../src/core/standing/standing-store';
import { StandingGoalService } from '../../../src/core/standing/standing-service';

const cronTrigger = { id: 'c1', type: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Shanghai' };
const base = {
  projectDir: '/p',
  title: 'Daily report',
  objective: 'Report',
  template: { taskType: 'research' as const },
};

function harness(over: { triage?: any; createGoal?: jest.Mock } = {}) {
  const db = new Database(':memory:');
  const store = new StandingGoalStore(db);
  const createTriage = jest.fn(async () => ({
    sessionId: 'ses_triage',
    output: over.triage ?? { mode: 'goal', rationale: 'new PR' },
  }));
  const createGoal = over.createGoal ?? jest.fn(async () => ({ goalId: 'g1' }));
  let seq = 0;
  const service = new StandingGoalService({
    store,
    now: () => '2026-11-10T00:00:00.000Z',
    newId: (prefix) => (prefix === 'standing-goal' ? 'sg1' : `${prefix}_${++seq}`),
    registerCron: () => ({ nextRunAt: null }),
    unregisterCron: () => {},
    enabled: () => true,
    broadcast: jest.fn(),
    createTriage,
    createGoal,
  });
  return { store, service, createTriage, createGoal };
}

describe('StandingGoalService run lifecycle', () => {
  test('cron tick creates one run, triages goal, and creates a normal Goal', async () => {
    const h = harness();
    const goal = h.service.create({ ...base, triggers: [cronTrigger] });
    const run = await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z');

    expect(run).toMatchObject({ status: 'running', mode: 'goal', goalId: 'g1' });
    expect(h.createGoal).toHaveBeenCalledWith(expect.objectContaining({ mode: 'goal' }));
    await expect(h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z')).resolves.toBeNull();
  });

  test('report mode passes research task type, not a code worktree', async () => {
    const h = harness({ triage: { mode: 'report', rationale: 'summary only' } });
    const goal = h.service.create({ ...base, triggers: [cronTrigger] });
    await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z');
    expect(h.createGoal.mock.calls[0][0].mode).toBe('report');
    expect(h.createGoal.mock.calls[0][0].standingGoal.template.taskType).toBe('research');
  });

  test('concurrency and duplicate trigger create no second run', async () => {
    const h = harness();
    const goal = h.service.create({ ...base, triggers: [cronTrigger] });
    const first = await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z');
    const second = await h.service.handleCronTick(goal.id, '2026-11-10T02:00:00.000Z');
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  test('skip and triage failure are audited', async () => {
    const h = harness({ triage: { mode: 'skip', rationale: 'duplicate' } });
    const goal = h.service.create({ ...base, triggers: [cronTrigger] });
    expect(await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z'))
      .toMatchObject({ status: 'skipped', mode: 'skip', rationale: 'duplicate' });
    expect(h.createGoal).not.toHaveBeenCalled();
  });

  test('confirm approval gates goal runs until a human approves', async () => {
    const h = harness();
    const goal = h.service.create({
      ...base,
      triggers: [cronTrigger],
      approval: 'confirm',
    });
    const run = await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z');
    expect(run).toMatchObject({ status: 'waiting_person', mode: 'goal' });
    expect(h.createGoal).not.toHaveBeenCalled();

    const approved = await h.service.approveRun(run!.id);
    expect(approved).toMatchObject({ status: 'running', mode: 'goal', goalId: 'g1' });
    expect(h.createGoal).toHaveBeenCalledTimes(1);
  });

  test('run cost accumulates triage and goal spend', async () => {
    const h = harness();
    h.createTriage.mockResolvedValue({
      sessionId: 'ses_triage',
      output: { mode: 'report', rationale: 'summary' },
      costUsd: 0.25,
      tokens: 120,
    });
    const goal = h.service.create({ ...base, triggers: [cronTrigger] });
    const run = await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z');
    await h.service.onGoalFinished(run!.goalId!, { status: 'done', costUsd: 1.5, tokens: 300 });
    expect(h.store.getRun(run!.id)).toMatchObject({ costUsd: 1.75, tokens: 420, status: 'done' });
  });
});
