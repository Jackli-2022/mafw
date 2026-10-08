// gateway/src/routes/goal-node-retry.ts
import * as http from 'http';

export interface NodeRetryDeps {
  body: { confirm?: boolean };
  getNodeRun(runId: number): { id: number; goal_id: string; node: string; status: string; loop: number } | null;
  retryNodeRun(goalId: string, runId: number): Promise<{ runId: number }>;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * POST /api/goals/:id/nodes/:runId/retry — 节点级重跑（DFX）。
 * execute 节点重跑会再次执行写操作 → 需 body.confirm=true（destructive 门）。
 */
export async function handleNodeRetry(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: NodeRetryDeps,
): Promise<boolean> {
  const m = url.match(/^\/api\/goals\/([^/]+)\/nodes\/(\d+)\/retry$/);
  if (!m || req.method !== 'POST') return false;
  const goalId = decodeURIComponent(m[1]);
  const runId = Number(m[2]);
  try {
    const run = deps.getNodeRun(runId);
    if (!run || run.goal_id !== goalId) { json(res, 404, { error: 'node run not found' }); return true; }
    if (run.status === 'succeeded') { json(res, 400, { error: 'cannot retry a succeeded run' }); return true; }
    if (run.node === 'execute' && !deps.body.confirm) {
      json(res, 409, { error: 'execute retry re-runs write operations — pass confirm: true to proceed' });
      return true;
    }
    const result = await deps.retryNodeRun(goalId, runId);
    json(res, 200, { success: true, runId: result.runId });
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? String(err) });
  }
  return true;
}
