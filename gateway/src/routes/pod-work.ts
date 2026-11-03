import type * as http from 'http';
import type { PodGoalService } from '../core/pod/pod-goal-service';
import type { PodService } from '../core/pod/pod-service';
import type { PodGoalView } from '../core/pod/pod-view';
import type { PodWorkBucket } from '../core/pod/pod-work-stage';

export interface PodWorkDeps {
  pods: Pick<PodService, 'lookup'>;
  goals: Pick<PodGoalService, 'views'>;
}

const BUCKETS: PodWorkBucket[] = ['needs_you', 'queued', 'in_progress', 'result_ready', 'ended'];

function emptyGroups(): Record<PodWorkBucket, PodGoalView[]> {
  return {
    needs_you: [],
    queued: [],
    in_progress: [],
    result_ready: [],
    ended: [],
  };
}

/**
 * GET /api/projects/:projectId/work
 *
 * Read-only, complete project overview. It never ensures a Pod and never
 * truncates Goal history: groups and counts are two projections of the same
 * array so a rendered count can always be opened.
 */
export async function handlePodWork(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: PodWorkDeps,
): Promise<boolean> {
  const pathname = url.split('?')[0];
  const match = pathname.match(/^\/api\/projects\/([^/]+)\/work$/);
  if (!match) return false;
  if ((req.method || 'GET') !== 'GET') return false;

  try {
    const projectID = decodeURIComponent(match[1]);
    const detail = deps.pods.lookup(projectID);
    if (!detail) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'pod not found' }));
      return true;
    }
    const views = deps.goals.views(detail.pod.id);
    const groups = emptyGroups();
    for (const view of views) groups[view.bucket].push(view);
    const counts = Object.fromEntries(
      BUCKETS.map((bucket) => [bucket, groups[bucket].length]),
    ) as Record<PodWorkBucket, number>;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      projectDir: detail.pod.projectDir,
      podId: detail.pod.id,
      groups,
      counts,
      total: views.length,
    }));
    return true;
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(error?.message ?? error) }));
    return true;
  }
}
