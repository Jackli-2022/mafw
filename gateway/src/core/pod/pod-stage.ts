// gateway/src/core/pod/pod-stage.ts
// Pure Goal stage projection: the server is the only place that decides what
// the Pod UI may claim about a Goal. No fs, no clock, no model judgement.

export type PodGoalVerdict = 'PASS' | 'FAIL' | 'MAX_RETRIES' | 'ERROR' | 'CANCELLED';
export type PodQueueReason = 'active_goal' | 'paused' | 'archived' | 'budget' | 'state_error';
export type PodGoalStageOwner = 'person' | 'team' | 'system';
export type PodGoalStageKind =
  | 'plan_approval'
  | 'question'
  | 'blocked'
  | 'queued'
  | 'working'
  | 'waiting'
  | 'ended';

export interface PodGoalStage {
  owner: PodGoalStageOwner;
  kind: PodGoalStageKind;
  queueReason?: PodQueueReason;
  action?: {
    type: 'open_plan_review' | 'open_question' | 'open_goal' | 'open_result';
    goalId: string;
    questionId?: string;
  };
}

export interface PodGoalStageInput {
  goalId: string;
  goalStatus: 'queued' | 'active' | 'done' | 'aborted';
  terminal: boolean;
  nextAction: string;
  verdict: PodGoalVerdict | null;
  planApproval?: { status: 'pending' | 'approved' | 'rejected' } | null;
  pendingQuestion?: { questionId: string; node: 'plan' | 'execute' | 'review' } | null;
  nodeSession?: unknown | null;
  stateMissing?: boolean;
  queueReason?: PodQueueReason;
}

export interface PodAttentionItem {
  id: string;
  goalId: string;
  kind: 'plan_approval' | 'question' | 'blocked';
  title: string;
  action: NonNullable<PodGoalStage['action']>;
}

export function projectPodGoalStage(input: PodGoalStageInput): PodGoalStage {
  const action = (type: NonNullable<PodGoalStage['action']>['type']) => ({
    type,
    goalId: input.goalId,
  });

  // Terminal results always win. The verdict is carried by the Goal view; this
  // stage only says the Goal cannot advance and where its result lives.
  if (input.terminal || input.goalStatus === 'done' || input.goalStatus === 'aborted') {
    return {
      owner: 'system',
      kind: 'ended',
      action: action('open_result'),
    };
  }

  if (input.stateMissing) {
    return {
      owner: 'person',
      kind: 'blocked',
      action: action('open_goal'),
    };
  }

  if (input.planApproval?.status === 'pending') {
    return {
      owner: 'person',
      kind: 'plan_approval',
      action: action('open_plan_review'),
    };
  }

  if (input.pendingQuestion) {
    return {
      owner: 'person',
      kind: 'question',
      action: {
        ...action('open_question'),
        questionId: input.pendingQuestion.questionId,
      },
    };
  }

  if (input.queueReason === 'state_error') {
    return { owner: 'person', kind: 'blocked', action: action('open_goal') };
  }

  if (input.goalStatus === 'queued') {
    return {
      owner: 'team',
      kind: 'queued',
      ...(input.queueReason ? { queueReason: input.queueReason } : {}),
    };
  }

  if (input.nodeSession || /^RUNNING_/i.test(input.nextAction) || /^NEXT_/i.test(input.nextAction)) {
    return { owner: 'team', kind: 'working' };
  }

  if (input.queueReason === 'paused' || input.queueReason === 'archived') {
    return { owner: 'system', kind: 'waiting', queueReason: input.queueReason };
  }

  return { owner: 'system', kind: 'waiting' };
}

export function projectPodAttention(
  goals: Array<{ goalId: string; title: string; stage: PodGoalStage }>,
): PodAttentionItem[] {
  const out: PodAttentionItem[] = [];
  for (const goal of goals) {
    const stage = goal.stage;
    if (stage.owner !== 'person') continue;
    if (stage.kind !== 'plan_approval' && stage.kind !== 'question' && stage.kind !== 'blocked') continue;
    if (!stage.action) continue;
    out.push({
      id: `${goal.goalId}:${stage.kind}`,
      goalId: goal.goalId,
      kind: stage.kind,
      title: goal.title,
      action: stage.action,
    });
  }
  return out;
}
