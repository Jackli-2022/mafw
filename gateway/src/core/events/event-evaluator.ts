import type {
  EventDecisionRow,
  EventSubscriptionRow,
  EventThreadRow,
  EventTriggerRow,
} from './event-types';

export interface EventEvaluationInput {
  thread: EventThreadRow;
  triggers: EventTriggerRow[];
  subscriptions: EventSubscriptionRow[];
  recentDecisions: EventDecisionRow[];
}

export interface EventDecision {
  decision: 'accept' | 'ignore' | 'unavailable';
  mode?: 'full' | 'report' | 'action' | 'skip';
  rationale: string;
  requiresApproval?: boolean;
}

export type EventEvaluator = (input: EventEvaluationInput) => Promise<EventDecision>;
