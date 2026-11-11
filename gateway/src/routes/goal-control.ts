import type { IncomingMessage, ServerResponse } from 'http';
import type { RouteRegistry } from './registry';
import { readRouteBody } from './cognition';
import {
  handleGoalControlCommand,
  type GoalControlCommandDeps,
} from '../core/goal/control-command';

export type GoalControlActionKind = 'pause' | 'resume' | 'stop' | 'retry';

/** Minimal state shape persisted by the NodeDriver (v3). */
export interface GoalControlState {
  phase?: string | null;
  nextAction?: string | null;
  _resumePhase?: string | null;
  _resumeNextAction?: string | null;
}

/**
 * Pause must be reversible: persist the phase/nextAction pair before writing
 * PAUSED so resume can restore exactly where the driver stopped.
 */
export function pauseStatePatch(
  state: GoalControlState,
  now: string,
): Record<string, unknown> {
  return {
    phase: 'PAUSED',
    nextAction: 'PAUSED',
    _resumePhase: state._resumePhase ?? state.phase ?? null,
    _resumeNextAction: state._resumeNextAction ?? state.nextAction ?? null,
    updatedAt: now,
  };
}

/** Restore a paused state; null when the Goal is not actually paused. */
export function resumeStatePatch(
  state: GoalControlState,
): Record<string, unknown> | null {
  if (state.nextAction !== 'PAUSED') return null;
  return {
    phase: state._resumePhase ?? 'PLANNING',
    nextAction: state._resumeNextAction ?? 'WAIT_PHASE_COMPLETE',
    _resumePhase: null,
    _resumeNextAction: null,
  };
}

export interface RetryRun {
  id: number;
  revision?: number | null;
  status: string;
}

const RETRYABLE_RUN_STATUSES = new Set(['failed', 'error', 'aborted', 'timed_out', 'timeout']);

export type RetryRunSelection =
  | { ok: true; runId: number }
  | { ok: false; status: number; error: string };

/**
 * Retry is only valid for a failed run inside the active revision. A run from
 * an old revision or a successful run is rejected instead of being replayed.
 */
export function selectRetryRun(
  runs: readonly RetryRun[],
  revision: number,
  runId?: number,
): RetryRunSelection {
  const scoped = runs.filter((run) => (run.revision ?? 1) === revision);
  if (runId !== undefined) {
    const run = scoped.find((candidate) => candidate.id === runId);
    if (!run) {
      return { ok: false, status: 404, error: `node run ${runId} not found in revision ${revision}` };
    }
    if (!RETRYABLE_RUN_STATUSES.has(run.status)) {
      return { ok: false, status: 409, error: `node run ${runId} did not fail (${run.status})` };
    }
    return { ok: true, runId };
  }

  const failed = [...scoped].reverse().find((run) => RETRYABLE_RUN_STATUSES.has(run.status));
  if (!failed) return { ok: false, status: 409, error: 'goal has no failed run to retry' };
  return { ok: true, runId: failed.id };
}

export interface GoalControlDeps {
  /** True when the Goal exists (Pod row or legacy state file). */
  hasGoal?(goalId: string): boolean;
  /** True when the Goal already reached done/aborted. */
  terminal?(goalId: string): boolean;
  pause(goalId: string): Promise<void> | void;
  resume(goalId: string): Promise<void> | void;
  patchState(goalId: string, patch: Record<string, unknown>): Promise<void> | void;
  destroySessions(goalId: string): Promise<void> | void;
  archiveGoal(goalId: string, opts: { verdict: string; rounds: number }): Promise<void> | void;
  retry(goalId: string, runId?: number): Promise<void> | void;
  startGoal(goalId: string): Promise<void> | void;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function failure(err: any): { status: number; body: { error: string } } {
  const status = typeof err?.status === 'number' ? err.status : 500;
  return { status, body: { error: String(err?.message ?? err) } };
}

/** POST /api/goals/:id/{pause,resume,stop,retry} — distinct control semantics. */
export async function handleGoalControl(
  args: { id?: string; action?: GoalControlActionKind; runId?: number },
  deps: GoalControlDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const id = clean(args?.id);
  const action = args?.action;
  if (!id) return { status: 400, body: { error: 'goal id is required' } };
  if (action !== 'pause' && action !== 'resume' && action !== 'stop' && action !== 'retry') {
    return { status: 400, body: { error: 'unknown control action' } };
  }
  if (deps.hasGoal && !deps.hasGoal(id)) {
    return { status: 404, body: { error: `goal not found: ${id}` } };
  }
  if (deps.terminal?.(id)) {
    return { status: 409, body: { error: `goal is terminal: ${id}` } };
  }

  try {
    if (action === 'pause') {
      await deps.pause(id);
      return { status: 200, body: { status: 'paused' } };
    }

    if (action === 'resume') {
      await deps.resume(id);
      return { status: 200, body: { status: 'resumed' } };
    }

    if (action === 'stop') {
      await deps.destroySessions(id);
      await deps.patchState(id, { nextAction: 'FAILED', planApproval: null });
      await deps.archiveGoal(id, { verdict: 'CANCELLED', rounds: 0 });
      return { status: 200, body: { status: 'stopped' } };
    }

    await deps.retry(id, typeof args?.runId === 'number' ? args.runId : undefined);
    return { status: 200, body: { status: 'retried' } };
  } catch (err: any) {
    return failure(err);
  }
}

export function attachGoalControlRoutes(registry: RouteRegistry, deps: GoalControlDeps): void {
  const handler = (action: GoalControlActionKind) => async (
    req: IncomingMessage,
    res: ServerResponse,
    params: Record<string, string>,
  ) => {
    let body: any = {};
    try { body = JSON.parse(await readRouteBody(req) || '{}'); } catch { body = {}; }
    const out = await handleGoalControl({ id: params.id, action, runId: body?.runId }, deps);
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body));
  };
  registry.attachHandler('goals.pause', handler('pause'));
  registry.attachHandler('goals.resume', handler('resume'));
  registry.attachHandler('goals.stop', handler('stop'));
  registry.attachHandler('goals.retry', handler('retry'));
}

/**
 * POST /api/goals/control（E1-4）—— SDK `goals.control` 契约路径。
 *
 * catalog 里一直是 shadow 条目（无 handler）→ 被 transport 的 dashboard
 * `/api/goals*` 前缀兜底吞掉（R6 死臂）。registry dispatch 先于 legacy 链，
 * 挂上 handler 后该路径由这里接管；transport 的 `/control` 分支继续服务旧
 * 路径，二者共用 `handleGoalControlCommand`（大写动作族：PAUSE/ABORT/
 * FORCE_PHASE/RESET_PARAMETRIC）。
 */
export function attachGoalControlCommandRoute(
  registry: RouteRegistry,
  deps: GoalControlCommandDeps,
): void {
  registry.attachHandler('goals.control', async (req: IncomingMessage, res: ServerResponse) => {
    let control: any;
    try {
      control = JSON.parse(await readRouteBody(req) || '{}');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    const out = await handleGoalControlCommand(control, deps);
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });
}
