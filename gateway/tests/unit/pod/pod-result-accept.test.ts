import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodGoalService } from '../../../src/core/pod/pod-goal-service';
import type { PodGoalResult } from '../../../src/core/pod/pod-result';
import type { PodGoalWorktreeRow } from '../../../src/core/pod/pod-store';

const NOW = '2026-11-09T00:00:00.000Z';

function makeResult(verdict: 'PASS' | 'FAIL' | null, patch: Partial<PodGoalResult> = {}): PodGoalResult {
  return {
    goalId: 'g1',
    revision: 1,
    verdict,
    resultReady: true,
    reviewed: verdict === 'PASS',
    assessment: verdict === 'PASS' ? 'reviewed' : null,
    goalAcceptance: [],
    goalConditions: [],
    goalResults: [],
    goalEvalValid: true,
    failure: null,
    tasks: [],
    reviewFeedback: '',
    receipt: null,
    artifacts: [],
    ...patch,
  };
}

function worktree(status: PodGoalWorktreeRow['status'] = 'active'): PodGoalWorktreeRow {
  return {
    podId: 'pod_1',
    goalId: 'g1',
    revision: 1,
    dir: '/tmp/repo-wt-g1-r1',
    branch: 'mafw/g1-r1',
    baseRef: 'main',
    baseBranch: 'main',
    status,
    mergeCommit: status === 'merged' ? 'abc123' : null,
    createdAt: NOW,
    updatedAt: NOW,
    mergedAt: status === 'merged' ? NOW : null,
  };
}

describe('Pod result acceptance', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let result: PodGoalResult;
  let wt: PodGoalWorktreeRow | null;
  let worktrees: {
    get: jest.Mock;
    ensure: jest.Mock;
    commitPending: jest.Mock;
    mergeForAcceptance: jest.Mock;
    markAbandoned: jest.Mock;
  };
  let revisions: {
    finishRevision: jest.Mock;
    reopenAfterReject: jest.Mock;
  };
  let service: PodGoalService;

  function seed(): void {
    const row = store.enqueueGoal({ id: 'pg_g1', podId: 'pod_1', goalId: 'g1', now: NOW });
    store.setGoalStatus(row.id, 'done', { startedAt: NOW, endedAt: NOW, verdict: 'PASS' });
    store.createGoalRevision({
      podId: 'pod_1', goalId: 'g1', revision: 1, status: 'completed',
      verdict: 'PASS', endedAt: NOW, now: NOW,
    });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-accept-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'A', now: NOW });
    result = makeResult('PASS');
    wt = worktree();
    worktrees = {
      get: jest.fn(() => wt),
      ensure: jest.fn(async () => wt ?? worktree()),
      commitPending: jest.fn(async () => ({ commit: null })),
      mergeForAcceptance: jest.fn(async () => ({
        branch: 'mafw/g1-r1',
        mergeCommit: 'abc123',
        mergedAt: NOW,
      })),
      markAbandoned: jest.fn(),
    };
    revisions = {
      finishRevision: jest.fn(),
      reopenAfterReject: jest.fn(async () => ({
        opened: true,
        podId: 'pod_1',
        goalId: 'g1',
        revision: 2,
        status: 'discussing',
        priority: 10,
        archivedState: null,
        previous: null,
      })),
    };
    service = new PodGoalService({
      store,
      pods: { ensure: jest.fn() } as any,
      startGoal: jest.fn(async () => {}),
      resolveProjectDir: () => '/proj/a',
      now: () => NOW,
      newId: () => 'pg_x',
      notify: jest.fn(),
      describeGoal: () => ({
        title: 'Ship it', phase: 'COMPLETED', nextAction: 'COMPLETED', terminal: true,
        verdict: 'PASS', hasResultEvidence: true, nodeSession: null, lastError: null,
        accepted: (wt?.status ?? null) === 'merged',
      }),
      resultForGoal: () => result,
      revisions: revisions as any,
      worktrees: worktrees as any,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('PASS result exposes a pending worktree and acceptance', () => {
    seed();
    const out = service.result('pod_1', 'g1');
    expect(out.acceptance).toBe('pending');
    expect(out.worktree).toMatchObject({
      branch: 'mafw/g1-r1', baseBranch: 'main', status: 'active', mergeCommit: null,
    });
  });

  test('FAIL result is unavailable for acceptance', () => {
    seed();
    result = makeResult('FAIL');
    const out = service.result('pod_1', 'g1');
    expect(out.acceptance).toBe('unavailable');
  });

  test('acceptResult merges the active PASS revision', async () => {
    seed();
    const out = await service.acceptResult('pod_1', 'g1');
    expect(out).toMatchObject({ revision: 1, branch: 'mafw/g1-r1', mergeCommit: 'abc123' });
    expect(worktrees.mergeForAcceptance).toHaveBeenCalledWith('pod_1', 'g1', 1);
  });

  test('acceptResult rejects failed or missing results', async () => {
    seed();
    result = makeResult('FAIL');
    await expect(service.acceptResult('pod_1', 'g1')).rejects.toMatchObject({ status: 409 });
    result = makeResult('PASS', { resultReady: false });
    await expect(service.acceptResult('pod_1', 'g1')).rejects.toMatchObject({ status: 409 });
  });

  test('acceptResult rejects a non-active revision', async () => {
    seed();
    store.createGoalRevision({
      podId: 'pod_1', goalId: 'g1', revision: 2, status: 'completed',
      verdict: 'PASS', endedAt: NOW, now: NOW,
    });
    store.setActiveRevision('pod_1', 'g1', 2);
    await expect(service.acceptResult('pod_1', 'g1', { revision: 1 }))
      .rejects.toMatchObject({ status: 409 });
  });

  test('repeat acceptance is idempotent when the worktree is already merged', async () => {
    seed();
    wt = worktree('merged');
    const out = await service.acceptResult('pod_1', 'g1');
    expect(out.mergeCommit).toBe('abc123');
    expect(worktrees.mergeForAcceptance).toHaveBeenCalledWith('pod_1', 'g1', 1);
  });

  test('accepted goal moves from result_ready to ended', () => {
    seed();
    wt = worktree('merged');
    expect(service.views('pod_1')[0]).toMatchObject({ bucket: 'ended', accepted: true });
  });

  test('reject commits the worktree before opening the next revision', async () => {
    seed();
    const order: string[] = [];
    worktrees.commitPending.mockImplementation(async () => { order.push('commit'); return { commit: 'c1' }; });
    revisions.reopenAfterReject.mockImplementation(async () => {
      order.push('reopen');
      return {
        opened: true, podId: 'pod_1', goalId: 'g1', revision: 2,
        status: 'discussing', priority: 10, archivedState: null, previous: null,
      };
    });
    await service.rejectResult('pod_1', 'g1', 'next revision');
    expect(order).toEqual(['commit', 'reopen']);
    expect(worktrees.markAbandoned).toHaveBeenCalledWith('pod_1', 'g1', 1);
  });

  test('merged revision cannot be rejected', async () => {
    seed();
    wt = worktree('merged');
    await expect(service.rejectResult('pod_1', 'g1', 'no'))
      .rejects.toMatchObject({ status: 409 });
    expect(worktrees.commitPending).not.toHaveBeenCalled();
  });

  test('accept and reject are serialized per goal', async () => {
    seed();
    store.insertGoalWorktree({
      podId: 'pod_1', goalId: 'g1', revision: 1,
      dir: '/tmp/repo-wt-g1-r1', branch: 'mafw/g1-r1',
      baseRef: 'main', baseBranch: 'main', status: 'active', now: NOW,
    });
    worktrees.get.mockImplementation((podId: string, goalId: string, revision: number) =>
      store.getGoalWorktree(podId, goalId, revision));
    let releaseMerge!: () => void;
    const mergeGate = new Promise<void>((resolve) => { releaseMerge = resolve; });
    worktrees.mergeForAcceptance.mockImplementation(async () => {
      await mergeGate;
      store.updateGoalWorktree({
        podId: 'pod_1', goalId: 'g1', revision: 1,
        status: 'merged', mergeCommit: 'abc123', mergedAt: NOW, now: NOW,
      });
      return { branch: 'mafw/g1-r1', mergeCommit: 'abc123', mergedAt: NOW };
    });

    const acceptPromise = service.acceptResult('pod_1', 'g1');
    await Promise.resolve();
    const rejectPromise = service.rejectResult('pod_1', 'g1', 'too late');
    await Promise.resolve();
    // The queued reject must not even start its commit while acceptance merges.
    expect(worktrees.commitPending).not.toHaveBeenCalled();
    releaseMerge();

    await expect(acceptPromise).resolves.toMatchObject({ mergeCommit: 'abc123' });
    await expect(rejectPromise).rejects.toMatchObject({ status: 409 });
    expect(revisions.reopenAfterReject).not.toHaveBeenCalled();
  });
});
