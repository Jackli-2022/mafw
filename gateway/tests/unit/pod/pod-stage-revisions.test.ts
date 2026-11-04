import {
  projectPodAttention,
  projectPodGoalStage,
  type PodGoalRevisionSummary,
  type PodGoalStageInput,
} from '../../../src/core/pod/pod-stage';

type DirectionStatus = 'none' | 'pending' | 'decided';

/** 当前 revision 的投影（Task 3 行的子集）；status 是阶段，directionStatus 是裁定状态。 */
function rev(
  status: PodGoalRevisionSummary['status'],
  directionStatus?: DirectionStatus,
): PodGoalRevisionSummary {
  return { revision: 2, status, ...(directionStatus ? { directionStatus } : {}) };
}

const base: PodGoalStageInput = {
  goalId: 'g1',
  goalStatus: 'active',
  terminal: false,
  nextAction: 'RUNNING_plan',
  verdict: null,
};

function stage(input: Partial<PodGoalStageInput>) {
  return projectPodGoalStage({ ...base, ...input });
}

function attention(input: Partial<PodGoalStageInput>) {
  return projectPodAttention([{ goalId: 'g1', title: 'Fix Pod', revision: 2, stage: stage(input) }]);
}

describe('projectPodGoalStage — revision aware phases', () => {
  test('a discussing revision is Tech Lead team work, never person attention', () => {
    expect(stage({ revision: rev('discussing') })).toMatchObject({
      owner: 'team',
      kind: 'discussing',
      role: 'tech_lead',
    });
    expect(attention({ revision: rev('discussing') })).toEqual([]);
  });

  test('a pending direction review is persistent person attention owned by the Tech Lead', () => {
    const input = { revision: rev('direction_review', 'pending'), direction: null };
    const projected = stage(input);
    expect(projected).toMatchObject({
      owner: 'person',
      kind: 'direction_review',
      role: 'tech_lead',
    });
    expect(projected.action).toEqual({ type: 'open_direction_review', goalId: 'g1' });
    expect(attention(input)).toEqual([
      {
        id: 'g1:direction_review:r2',
        goalId: 'g1',
        revision: 2,
        kind: 'direction_review',
        title: 'Fix Pod',
        action: { type: 'open_direction_review', goalId: 'g1' },
      },
    ]);
  });

  test('a direction review that was already decided is team planning, not a stale blocker', () => {
    expect(stage({ revision: rev('direction_review', 'decided') })).toMatchObject({
      owner: 'team',
      kind: 'planning',
      role: 'tech_lead',
    });
    expect(attention({ revision: rev('direction_review', 'decided') })).toEqual([]);
  });

  test('a direction_review row without a real pending record is not permanent attention', () => {
    // schema 缺省是 'none'：没有 DirectionReview（Task 6）就是没有阻塞。
    expect(stage({ revision: rev('direction_review', 'none') })).toMatchObject({
      owner: 'team',
      kind: 'planning',
      role: 'tech_lead',
    });
    expect(attention({ revision: rev('direction_review', 'none') })).toEqual([]);
    // 缺省 directionStatus 也一样，不得凭 status 单独臆造人类阻塞。
    expect(stage({ revision: rev('direction_review') })).toMatchObject({ owner: 'team' });
    expect(attention({ revision: rev('direction_review') })).toEqual([]);
    // 只有显式 pending（或 direction 摘要声明 pending）才是 attention。
    expect(stage({
      revision: { revision: 2, status: 'direction_review' },
      direction: { status: 'pending' },
    })).toMatchObject({ owner: 'person', kind: 'direction_review', role: 'tech_lead' });
  });

  test('planning is Tech Lead work and a running probe surfaces as builder probing', () => {
    expect(stage({ revision: rev('planning') })).toMatchObject({
      owner: 'team',
      kind: 'planning',
      role: 'tech_lead',
    });
    expect(stage({ revision: rev('planning'), probeRunning: true })).toMatchObject({
      owner: 'team',
      kind: 'probing',
      role: 'builder',
    });
  });

  test('implementing belongs to the builder and reviewing to the reviewer', () => {
    expect(stage({ revision: rev('implementing') })).toMatchObject({
      owner: 'team',
      kind: 'implementing',
      role: 'builder',
    });
    expect(stage({ revision: rev('reviewing') })).toMatchObject({
      owner: 'team',
      kind: 'reviewing',
      role: 'reviewer',
    });
  });

  test('plan review without a pending approval is Tech Lead revision, not person attention', () => {
    expect(stage({ revision: rev('plan_review'), planApproval: { status: 'approved' } })).toMatchObject({
      owner: 'team',
      kind: 'planning',
      role: 'tech_lead',
    });
    expect(attention({ revision: rev('plan_review'), planApproval: { status: 'approved' } })).toEqual([]);
    expect(stage({ revision: rev('plan_review'), planApproval: { status: 'rejected' } })).toMatchObject({
      owner: 'team',
      kind: 'planning',
      role: 'tech_lead',
    });
    // A real pending approval still outranks the revision phase and names the owner role.
    expect(stage({ revision: rev('plan_review'), planApproval: { status: 'pending' } })).toMatchObject({
      owner: 'person',
      kind: 'plan_approval',
      role: 'tech_lead',
    });
  });

  test('a submitted plan without any recorded decision is a real approval blocker', () => {
    const input = { revision: rev('plan_review') };
    expect(stage(input)).toMatchObject({ owner: 'person', kind: 'plan_approval', role: 'tech_lead' });
    expect(attention(input)).toEqual([
      expect.objectContaining({ goalId: 'g1', kind: 'plan_approval' }),
    ]);
  });

  test('a completed revision is a Lead result notification, never a fake person blocker', () => {
    const projected = stage({ revision: rev('completed') });
    expect(projected).toMatchObject({ owner: 'team', kind: 'result_notified', role: 'lead' });
    expect(projected.action).toEqual({ type: 'open_result', goalId: 'g1' });
    expect(attention({ revision: rev('completed') })).toEqual([]);
  });

  test('aborted and discarded revisions end without inventing a result', () => {
    for (const status of ['aborted', 'discarded'] as const) {
      expect(stage({ revision: rev(status) })).toMatchObject({
        owner: 'system',
        kind: 'ended',
        action: { type: 'open_result', goalId: 'g1' },
      });
    }
  });

  test('queued revisions stay queued and keep the explicit reason', () => {
    expect(stage({ goalStatus: 'queued', revision: rev('queued'), queueReason: 'paused' }))
      .toMatchObject({ owner: 'team', kind: 'queued', queueReason: 'paused' });
  });

  test('no revision phase claims person attention except direction and plan approval gates', () => {
    for (const status of ['discussing', 'planning', 'queued', 'implementing', 'reviewing', 'completed'] as const) {
      const input = { revision: rev(status) };
      expect(stage(input).owner).not.toBe('person');
      expect(attention(input)).toEqual([]);
    }
  });

  test('terminal and missing-state precedence is preserved over revision phases', () => {
    expect(stage({ goalStatus: 'done', terminal: true, verdict: 'PASS', revision: rev('implementing') }))
      .toMatchObject({ owner: 'system', kind: 'ended' });
    expect(stage({ stateMissing: true, revision: rev('reviewing') }))
      .toMatchObject({ owner: 'person', kind: 'blocked' });
  });

  test('a pending question is owned by the role of the node that asked it', () => {
    expect(stage({ pendingQuestion: { questionId: 'q1', node: 'plan' } }))
      .toMatchObject({ owner: 'person', kind: 'question', role: 'tech_lead' });
    expect(stage({ pendingQuestion: { questionId: 'q2', node: 'execute' } }))
      .toMatchObject({ owner: 'person', kind: 'question', role: 'builder' });
    expect(stage({ pendingQuestion: { questionId: 'q3', node: 'review' } }))
      .toMatchObject({ owner: 'person', kind: 'question', role: 'reviewer' });
  });

  test('legacy goals without a revision row keep the node-based working stage and role', () => {
    expect(stage({ nextAction: 'RUNNING_plan', nodeSession: { id: 's1', phase: 'plan' } }))
      .toMatchObject({ owner: 'team', kind: 'working', role: 'tech_lead' });
    expect(stage({ nextAction: 'RUNNING_execute' }))
      .toMatchObject({ owner: 'team', kind: 'working', role: 'builder' });
    expect(stage({ nextAction: 'NEXT_review' }))
      .toMatchObject({ owner: 'team', kind: 'working', role: 'reviewer' });
    expect(stage({ nextAction: 'NEXT_plan' })).toMatchObject({ owner: 'team', kind: 'working' });
  });

  test('paused pods with a live node stay team work instead of a fake pause banner', () => {
    expect(stage({ queueReason: 'paused', nodeSession: { id: 's1', phase: 'execute' } }))
      .toMatchObject({ owner: 'team', kind: 'working', role: 'builder' });
    expect(stage({ queueReason: 'paused' })).toMatchObject({
      owner: 'system',
      kind: 'waiting',
      queueReason: 'paused',
    });
  });

  test('state_error stays person blocked and carries no revision claim', () => {
    expect(stage({ goalStatus: 'queued', queueReason: 'state_error', revision: rev('discussing') }))
      .toMatchObject({ owner: 'person', kind: 'blocked' });
  });
});
