// gateway/src/routes/goal-timeline.ts
import * as http from 'http';
import * as path from 'path';
import { GoalStateV3 } from '../core/goal/state-v3';
import { nodeArtifactPaths } from '../core/goal/node-prompts';

export interface TimelineDeps {
  loadState(goalId: string): GoalStateV3 | null;
  listNodeRuns(goalId: string): any[];
  loadRequest(goalId: string): any;
  getOutcome(goalId: string): any;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * GET /api/goals/:id/timeline — 节点级执行 trace 聚合（goal_node_runs ⋈ state）。
 * 返回 handled=false 表示路径不匹配，交给后续路由。
 */
export async function handleGoalTimeline(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: TimelineDeps,
): Promise<boolean> {
  const m = url.match(/^\/api\/goals\/([^/]+)\/timeline(?:\?|$)/);
  if (!m || req.method !== 'GET') return false;
  const goalId = decodeURIComponent(m[1]);
  try {
    const state = deps.loadState(goalId);
    if (!state) { json(res, 404, { error: 'goal state not found' }); return true; }
    const request = deps.loadRequest(goalId);
    const a = nodeArtifactPaths(state.mafwDir, goalId, state.round);
    const nodes = (deps.listNodeRuns(goalId) ?? []).map((r) => ({
      runId: r.id, loop: r.loop, node: r.node, attempt: r.attempt, status: r.status,
      sessionId: r.session_id, startedAt: r.started_at, finishedAt: r.finished_at,
      durationMs: r.started_at && r.finished_at
        ? Math.max(0, Date.parse(r.finished_at) - Date.parse(r.started_at)) : null,
      outcome: r.outcome, error: r.error,
      tokensInput: r.tokens_input, tokensOutput: r.tokens_output, costUsd: r.cost_usd,
    }));
    json(res, 200, {
      goal: {
        goalId, title: request?.title ?? goalId, phase: state.phase,
        round: state.round, maxRounds: state.maxRounds,
        verdict: state.reviewVerdict, nextNode: state.nextNode, nextAction: state.nextAction,
        lastError: state.lastError, updatedAt: state.updatedAt,
      },
      nodes,
      artifacts: {
        wavesPath: state.wavePlanPath ?? a.waves,
        receipts: nodes.filter((n) => n.node === 'execute').map((n) => n.outcome),
        reviewsDir: path.dirname(a.review),
      },
      outcome: deps.getOutcome(goalId) ?? undefined,
    });
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? String(err) });
  }
  return true;
}
