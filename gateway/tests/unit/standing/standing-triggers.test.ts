import {
  canStartRun,
  parseStandingTriggers,
  triggerKeyFor,
} from '../../../src/core/standing/standing-triggers';
import type { GoalRun, StandingGoal } from '../../../src/core/standing/standing-types';

const standingGoal = (over: Partial<StandingGoal> = {}): StandingGoal => ({
  id: 'sg1',
  projectDir: '/p',
  title: 'Daily',
  objective: 'Report',
  template: {},
  triggers: [],
  state: 'active',
  concurrency: 1,
  cooldownMs: 0,
  budget: {},
  approval: 'plan',
  createdBy: null,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  lastRunAt: null,
  nextRunAt: null,
  ...over,
});

const goalRun = (over: Partial<GoalRun> = {}): GoalRun => ({
  id: 'r1',
  standingGoalId: 'sg1',
  triggerType: 'cron',
  triggerKey: 'k1',
  payload: {},
  status: 'queued',
  mode: null,
  rationale: null,
  goalId: null,
  sessionId: null,
  worktree: null,
  result: null,
  costUsd: null,
  tokens: null,
  startedAt: null,
  endedAt: null,
  ...over,
});

describe('standing triggers', () => {
  test('builds stable keys for cron and event triggers', () => {
    expect(triggerKeyFor({
      standingGoalId: 'sg1',
      trigger: { id: 'c1', type: 'cron' },
      scheduledAt: '2026-11-10T01:00:00.000Z',
    })).toBe('sg1:cron:2026-11-10T01:00:00.000Z');
    expect(triggerKeyFor({
      standingGoalId: 'sg1',
      trigger: { id: 'e1', type: 'event' },
      eventId: 'd1',
    })).toBe('sg1:event:d1');
  });

  test('blocks concurrency and daily budget', () => {
    const goal = standingGoal({ concurrency: 1, budget: { perDayCostUsd: 2 } });
    expect(canStartRun({
      goal,
      openRuns: [goalRun({ id: 'r1', status: 'running' })],
      todayCostUsd: 0,
      now: '2026-11-10T00:00:00.000Z',
    })).toMatchObject({ ok: false, reason: 'concurrency' });
    expect(canStartRun({ goal, openRuns: [], todayCostUsd: 2, now: '2026-11-10T00:00:00.000Z' }))
      .toMatchObject({ ok: false, reason: 'budget' });
  });

  test('enforces cooldown from the latest started run', () => {
    const goal = standingGoal({ cooldownMs: 60_000 });
    expect(canStartRun({
      goal,
      openRuns: [goalRun({ status: 'done', startedAt: '2026-11-10T00:00:30.000Z' })],
      todayCostUsd: 0,
      now: '2026-11-10T00:01:00.000Z',
    })).toMatchObject({ ok: false, reason: 'cooldown' });
  });

  test('parses valid triggers and rejects invalid ones', () => {
    expect(parseStandingTriggers([
      { id: 'c1', type: 'cron', schedule: '0 9 * * *', timezone: 'Asia/Shanghai' },
      { id: 'e1', type: 'event', eventKinds: ['pr_opened'] },
      { id: 'm1', type: 'manual' },
    ])).toHaveLength(3);
    expect(() => parseStandingTriggers([{ id: 'c1', type: 'cron', schedule: '0 9 * * *' }])).toThrow();
    expect(() => parseStandingTriggers([{ id: 'e1', type: 'event', eventKinds: [] }])).toThrow();
    expect(() => parseStandingTriggers([{ id: 'x', type: 'nope' }])).toThrow();
  });
});
