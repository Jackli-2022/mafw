export interface PodGoalProgress {
  total: number;
  done: number;
  inProgress: number;
  review: number;
  failed: number;
  skipped: number;
}

type ProgressTask = Pick<{ kind: string; status: string }, 'kind' | 'status'>;

/**
 * Project the current plan task rows into a list-level progress summary.
 *
 * Only `kind === 'plan'` tasks participate: notes and external requests are not
 * execution progress. Pending and any unknown status stay implicit in `total`.
 * An empty/absent plan is unknown, not 0/0.
 */
export function summarizePodGoalProgress(tasks: readonly ProgressTask[]): PodGoalProgress | null {
  const plan = tasks.filter((task) => task.kind === 'plan');
  if (plan.length === 0) return null;
  const summary: PodGoalProgress = {
    total: plan.length,
    done: 0,
    inProgress: 0,
    review: 0,
    failed: 0,
    skipped: 0,
  };
  for (const task of plan) {
    if (task.status === 'done') summary.done += 1;
    else if (task.status === 'in_progress' || task.status === 'blocked') summary.inProgress += 1;
    else if (task.status === 'review') summary.review += 1;
    else if (task.status === 'failed') summary.failed += 1;
    else if (task.status === 'skipped') summary.skipped += 1;
  }
  return summary;
}
