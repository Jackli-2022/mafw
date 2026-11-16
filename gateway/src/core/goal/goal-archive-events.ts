// gateway/src/core/goal/goal-archive-events.ts
// Terminal Goal fact: one `goal.result` for an accepted outcome, one
// `goal.failed` for every other terminal verdict.
import type { DomainEventInput } from '../events/domain-event';

const SUCCESS_VERDICTS = new Set(['PASS', 'UNREVIEWED']);

export function archiveDomainEvent(input: {
  goalId: string;
  revision: number;
  verdict: string;
  status: 'done' | 'aborted';
  lastError?: string | null;
  projectDir: string;
  occurredAt: string;
}): DomainEventInput {
  const type = SUCCESS_VERDICTS.has(input.verdict) ? 'goal.result' : 'goal.failed';
  return {
    type,
    aggregateType: 'goal',
    aggregateId: input.goalId,
    occurredAt: input.occurredAt,
    audience: 'human',
    payload: {
      verdict: input.verdict,
      status: input.status,
      revision: input.revision,
      lastError: input.lastError ?? null,
      projectDir: input.projectDir,
    },
  };
}
