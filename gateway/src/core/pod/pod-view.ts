import type { PodGoalRow } from './pod-store';
import type { PodDetail } from './pod-service';
import {
  projectPodAttention,
  projectPodGoalStage,
  type PodAttentionItem,
  type PodGoalStage,
  type PodGoalVerdict,
  type PodQueueReason,
} from './pod-stage';

export type { PodAttentionItem } from './pod-stage';

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
  nodeSession: unknown | null;
  lastError: string | null;
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
  resultReady: boolean;
  enqueuedAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface PodDetailView extends PodDetail {
  goals: PodGoalView[];
  attention: PodAttentionItem[];
}

export function buildPodGoalView(
  row: PodGoalRow,
  description: PodGoalDescription | null,
  queueReason: PodQueueReason | undefined,
): PodGoalView {
  const terminal = !!description?.terminal || row.status === 'done' || row.status === 'aborted';
  const verdict = row.verdict ?? description?.verdict ?? null;
  const stage = projectPodGoalStage({
    goalId: row.goalId,
    goalStatus: row.status,
    terminal,
    nextAction: description?.nextAction ?? '',
    verdict,
    planApproval: description?.planApproval ?? null,
    pendingQuestion: description?.pendingQuestion ?? null,
    nodeSession: description?.nodeSession ?? null,
    stateMissing: row.status === 'active' && !description,
    ...(queueReason ? { queueReason } : {}),
  });

  return {
    id: row.id,
    podId: row.podId,
    goalId: row.goalId,
    status: row.status,
    title: description?.title?.trim() || row.goalId,
    phase: description?.phase ?? null,
    verdict,
    stage,
    resultReady: terminal && !!description?.hasResultEvidence,
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
