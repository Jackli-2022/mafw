import type { PodGoalView } from '../pod/pod-view';

export type AttentionKind =
  | 'answer' | 'plan_approval' | 'review' | 'blocked' | 'failed' | 'direction_review';

export interface AttentionItem {
  id: string;
  goalId: string;
  revision: number;
  kind: AttentionKind;
  priority: number;
  coalesceKey: string;
  title: string;
  action: { type: string; goalId: string; questionId?: string };
}

const PRIORITY: Record<AttentionKind, number> = {
  plan_approval: 100,
  direction_review: 90,
  answer: 80,
  review: 70,
  failed: 60,
  blocked: 50,
};

/**
 * Person-first attention list derived only from structured Goal facts.
 * Review is reachable after the Goal ends (result ready, not accepted); failed
 * is reachable from the driver's last error even while the stage is team-owned.
 */
export function deriveAttention(views: PodGoalView[]): AttentionItem[] {
  const byKey = new Map<string, AttentionItem>();
  for (const view of views) {
    let kind: AttentionKind | null = null;
    let action: AttentionItem['action'] = { type: 'open_goal', goalId: view.goalId };

    if (view.resultReady && !view.accepted) {
      kind = 'review';
      action = { type: 'open_result', goalId: view.goalId };
    } else if (view.endedAt) {
      continue;
    } else if (view.lastError) {
      kind = 'failed';
    } else {
      const stage = view.stage;
      if (!stage || stage.owner !== 'person') continue;
      switch (stage.kind) {
        case 'plan_approval':
          kind = 'plan_approval';
          break;
        case 'direction_review':
          kind = 'direction_review';
          break;
        case 'question':
          kind = 'answer';
          break;
        case 'blocked':
          if (view.stateMissing) continue;
          kind = 'blocked';
          break;
        default:
          kind = null;
      }
      if (stage.action) {
        action = {
          type: stage.action.type,
          goalId: view.goalId,
          ...(stage.action.questionId ? { questionId: stage.action.questionId } : {}),
        };
      }
    }
    if (!kind) continue;

    const revision = view.revision ?? view.activeRevision ?? 1;
    const coalesceKey = `${view.goalId}:${kind}:r${revision}`;
    if (byKey.has(coalesceKey)) continue;
    byKey.set(coalesceKey, {
      id: coalesceKey,
      goalId: view.goalId,
      revision,
      kind,
      priority: PRIORITY[kind],
      coalesceKey,
      title: view.title,
      action,
    });
  }

  return [...byKey.values()].sort((a, b) =>
    b.priority - a.priority
    || a.goalId.localeCompare(b.goalId));
}
