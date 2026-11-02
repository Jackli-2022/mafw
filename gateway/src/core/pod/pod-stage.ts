// gateway/src/core/pod/pod-stage.ts
// Pure Goal stage projection: the server is the only place that decides what
// the Pod UI may claim about a Goal. No fs, no clock, no model judgement.
//
// Revision aware（Task 11）：一个 Goal 的当前 revision 有任务状态（discussing /
// direction_review / planning / plan_review / queued / implementing / reviewing /
// completed / aborted / discarded）。阶段由 revision 状态 + 已持久化的 blockers
// 投影而来；legacy Goal（没有 revision 行）继续走 nextAction 投影。
//
// 人类 attention 只允许真正的阻塞：计划待批准、待回答问题、方向裁定 pending、
// 状态损坏。讨论/规划/实施/验收/结果通知都是团队工作，绝不冒充人类阻塞。
import type {
  PodGoalDirectionStatus,
  PodGoalRevisionStatus,
  PodMemberRole,
} from './pod-store';

export type PodGoalVerdict = 'PASS' | 'FAIL' | 'MAX_RETRIES' | 'ERROR' | 'CANCELLED';
export type PodQueueReason = 'active_goal' | 'paused' | 'archived' | 'budget' | 'state_error';
export type PodGoalStageOwner = 'person' | 'team' | 'system';
export type PodGoalStageKind =
  | 'plan_approval'
  | 'direction_review'
  | 'question'
  | 'blocked'
  | 'queued'
  | 'discussing'
  | 'planning'
  | 'probing'
  | 'implementing'
  | 'reviewing'
  | 'result_notified'
  | 'working'
  | 'waiting'
  | 'ended';

export type PodGoalStageActionType =
  | 'open_plan_review'
  | 'open_direction_review'
  | 'open_question'
  | 'open_discussion'
  | 'open_goal'
  | 'open_result';

export interface PodGoalStageAction {
  type: PodGoalStageActionType;
  goalId: string;
  questionId?: string;
}

/** 当前 revision 的任务状态（Task 3 行投影；`revision` 号只用于展示/对齐）。 */
export interface PodGoalRevisionSummary {
  revision?: number;
  status: PodGoalRevisionStatus;
  directionStatus?: PodGoalDirectionStatus | null;
}

/** 方向裁定摘要（Task 6）：只有 pending 才是人类 attention。 */
export interface PodGoalDirectionSummary {
  status?: PodGoalDirectionStatus | null;
  /** 最近一次 pending DirectionReview 的 id（UI 定位用，不参与判定）。 */
  requestId?: string | null;
}

/** 节点会话摘要（phase/作用域名；用于给 legacy 阶段标出负责角色）。 */
export interface PodNodeSessionSummary {
  id?: string;
  phase?: string | null;
}

export interface PodGoalStage {
  owner: PodGoalStageOwner;
  kind: PodGoalStageKind;
  /** 这一步由哪个 Pod 角色负责（person 阶段 = 提交产物/被审阅的角色）。 */
  role?: PodMemberRole;
  queueReason?: PodQueueReason;
  action?: PodGoalStageAction;
}

export interface PodGoalStageInput {
  goalId: string;
  goalStatus: 'queued' | 'active' | 'done' | 'aborted';
  terminal: boolean;
  nextAction: string;
  verdict: PodGoalVerdict | null;
  planApproval?: { status: 'pending' | 'approved' | 'rejected' } | null;
  pendingQuestion?: { questionId: string; node: 'plan' | 'execute' | 'review' } | null;
  nodeSession?: PodNodeSessionSummary | null;
  stateMissing?: boolean;
  queueReason?: PodQueueReason;
  /** 当前 revision 的任务状态；缺省 = legacy Goal（nextAction 投影）。 */
  revision?: PodGoalRevisionSummary | null;
  /** 方向裁定摘要；判定以 revision.directionStatus 为准，这里只做缺省兜底。 */
  direction?: PodGoalDirectionSummary | null;
  /** 规划期的 Spike 正在运行（Task 9）→ probing。 */
  probeRunning?: boolean;
}

export interface PodAttentionItem {
  id: string;
  goalId: string;
  kind: 'plan_approval' | 'direction_review' | 'question' | 'blocked';
  title: string;
  action: PodGoalStageAction;
}

/** 只有这四种阶段是真正的人类阻塞（结果通知/未读不算）。 */
const PERSON_ATTENTION_KINDS: ReadonlySet<PodGoalStageKind> = new Set([
  'plan_approval',
  'direction_review',
  'question',
  'blocked',
]);

function roleForNode(node: string | null | undefined): PodMemberRole | undefined {
  switch (node) {
    case 'plan':
    case 'discussion':
    case 'tech_lead':
      return 'tech_lead';
    case 'probe':
    case 'execute':
    case 'builder':
      return 'builder';
    case 'review':
    case 'reviewer':
      return 'reviewer';
    case 'coordination':
    case 'lead':
      return 'lead';
    default:
      return undefined;
  }
}

/**
 * 方向裁定是否仍在等人类：`direction_review` 的 revision 在 `decided` 之前
 * 一律是持久的人类阻塞（进程重启后仍然存在，不依赖瞬时内存状态）。
 */
function directionPending(input: PodGoalStageInput): boolean {
  const revision = input.revision;
  if (!revision || revision.status !== 'direction_review') return false;
  const status = revision.directionStatus ?? input.direction?.status ?? null;
  return status !== 'decided';
}

function nodeNameFromNextAction(nextAction: string): string | undefined {
  const match = /^(?:RUNNING|NEXT)_([A-Za-z_]+)/.exec(nextAction ?? '');
  return match?.[1]?.toLowerCase();
}

function projectRevisionStage(
  input: PodGoalStageInput,
  action: (type: PodGoalStageActionType) => PodGoalStageAction,
): PodGoalStage | null {
  const revision = input.revision;
  if (!revision) return null;
  switch (revision.status) {
    case 'discussing':
      return { owner: 'team', kind: 'discussing', role: 'tech_lead', action: action('open_discussion') };
    case 'direction_review':
      // pending 在上面已作为人类 attention 处理；到这里说明裁定已记录（防御陈旧行）。
      return { owner: 'team', kind: 'planning', role: 'tech_lead', action: action('open_goal') };
    case 'planning':
      return input.probeRunning
        ? { owner: 'team', kind: 'probing', role: 'builder', action: action('open_goal') }
        : { owner: 'team', kind: 'planning', role: 'tech_lead', action: action('open_goal') };
    case 'plan_review': {
      // 计划已提交、但还没有任何批准记录 → 真正的人类批准门（不得伪装团队工作）。
      // 批准/驳回已经有人回应过：Tech Lead 继续推进或按反馈修订。
      const approval = input.planApproval?.status;
      return approval
        ? { owner: 'team', kind: 'planning', role: 'tech_lead', action: action('open_goal') }
        : { owner: 'person', kind: 'plan_approval', role: 'tech_lead', action: action('open_plan_review') };
    }
    case 'queued':
      return { owner: 'team', kind: 'queued' };
    case 'implementing':
      return { owner: 'team', kind: 'implementing', role: 'builder', action: action('open_goal') };
    case 'reviewing':
      return { owner: 'team', kind: 'reviewing', role: 'reviewer', action: action('open_goal') };
    case 'completed':
      // revision 已完成：结果通知是 Lead 的工作，不是人类阻塞。
      return { owner: 'team', kind: 'result_notified', role: 'lead', action: action('open_result') };
    case 'aborted':
    case 'discarded':
      return { owner: 'system', kind: 'ended', action: action('open_result') };
    default:
      return null;
  }
}

export function projectPodGoalStage(input: PodGoalStageInput): PodGoalStage {
  const action = (type: PodGoalStageActionType): PodGoalStageAction => ({
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
      role: 'tech_lead',
      action: action('open_plan_review'),
    };
  }

  if (input.pendingQuestion) {
    const role = roleForNode(input.pendingQuestion.node);
    return {
      owner: 'person',
      kind: 'question',
      ...(role ? { role } : {}),
      action: {
        ...action('open_question'),
        questionId: input.pendingQuestion.questionId,
      },
    };
  }

  if (directionPending(input)) {
    return {
      owner: 'person',
      kind: 'direction_review',
      role: 'tech_lead',
      action: action('open_direction_review'),
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

  // Paused/archived Pod with no live node cannot be "working" whatever nextAction
  // says: only a node that is actually running may continue (spec §11).
  if (!input.nodeSession && (input.queueReason === 'paused' || input.queueReason === 'archived')) {
    return { owner: 'system', kind: 'waiting', queueReason: input.queueReason };
  }

  const revisionStage = projectRevisionStage(input, action);
  if (revisionStage) return revisionStage;

  if (input.nodeSession || /^RUNNING_/i.test(input.nextAction) || /^NEXT_/i.test(input.nextAction)) {
    const role = roleForNode(input.nodeSession?.phase ?? nodeNameFromNextAction(input.nextAction));
    return { owner: 'team', kind: 'working', ...(role ? { role } : {}) };
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
    if (!PERSON_ATTENTION_KINDS.has(stage.kind)) continue;
    if (!stage.action) continue;
    out.push({
      id: `${goal.goalId}:${stage.kind}`,
      goalId: goal.goalId,
      kind: stage.kind as PodAttentionItem['kind'],
      title: goal.title,
      action: stage.action,
    });
  }
  return out;
}
