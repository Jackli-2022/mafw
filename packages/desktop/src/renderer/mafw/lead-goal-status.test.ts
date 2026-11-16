import { describe, expect, test } from 'bun:test';
import { buildLeadGoalStatusCards } from './lead-goal-status';

function view(over: Record<string, unknown>) {
  return {
    goalId: 'g1',
    title: 'T',
    endedAt: null,
    verdict: null,
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
  test('includes terminal failures but omits successful history', () => {
    const cards = buildLeadGoalStatusCards(
      [
        view({ goalId: 'ended-pass', endedAt: '2026-01-01', verdict: 'PASS', stage: { owner: 'system', kind: 'ended' } }),
        view({ goalId: 'failed', endedAt: '2026-01-01', verdict: 'ERROR', lastError: 'artifact_invalid', stage: { owner: 'system', kind: 'ended' } }),
        view({ goalId: 'work', stage: { owner: 'team', kind: 'implementing' }, progress: { done: 1, total: 2 } }),
        view({ goalId: 'person', stage: { owner: 'person', kind: 'plan_approval' } }),
      ],
      [{ goalId: 'failed' }],
    );

    expect(cards.map((card) => card.goalId)).toEqual(['person', 'failed', 'work']);
    expect(cards[1]).toMatchObject({
      stageLabel: '异常',
      blocker: 'artifact_invalid',
      pendingAttention: 1,
    });
    expect(cards[2]).toMatchObject({ progressText: '1/2', stageLabel: '执行中' });
  });

  test('labels FAIL and MAX_RETRIES as terminal failures', () => {
    const cards = buildLeadGoalStatusCards([
      view({ goalId: 'fail', endedAt: '2026-01-01', verdict: 'FAIL', stage: { owner: 'system', kind: 'ended' } }),
      view({ goalId: 'max', endedAt: '2026-01-01', verdict: 'MAX_RETRIES', stage: { owner: 'system', kind: 'ended' } }),
    ]);
    expect(cards.map((card) => card.stageLabel)).toEqual(['失败', '重试耗尽']);
    expect(cards.every((card) => card.blocker === '需要你决定重试或新建 Goal')).toBe(true);
  });

  test('surfaces a pending question as a blocker', () => {
    const cards = buildLeadGoalStatusCards([
      view({ goalId: 'q', pendingQuestion: { questionId: 'q1' } }),
    ]);
    expect(cards[0].blocker).toBe('待你回答');
  });

  test('surfaces a blocked stage as a blocker', () => {
    const cards = buildLeadGoalStatusCards([
      view({ goalId: 'b', stage: { owner: 'team', kind: 'blocked' } }),
    ]);
    expect(cards[0].stageLabel).toBe('阻塞');
    expect(cards[0].blocker).toBe('阻塞');
  });

  test('counts human attention per Goal', () => {
    const cards = buildLeadGoalStatusCards(
      [view({ goalId: 'a' }), view({ goalId: 'b' })],
      [{ goalId: 'a' }, { goalId: 'a' }, { goalId: 'b' }],
    );
    expect(cards.find((card) => card.goalId === 'a')?.pendingAttention).toBe(2);
    expect(cards.find((card) => card.goalId === 'b')?.pendingAttention).toBe(1);
  });
});
