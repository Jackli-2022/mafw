import { buildPodGoalView, type PodGoalDescription } from '../../../src/core/pod/pod-view';
import type { PodGoalRow } from '../../../src/core/pod/pod-store';

const row: PodGoalRow = {
  id: 'pg1',
  podId: 'pod_1',
  goalId: 'g1',
  status: 'active',
  verdict: null,
  enqueuedAt: '2026-11-02T00:00:00.000Z',
  startedAt: '2026-11-02T00:01:00.000Z',
  endedAt: null,
};

const desc: PodGoalDescription = {
  title: 'Fix Pod',
  phase: 'PLANNING',
  nextAction: 'RUNNING_plan',
  terminal: false,
  verdict: null,
  hasResultEvidence: false,
  planApproval: null,
  pendingQuestion: null,
  nodeSession: { id: 's1' },
  lastError: null,
};

describe('buildPodGoalView', () => {
  test('legacy row without verdict remains ended; resultReady requires evidence', () => {
    const legacyRow: PodGoalRow = { ...row, status: 'done', endedAt: '2026-11-02T00:02:00.000Z' };
    const legacyDesc = { ...desc, terminal: true, nextAction: 'COMPLETED', phase: 'ARCHIVED' };
    expect(buildPodGoalView(legacyRow, { ...legacyDesc, hasResultEvidence: false }, undefined))
      .toMatchObject({ verdict: null, stage: { kind: 'ended' }, resultReady: false });
    expect(buildPodGoalView(legacyRow, { ...legacyDesc, hasResultEvidence: true }, undefined).resultReady).toBe(true);
  });

  test('uses the persisted verdict rather than guessing PASS', () => {
    const ended: PodGoalRow = { ...row, status: 'done', verdict: 'MAX_RETRIES', endedAt: '2026-11-02T00:02:00.000Z' };
    const view = buildPodGoalView(ended, { ...desc, terminal: true, verdict: 'MAX_RETRIES', hasResultEvidence: true }, undefined);
    expect(view).toMatchObject({ verdict: 'MAX_RETRIES', resultReady: true, stage: { kind: 'ended' } });
  });

  test('missing description falls back to the id only as folded title and reports blocked', () => {
    expect(buildPodGoalView(row, null, undefined)).toMatchObject({
      title: 'g1',
      stage: { owner: 'person', kind: 'blocked' },
    });
  });

  test('queued view carries an explicit reason and no fake work title', () => {
    const queued: PodGoalRow = { ...row, status: 'queued', startedAt: null, endedAt: null };
    expect(buildPodGoalView(queued, { ...desc, title: 'Queued goal', nodeSession: null }, 'active_goal'))
      .toMatchObject({ title: 'Queued goal', stage: { kind: 'queued', queueReason: 'active_goal' } });
  });
});
