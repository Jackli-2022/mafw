import type { IncomingMessage, ServerResponse } from 'http';
import type { RouteRegistry } from './registry';
import type { SchedulerPlan } from '../core/pod/pod-scheduler';

export interface SchedulerStatus {
  active: string[];
  queued: string[];
  capacity: number;
  plan: SchedulerPlan;
}

export interface SchedulerRouteDeps {
  status(projectDir: string): SchedulerStatus | null;
}

function projectDirOf(value: unknown): string {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : process.env.MAFW_PROJECT_DIR || process.cwd();
}

export function handleSchedulerStatus(
  args: { projectDir?: string },
  deps: SchedulerRouteDeps,
): { status: number; body: SchedulerStatus | { error: string } } {
  const status = deps.status(projectDirOf(args?.projectDir));
  return status ? { status: 200, body: status } : { status: 404, body: { error: 'pod not found' } };
}

export function attachSchedulerRoutes(registry: RouteRegistry, deps: SchedulerRouteDeps): void {
  registry.attachHandler('scheduler.status', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const out = handleSchedulerStatus({ projectDir: url.searchParams.get('projectDir') ?? undefined }, deps);
    res.writeHead(out.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out.body));
  });
}
