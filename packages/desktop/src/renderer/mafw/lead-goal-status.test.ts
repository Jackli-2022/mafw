import { describe, expect, test } from 'bun:test';
import { buildLeadGoalStatusCards } from './lead-goal-status';

function view(over: Record<string, unknown>) {
  return {
    goalId: 'g1',
    title: 'T',
    endedAt: null,
    stage: { owner: 'team', kind: 'implementing' },
    progress: null,
    pendingQuestion: null,
    lastError: null,
    priority: 0,
    enqueuedAt: '2026-11-10T00:00:00.000Z',
    ...over,
  } as any;
}

describe('buildLeadGoalStatusCards', () => {
  test('omits ended goals and keeps person stages first', () => {
    const cards = buildLeadGoalStatusCards([
      view({ goalId: 'ended', endedAt: '2026-01-01', stage: { owner: 'person', kind: 'plan_approval' } }),
      view({ goalId: 'work', stage: { owner: 'team', kind: 'implementing' }, progress: { done: 1, total: 2 } }),
      view({ goalId: 'person', stage: { owner: 'person', kind: 'plan_approval' } }),
    ]);

    expect(cards.map((card) => card.goalId)).toEqual(['person', 'work']);
    expect(cards[1]).toMatchObject({ progressText: '1/2', stageLabel: '执行中' });
  });

  test('surfaces a pending question as a blocker', () => {
    const cards = buildLeadGoalStatusCards([
      view({ goalId: 'q', pendingQuestion: { questionId: 'q1' } }),
    ]);
    expect(cards[0].blocker).toBe('待你回答');
  });
});
