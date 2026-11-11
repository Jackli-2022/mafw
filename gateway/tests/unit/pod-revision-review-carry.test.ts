import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodGoalRevisionService } from '../../src/core/pod/pod-goal-revision-service';
import { PodStore } from '../../src/core/pod/pod-store';

const now = '2026-11-11T00:00:00.000Z';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-review-carry-'));
  const mafwDir = path.join(root, '.mafw');
  fs.mkdirSync(mafwDir, { recursive: true });
  const store = new PodStore(new Database(':memory:'));
  store.ensurePod({ id: 'pod_1', projectDir: root, name: 'Project', now });
  store.enqueueGoal({ id: 'podgoal_1', podId: 'pod_1', goalId: 'g1', now });
  store.setGoalStatus('podgoal_1', 'active', { startedAt: now });
  store.createGoalRevision({
    podId: 'pod_1', goalId: 'g1', revision: 1,
    status: 'completed', verdict: 'PASS', enqueuedAt: now,
  });
  store.setActiveRevision('pod_1', 'g1', 1);
  const revisions = new PodGoalRevisionService({
    store,
    resolveMafwDir: () => mafwDir,
    now: () => now,
    resultForGoal: () => ({
      goalId: 'g1', revision: 1, verdict: 'PASS', resultReady: true,
    } as any),
  });
  return { store, revisions, root };
}

describe('review item revision carry-over', () => {
  test('unresolved items follow the next revision exactly once', async () => {
    const { store, revisions } = setup();
    const open = store.createReviewItem({
      podId: 'pod_1', goalId: 'g1', revision: 1,
      rel: 'src/a.ts', comment: '未解决', now,
    });
    const done = store.createReviewItem({
      podId: 'pod_1', goalId: 'g1', revision: 1,
      rel: 'src/b.ts', comment: '已解决', now,
    });
    store.setReviewItemStatus({
      podId: 'pod_1', goalId: 'g1', itemId: done.id,
      from: ['pending'], to: 'resolved', now,
    });

    const first = await revisions.openNextRevision('g1', '请继续', { expectedRevision: 1 });
    expect(first.opened).toBe(true);
    expect(first.revision).toBe(2);
    const rev2 = store.listReviewItems('pod_1', 'g1', 2);
    expect(rev2).toHaveLength(1);
    expect(rev2[0]).toMatchObject({
      status: 'pending', comment: '未解决', originItemId: open.id, originRevision: 1,
    });
    expect(store.listReviewItems('pod_1', 'g1', 1)).toHaveLength(2);

    const replay = await revisions.openNextRevision('g1', '请继续', { expectedRevision: 1 });
    expect(replay.opened).toBe(false);
    expect(store.listReviewItems('pod_1', 'g1', 2)).toHaveLength(1);
  });
});
