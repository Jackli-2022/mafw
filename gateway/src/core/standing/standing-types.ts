export type StandingState = 'active' | 'paused' | 'stopped';
export type StandingRunMode = 'goal' | 'report' | 'action' | 'skip';
export type StandingRunStatus =
  | 'queued'
  | 'triaging'
  | 'running'
  | 'waiting_person'
  | 'done'
  | 'failed'
  | 'skipped';
export type StandingTriggerType = 'cron' | 'event' | 'manual';

export class StandingGoalError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'StandingGoalError';
  }
}

export interface StandingTrigger {
  id: string;
  type: StandingTriggerType;
  schedule?: string;
  timezone?: string;
  eventKinds?: string[];
  filter?: Record<string, unknown>;
}

export interface StandingTemplate {
  taskType?: 'feature' | 'bug' | 'research' | 'refactor' | 'ops';
  acceptance?: string[];
  boundaries?: string[];
  planReview?: 'auto' | 'manual';
}

export interface StandingBudget {
  perRunTurns?: number;
  perRunCostUsd?: number;
  perDayCostUsd?: number;
}

export interface StandingGoal {
  id: string;
  projectDir: string;
  title: string;
  objective: string;
  template: StandingTemplate;
  triggers: StandingTrigger[];
  state: StandingState;
  concurrency: number;
  cooldownMs: number;
  budget: StandingBudget;
  approval: 'auto' | 'plan' | 'confirm';
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface GoalRun {
  id: string;
  standingGoalId: string;
  triggerType: StandingTriggerType;
  triggerKey: string;
  payload: Record<string, unknown>;
  status: StandingRunStatus;
  mode: StandingRunMode | null;
  rationale: string | null;
  goalId: string | null;
  sessionId: string | null;
  worktree: string | null;
  result: Record<string, unknown> | null;
  costUsd: number | null;
  tokens: number | null;
  startedAt: string | null;
  endedAt: string | null;
}
