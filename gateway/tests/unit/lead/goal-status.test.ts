import { buildLeadGoalStatus } from '../../../src/core/lead/goal-status';
import type { PodGoalView } from '../../../src/core/pod/pod-view';

function view(over: Partial<PodGoalView>): PodGoalView {
  return {
    id: 'row_1',
    podId: 'pod_1',
    goalId: 'g1',
    status: 'active',
    title: 'T',
    phase: null,
    verdict: null,
    stage: { owner: 'team', kind: 'working' } as any,
    bucket: 'working' as any,
    resultReady: false,
    accepted: false,
    progress: null,
    sourceRef: null,
    strategy: null,
    assessment: null,
    currentAssignment: null,
    pendingQuestion: null,
    activeRevision: 1,
    revision: 1,
    priority: 0,
    enqueuedAt: '2026-11-10T00:00:00.000Z',
    startedAt: null,
    endedAt: null,
    ...over,
  };
}

describe('buildLeadGoalStatus', () => {
  test('projects active goals with attention counts', () => {
    const status = buildLeadGoalStatus(
      [view({
        goalId: 'g1',
        title: 'T',
        stage: { owner: 'person', kind: 'plan_approval' } as any,
        progress: { done: 1, total: 3, inProgress: 0, review: 0, failed: 0, skipped: 0 },
      })],
      [{ goalId: 'g1', kind: 'plan_approval' } as any],
    );

    expect(status[0]).toMatchObject({
      goalId: 'g1',
      title: 'T',
      stage: 'plan_approval',
      progress: { done: 1, total: 3 },
      pendingAttention: 1,
    });
  });

  test('omits ended goals and keeps priority order', () => {
    const status = buildLeadGoalStatus(
      [
        view({ goalId: 'ended', endedAt: '2026-11-10T01:00:00.000Z' }),
        view({ goalId: 'low', priority: 0 }),
        view({ goalId: 'high', priority: 5 }),
      ],
      [],
    );

    expect(status.map((s) => s.goalId)).toEqual(['high', 'low']);
  });

  test('surfaces a blocked stage as a blocker', () => {
    const status = buildLeadGoalStatus([
      view({ goalId: 'blocked', stage: { owner: 'team', kind: 'blocked' } as any }),
    ], []);
    expect(status[0].blockers).toContain('blocked');
  });
});
