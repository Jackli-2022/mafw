import Database from 'better-sqlite3';
import { StandingGoalStore } from '../../../src/core/standing/standing-store';
import { StandingGoalService } from '../../../src/core/standing/standing-service';

const cronTrigger = { id: 'c1', type: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Shanghai' };
const eventTrigger = { id: 'e1', type: 'event', eventKinds: ['pr_opened'] };
const base = {
  projectDir: '/p',
  title: 'Daily',
  objective: 'Report',
  template: { taskType: 'research' as const },
};

function harness(over: { eventLayerEnabled?: boolean } = {}) {
  const db = new Database(':memory:');
  const store = new StandingGoalStore(db);
  const subscribeEvents = jest.fn();
  const unsubscribeEvents = jest.fn();
  let seq = 0;
  const service = new StandingGoalService({
    store,
    now: () => '2026-11-10T00:00:00.000Z',
    newId: (prefix) => (prefix === 'standing-goal' ? 'sg1' : `${prefix}_${++seq}`),
    registerCron: () => ({ nextRunAt: null }),
    unregisterCron: () => {},
    enabled: () => true,
    broadcast: jest.fn(),
    createTriage: async () => ({ sessionId: 'ses_triage', output: { mode: 'goal', rationale: 'new' } }),
    createGoal: async () => ({ goalId: 'g1' }),
    subscribeEvents,
    unsubscribeEvents,
    eventLayerEnabled: () => over.eventLayerEnabled ?? true,
  });
  return { store, service, subscribeEvents, unsubscribeEvents };
}

describe('StandingGoalService event integration', () => {
  test('event subscription creates a run only for work mode', async () => {
    const h = harness();
    const goal = h.service.create({ ...base, triggers: [eventTrigger] });
    expect(h.subscribeEvents).toHaveBeenCalledTimes(1);

    const run = await h.service.handleEventTrigger(goal.id, {
      triggerKey: 'sg1:event:d1',
      eventId: 'd1',
      payload: { number: 42 },
    });
    expect(run).toMatchObject({ triggerType: 'event', status: 'running' });
    await expect(h.service.handleEventTrigger(goal.id, {
      triggerKey: 'sg1:event:d1',
      eventId: 'd1',
      payload: {},
    })).resolves.toBeNull();
  });

  test('event layer off leaves cron/manual working', async () => {
    const h = harness({ eventLayerEnabled: false });
    const goal = h.service.create({ ...base, triggers: [eventTrigger, cronTrigger] });
    expect(h.subscribeEvents).not.toHaveBeenCalled();
    expect(await h.service.handleCronTick(goal.id, '2026-11-10T01:00:00.000Z'))
      .toMatchObject({ status: 'running' });
  });
});
