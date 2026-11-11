// gateway/src/scheduler/task-descriptor.ts
// Declarative description of a schedulable task: priority class, same-key
// conflict strategy, budget admission, and watchdog timeout.
// Spec: docs/superpowers/specs/2026-11-09-gateway-kernel-scheduler-design.md

export type TaskPriority = 'foreground' | 'midground' | 'background' | 'idle';
export type SubmitStrategy = 'skip' | 'coalesce' | 'defer-to-idle' | 'queue';

export interface TaskBudget {
  /** Which budget system the injected checker consults. */
  kind: 'pipeline' | 'session' | 'pod';
  /** Pipeline name for kind:'pipeline' — MUST match the pipeline's internal
   *  PipelineBudget.allow() name (e.g. 'extract', 'reflect'). */
  pipeline?: string;
  /** Per-task turn cap (session budgets). Unused by the default checker. */
  maxTurns?: number;
  /** Per-task USD cap (session/pod budgets). Unused by the default checker. */
  maxCostUsd?: number;
}

export interface TaskDescriptor<T = unknown> {
  /** Diagnostic id; auto-generated (`task_<seq>`) when absent. */
  id?: string;
  priority: TaskPriority;
  strategy: SubmitStrategy;
  /** Same-key mutual exclusion. */
  mutexKey?: string;
  /** Watchdog: reject with TaskTimeoutError and free the key after this many
   *  ms of EXECUTION (queue wait does not count). Timer is unref'd. */
  timeoutMs?: number;
  budget?: TaskBudget;
}

/** Rejected when strategy 'skip' finds the mutexKey already in use. */
export class TaskSkippedError extends Error {
  readonly code = 'task_skipped';
  constructor(key: string) {
    super(`task skipped: "${key}" already in use`);
    this.name = 'TaskSkippedError';
  }
}

/** Rejected when a started task's watchdog expires. The lock is released and
 *  the abandoned fn keeps running in the background (release semantics). */
export class TaskTimeoutError extends Error {
  readonly code = 'task_timeout';
  constructor(id: string, timeoutMs: number) {
    super(`task "${id}" exceeded ${timeoutMs}ms`);
    this.name = 'TaskTimeoutError';
  }
}

/** Rejected at submit time when the injected budget checker denies the task. */
export class BudgetExceededError extends Error {
  readonly code = 'budget_exceeded';
  constructor(reason: string) {
    super(`budget exceeded: ${reason}`);
    this.name = 'BudgetExceededError';
  }
}

export interface BudgetCheckResult {
  ok: boolean;
  reason?: string;
}
export type BudgetChecker = (task: TaskDescriptor<any>) => BudgetCheckResult;

export interface SchedulerStats {
  queued: number;
  /** In-flight tasks, foreground included. */
  running: number;
  /** QUEUED per priority; all four keys always present. */
  byPriority: Record<TaskPriority, number>;
}

export interface SchedulerOpts {
  /** Max concurrently running non-foreground tasks. Default 4. */
  maxConcurrent?: number;
  /** Admission budget check at submit. Consulted only for budgeted descriptors. */
  budgetChecker?: BudgetChecker;
  /**
   * Universal admission check: consulted for EVERY submit (budgeted or not).
   * Runs before `budgetChecker` and before any queueing/coalescing; `budgetChecker`
   * stays budget-only. Default: allow everything.
   */
  admissionChecker?: BudgetChecker;
  log?: (msg: string) => void;
}
