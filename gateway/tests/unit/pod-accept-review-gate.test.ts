import Database from 'better-sqlite3';
import { PodGoalService } from '../../src/core/pod/pod-goal-service';
import { PodError, PodStore } from '../../src/core/pod/pod-store';
import type { PodGoalResult } from '../../src/core/pod/pod-result';

const now = '2026-11-11T00:00:00.000Z';

function createHarness(unresolved: Array<{ id: string }>) {
  const store = new PodStore(new Database(':memory:'));
  store.ensurePod({ id: 'pod_1', projectDir: '/tmp/project', name: 'Project', now });
  store.enqueueGoal({ id: 'podgoal_1', podId: 'pod_1', goalId: 'g1', now });
  store.setGoalStatus('podgoal_1', 'active', { startedAt: now });
  store.createGoalRevision({
    podId: 'pod_1', goalId: 'g1', revision: 1,
    status: 'completed', verdict: 'PASS', enqueuedAt: now,
  });
  store.setActiveRevision('pod_1', 'g1', 1);

  const result: PodGoalResult = {
    goalId: 'g1', revision: 1, verdict: 'PASS', resultReady: true,
    reviewed: true, assessment: 'reviewed', goalAcceptance: [],
    goalConditions: [], goalResults: [], goalEvalValid: true,
    tasks: [], reviewFeedback: 'ok', receipt: null, artifacts: [],
    acceptance: 'pending',
    worktree: {
      dir: '/tmp/wt', branch: 'b', baseBranch: 'main',
      status: 'active', mergeCommit: null, mergedAt: null,
    },
  };
  let recorded: any = null;
  const service = new PodGoalService({
    store,
    pods: { get: () => ({ pod: { id: 'pod_1' } }) } as any,
    startGoal: async () => {},
    resolveProjectDir: () => '/tmp/project',
    now: () => now,
    newId: () => 'id_1',
    notify: () => {},
    resultForGoal: () => result,
    worktrees: {
      get: () => ({ status: 'active' }),
      mergeForAcceptance: async () => ({ branch: 'b', mergeCommit: 'abc1234', mergedAt: now }),
    } as any,
    reviews: {
      unresolved: () => unresolved,
      recordAcceptance: (input: any) => {
        recorded = {
          ...input,
          id: 'accept_1',
          actorKind: 'human',
          acceptedAt: now,
          unresolvedItemIds: input.unresolvedItemIds,
        };
        return recorded;
      },
      acceptance: () => (recorded
        ? { ...recorded, unresolvedItemIds: recorded.unresolvedItemIds }
        : null),
    },
  });
  return { service, getRecorded: () => recorded };
}

describe('goal acceptance review gate', () => {
  test('accepts normally when nothing is unresolved', async () => {
    const { service, getRecorded } = createHarness([]);
    const accepted = await service.acceptResult('pod_1', 'g1', { revision: 1 });
    expect(accepted.forced).toBe(false);
    expect(accepted.unresolvedReviewItemIds).toEqual([]);
    expect(getRecorded()).toMatchObject({ forced: false, unresolvedItemIds: [] });
  });

  test('unresolved items block acceptance unless risk is acknowledged', async () => {
    const { service, getRecorded } = createHarness([{ id: 'review_1' }, { id: 'review_2' }]);
    await expect(service.acceptResult('pod_1', 'g1', { revision: 1 }))
      .rejects.toMatchObject({ status: 409 });
    await expect(service.acceptResult('pod_1', 'g1', { revision: 1, force: true }))
      .rejects.toMatchObject({ status: 400 });
    expect(getRecorded()).toBeNull();

    const accepted = await service.acceptResult('pod_1', 'g1', {
      revision: 1, force: true, riskAcknowledged: true,
    });
    expect(accepted.forced).toBe(true);
    expect(accepted.unresolvedReviewItemIds).toEqual(['review_1', 'review_2']);
    expect(getRecorded()).toMatchObject({
      forced: true, riskAcknowledged: true, unresolvedItemIds: ['review_1', 'review_2'],
    });
    expect(service.result('pod_1', 'g1').acceptanceRecord).toMatchObject({
      forced: true, acceptedAt: now, unresolvedReviewItemIds: ['review_1', 'review_2'],
    });
  });

  test('the agent-only refusal still applies before the review gate', async () => {
    const { service } = createHarness([{ id: 'review_1' }]);
    // acceptResult has no actor parameter; the route guard is covered separately.
    await expect(service.acceptResult('pod_1', 'g1', { force: true, riskAcknowledged: true }))
      .resolves.toMatchObject({ forced: true });
  });
});
