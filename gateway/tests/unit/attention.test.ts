import {
  appendReviewAttention,
  type AttentionItem,
  type ReviewAttentionInput,
} from '../../src/core/lead/attention';

const plan: AttentionItem = {
  id: 'g1:plan_approval:r1',
  goalId: 'g1',
  revision: 1,
  kind: 'plan_approval',
  priority: 100,
  coalesceKey: 'g1:plan_approval:r1',
  title: '工作台重构',
  action: { type: 'open_plan_review', goalId: 'g1' },
};

function review(overrides: Partial<ReviewAttentionInput> = {}): ReviewAttentionInput {
  return {
    id: 'item_1',
    goalId: 'g1',
    revision: 1,
    title: 'src/a.ts:12',
    rel: 'src/a.ts',
    line: 12,
    comment: '这里要补测试',
    ...overrides,
  };
}

test('appendReviewAttention adds one decision per unresolved item', () => {
  const items = appendReviewAttention([plan], [
    review(),
    review({ id: 'item_2', rel: 'src/b.ts', line: 4, comment: '命名不一致' }),
  ]);

  const added = items.filter((item) => item.kind === 'review_item');
  expect(added).toHaveLength(2);
  expect(new Set(added.map((item) => item.id)).size).toBe(2);
  expect(added[0].action).toEqual({
    type: 'open_review_item',
    goalId: 'g1',
    itemId: 'item_1',
    rel: 'src/a.ts',
    line: 12,
  });
  expect(added[0].priority).toBe(75);
  expect(added[0].detail).toBe('这里要补测试');
  expect(added[1].coalesceKey).toBe('review_item:g1:r1:item_2');
});

test('appendReviewAttention keeps existing attention untouched', () => {
  const items = appendReviewAttention([plan], [review()]);
  expect(items[0]).toEqual(plan);
  expect(items[0].kind).toBe('plan_approval');
});

test('review items without a line still carry the anchor rel', () => {
  const items = appendReviewAttention([], [review({ line: undefined })]);
  expect(items[0].action.line).toBeUndefined();
  expect(items[0].action.rel).toBe('src/a.ts');
});
