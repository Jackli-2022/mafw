import Database from 'better-sqlite3';
import { PodStore } from '../../src/core/pod/pod-store';

const now = '2026-11-11T00:00:00.000Z';

function store(): PodStore {
  return new PodStore(new Database(':memory:'));
}

describe('pod review item store', () => {
  test('creates, lists and transitions an item with append-only events', () => {
    const s = store();
    const item = s.createReviewItem({
      podId: 'pod_1', goalId: 'g1', revision: 1, rel: 'src/a.ts',
      startLine: 3, endLine: 5, code: 'x()', comment: '这里要改', now,
    });
    expect(item.status).toBe('pending');
    expect(s.listReviewItems('pod_1', 'g1', 1).map((row) => row.id)).toEqual([item.id]);

    expect(s.setReviewItemStatus({
      podId: 'pod_1', goalId: 'g1', itemId: item.id,
      from: ['pending'], to: 'responded', response: '已改', now,
    })).toBe(true);
    expect(s.getReviewItem(item.id)?.status).toBe('responded');
    expect(s.setReviewItemStatus({
      podId: 'pod_1', goalId: 'g1', itemId: item.id,
      from: ['pending'], to: 'resolved', now,
    })).toBe(false);

    s.appendReviewItemEvent({
      podId: 'pod_1', goalId: 'g1', revision: 1, itemId: item.id,
      kind: 'created', now,
    });
    expect(s.listReviewItemEvents(item.id).map((event) => event.kind)).toEqual(['created']);
  });

  test('carry-forward clones only unresolved items into the next revision', () => {
    const s = store();
    const open = s.createReviewItem({
      podId: 'pod_1', goalId: 'g1', revision: 1, rel: 'src/a.ts',
      comment: '未解决', now,
    });
    const done = s.createReviewItem({
      podId: 'pod_1', goalId: 'g1', revision: 1, rel: 'src/b.ts',
      comment: '已解决', now,
    });
    s.setReviewItemStatus({
      podId: 'pod_1', goalId: 'g1', itemId: done.id,
      from: ['pending'], to: 'resolved', now,
    });

    expect(s.carryForwardReviewItems({
      podId: 'pod_1', goalId: 'g1', fromRevision: 1, toRevision: 2, now,
    })).toBe(1);

    const rev2 = s.listReviewItems('pod_1', 'g1', 2);
    expect(rev2).toHaveLength(1);
    expect(rev2[0]).toMatchObject({
      status: 'pending', comment: '未解决', originItemId: open.id, originRevision: 1,
    });
    expect(s.listReviewItems('pod_1', 'g1', 1)).toHaveLength(2);
  });

  test('acceptance audit round-trips forced state and snapshot', () => {
    const s = store();
    const record = s.recordGoalAcceptance({
      podId: 'pod_1', goalId: 'g1', revision: 1, forced: true,
      unresolvedItemIds: ['review_1', 'review_2'], riskAcknowledged: true,
      mergeCommit: 'abc1234', now,
    });
    expect(record.forced).toBe(true);
    expect(record.unresolvedItemIds).toEqual(['review_1', 'review_2']);
    expect(s.getGoalAcceptance('pod_1', 'g1', 1)).toEqual(record);
    expect(s.getGoalAcceptance('pod_1', 'g1', 2)).toBeNull();
  });
});
