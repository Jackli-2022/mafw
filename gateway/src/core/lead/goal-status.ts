import type { PodAttentionItem, PodGoalView } from '../pod/pod-view';

export interface LeadGoalStatus {
  goalId: string;
  title: string;
  stage: string;
  progress: { done: number; total: number } | null;
  blockers: string[];
  pendingAttention: number;
  lastUpdate: string;
}

/**
 * Lead-facing projection: broad status only (stage / progress / blockers /
 * attention), never the Tech Lead's raw transcript.
 */
export function buildLeadGoalStatus(
  views: PodGoalView[],
  attention: PodAttentionItem[],
  limit = 5,
): LeadGoalStatus[] {
  const attentionByGoal = new Map<string, number>();
  for (const item of attention) {
    attentionByGoal.set(item.goalId, (attentionByGoal.get(item.goalId) ?? 0) + 1);
  }

  return views
    .filter((view) => !view.endedAt)
    .sort((a, b) => (b.priority - a.priority) || b.enqueuedAt.localeCompare(a.enqueuedAt))
    .slice(0, Math.max(0, limit))
    .map((view) => {
      const blockers: string[] = [];
      if (view.lastError) blockers.push(view.lastError);
      if (view.pendingQuestion) blockers.push('waiting for user answer');
      if ((view.stage.kind === 'blocked' || view.stage.kind === 'failed')
        && !blockers.includes(view.stage.kind)) {
        blockers.push(view.stage.kind);
      }
      return {
        goalId: view.goalId,
        title: view.title,
        stage: view.stage.kind,
        progress: view.progress ? { done: view.progress.done, total: view.progress.total } : null,
        blockers,
        pendingAttention: attentionByGoal.get(view.goalId) ?? 0,
        lastUpdate: view.startedAt ?? view.enqueuedAt,
      };
    });
}
