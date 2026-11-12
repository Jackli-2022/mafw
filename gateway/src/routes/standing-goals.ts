import type { IncomingMessage, ServerResponse } from 'http';
import type { RouteRegistry } from './registry';
import { humanOnlyDenied, isHumanPrincipal } from '../core/auth';
import { readRouteBody } from './cognition';
import type { GoalRun, StandingGoal } from '../core/standing/standing-types';

export interface StandingGoalRouteDeps {
  enabled(): boolean;
  list(projectDir: string): StandingGoal[];
  create(input: unknown): StandingGoal;
  update(id: string, patch: unknown): StandingGoal;
  runs(id: string): GoalRun[];
  getGoal(id: string): StandingGoal | null;
  pause(id: string): StandingGoal;
  resume(id: string): StandingGoal;
  stop(id: string): StandingGoal;
  run(id: string): Promise<GoalRun | null>;
  getRun(id: string): GoalRun | null;
  approveRun(id: string): Promise<GoalRun>;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function projectDirOf(value: unknown): string {
  return clean(value) || process.env.MAFW_PROJECT_DIR || process.cwd();
}

function gate(deps: StandingGoalRouteDeps): { status: number; body: any } | null {
  return deps.enabled() ? null : { status: 503, body: { error: 'standing goals disabled' } };
}

function fail(err: any): { status: number; body: any } {
  return {
    status: typeof err?.status === 'number' ? err.status : 500,
    body: { error: String(err?.message ?? err) },
  };
}

export function handleListStandingGoals(
  args: { projectDir?: string },
  deps: StandingGoalRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  return { status: 200, body: { items: deps.list(projectDirOf(args?.projectDir)) } };
}

export function handleCreateStandingGoal(
  args: { projectDir?: string; title?: string; objective?: string; triggers?: unknown; [key: string]: unknown },
  deps: StandingGoalRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  const triggers = Array.isArray(args?.triggers) ? args.triggers : [];
  if (triggers.length === 0) return { status: 400, body: { error: 'at least one trigger is required' } };
  try {
    return {
      status: 200,
      body: { goal: deps.create({ ...args, projectDir: projectDirOf(args?.projectDir) }) },
    };
  } catch (err: any) {
    return fail(err);
  }
}

export function handleUpdateStandingGoal(
  args: { id?: string; patch?: Record<string, unknown> },
  deps: StandingGoalRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  const id = clean(args?.id);
  if (!id) return { status: 400, body: { error: 'standing goal id is required' } };
  try {
    return { status: 200, body: { goal: deps.update(id, args?.patch ?? {}) } };
  } catch (err: any) {
    return fail(err);
  }
}

export function handleListRuns(
  args: { id?: string },
  deps: StandingGoalRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  const id = clean(args?.id);
  if (!id) return { status: 400, body: { error: 'standing goal id is required' } };
  if (!deps.getGoal(id)) return { status: 404, body: { error: `standing goal not found: ${id}` } };
  return { status: 200, body: { items: deps.runs(id) } };
}

function lifecycle(
  action: 'pause' | 'resume' | 'stop',
  args: { id?: string },
  deps: StandingGoalRouteDeps,
): { status: number; body: any } {
  const off = gate(deps);
  if (off) return off;
  const id = clean(args?.id);
  if (!id) return { status: 400, body: { error: 'standing goal id is required' } };
  try {
    return { status: 200, body: { goal: deps[action](id) } };
  } catch (err: any) {
    return fail(err);
  }
}

export function handlePauseStandingGoal(args: { id?: string }, deps: StandingGoalRouteDeps) {
  return lifecycle('pause', args, deps);
}
export function handleResumeStandingGoal(args: { id?: string }, deps: StandingGoalRouteDeps) {
  return lifecycle('resume', args, deps);
}
export function handleStopStandingGoal(args: { id?: string }, deps: StandingGoalRouteDeps) {
  return lifecycle('stop', args, deps);
}

export async function handleRunStandingGoal(
  args: { id?: string },
  deps: StandingGoalRouteDeps,
): Promise<{ status: number; body: any }> {
  const off = gate(deps);
  if (off) return off;
  const id = clean(args?.id);
  if (!id) return { status: 400, body: { error: 'standing goal id is required' } };
  try {
    const run = await deps.run(id);
    return run ? { status: 200, body: { run } } : { status: 409, body: { error: 'run not admitted' } };
  } catch (err: any) {
    return fail(err);
  }
}

export async function handleApproveRun(
  args: { id?: string; actorSessionID?: string; human: boolean },
  deps: StandingGoalRouteDeps,
): Promise<{ status: number; body: any }> {
  // E5a-2: approval is human-only. Fail-closed: `human` comes from the resolved
  // principal, never from the mere absence of actorSessionID.
  if (!args?.human) return humanOnlyDenied();
  const off = gate(deps);
  if (off) return off;
  if (args?.actorSessionID) {
    return { status: 403, body: { error: 'goal run approval is human-only' } };
  }
  const id = clean(args?.id);
  if (!id) return { status: 400, body: { error: 'goal run id is required' } };
  const run = deps.getRun(id);
  if (!run) return { status: 404, body: { error: `goal run not found: ${id}` } };
  if (run.status !== 'waiting_person') {
    return { status: 409, body: { error: `goal run is ${run.status}, not waiting_person` } };
  }
  try {
    return { status: 200, body: { run: await deps.approveRun(id) } };
  } catch (err: any) {
    return fail(err);
  }
}

function send(res: ServerResponse, out: { status: number; body: unknown }): void {
  res.writeHead(out.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(out.body));
}

async function bodyOf(req: IncomingMessage): Promise<any> {
  try { return JSON.parse(await readRouteBody(req) || '{}'); } catch { return {}; }
}

export function attachStandingGoalRoutes(registry: RouteRegistry, deps: StandingGoalRouteDeps): void {
  registry.attachHandler('standingGoals.list', async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    send(res, handleListStandingGoals({ projectDir: url.searchParams.get('projectDir') ?? undefined }, deps));
  });
  registry.attachHandler('standingGoals.create', async (req, res) => {
    send(res, handleCreateStandingGoal(await bodyOf(req), deps));
  });
  registry.attachHandler('standingGoals.update', async (req, res, params) => {
    send(res, handleUpdateStandingGoal({ id: params.id, patch: await bodyOf(req) }, deps));
  });
  registry.attachHandler('standingGoals.runs', async (_req, res, params) => {
    send(res, handleListRuns({ id: params.id }, deps));
  });
  registry.attachHandler('standingGoals.pause', async (_req, res, params) => {
    send(res, handlePauseStandingGoal({ id: params.id }, deps));
  });
  registry.attachHandler('standingGoals.resume', async (_req, res, params) => {
    send(res, handleResumeStandingGoal({ id: params.id }, deps));
  });
  registry.attachHandler('standingGoals.stop', async (_req, res, params) => {
    send(res, handleStopStandingGoal({ id: params.id }, deps));
  });
  registry.attachHandler('standingGoals.run', async (_req, res, params) => {
    send(res, await handleRunStandingGoal({ id: params.id }, deps));
  });
  registry.attachHandler('goalRuns.approve', async (req, res, params) => {
    const body = await bodyOf(req);
    send(res, await handleApproveRun({
      id: params.id,
      actorSessionID: body?.actorSessionID,
      human: isHumanPrincipal((req as any).mafwPrincipal),
    }, deps));
  });
}
