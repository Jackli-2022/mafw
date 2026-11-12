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

function harness() {
  const db = new Database(':memory:');
  const store = new StandingGoalStore(db);
  const registerCron = jest.fn((_input: any) => ({ nextRunAt: '2026-11-11T01:00:00.000Z' }));
  const unregisterCron = jest.fn();
  let seq = 0;
  const broadcast = jest.fn();
  const service = new StandingGoalService({
    store,
    now: () => '2026-11-10T00:00:00.000Z',
    newId: (prefix) => (prefix === 'standing-goal' ? 'sg1' : `${prefix}_${++seq}`),
    registerCron,
    unregisterCron,
    enabled: () => true,
    broadcast,
  });
  return { store, service, registerCron, unregisterCron, broadcast };
}

describe('StandingGoalService lifecycle', () => {
  test('create registers cron keys and pause unregisters them', () => {
    const h = harness();
    const goal = h.service.create({ ...base, triggers: [cronTrigger] });

    expect(h.registerCron).toHaveBeenCalledWith(expect.objectContaining({ key: 'standing-goal:sg1:c1' }));
    expect(goal.nextRunAt).toBe('2026-11-11T01:00:00.000Z');
    h.service.pause(goal.id);
    expect(h.unregisterCron).toHaveBeenCalledWith('standing-goal:sg1:c1');
    expect(h.store.getGoal(goal.id)?.state).toBe('paused');
  });

  test('resume re-registers and reconcile repairs missing jobs', () => {
    const h = harness();
    const goal = h.service.create({ ...base, triggers: [cronTrigger] });
    h.service.pause(goal.id);
    h.service.resume(goal.id);
    h.service.reconcile();
    expect(h.registerCron).toHaveBeenCalledTimes(3);
    expect(h.store.getGoal(goal.id)?.state).toBe('active');
  });

  test('rejects when disabled and validates triggers', () => {
    const db = new Database(':memory:');
    const service = new StandingGoalService({
      store: new StandingGoalStore(db),
      now: () => '2026-11-10T00:00:00.000Z',
      newId: () => 'sg1',
      registerCron: () => ({ nextRunAt: null }),
      unregisterCron: () => {},
      enabled: () => false,
      broadcast: () => {},
    });
    expect(() => service.create({ ...base, triggers: [] })).toThrow();
    expect(() => service.list('/p')).not.toThrow();
  });

  test('stopped is terminal and clears nextRunAt', () => {
    const h = harness();
    const goal = h.service.create({ ...base, triggers: [cronTrigger] });
    expect(goal.nextRunAt).toBe('2026-11-11T01:00:00.000Z');
    expect(h.service.stop(goal.id).nextRunAt).toBeNull();
    expect(() => h.service.pause(goal.id)).toThrow();
    expect(() => h.service.resume(goal.id)).toThrow();
    try {
      h.service.pause(goal.id);
    } catch (err: any) {
      expect(err.status).toBe(409);
    }
  });

  test('update broadcasts a standing_goal.updated event', () => {
    const h = harness();
    const goal = h.service.create({ ...base, triggers: [cronTrigger] });
    h.service.update(goal.id, { title: 'Renamed' });
    expect(h.service.list('/p')[0].title).toBe('Renamed');
    expect(h.broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'standing_goal.updated',
      properties: expect.objectContaining({ standingGoalId: goal.id }),
    }));
  });
});
