import Database from 'better-sqlite3';
import { StandingGoalStore } from '../../../src/core/standing/standing-store';
import { StandingGoalService } from '../../../src/core/standing/standing-service';
import { StandingActionExecutor } from '../../../src/core/standing/standing-actions';

const cronTrigger = { id: 'c1', type: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Shanghai' };
const base = {
  projectDir: '/p',
  title: 'Daily',
  objective: 'Report',
  template: { taskType: 'research' as const },
};

function harness(over: { triage?: any; executeAction?: jest.Mock } = {}) {
  const db = new Database(':memory:');
  const store = new StandingGoalStore(db);
  const executeAction = over.executeAction ?? jest.fn(async () => ({ ok: true, result: { sent: true } }));
  let seq = 0;
  const service = new StandingGoalService({
    store,
    now: () => '2026-11-10T00:00:00.000Z',
    newId: (prefix) => (prefix === 'standing-goal' ? 'sg1' : `${prefix}_${++seq}`),
    registerCron: () => ({ nextRunAt: null }),
    unregisterCron: () => {},
    enabled: () => true,
    broadcast: jest.fn(),
    createTriage: async () => ({ sessionId: 'ses_triage', output: over.triage }),
    createGoal: async () => ({ goalId: 'g1' }),
    executeAction,
  });
  return { store, service, executeAction };
}

describe('standing actions', () => {
  test('notify executes; merge/close/delete are rejected', async () => {
    const exec = new StandingActionExecutor({
      notify: jest.fn(),
      comment: jest.fn(),
      label: jest.fn(),
      enabled: () => true,
    });
    expect(await exec.execute({ type: 'notify', payload: { title: 'PR', body: 'new' } })).toMatchObject({ ok: true });
    expect(await exec.execute({ type: 'comment', payload: { target: 'acme/app#1', body: 'hi' } })).toMatchObject({ ok: true });
    expect(await exec.execute({ type: 'merge' as any, payload: {} } as any)).toMatchObject({ ok: false });
  });

  test('requiresApproval moves action run to waiting_person', async () => {
    const h = harness({
      triage: {
        mode: 'action',
        rationale: 'reply',
        requiresApproval: true,
        action: { type: 'comment', payload: { target: 'acme/app#1', body: 'hi' } },
      },
    });
    const goal = h.service.create({ ...base, triggers: [cronTrigger] });
    const run = await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z');
    expect(run).toMatchObject({ status: 'waiting_person', mode: 'action' });
    expect(h.executeAction).not.toHaveBeenCalled();
  });

  test('approveRun executes a pending action and rejects other states', async () => {
    const h = harness({
      triage: {
        mode: 'action',
        rationale: 'reply',
        requiresApproval: true,
        action: { type: 'comment', payload: { target: 'acme/app#1', body: 'hi' } },
      },
    });
    const goal = h.service.create({ ...base, triggers: [cronTrigger] });
    const run = await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z');
    const approved = await h.service.approveRun(run!.id);
    expect(approved).toMatchObject({ status: 'done', mode: 'action' });
    expect(h.executeAction).toHaveBeenCalledTimes(1);
    await expect(h.service.approveRun(run!.id)).rejects.toMatchObject({ status: 409 });
  });
});
