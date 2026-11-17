// Plan-time review snapshot + execute-time stable context.
//
// Plan dispatch captures the current unresolved review-item IDs for that
// revision. Execute dispatch reads the same snapshot and filters the current
// unresolved rows by those IDs. A late item therefore belongs to the next
// planning/rework cycle, never to an already-dispatched execution.
import type { PodReviewItem, PodReviewService } from './pod-review-service';
import {
  captureReviewWorkSnapshot,
  readReviewWorkSnapshot,
  renderReviewWorkBlock,
  reviewWorkSnapshotPath,
  type ReviewWorkSnapshot,
} from './goal-review-context';

export class GoalReviewWorkService {
  constructor(private readonly deps: {
    reviews: Pick<PodReviewService, 'unresolved'>;
    mafwDirForGoal(goalId: string): string | null;
    now(): string;
  }) {}

  render(input: {
    podId: string;
    goalId: string;
    revision: number;
    node: 'plan' | 'execute';
  }): string | null {
    const mafwDir = this.deps.mafwDirForGoal(input.goalId);
    if (!mafwDir) throw new Error(`mafw dir unavailable for goal ${input.goalId}`);
    const snapshotPath = reviewWorkSnapshotPath(mafwDir, input.goalId, input.revision);
    const unresolved = this.deps.reviews.unresolved(input.podId, input.goalId, input.revision);

    if (input.node === 'plan') {
      const snapshot = captureReviewWorkSnapshot({
        goalId: input.goalId,
        path: snapshotPath,
        revision: input.revision,
        items: unresolved,
        now: this.deps.now(),
      });
      return this.renderSnapshot(input.revision, snapshot, unresolved);
    }

    let snapshot = readReviewWorkSnapshot(snapshotPath, input.goalId, input.revision);
    if (!snapshot) {
      // Legacy / mid-flight recovery: freeze once before the first execute.
      snapshot = captureReviewWorkSnapshot({
        goalId: input.goalId,
        path: snapshotPath,
        revision: input.revision,
        items: unresolved,
        now: this.deps.now(),
      });
    }
    return this.renderSnapshot(input.revision, snapshot, unresolved);
  }

  private renderSnapshot(
    revision: number,
    snapshot: ReviewWorkSnapshot,
    unresolved: readonly PodReviewItem[],
  ): string | null {
    const ids = new Set(snapshot.itemIds);
    const selected = unresolved.filter((item) => ids.has(item.id));
    return renderReviewWorkBlock({
      revision,
      items: selected,
      capturedAt: snapshot.capturedAt,
    });
  }
}
