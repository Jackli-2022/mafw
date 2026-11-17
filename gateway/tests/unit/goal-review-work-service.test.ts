import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PodReviewItem } from '../../src/core/pod/pod-review-service';
import { GoalReviewWorkService } from '../../src/core/pod/goal-review-work-service';

const now = '2026-11-17T00:00:00.000Z';

function item(id: string, revision = 2, status: PodReviewItem['status'] = 'pending'): PodReviewItem {
  return {
    id,
    podId: 'pod_1',
    goalId: 'g1',
    revision,
    status,
    rel: 'src/a.ts',
    startLine: 1,
    endLine: 1,
    code: 'x',
    comment: id,
    anchor: null,
    source: { kind: 'project', projectDir: 'C:/repo', root: 'C:/repo', contentVersion: 'v1' },
    clientRef: id,
    response: null,
    originItemId: null,
    originRevision: null,
    createdAt: now,
    updatedAt: now,
    respondedAt: null,
    resolvedAt: null,
  };
}

describe('GoalReviewWorkService', () => {
  test('plan captures a snapshot and execute reuses it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-review-work-'));
    let unresolved = [item('review_a')];
    const service = new GoalReviewWorkService({
      reviews: { unresolved: () => unresolved },
      mafwDirForGoal: () => dir,
      now: () => now,
    });
    try {
      expect(service.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'plan' })).toContain('review_a');
      unresolved = [item('review_a'), item('review_late')];
      const execute = service.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'execute' });
      expect(execute).toContain('review_a');
      expect(execute).not.toContain('review_late');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('resolved items leave the frozen set and missing dirs fail closed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-review-work-'));
    let unresolved = [item('review_a')];
    const service = new GoalReviewWorkService({
      reviews: { unresolved: () => unresolved },
      mafwDirForGoal: () => dir,
      now: () => now,
    });
    try {
      service.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'plan' });
      unresolved = [];
      expect(service.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'execute' })).toBeNull();
      const missing = new GoalReviewWorkService({
        reviews: { unresolved: () => unresolved },
        mafwDirForGoal: () => null,
        now: () => now,
      });
      expect(() => missing.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'plan' }))
        .toThrow(/mafw dir/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('revision 2 renders only current-revision unresolved rows', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-review-work-'));
    const origin = item('review_rev1_origin', 1);
    const clone = item('review_rev2_clone', 2);
    let unresolved = [origin];
    const service = new GoalReviewWorkService({
      reviews: { unresolved: () => unresolved },
      mafwDirForGoal: () => dir,
      now: () => now,
    });
    try {
      service.render({ podId: 'pod_1', goalId: 'g1', revision: 1, node: 'plan' });
      unresolved = [clone];
      const block = service.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'plan' }) ?? '';
      expect(block).toContain('review_rev2_clone');
      expect(block).not.toContain('review_rev1_origin');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('plan always replaces the snapshot, including with an empty set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-review-work-'));
    let unresolved = [item('review_a')];
    const service = new GoalReviewWorkService({
      reviews: { unresolved: () => unresolved },
      mafwDirForGoal: () => dir,
      now: () => now,
    });
    try {
      service.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'plan' });
      unresolved = [];
      expect(service.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'plan' })).toBeNull();
      unresolved = [item('review_late')];
      expect(service.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'execute' })).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('corrupt snapshot fails closed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-review-work-'));
    const service = new GoalReviewWorkService({
      reviews: { unresolved: () => [item('review_a')] },
      mafwDirForGoal: () => dir,
      now: () => now,
    });
    try {
      service.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'plan' });
      fs.writeFileSync(path.join(dir, 'revisions', 'g1', 'rev-2', 'review-work.json'), '{broken');
      expect(() => service.render({ podId: 'pod_1', goalId: 'g1', revision: 2, node: 'execute' }))
        .toThrow(/snapshot/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
