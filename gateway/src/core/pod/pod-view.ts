import type {
  PodGoalDirectionStatus,
  PodGoalRevisionStatus,
  PodGoalRow,
  PodMessageDeliveryRow,
} from './pod-store';
import type { GoalSourceRef } from '../goal/goal-intake';
import type { PodDetail } from './pod-service';
import { projectPodWorkBucket, type PodWorkBucket } from './pod-work-stage';
import {
  projectPodAttention,
  projectPodGoalStage,
  type PodAttentionItem,
  type PodGoalStage,
  type PodGoalVerdict,
  type PodNodeSessionSummary,
  type PodQueueReason,
} from './pod-stage';

export type { PodAttentionItem } from './pod-stage';

export type PodGoalStrategy = 'quick' | 'collaborative';
export type PodGoalAssessment = 'reviewed' | 'unreviewed';

export interface PodCurrentAssignment {
  assignmentId: string;
  role: 'builder' | 'reviewer';
  taskIds: string[];
  attempt: number;
}

export interface PodGoalDescription {
  title: string;
  phase: string | null;
  nextAction: string;
  terminal: boolean;
  verdict: PodGoalVerdict | null;
  hasResultEvidence: boolean;
  planApproval?: { id?: string; status: 'pending' | 'approved' | 'rejected' } | null;
  pendingQuestion?: {
    questionId: string;
    node: 'plan' | 'execute' | 'review';
    questions: string[];
  } | null;
  nodeSession: PodNodeSessionSummary | null;
  lastError: string | null;
  /** No state file yet (queued goal, or an active goal whose state vanished). */
  stateMissing?: boolean;
  /** 这份描述对应的 revision（GoalStateV3.revision）；缺省 = 存储指针。 */
  revision?: number;
  /** 当前 revision 的任务状态（Task 3 行投影）；缺省 = legacy Goal。 */
  revisionStatus?: PodGoalRevisionStatus | null;
  /** 方向裁定状态（Task 6）；pending 才算人类 attention。 */
  directionStatus?: PodGoalDirectionStatus | null;
  /** 规划期的 Spike 正在运行（Task 9）。 */
  probeRunning?: boolean;
  /** Free-discussion handoff origin, persisted in request.json. */
  sourceRef?: GoalSourceRef | null;
  /** Tech Lead execution choice. */
  strategy?: PodGoalStrategy | null;
  /** Whether an independent review actually produced the result. */
  assessment?: PodGoalAssessment | null;
  /** Current dispatch summary, projected from assignment file/state. */
  currentAssignment?: PodCurrentAssignment | null;
}

export interface PodGoalView {
  id: string;
  podId: string;
  goalId: string;
  status: 'queued' | 'active' | 'done' | 'aborted';
  title: string;
  phase: string | null;
  verdict: PodGoalVerdict | null;
  stage: PodGoalStage;
  /** The only list/count bucket exposed to Desktop. */
  bucket: PodWorkBucket;
  resultReady: boolean;
  sourceRef: GoalSourceRef | null;
  strategy: PodGoalStrategy | null;
  assessment: PodGoalAssessment | null;
  currentAssignment: PodCurrentAssignment | null;
  /** 当前 revision（legacy 行为 1）；revision 明细见 pod_goal_revisions。 */
  activeRevision: number;
  /**
   * 本视图 stage 所描述的 revision。存储指针（`activeRevision`）是权威：
   * 描述来自更旧 revision 时不再采信它的阶段快照，两者因此总是相等。
   */
  revision: number;
  priority: number;
  enqueuedAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface PodDetailView extends PodDetail {
  goals: PodGoalView[];
  attention: PodAttentionItem[];
  messageHealth: PodMessageDeliveryRow[];
}

export function goalVerdictFromState(state: {
  reviewVerdict?: PodGoalVerdict | string | null
  nextAction?: string | null
  round?: number | null
  maxRounds?: number | null
}): PodGoalVerdict | null {
  const verdict = state.reviewVerdict;
  if (verdict === 'PASS' || verdict === 'FAIL' || verdict === 'MAX_RETRIES' || verdict === 'ERROR' || verdict === 'CANCELLED') {
    // A FAILED state at the round ceiling is the autonomous-exhaustion path.
    if (verdict === 'FAIL'
      && state.nextAction === 'FAILED'
      && typeof state.round === 'number'
      && typeof state.maxRounds === 'number'
      && state.round >= state.maxRounds) {
      return 'MAX_RETRIES';
    }
    return verdict;
  }
  if (state.nextAction === 'CANCELLED') return 'CANCELLED';
  // Legacy COMPLETED without a review verdict is only "ended"; never invent PASS.
  return null;
}

function positiveRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Pre-execution revisions live before the Goal has any GoalState file: the
 * hidden Tech Lead session owns discussing/direction_review. An absent state
 * file there is the designed shape, not a corrupted Goal — only revisions that
 * must have started a node (planning/implementing/...) treat it as damage.
 */
const PRE_EXECUTION_REVISION_STATUSES: ReadonlySet<PodGoalRevisionStatus> = new Set([
  'discussing',
  'direction_review',
]);

function stateIsMissing(
  row: PodGoalRow,
  description: PodGoalDescription | null,
  revisionStatus: PodGoalRevisionStatus | null,
): boolean {
  if (row.status !== 'active') return false;
  const absent = !!description?.stateMissing || !description;
  if (!absent) return false;
  if (revisionStatus && PRE_EXECUTION_REVISION_STATUSES.has(revisionStatus)) return false;
  return true;
}

export function buildPodGoalView(
  row: PodGoalRow,
  description: PodGoalDescription | null,
  queueReason: PodQueueReason | undefined,
): PodGoalView {
  const terminal = !!description?.terminal || row.status === 'done' || row.status === 'aborted';
  const verdict = row.verdict ?? description?.verdict ?? null;
  // 描述里的 revision 只有与存储指针一致时才可信：打回后旧 state 快照的阶段
  // 不能冒充当前 revision（否则会把已完成的旧版本显示成「结果已通知」）。
  const describedRevision = positiveRevision(description?.revision);
  const revisionStatus = describedRevision === null || describedRevision === row.activeRevision
    ? description?.revisionStatus ?? null
    : null;
  const resultReady = terminal && !!description?.hasResultEvidence;
  const stage = projectPodGoalStage({
    goalId: row.goalId,
    goalStatus: row.status,
    terminal,
    nextAction: description?.nextAction ?? '',
    verdict,
    planApproval: description?.planApproval ?? null,
    pendingQuestion: description?.pendingQuestion ?? null,
    nodeSession: description?.nodeSession ?? null,
    stateMissing: stateIsMissing(row, description, revisionStatus),
    ...(queueReason ? { queueReason } : {}),
    revision: revisionStatus
      ? {
        revision: row.activeRevision,
        status: revisionStatus,
        directionStatus: description?.directionStatus ?? null,
      }
      : null,
    direction: description?.directionStatus ? { status: description.directionStatus } : null,
    probeRunning: description?.probeRunning === true,
  });

  return {
    id: row.id,
    podId: row.podId,
    goalId: row.goalId,
    status: row.status,
    title: description?.title?.trim() || '未命名目标',
    phase: description?.phase ?? null,
    verdict,
    stage,
    bucket: projectPodWorkBucket({ stage, status: row.status, resultReady }),
    resultReady,
    sourceRef: description?.sourceRef ?? null,
    strategy: description?.strategy ?? null,
    assessment: description?.assessment ?? null,
    currentAssignment: description?.currentAssignment ?? null,
    activeRevision: row.activeRevision,
    revision: row.activeRevision,
    priority: row.priority,
    enqueuedAt: row.enqueuedAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  };
}

export function buildPodAttention(views: PodGoalView[]): PodAttentionItem[] {
  return projectPodAttention(views.map((view) => ({
    goalId: view.goalId,
    title: view.title,
    stage: view.stage,
  })));
}
