// gateway/src/core/pod/goal-view-projector.ts
// Rebuild a Goal's lifecycle facts from the domain log. Phase 2 uses this for
// parity with `buildPodGoalView` + `deriveAttention`; the read path still uses
// the live projection until Phase 3 flips it.
import type { DomainEvent } from '../events/domain-event';

export type GoalLifecycleVerdict =
  | 'PASS'
  | 'UNREVIEWED'
  | 'FAIL'
  | 'MAX_RETRIES'
  | 'ERROR'
  | 'CANCELLED';

export interface GoalLifecycleProjection {
  goalId: string;
  revision: number;
  phase: string | null;
  round: number;
  status: 'active' | 'done' | 'aborted';
  verdict: GoalLifecycleVerdict | null;
  failed: boolean;
  resultReady: boolean;
  lastError: string | null;
  accepted: boolean;
}

const VERDICTS = new Set<GoalLifecycleVerdict>([
  'PASS', 'UNREVIEWED', 'FAIL', 'MAX_RETRIES', 'ERROR', 'CANCELLED',
]);

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function verdictOf(value: unknown): GoalLifecycleVerdict | null {
  return typeof value === 'string' && VERDICTS.has(value as GoalLifecycleVerdict)
    ? (value as GoalLifecycleVerdict)
    : null;
}

export function projectGoalLifecycle(events: DomainEvent[]): GoalLifecycleProjection | null {
  const goalEvents = events
    .filter((event) => event.aggregateType === 'goal')
    .sort((a, b) => a.aggregateVersion - b.aggregateVersion);
  if (goalEvents.length === 0) return null;
  const goalId = goalEvents[0].aggregateId;

  const projection: GoalLifecycleProjection = {
    goalId,
    revision: 1,
    phase: null,
    round: 1,
    status: 'active',
    verdict: null,
    failed: false,
    resultReady: false,
    lastError: null,
    accepted: false,
  };

  for (const event of goalEvents) {
    if (event.aggregateId !== goalId) continue;
    const payload = event.payload as Record<string, unknown>;
    switch (event.type) {
      case 'goal.created':
        projection.status = 'active';
        projection.revision = positiveInt(payload.revision, projection.revision);
        break;
      case 'goal.phase.changed':
        if (typeof payload.phase === 'string') projection.phase = payload.phase;
        projection.round = positiveInt(payload.round, projection.round);
        break;
      case 'goal.node.started':
        projection.round = positiveInt(payload.round, projection.round);
        break;
      case 'goal.node.failed':
        if (typeof payload.message === 'string' && payload.message) {
          projection.lastError = payload.message;
        }
        break;
      case 'goal.result':
        projection.status = 'done';
        projection.verdict = verdictOf(payload.verdict) ?? 'PASS';
        projection.resultReady = true;
        projection.failed = false;
        break;
      case 'goal.failed': {
        const verdict = verdictOf(payload.verdict);
        projection.status = verdict === 'CANCELLED' ? 'aborted' : 'done';
        projection.verdict = verdict;
        projection.failed = true;
        projection.resultReady = false;
        if (typeof payload.lastError === 'string' && payload.lastError) {
          projection.lastError = payload.lastError;
        }
        break;
      }
      case 'goal.accepted':
        projection.accepted = true;
        break;
      default:
        break;
    }
  }

  return projection;
}

export function projectAttention(projection: GoalLifecycleProjection): {
  failed: boolean;
  openResult: boolean;
} {
  return {
    failed: projection.failed && !projection.accepted,
    openResult: projection.resultReady && !projection.accepted,
  };
}
