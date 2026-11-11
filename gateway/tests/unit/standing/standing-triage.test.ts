import {
  buildStandingTriagePrompt,
  validateRunTriage,
} from '../../../src/core/standing/standing-triage';
import type { GoalRun, StandingGoal, StandingTrigger } from '../../../src/core/standing/standing-types';

const standingGoal: StandingGoal = {
  id: 'sg1',
  projectDir: '/p',
  title: 'Review PRs',
  objective: 'Review every PR',
  template: { taskType: 'research' },
  triggers: [],
  state: 'active',
  concurrency: 1,
  cooldownMs: 0,
  budget: { perRunCostUsd: 1 },
  approval: 'plan',
  createdBy: null,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  lastRunAt: null,
  nextRunAt: null,
};

const trigger: StandingTrigger = { id: 'e1', type: 'event', eventKinds: ['pr_opened'] };

const goalRun = (over: Partial<GoalRun> = {}): GoalRun => ({
  id: 'r1',
  standingGoalId: 'sg1',
  triggerType: 'event',
  triggerKey: 'k1',
  payload: {},
  status: 'done',
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

describe('standing triage', () => {
  test('accepts a goal triage and rejects an unknown mode', () => {
    expect(validateRunTriage({ mode: 'goal', rationale: 'new PR' })).toMatchObject({ mode: 'goal' });
    expect(() => validateRunTriage({ mode: 'auto', rationale: 'x' })).toThrow();
    expect(() => validateRunTriage({ mode: 'goal', rationale: '' })).toThrow();
  });

  test('action mode requires a whitelisted action payload', () => {
    expect(validateRunTriage({
      mode: 'action',
      rationale: 'reply',
      action: { type: 'comment', payload: { body: 'hi', target: 'acme/app#42' } },
    })).toMatchObject({ mode: 'action' });
    expect(() => validateRunTriage({
      mode: 'action',
      rationale: 'merge',
      action: { type: 'merge', payload: {} },
    })).toThrow();
    expect(() => validateRunTriage({ mode: 'action', rationale: 'missing action' })).toThrow();
  });

  test('prompt includes objective, trigger and recent skip reasons', () => {
    const prompt = buildStandingTriagePrompt({
      standingGoal,
      trigger,
      payload: { number: 42 },
      recentRuns: [goalRun({ mode: 'skip', rationale: 'duplicate' })],
    });
    expect(prompt).toContain('Review every PR');
    expect(prompt).toContain('pr_opened');
    expect(prompt).toContain('duplicate');
    expect(prompt).toContain('Return JSON only');
  });
});
