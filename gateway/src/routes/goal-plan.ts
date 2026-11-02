// gateway/src/routes/goal-plan.ts
// W1 计划审阅：GET /api/goals/:id/plan（读当前计划）+ POST /api/goals/:id/plan-approval。
// Task 13：计划 = PlanPackage（waves + GoalEval），批准绑定两者的内容哈希。
// deps 注入可单测；注册须在 dashboard /api/goals* 兜底之前（既有路由次序约束）。
import * as http from 'http';
import * as fs from 'fs';
import { GoalStateV3, effectiveRevision } from '../core/goal/state-v3';
import { nodeArtifactPaths, readGoalEvalArtifact } from '../core/goal/node-prompts';
import { computeGoalEvalHash, computeWavesHash } from '../core/goal/plan-package';

export interface PlanApprovalOptions {
  /** 客户端批准时声明的计划哈希（不匹配 → 409 stale_plan）。 */
  planHash?: string;
  /** 客户端批准时声明的 Goal Eval 哈希（不匹配 → 409 stale_plan）。 */
  evalHash?: string;
}

export interface GoalPlanDeps {
  body?: { approve?: boolean; feedback?: string; approvalId?: string; planHash?: string; evalHash?: string };
  loadState(goalId: string): GoalStateV3 | null;
  approvePlan(goalId: string, approvalId?: string, opts?: PlanApprovalOptions): Promise<boolean>;
  rejectPlan(goalId: string, feedback: string, approvalId?: string): Promise<boolean>;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function safeHash(fn: () => string): string | null {
  try { return fn(); } catch { return null; }
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
      const revision = effectiveRevision(state);
      // waves 缺失/损坏 → null（不 500，桌面渲染空态）
      const wavesPath = state.wavePlanPath
        ?? nodeArtifactPaths(state.mafwDir, goalId, state.round, { revision }).waves;
      let waves: any = null;
      try { waves = JSON.parse(fs.readFileSync(wavesPath, 'utf-8')); } catch { waves = null; }
      // Task 13：Goal Eval 与内容哈希（客户端据此判断"我看到的这一版"是否还能批准）。
      const evalRead = state.mafwDir
        ? readGoalEvalArtifact(state.mafwDir, goalId, revision, waves)
        : { goalEval: null, error: null, path: null as string | null };
      const planHash = waves && Array.isArray(waves.waves) ? safeHash(() => computeWavesHash(waves.waves)) : null;
      const evalHash = evalRead.goalEval ? safeHash(() => computeGoalEvalHash(evalRead.goalEval)) : null;
      const approval = state.planApproval ?? null;
      // stale = 用户在批旧的这一版（批准后内容被改写）。
      const stale = !!approval && (
        (approval.planHash != null && approval.planHash !== planHash)
        || (approval.evalHash != null && approval.evalHash !== evalHash)
      );
      json(res, 200, {
        planReview: state.planReview ?? 'auto',
        planApproval: approval,
        planFeedback: state.planFeedback ?? null,
        round: state.round,
        revision,
        waves,
        wavePlanPath: state.wavePlanPath ?? null,
        wavesPath,
        goalEval: evalRead.goalEval,
        goalEvalPath: evalRead.path,
        goalEvalError: evalRead.error,
        planHash,
        evalHash,
        stale,
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
      const approvalId = typeof deps.body?.approvalId === 'string' ? deps.body.approvalId : undefined;
      const planHash = typeof deps.body?.planHash === 'string' ? deps.body.planHash : undefined;
      const evalHash = typeof deps.body?.evalHash === 'string' ? deps.body.evalHash : undefined;
      const current = state.planApproval;
      if (current?.status !== 'pending') {
        json(res, 409, { error: 'plan approval is not pending (or goal is terminal)' });
        return true;
      }
      if (!approve && !feedback) {
        json(res, 400, { error: 'reject requires feedback' });
        return true;
      }
      // A new plan always carries a random id. Missing/stale ids never fall
      // through to the legacy path when the stored approval has an id.
      if (current.id && approvalId !== current.id) {
        json(res, 409, { error: 'stale or missing approvalId' });
        return true;
      }
      if (approve) {
        let ok = false;
        try {
          ok = await deps.approvePlan(
            goalId,
            approvalId,
            planHash || evalHash ? { planHash, evalHash } : undefined,
          );
        } catch (err: any) {
          if (err?.code === 'stale_plan') {
            json(res, 409, {
              error: err?.message ?? 'plan content changed since approval was requested',
              code: 'stale_plan',
              planHash: err?.hashes?.planHash ?? null,
              evalHash: err?.hashes?.evalHash ?? null,
            });
            return true;
          }
          throw err;
        }
        if (!ok) { json(res, 409, { error: 'plan approval is not pending (or goal is terminal)' }); return true; }
        json(res, 200, { success: true });
      } else {
        const ok = await deps.rejectPlan(goalId, feedback, approvalId);
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
