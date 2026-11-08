import { summarizePodGoalProgress } from '../../../src/core/pod/pod-goal-progress';

describe('summarizePodGoalProgress', () => {
  test('counts plan tasks only and leaves pending implicit', () => {
    expect(summarizePodGoalProgress([
      { kind: 'plan', status: 'done' },
      { kind: 'plan', status: 'done' },
      { kind: 'plan', status: 'in_progress' },
      { kind: 'plan', status: 'blocked' },
      { kind: 'plan', status: 'review' },
      { kind: 'plan', status: 'failed' },
      { kind: 'plan', status: 'skipped' },
      { kind: 'plan', status: 'pending' },
      { kind: 'note', status: 'done' },
    ])).toEqual({ total: 8, done: 2, inProgress: 2, review: 1, failed: 1, skipped: 1 });
  });

  test('returns null when there are no plan tasks', () => {
    expect(summarizePodGoalProgress([])).toBeNull();
    expect(summarizePodGoalProgress([{ kind: 'note', status: 'done' }])).toBeNull();
  });
});
