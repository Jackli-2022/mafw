import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodGoalService } from '../../../src/core/pod/pod-goal-service';
import {
  REJECT_REVISION_PRIORITY,
  PodGoalRevisionService,
} from '../../../src/core/pod/pod-goal-revision-service';
import { PodDirectionService } from '../../../src/core/pod/pod-direction-service';
import type { PodGoalDescription } from '../../../src/core/pod/pod-view';
import type { PodGoalResult } from '../../../src/core/pod/pod-result';
import { ensureGoalState, writeGoalState } from '../../../src/core/goal/state-v3';

const NOW = '2026-11-02T00:00:00.000Z';
const LATER = '2026-11-02T00:15:00.000Z';

function goalResult(goalId: string): PodGoalResult {
  return {
    goalId,
    revision: 1,
    verdict: 'PASS',
    resultReady: true,
    goalAcceptance: [],
    goalConditions: [],
    goalResults: [],
    goalEvalValid: true,
    failure: null,
    tasks: [],
    reviewFeedback: 'all conditions met',
    receipt: null,
    artifacts: [],
  };
}

describe('PodGoal revision priority', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let mafwDir: string;
  let result: PodGoalResult | null;
  let service: PodGoalService;

  const collectResult = (row: { goalId: string; revision: number; priority: number }) =>
    `${row.goalId}#${row.revision}:p${row.priority}`;

  const describeGoal = (goalId: string): PodGoalDescription => {
    const row = store.getGoalByGoalId(goalId);
    return {
      title: goalId,
      phase: 'COMPLETED',
      nextAction: 'COMPLETED',
      terminal: false,
      verdict: 'PASS',
      hasResultEvidence: true,
      planApproval: null,
      pendingQuestion: null,
      nodeSession: null,
      lastError: null,
      revision: row?.activeRevision ?? 1,
    };
  };

  const seedArchivedGoal = (goalId: string) => {
    const row = store.enqueueGoal({ id: `pg_${goalId}`, podId: 'pod_1', goalId, now: NOW });
    store.setGoalStatus(row.id, 'done', { startedAt: NOW, endedAt: NOW, verdict: 'PASS' });
    store.createGoalRevision({
      podId: 'pod_1',
      goalId,
      revision: 1,
      status: 'completed',
      verdict: 'PASS',
      endedAt: NOW,
      now: NOW,
    });
    ensureGoalState(mafwDir, goalId, { revision: 1, projectDir: '/proj/a', maxRounds: 3 });
    writeGoalState(mafwDir, goalId, {
      nextAction: 'COMPLETED',
      phase: 'COMPLETED',
      reviewVerdict: 'PASS',
    });
  };

  const seedQueuedGoal = (goalId: string, priority = 0) => {
    store.enqueueGoal({ id: `pg_${goalId}`, podId: 'pod_1', goalId, now: NOW });
    store.createGoalRevision({
      podId: 'pod_1',
      goalId,
      revision: 1,
      status: 'queued',
      priority,
      now: NOW,
    });
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-priority-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    mafwDir = path.join(dir, 'mafw');
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: NOW });
    result = null;

    const revisions = new PodGoalRevisionService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => LATER,
      resultForGoal: () => result,
    });
    const directions = new PodDirectionService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => LATER,
      newId: () => `dirreq_${Math.random().toString(16).slice(2, 8)}`,
    });
    service = new PodGoalService({
      store,
      pods: { ensure: jest.fn() } as any,
      startGoal: jest.fn(async () => {}),
      resolveProjectDir: () => '/proj/a',
      now: () => LATER,
      newId: () => `pg_${Math.random().toString(36).slice(2, 8)}`,
      notify: () => {},
      describeGoal: (goalId) => describeGoal(goalId),
      resultForGoal: () => result,
      revisions,
      techLead: { ensureSession: async () => 'sess_tl' },
      directions: directions as any,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a rejected revision outranks ordinary queued revisions', async () => {
    seedArchivedGoal('g1');
    seedQueuedGoal('g2');
    result = goalResult('g1');

    await service.rejectResult('pod_1', 'g1', '方向不对，重新讨论');

    expect(store.listQueuedGoalRevisions('pod_1').map(collectResult))
      .toEqual([`g1#2:p${REJECT_REVISION_PRIORITY}`, 'g2#1:p0']);
    expect(service.views('pod_1').find((view) => view.goalId === 'g1')?.priority)
      .toBe(REJECT_REVISION_PRIORITY);
  });

  test('the reopened goal becomes the pod active goal again when the pod is idle', async () => {
    seedArchivedGoal('g1');
    result = goalResult('g1');

    await service.rejectResult('pod_1', 'g1', '再讨论一次');

    expect(store.getGoal('pod_1', 'g1')).toMatchObject({
      status: 'active',
      activeRevision: 2,
      verdict: null,
      endedAt: null,
      priority: REJECT_REVISION_PRIORITY,
    });
    expect(store.getPod('pod_1')).toMatchObject({ status: 'active', activeGoalId: 'g1' });
    expect(store.getActiveGoal('pod_1')?.goalId).toBe('g1');
  });

  test('a reject never evicts another goal that is already running', async () => {
    seedArchivedGoal('g1');
    const g2 = store.enqueueGoal({ id: 'pg_g2', podId: 'pod_1', goalId: 'g2', now: NOW });
    store.setGoalStatus(g2.id, 'active', { startedAt: NOW });
    store.createGoalRevision({
      podId: 'pod_1',
      goalId: 'g2',
      revision: 1,
      status: 'implementing',
      now: NOW,
    });
    store.updatePod('pod_1', { status: 'active', activeGoalId: 'g2' }, NOW);
    result = goalResult('g1');

    await service.rejectResult('pod_1', 'g1', '方向不对');

    // 同一 Goal 继续，但不抢占另一个 Goal 正在运行的节点（spec §8.3）。
    expect(store.getGoal('pod_1', 'g1')).toMatchObject({
      status: 'queued',
      activeRevision: 2,
      priority: REJECT_REVISION_PRIORITY,
    });
    expect(store.getPod('pod_1').activeGoalId).toBe('g2');
    expect(store.getActiveGoal('pod_1')?.goalId).toBe('g2');
    expect(store.getGoalRevision('pod_1', 'g2', 1)).toMatchObject({ status: 'implementing' });
  });

  test('queue ordering is priority first, then enqueue time; plain discussions stay out', () => {
    store.enqueueGoal({ id: 'pg_g1', podId: 'pod_1', goalId: 'g1', now: NOW });
    store.enqueueGoal({ id: 'pg_g2', podId: 'pod_1', goalId: 'g2', now: NOW });
    store.enqueueGoal({ id: 'pg_g3', podId: 'pod_1', goalId: 'g3', now: NOW });
    store.enqueueGoal({ id: 'pg_g4', podId: 'pod_1', goalId: 'g4', now: NOW });

    // 打回后的 revision 在 discussing 阶段就带优先级（Tech Lead 讨论不占实施槽）。
    store.createGoalRevision({
      podId: 'pod_1', goalId: 'g1', revision: 2, status: 'discussing',
      priority: REJECT_REVISION_PRIORITY, now: NOW, enqueuedAt: LATER,
    });
    store.createGoalRevision({
      podId: 'pod_1', goalId: 'g2', revision: 1, status: 'queued', priority: 3, now: NOW,
    });
    store.createGoalRevision({
      podId: 'pod_1', goalId: 'g3', revision: 1, status: 'queued', priority: 3, now: NOW,
      enqueuedAt: LATER,
    });
    // 普通讨论中的 revision 没有优先级 → 不在调度队列里。
    store.createGoalRevision({
      podId: 'pod_1', goalId: 'g4', revision: 1, status: 'discussing', priority: 0, now: NOW,
    });

    expect(store.listQueuedGoalRevisions('pod_1').map(collectResult))
      .toEqual([`g1#2:p${REJECT_REVISION_PRIORITY}`, 'g2#1:p3', 'g3#1:p3']);
  });

  test('revision priority ordering is per pod', async () => {
    store.ensurePod({ id: 'pod_2', projectDir: '/proj/b', name: 'B', now: NOW });
    seedArchivedGoal('g1');
    result = goalResult('g1');

    await service.rejectResult('pod_1', 'g1', '方向不对');

    expect(store.listQueuedGoalRevisions('pod_1')).toHaveLength(1);
    expect(store.listQueuedGoalRevisions('pod_2')).toEqual([]);
  });
});
