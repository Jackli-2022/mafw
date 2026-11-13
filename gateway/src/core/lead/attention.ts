import type { PodGoalView } from '../pod/pod-view';
import type { DecisionRecord } from '../decision/decision-record';

export type AttentionKind =
  | 'answer' | 'plan_approval' | 'review' | 'review_item' | 'blocked' | 'failed' | 'direction_review'
  | 'decision';

export interface AttentionItem {
  id: string;
  goalId: string;
  revision: number;
  kind: AttentionKind;
  priority: number;
  coalesceKey: string;
  title: string;
  detail?: string;
  action: {
    type: string;
    goalId: string;
    questionId?: string;
    itemId?: string;
    rel?: string;
    line?: number;
  };
}

export interface ReviewAttentionInput {
  id: string;
  goalId: string;
  revision: number;
  title: string;
  rel: string;
  line?: number;
  comment: string;
}

/** A draft decision reduced to the fields person-first attention needs. */
export interface DecisionAttentionInput {
  id: string;
  goalId: string;
  revision: number;
  title: string;
  detail?: string;
}

const PRIORITY: Record<AttentionKind, number> = {
  plan_approval: 100,
  direction_review: 90,
  decision: 85,
  answer: 80,
  review_item: 75,
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

function sortAttention(items: Iterable<AttentionItem>): AttentionItem[] {
  return [...items].sort((a, b) =>
    b.priority - a.priority
    || a.goalId.localeCompare(b.goalId)
    || a.id.localeCompare(b.id));
}

/**
 * Project unresolved review items into the same person-first attention list.
 * Review items are appended, not merged into deriveAttention, so historical
 * Goal-stage behavior stays unchanged.
 */
export function appendReviewAttention(
  items: readonly AttentionItem[],
  reviews: readonly ReviewAttentionInput[],
): AttentionItem[] {
  const byKey = new Map(items.map((item) => [item.coalesceKey, item]));
  for (const review of reviews) {
    const coalesceKey = `review_item:${review.goalId}:r${review.revision}:${review.id}`;
    if (byKey.has(coalesceKey)) continue;
    byKey.set(coalesceKey, {
      id: coalesceKey,
      goalId: review.goalId,
      revision: review.revision,
      kind: 'review_item',
      priority: PRIORITY.review_item,
      coalesceKey,
      title: review.title || review.rel,
      detail: review.comment,
      action: {
        type: 'open_review_item',
        goalId: review.goalId,
        itemId: review.id,
        rel: review.rel,
        ...(review.line !== undefined ? { line: review.line } : {}),
      },
    });
  }
  return sortAttention(byKey.values());
}

/**
 * Only a draft decision is still waiting on a person. Decided/shelved records
 * are settled, and records without a Goal cannot be goal-scoped, so they stay
 * on the decision board instead of entering the attention list.
 */
export function decisionAttentionInput(record: DecisionRecord): DecisionAttentionInput | null {
  if (record.status !== 'draft' || !record.goalId) return null;
  return {
    id: record.id,
    goalId: record.goalId,
    revision: record.revision ?? 1,
    title: record.question,
    detail: record.rationale ?? record.consequences ?? undefined,
  };
}

/**
 * Project draft decision records into the same person-first list. Appended like
 * review items so Goal-stage attention stays byte-identical.
 */
export function appendDecisionAttention(
  items: readonly AttentionItem[],
  decisions: readonly DecisionRecord[],
): AttentionItem[] {
  const byKey = new Map(items.map((item) => [item.coalesceKey, item]));
  for (const record of decisions) {
    const input = decisionAttentionInput(record);
    if (!input) continue;
    const coalesceKey = `decision:${input.id}`;
    if (byKey.has(coalesceKey)) continue;
    byKey.set(coalesceKey, {
      id: coalesceKey,
      goalId: input.goalId,
      revision: input.revision,
      kind: 'decision',
      priority: PRIORITY.decision,
      coalesceKey,
      title: input.title,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
      action: { type: 'open_decision', goalId: input.goalId, itemId: input.id },
    });
  }
  return sortAttention(byKey.values());
}
