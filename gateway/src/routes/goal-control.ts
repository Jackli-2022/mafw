import type { IncomingMessage, ServerResponse } from 'http';
import type { RouteRegistry } from './registry';
import { readRouteBody } from './cognition';

export type GoalControlActionKind = 'pause' | 'stop' | 'retry';

export interface GoalControlDeps {
  patchState(goalId: string, patch: Record<string, unknown>): Promise<void> | void;
  destroySessions(goalId: string): Promise<void> | void;
  archiveGoal(goalId: string, opts: { verdict: string; rounds: number }): Promise<void> | void;
  retry(goalId: string, runId?: number): Promise<void> | void;
  startGoal(goalId: string): Promise<void> | void;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** POST /api/goals/:id/{pause,stop,retry} — three distinct control semantics. */
export async function handleGoalControl(
  args: { id?: string; action?: GoalControlActionKind; runId?: number },
  deps: GoalControlDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const id = clean(args?.id);
  const action = args?.action;
  if (!id) return { status: 400, body: { error: 'goal id is required' } };
  if (action !== 'pause' && action !== 'stop' && action !== 'retry') {
    return { status: 400, body: { error: 'unknown control action' } };
  }

  if (action === 'pause') {
    await deps.patchState(id, { nextAction: 'PAUSED' });
    return { status: 200, body: { status: 'paused' } };
  }

  if (action === 'stop') {
    await deps.destroySessions(id);
    await deps.patchState(id, { nextAction: 'FAILED', planApproval: null });
    await deps.archiveGoal(id, { verdict: 'CANCELLED', rounds: 0 });
    return { status: 200, body: { status: 'stopped' } };
  }

  await deps.retry(id, typeof args?.runId === 'number' ? args.runId : undefined);
  return { status: 200, body: { status: 'retried' } };
}

export function attachGoalControlRoutes(registry: RouteRegistry, deps: GoalControlDeps): void {
  const handler = (action: GoalControlActionKind) => async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    let body: any = {};
    try { body = JSON.parse(await readRouteBody(req) || '{}'); } catch { body = {}; }
    const out = await handleGoalControl({ id: params.id, action, runId: body?.runId }, deps);
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body));
  };
  registry.attachHandler('goals.pause', handler('pause'));
  registry.attachHandler('goals.stop', handler('stop'));
  registry.attachHandler('goals.retry', handler('retry'));
}
