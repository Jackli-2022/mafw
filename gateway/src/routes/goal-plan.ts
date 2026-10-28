// gateway/src/routes/goal-plan.ts
// W1 计划审阅：GET /api/goals/:id/plan（读当前计划）+ POST /api/goals/:id/plan-approval。
// deps 注入可单测；注册须在 dashboard /api/goals* 兜底之前（既有路由次序约束）。
import * as http from 'http';
import * as fs from 'fs';
import { GoalStateV3 } from '../core/goal/state-v3';

export interface GoalPlanDeps {
  body?: { approve?: boolean; feedback?: string };
  loadState(goalId: string): GoalStateV3 | null;
  approvePlan(goalId: string): Promise<boolean>;
  rejectPlan(goalId: string, feedback: string): Promise<boolean>;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export async function handleGoalPlan(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: GoalPlanDeps,
): Promise<boolean> {
  const mGet = url.match(/^\/api\/goals\/([^/]+)\/plan(?:\?|$)/);
  const mPost = url.match(/^\/api\/goals\/([^/]+)\/plan-approval(?:\?|$)/);

  if (mGet && req.method === 'GET') {
    const goalId = decodeURIComponent(mGet[1]);
    try {
      const state = deps.loadState(goalId);
      if (!state) { json(res, 404, { error: 'goal state not found' }); return true; }
      // waves 缺失/损坏 → null（不 500，桌面渲染空态）
      let waves: any = null;
      if (state.wavePlanPath) {
        try { waves = JSON.parse(fs.readFileSync(state.wavePlanPath, 'utf-8')); } catch { waves = null; }
      }
      json(res, 200, {
        planReview: state.planReview ?? 'auto',
        planApproval: state.planApproval ?? null,
        planFeedback: state.planFeedback ?? null,
        round: state.round,
        waves,
        wavePlanPath: state.wavePlanPath ?? null,
      });
    } catch (err: any) {
      json(res, 500, { error: err?.message ?? String(err) });
    }
    return true;
  }

  if (mPost && req.method === 'POST') {
    const goalId = decodeURIComponent(mPost[1]);
    try {
      const state = deps.loadState(goalId);
      if (!state) { json(res, 404, { error: 'goal state not found' }); return true; }
      const approve = deps.body?.approve === true;
      const feedback = typeof deps.body?.feedback === 'string' ? deps.body.feedback.trim() : '';
      if (approve) {
        const ok = await deps.approvePlan(goalId);
        if (!ok) { json(res, 409, { error: 'plan approval is not pending (or goal is terminal)' }); return true; }
        json(res, 200, { success: true });
      } else {
        if (!feedback) { json(res, 400, { error: 'reject requires feedback' }); return true; }
        const ok = await deps.rejectPlan(goalId, feedback);
        if (!ok) { json(res, 409, { error: 'plan approval is not pending (or goal is terminal)' }); return true; }
        json(res, 200, { success: true });
      }
    } catch (err: any) {
      json(res, 500, { error: err?.message ?? String(err) });
    }
    return true;
  }

  return false;
}
