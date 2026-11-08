import { buildPodGoalView, goalVerdictFromState, type PodGoalDescription } from '../../../src/core/pod/pod-view';
import type { PodGoalRow } from '../../../src/core/pod/pod-store';

const row: PodGoalRow = {
  id: 'pg1',
  podId: 'pod_1',
  goalId: 'g1',
  status: 'active',
  verdict: null,
  activeRevision: 1,
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

describe('goalVerdictFromState', () => {
  test('never infers PASS from legacy COMPLETED without a review verdict', () => {
    expect(goalVerdictFromState({ reviewVerdict: null, nextAction: 'COMPLETED' })).toBeNull()
    expect(goalVerdictFromState({ reviewVerdict: 'PASS', nextAction: 'COMPLETED' })).toBe('PASS')
    expect(goalVerdictFromState({ reviewVerdict: null, nextAction: 'CANCELLED' })).toBe('CANCELLED')
    expect(goalVerdictFromState({ reviewVerdict: 'ERROR', nextAction: 'FAILED' })).toBe('ERROR')
    expect(goalVerdictFromState({
      reviewVerdict: 'FAIL', nextAction: 'FAILED', round: 3, maxRounds: 3,
    })).toBe('MAX_RETRIES')
  })
})

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

  test('carries real progress and explicit null without inventing counts', () => {
    const progress = { total: 5, done: 3, inProgress: 1, review: 0, failed: 1, skipped: 0 };
    expect(buildPodGoalView(row, desc, undefined, progress).progress).toEqual(progress);
    expect(buildPodGoalView(row, desc, undefined, null).progress).toBeNull();
  });

  test('carries source, strategy, assessment and assignment without inventing old metadata', () => {
    const sourceRef = {
      sessionID: 'ses_free',
      messageID: 'msg_1',
      snapshot: '按方案 B 执行',
      capturedAt: '2026-11-03T00:00:00.000Z',
    };
    const view = buildPodGoalView(row, {
      ...desc,
      revisionStatus: 'implementing',
      sourceRef,
      strategy: 'quick',
      assessment: 'unreviewed',
      currentAssignment: {
        assignmentId: 'asg_123',
        role: 'builder',
        taskIds: ['w1-t1'],
        attempt: 1,
      },
    }, undefined);
    expect(view).toMatchObject({
      sourceRef,
      strategy: 'quick',
      assessment: 'unreviewed',
      currentAssignment: { assignmentId: 'asg_123', attempt: 1 },
      bucket: 'in_progress',
    });

    expect(buildPodGoalView(row, desc, undefined)).toMatchObject({
      sourceRef: null,
      strategy: null,
      assessment: null,
      currentAssignment: null,
      bucket: 'in_progress',
    });
  });

  test('exposes the driver pendingQuestion (id + node + question text) on the view', () => {
    const pendingQuestion = {
      questionId: 'q_1700000000000_ab12_ok',
      node: 'plan' as const,
      questions: ['登录先走 SSO 还是密码？', '需要保留旧的登录方式吗？'],
    };
    const view = buildPodGoalView(row, { ...desc, pendingQuestion }, undefined);
    expect(view.pendingQuestion).toEqual(pendingQuestion);
    // stage 与正文同源：attention 落点仍用同一个 questionId。
    expect(view.stage).toMatchObject({
      kind: 'question',
      action: { type: 'open_question', questionId: pendingQuestion.questionId },
    });

    // 没有待答问题时显式 null，绝不发一个空壳对象。
    expect(buildPodGoalView(row, desc, undefined).pendingQuestion).toBeNull();
    expect(buildPodGoalView(row, null, undefined).pendingQuestion).toBeNull();
  });

  test('a discussing Goal without state is work in progress, not ended', () => {
    const view = buildPodGoalView(row, {
      ...desc,
      revision: 1,
      revisionStatus: 'discussing',
      stateMissing: true,
      phase: null,
      nextAction: '',
    }, undefined);
    expect(view.stage).toMatchObject({ kind: 'discussing' });
    expect(view.bucket).toBe('in_progress');
  });

  test('missing description falls back to the id only as folded title and reports blocked', () => {
    expect(buildPodGoalView(row, null, undefined)).toMatchObject({
      title: '未命名目标',
      stage: { owner: 'person', kind: 'blocked' },
    });
  });

  test('queued view carries an explicit reason and no fake work title', () => {
    const queued: PodGoalRow = { ...row, status: 'queued', startedAt: null, endedAt: null };
    expect(buildPodGoalView(queued, { ...desc, title: 'Queued goal', nodeSession: null }, 'active_goal'))
      .toMatchObject({ title: 'Queued goal', stage: { kind: 'queued', queueReason: 'active_goal' } });
  });

  test('a request-only queued goal keeps its intake title and stays queued', () => {
    const queued: PodGoalRow = { ...row, status: 'queued', startedAt: null, endedAt: null };
    const intakeOnly: PodGoalDescription = {
      ...desc, title: 'Intake title', phase: null, nextAction: '', nodeSession: null, stateMissing: true,
    };
    expect(buildPodGoalView(queued, intakeOnly, 'paused'))
      .toMatchObject({ title: 'Intake title', stage: { kind: 'queued', queueReason: 'paused' } });
    expect(buildPodGoalView(row, intakeOnly, undefined))
      .toMatchObject({ title: 'Intake title', stage: { kind: 'blocked' } });
  });
});
