export interface OrchestrationComponent {
  id: string;
  kind: 'prompt' | 'threshold' | 'model_route' | 'parameter';
  currentValueSource: string;
  evolvablePhase: 2 | 3;
}

export const ORCHESTRATION_REGISTRY: OrchestrationComponent[] = [
  {
    id: 'plan.prompt',
    kind: 'prompt',
    currentValueSource: 'gateway/src/core/skills/mafw-plan/entry.ts:buildPlanPrompt',
    evolvablePhase: 2,
  },
  {
    id: 'review.prompt',
    kind: 'prompt',
    currentValueSource: 'gateway/src/core/skills/mafw-review/entry.ts:buildReviewPrompt',
    evolvablePhase: 2,
  },
  {
    id: 'review.samematch_threshold',
    kind: 'threshold',
    currentValueSource: 'gateway/src/core/langgraph/nodes/review.node.ts',
    evolvablePhase: 2,
  },
  {
    id: 'review.verdict_parse',
    kind: 'parameter',
    currentValueSource: 'gateway/src/core/langgraph/nodes/review.node.ts:parseReviewVerdict',
    evolvablePhase: 2,
  },
  {
    id: 'execute.degradation_l3',
    kind: 'threshold',
    currentValueSource: 'gateway/src/core/engine/degradation.ts:checkL3Oscillation',
    evolvablePhase: 2,
  },
  {
    id: 'loop.max_rounds',
    kind: 'parameter',
    currentValueSource: 'gateway/src/config.ts:loop.maxRounds',
    evolvablePhase: 2,
  },
  {
    id: 'loop.stuck_timeout',
    kind: 'parameter',
    currentValueSource: 'gateway/src/config.ts:timeouts.stuckLoopTimeout',
    evolvablePhase: 2,
  },
];
