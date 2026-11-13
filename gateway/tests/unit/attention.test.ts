import {
  appendDecisionAttention,
  appendReviewAttention,
  decisionAttentionInput,
  type AttentionItem,
  type ReviewAttentionInput,
} from '../../src/core/lead/attention';
import type { DecisionRecord } from '../../src/core/decision/decision-record';

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

const answer: AttentionItem = {
  id: 'g1:answer:r1',
  goalId: 'g1',
  revision: 1,
  kind: 'answer',
  priority: 80,
  coalesceKey: 'g1:answer:r1',
  title: '工作台重构',
  action: { type: 'open_question', goalId: 'g1', questionId: 'q1' },
};

function decision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: 'dec_1',
    projectDir: 'C:/repo',
    goalId: 'g1',
    revision: 1,
    kind: 'plan',
    status: 'draft',
    question: '采用哪个方案？',
    options: [],
    evidence: [],
    rationale: '方案 A 更省改动',
    consequences: null,
    reviewAt: null,
    decidedBy: null,
    decidedAt: null,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z',
    history: [],
    ...overrides,
  };
}

test('appendDecisionAttention projects draft records as open_decision items', () => {
  const items = appendDecisionAttention([], [decision()]);

  expect(items).toHaveLength(1);
  expect(items[0]).toEqual({
    id: 'decision:dec_1',
    goalId: 'g1',
    revision: 1,
    kind: 'decision',
    priority: 85,
    coalesceKey: 'decision:dec_1',
    title: '采用哪个方案？',
    detail: '方案 A 更省改动',
    action: { type: 'open_decision', goalId: 'g1', itemId: 'dec_1' },
  });
});

test('appendDecisionAttention skips decided and shelved records', () => {
  const items = appendDecisionAttention([], [
    decision({ id: 'dec_draft', status: 'draft' }),
    decision({ id: 'dec_decided', status: 'decided' }),
    decision({ id: 'dec_shelved', status: 'shelved' }),
  ]);

  expect(items.map((item) => item.id)).toEqual(['decision:dec_draft']);
});

test('appendDecisionAttention dedupes duplicate records by id', () => {
  const items = appendDecisionAttention([], [decision(), decision()]);
  expect(items).toHaveLength(1);
  expect(items[0].coalesceKey).toBe('decision:dec_1');
});

test('appendDecisionAttention leaves existing attention untouched', () => {
  const items = appendDecisionAttention([plan, answer], [decision()]);
  expect(items.find((item) => item.coalesceKey === plan.coalesceKey)).toEqual(plan);
  expect(items.find((item) => item.coalesceKey === answer.coalesceKey)).toEqual(answer);
});

test('decisions sort between direction_review and answer', () => {
  const direction: AttentionItem = {
    ...plan,
    id: 'g1:direction_review:r1',
    kind: 'direction_review',
    priority: 90,
    coalesceKey: 'g1:direction_review:r1',
  };
  const items = appendDecisionAttention([answer, plan, direction], [decision()]);

  expect(items.map((item) => item.kind)).toEqual([
    'plan_approval', 'direction_review', 'decision', 'answer',
  ]);
});

test('decision detail falls back to consequences, then to none', () => {
  const items = appendDecisionAttention([], [
    decision({ id: 'dec_a', rationale: null, consequences: '后续要补测试' }),
    decision({ id: 'dec_b', rationale: null, consequences: null }),
  ]);

  expect(items.find((item) => item.id === 'decision:dec_a')?.detail).toBe('后续要补测试');
  expect(items.find((item) => item.id === 'decision:dec_b')?.detail).toBeUndefined();
});

test('draft records without a goal stay out of goal-scoped attention', () => {
  const items = appendDecisionAttention([], [decision({ goalId: null })]);
  expect(items).toEqual([]);
});

test('decisionAttentionInput maps a draft record and rejects the rest', () => {
  expect(decisionAttentionInput(decision())).toEqual({
    id: 'dec_1',
    goalId: 'g1',
    revision: 1,
    title: '采用哪个方案？',
    detail: '方案 A 更省改动',
  });
  expect(decisionAttentionInput(decision({ status: 'decided' }))).toBeNull();
  expect(decisionAttentionInput(decision({ goalId: null }))).toBeNull();
});
