import {
  projectPodAttention,
  projectPodGoalStage,
  type PodGoalStageInput,
} from '../../../src/core/pod/pod-stage';

const base: PodGoalStageInput = {
  goalId: 'g1',
  goalStatus: 'active',
  terminal: false,
  nextAction: 'RUNNING_plan',
  verdict: null,
};

describe('projectPodGoalStage', () => {
  test('plan approval outranks question and is the only attention source', () => {
    const stage = projectPodGoalStage({
      ...base,
      nextAction: 'AWAIT_PLAN_APPROVAL',
      planApproval: { status: 'pending' },
      pendingQuestion: { questionId: 'q1', node: 'plan' },
    });
    expect(stage).toMatchObject({ owner: 'person', kind: 'plan_approval' });
    expect(projectPodAttention([{ goalId: 'g1', title: 'Fix Pod', stage }])).toEqual([
      {
        id: 'g1:plan_approval',
        goalId: 'g1',
        kind: 'plan_approval',
        title: 'Fix Pod',
        action: { type: 'open_plan_review', goalId: 'g1' },
      },
    ]);
  });

  test('pending question is person attention with question id', () => {
    const stage = projectPodGoalStage({
      ...base,
      nextAction: 'WAIT_USER_ANSWER',
      pendingQuestion: { questionId: 'q1', node: 'execute' },
    });
    expect(stage).toMatchObject({ owner: 'person', kind: 'question' });
    expect(projectPodAttention([{ goalId: 'g1', title: 'Fix Pod', stage }])[0].action).toEqual({
      type: 'open_question',
      goalId: 'g1',
      questionId: 'q1',
    });
  });

  test('reviewer review is team working, never person', () => {
    expect(projectPodGoalStage({
      ...base,
      nextAction: 'RUNNING_review',
      nodeSession: { id: 's1', phase: 'review' },
    })).toMatchObject({ owner: 'team', kind: 'working' });
  });

  test('terminal verdicts remain distinct and never claim success', () => {
    for (const verdict of ['PASS', 'FAIL', 'MAX_RETRIES', 'ERROR', 'CANCELLED'] as const) {
      const stage = projectPodGoalStage({
        ...base,
        goalStatus: 'done',
        terminal: true,
        nextAction: verdict === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
        verdict,
      });
      expect(stage).toMatchObject({ owner: 'system', kind: 'ended' });
      expect(stage.action).toEqual({ type: 'open_result', goalId: 'g1' });
    }
    expect(projectPodAttention([{ goalId: 'g1', title: 'Fix Pod', stage: projectPodGoalStage({ ...base, terminal: true, goalStatus: 'done', verdict: 'FAIL', nextAction: 'FAILED' }) }])).toEqual([]);
  });

  test('queue reasons are explicit and state errors are person/blocked', () => {
    expect(projectPodGoalStage({
      ...base,
      goalStatus: 'queued',
      nextAction: 'NEXT_plan',
      queueReason: 'paused',
    })).toMatchObject({ owner: 'team', kind: 'queued', queueReason: 'paused' });
    expect(projectPodGoalStage({
      ...base,
      nextAction: 'RUNNING_plan',
      stateMissing: true,
    })).toMatchObject({ owner: 'person', kind: 'blocked' });
  });

  test('a paused Pod with a live node is still team-working', () => {
    expect(projectPodGoalStage({
      ...base,
      queueReason: 'paused',
      nodeSession: { id: 's1', phase: 'execute' },
    })).toMatchObject({ owner: 'team', kind: 'working' })
  })

  test('state_error queue reason is person-blocked, not a fabricated queue', () => {
    expect(projectPodGoalStage({
      ...base,
      goalStatus: 'queued',
      queueReason: 'state_error',
    })).toMatchObject({ owner: 'person', kind: 'blocked' })
  })

  test('an active goal with no node is waiting without inventing a person action', () => {
    expect(projectPodGoalStage({
      ...base,
      goalStatus: 'active',
      nextAction: 'NEXT_plan',
    })).toMatchObject({ owner: 'team', kind: 'working' });
  });
});
