import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PodReviewItem } from '@mafw/sdk';
import {
  canReopenReviewItem,
  canResolveReviewItem,
  forcedAcceptanceNote,
  forcedAcceptReady,
  orderReviewItems,
  reviewAcceptAction,
  reviewCounts,
  reviewStatusLabel,
} from './pod-review-model';

function item(over: Partial<PodReviewItem>): PodReviewItem {
  return {
    id: 'review_1', podId: 'pod_1', goalId: 'g1', revision: 1,
    status: 'pending', rel: 'src/a.ts', startLine: 1, endLine: 1,
    code: 'x', comment: '改这里', anchor: null, response: null,
    originItemId: null, originRevision: null,
    createdAt: '2026-11-11T00:00:00.000Z', updatedAt: '2026-11-11T00:00:00.000Z',
    respondedAt: null, resolvedAt: null, ...over,
  };
}

test('counts and labels distinguish responded from resolved', () => {
  const items = [
    item({ id: 'a' }),
    item({ id: 'b', status: 'responded' }),
    item({ id: 'c', status: 'resolved' }),
  ];
  assert.deepEqual(reviewCounts(items), { unresolved: 2, resolved: 1 });
  assert.equal(reviewStatusLabel('pending'), '待处理');
  assert.equal(reviewStatusLabel('responded'), '已回应');
  assert.equal(reviewStatusLabel('resolved'), '已解决');
  assert.deepEqual(orderReviewItems(items).map((row) => row.id), ['a', 'b', 'c']);
});

test('action transitions are human-only projections', () => {
  assert.equal(canResolveReviewItem(item({ status: 'responded' })), true);
  assert.equal(canResolveReviewItem(item({ status: 'resolved' })), false);
  assert.equal(canReopenReviewItem(item({ status: 'resolved' })), true);
  assert.equal(canReopenReviewItem(item({ status: 'pending' })), false);
});

test('forced acceptance note survives the accepted (non-actionable) state', () => {
  assert.equal(forcedAcceptanceNote(null), null);
  assert.equal(forcedAcceptanceNote({ forced: false, unresolvedReviewItemIds: [] }), null);
  assert.equal(
    forcedAcceptanceNote({ forced: true, unresolvedReviewItemIds: ['a', 'b'] }),
    '已强制验收（2 条未解决意见）',
  );
});

test('unresolved items steer acceptance to handling first', () => {
  assert.deepEqual(reviewAcceptAction({ unresolved: 2 }), { kind: 'handle', label: '先处理意见' });
  assert.deepEqual(reviewAcceptAction({ unresolved: 0 }), { kind: 'accept', label: '验收并合并到主分支' });
  assert.equal(forcedAcceptReady({ acknowledged: false, unresolved: 2 }), false);
  assert.equal(forcedAcceptReady({ acknowledged: true, unresolved: 2 }), true);
});
