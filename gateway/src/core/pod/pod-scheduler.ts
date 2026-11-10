export interface SchedulerCandidate {
  goalId: string;
  active: boolean;
  priority: number;
  enqueuedAt: string;
  humanAttention: boolean;
}

export interface SchedulerPlan {
  start: string[];
  waiting: string[];
  humanSlot: boolean;
  capacity: number;
}

/**
 * Pure slot planner: normal capacity plus one human-intervention slot that is
 * only opened by an already-active person-attention goal. New goals can fill
 * normal slots, never the human slot.
 */
export function planPromotions(input: {
  active: SchedulerCandidate[];
  queued: SchedulerCandidate[];
  maxConcurrent: number;
}): SchedulerPlan {
  const limit = Math.max(1, Math.trunc(input.maxConcurrent || 1));
  const running = input.active.filter((candidate) => candidate.active);
  const humanSlot = running.some((candidate) => candidate.humanAttention);
  const capacity = limit + (humanSlot ? 1 : 0);
  const slots = Math.max(0, capacity - running.length);
  const ordered = [...input.queued].sort((a, b) =>
    b.priority - a.priority
    || a.enqueuedAt.localeCompare(b.enqueuedAt)
    || a.goalId.localeCompare(b.goalId));
  return {
    start: ordered.slice(0, slots).map((candidate) => candidate.goalId),
    waiting: ordered.slice(slots).map((candidate) => candidate.goalId),
    humanSlot,
    capacity,
  };
}
