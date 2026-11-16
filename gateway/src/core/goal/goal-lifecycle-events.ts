// gateway/src/core/goal/goal-lifecycle-events.ts
// Pure builders for `goal.*` domain events. NodeDriver stays the execution
// authority; kernel converts its existing `goal_node` / `phase_transition`
// notifications into append-only facts.
import type { DomainEventInput } from '../events/domain-event';

export function goalCreatedEvent(input: {
  goalId: string;
  revision: number;
  maxRounds: number;
  taskType?: string;
  planReview?: 'auto' | 'manual';
  occurredAt: string;
}): DomainEventInput {
  return {
    type: 'goal.created',
    aggregateType: 'goal',
    aggregateId: input.goalId,
    occurredAt: input.occurredAt,
    audience: 'none',
    payload: {
      revision: input.revision,
      maxRounds: input.maxRounds,
      ...(input.taskType ? { taskType: input.taskType } : {}),
      ...(input.planReview ? { planReview: input.planReview } : {}),
    },
  };
}

export function goalPhaseChangedEvent(input: {
  goalId: string;
  phase: string;
  round: number;
  revision?: number;
  projectDir: string;
  occurredAt: string;
}): DomainEventInput {
  return {
    type: 'goal.phase.changed',
    aggregateType: 'goal',
    aggregateId: input.goalId,
    occurredAt: input.occurredAt,
    audience: 'none',
    payload: {
      phase: input.phase,
      round: input.round,
      ...(input.revision ? { revision: input.revision } : {}),
      projectDir: input.projectDir,
    },
  };
}

export function goalNodeStartedEvent(input: {
  goalId: string;
  node: string;
  round: number;
  attempt: number;
  revision: number;
  projectDir: string;
  occurredAt: string;
}): DomainEventInput {
  return {
    type: 'goal.node.started',
    aggregateType: 'goal',
    aggregateId: input.goalId,
    occurredAt: input.occurredAt,
    audience: 'none',
    payload: {
      node: input.node,
      round: input.round,
      attempt: input.attempt,
      revision: input.revision,
      projectDir: input.projectDir,
    },
  };
}

export function goalNodeFinishedEvent(input: {
  goalId: string;
  node: string;
  round: number;
  attempt: number;
  revision: number;
  projectDir: string;
  outcome?: string;
  occurredAt: string;
}): DomainEventInput {
  return {
    type: 'goal.node.completed',
    aggregateType: 'goal',
    aggregateId: input.goalId,
    occurredAt: input.occurredAt,
    audience: 'none',
    payload: {
      node: input.node,
      round: input.round,
      attempt: input.attempt,
      revision: input.revision,
      ...(input.outcome ? { outcome: input.outcome } : {}),
      projectDir: input.projectDir,
    },
  };
}

export function goalNodeFailedEvent(input: {
  goalId: string;
  node: string;
  round: number;
  attempt: number;
  revision: number;
  projectDir: string;
  failureClass: string;
  code: string;
  message: string;
  occurredAt: string;
}): DomainEventInput {
  return {
    type: 'goal.node.failed',
    aggregateType: 'goal',
    aggregateId: input.goalId,
    occurredAt: input.occurredAt,
    audience: 'human',
    payload: {
      node: input.node,
      round: input.round,
      attempt: input.attempt,
      revision: input.revision,
      failureClass: input.failureClass,
      code: input.code,
      message: input.message,
      projectDir: input.projectDir,
    },
  };
}
