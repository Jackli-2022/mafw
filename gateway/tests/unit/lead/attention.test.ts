import { buildPodGoalView, type PodGoalDescription } from '../../../src/core/pod/pod-view';
import type { PodGoalRow } from '../../../src/core/pod/pod-store';
import { deriveAttention } from '../../../src/core/lead/attention';

const NOW = '2026-11-10T00:00:00.000Z';

const row = (goalId: string, over: Partial<PodGoalRow> = {}): PodGoalRow => ({
  id: `row-${goalId}`,
  podId: 'pod_1',
  goalId,
  status: 'active',
  verdict: null,
  activeRevision: 1,
  enqueuedAt: NOW,
  startedAt: NOW,
  endedAt: null,
  ...over,
});

const desc = (over: Partial<PodGoalDescription> = {}): PodGoalDescription => ({
  title: 'Goal',
  phase: 'EXECUTING',
  nextAction: 'RUNNING_execute',
  terminal: false,
  verdict: null,
  hasResultEvidence: false,
  planApproval: null,
  pendingQuestion: null,
  nodeSession: { id: 's1' },
  lastError: null,
  ...over,
});

const view = (goalId: string, rowOver: Partial<PodGoalRow>, descOver: Partial<PodGoalDescription> = {}) =>
  buildPodGoalView(row(goalId, rowOver), desc(descOver), undefined);

describe('deriveAttention', () => {
  test('derives plan approval, question, direction and blocked from real views', () => {
    const items = deriveAttention([
      view('plan', {}, { planApproval: { status: 'pending' } }),
      view('question', {}, { pendingQuestion: { questionId: 'q1', node: 'execute' } }),
      view('direction', {}, {
        nodeSession: null,
        nextAction: '',
        revisionStatus: 'direction_review',
        directionStatus: 'pending',
      }),
      buildPodGoalView(
        row('state-error'),
        desc({ nodeSession: null, nextAction: '' }),
        'state_error',
      ),
      view('missing', {}, { nodeSession: null, nextAction: '', stateMissing: true }),
    ]);

    expect(items.map((item) => `${item.goalId}:${item.kind}`)).toEqual([
      'plan:plan_approval',
      'direction:direction_review',
      'question:answer',
      'state-error:blocked',
    ]);
  });

  test('result-ready review is reachable after the goal ends', () => {
    const items = deriveAttention([
      view('ready', {
        status: 'done',
        endedAt: '2026-11-10T01:00:00.000Z',
        verdict: 'PASS',
      }, {
        terminal: true,
        verdict: 'PASS',
        hasResultEvidence: true,
        nextAction: 'COMPLETED',
        nodeSession: null,
      }),
      view('accepted', {
        status: 'done',
        endedAt: '2026-11-10T01:00:00.000Z',
        verdict: 'PASS',
      }, {
        terminal: true,
        verdict: 'PASS',
        hasResultEvidence: true,
        accepted: true,
        nextAction: 'COMPLETED',
        nodeSession: null,
      }),
    ]);

    expect(items.map((item) => `${item.goalId}:${item.kind}`)).toEqual(['ready:review']);
    expect(items[0].action.type).toBe('open_result');
  });

  test('failed derives from lastError even when the stage is team-owned', () => {
    const items = deriveAttention([
      view('failed', {}, { lastError: 'worktree_unavailable' }),
      view('healthy', {}, { lastError: null }),
    ]);

    expect(items.map((item) => `${item.goalId}:${item.kind}`)).toEqual(['failed:failed']);
  });

  test('coalesces same goal+kind and sorts by priority', () => {
    const items = deriveAttention([
      view('plan', {}, { planApproval: { status: 'pending' } }),
      view('plan', {}, { planApproval: { status: 'pending' } }),
      view('failed', {}, { lastError: 'boom' }),
    ]);

    expect(items.map((item) => item.goalId)).toEqual(['plan', 'failed']);
    expect(items.map((item) => item.priority)).toEqual([100, 60]);
    expect(items.every((item) => item.coalesceKey.includes(item.goalId))).toBe(true);
  });
});
