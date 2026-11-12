import { handleAttention } from '../../src/routes/attention';
import type { PodGoalView } from '../../src/core/pod/pod-view';

function view(overrides: Partial<PodGoalView> = {}): PodGoalView {
  return {
    id: 'pod_1',
    podId: 'pod_1',
    goalId: 'g1',
    status: 'active',
    title: '工作台重构',
    phase: 'plan',
    verdict: null,
    stage: {
      owner: 'person',
      kind: 'plan_approval',
      action: { type: 'open_plan_review', goalId: 'g1' },
    },
    bucket: 'needs_you',
    resultReady: false,
    accepted: false,
    sourceRef: null,
    strategy: null,
    assessment: null,
    currentAssignment: null,
    activeRevision: 1,
    revision: 1,
    priority: 0,
    enqueuedAt: new Date(0).toISOString(),
    startedAt: null,
    endedAt: null,
    ...overrides,
  } as PodGoalView;
}

test('handleAttention appends reviews from deps', () => {
  const out = handleAttention(
    { projectDir: 'C:/repo' },
    {
      views: () => [view()],
      reviews: () => [{
        id: 'item_1',
        goalId: 'g1',
        revision: 1,
        title: 'src/a.ts:12',
        rel: 'src/a.ts',
        line: 12,
        comment: '这里要补测试',
      }],
    },
  );

  expect(out.status).toBe(200);
  expect(out.body.items.map((item) => item.kind)).toEqual(['plan_approval', 'review_item']);
  expect(out.body.items[1].action.itemId).toBe('item_1');
});

test('handleAttention works without a review projection', () => {
  const out = handleAttention({ projectDir: 'C:/repo' }, { views: () => [view()] });
  expect(out.body.items).toHaveLength(1);
  expect(out.body.items[0].kind).toBe('plan_approval');
});
