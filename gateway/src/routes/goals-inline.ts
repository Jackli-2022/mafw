/**
 * Phase D1 Task F2: goals inline 面（registry dispatch 接线）。
 *
 *   POST /api/goals/:goalId/questions/:questionId/respond — 人侧回答/取消（goals.respondQuestion，E7-1 human-only）
 *   GET  /api/goals/:id/timeline                          — 节点级 trace 聚合（goals.timeline）
 *   POST /api/goals/:id/nodes/:runId/retry                — 节点重跑（goals.retryNode）
 *   GET  /api/goals/:id/plan                              — W1 计划审阅（goals.plan）
 *   POST /api/goals/:id/plan-approval                     — 计划批准/驳回（goals.planApproval）
 *   POST /api/work/:goalId/validate                       — goal 创建校验（goals.validate）
 *   POST /api/work/:goalId/complete                       — phase 完成上报（goals.complete）
 *
 * handler 体从 index.ts legacy 分支逐字迁移（`this.x` → `deps.x()`）。plan /
 * plan-approval 在 legacy 是一条联合正则分支：body 只在 POST 预读，然后把**原始
 * req.url** 交给 handleGoalPlan 内部再分流 —— 两个 registry op 都保持这一形状
 * （handleGoalPlan 返回 false 时原样上抛，dispatch 回落 legacy/dashboard）。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { loadGoalState } from '../core/goal/state-v3';
import { QuestionLedger } from '../core/manager/question-ledger';
import type { NodeDriver } from '../core/goal/driver';
import type { GatewayDatabase } from '../memory/gateway-db';
import { handleGoalPlan } from './goal-plan';
import { handleGoalTimeline } from './goal-timeline';
import { handleNodeRetry } from './goal-node-retry';
import { readRouteBody } from './cognition';
import { requireHumanPrincipal } from '../core/http/human-guard';
import type { RouteRegistry } from './registry';

export interface GoalsInlineRouteDeps {
  mafwDir: () => string;
  goalDriver: () => NodeDriver | null;
  goalDriverMafwDirCache: () => Map<string, string>;
  findGoalStatePath: (goalId: string) => { statePath: string; info: { mafwDir: string } } | null;
  loadRequest: (goalId: string) => Promise<any>;
  getGatewayDb: () => GatewayDatabase;
  handleValidate: (goalId: string, data?: { projectDir?: string }) => Promise<any>;
  handleComplete: (goalId: string, data?: { score?: number }) => Promise<any>;
}

export function attachGoalRoutes(registry: RouteRegistry, deps: GoalsInlineRouteDeps): void {
  // POST /api/goals/{goalId}/questions/{questionId}/respond
  registry.attachHandler('goals.respondQuestion', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    // E7-1 (review round): answering / cancelling a goal question is a human
    // decision. Gate before the body read so a denied request consumes nothing.
    if (!requireHumanPrincipal(req, res)) return;
    const goalId = params.goalId;
    const questionId = params.questionId;
    const body = await readRouteBody(req);
    let data: any;
    try { data = JSON.parse(body); } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ status: 'bad_request', error: 'Invalid JSON' }));
      return;
    }
    const ledger = new QuestionLedger(deps.mafwDir());
    const state = ledger.getQuestionState(questionId);
    if (!state) {
      res.writeHead(404);
      res.end(JSON.stringify({ status: 'not_found' }));
      return;
    }
    if (state !== 'pending') {
      res.writeHead(409);
      res.end(JSON.stringify({ status: 'conflict', currentState: state }));
      return;
    }
    if (data.type === 'cancel') {
      // NodeDriver 写 ledger cancelled + state → archive_fail（不再依赖 langgraph）
      deps.goalDriver()?.handleCancel(goalId, questionId);
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'accepted', action: 'cancelled' }));
      return;
    }
    // answer or redirect —— NodeDriver（state 驱动，langgraph Command 退役）
    deps.goalDriver()?.handleAnswer(goalId, questionId, data.answer || '');
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'accepted' }));
  });

  // GET /api/goals/:id/timeline — 节点级 trace 聚合（须在 dashboard 兜底之前）
  registry.attachHandler('goals.timeline', (req: IncomingMessage, res: ServerResponse) =>
    handleGoalTimeline(req, res, req.url!, {
      loadState: (goalId) => {
        const mafwDir = deps.goalDriverMafwDirCache().get(goalId)
          ?? deps.findGoalStatePath(goalId)?.info.mafwDir;
        return mafwDir ? loadGoalState(mafwDir, goalId) : null;
      },
      listNodeRuns: (goalId) => deps.getGatewayDb().listNodeRuns(goalId),
      loadRequest: (goalId) => { try { return deps.loadRequest(goalId); } catch { return null; } },
      getOutcome: (goalId) => deps.getGatewayDb().getGoalOutcome(goalId),
    }));

  // POST /api/goals/:id/nodes/:runId/retry — 节点重跑（execute 过 destructive 门）
  registry.attachHandler('goals.retryNode', async (req: IncomingMessage, res: ServerResponse) => {
    const goalIdM = req.url!.match(/^\/api\/goals\/([^/]+)\/nodes\/\d+\/retry$/);
    // registry 模板 `:runId` 接受任意段，且 match() 会剥 query/尾斜杠 —— legacy 里
    // 同一条正则既是入口门也是解构依据，迁到 registry 后必须显式回落（false →
    // dispatchAuthorized 回退 legacy/dashboard，与 legacy 同形）。
    // body 必须在门的**后面**读：被 decline 的 URL 一个字节都不消费（legacy 从不到
    // 达这条分支，body 原样留给下游）。
    if (!goalIdM) return false;
    const raw = await readRouteBody(req);
    let body: any; try { body = JSON.parse(raw); } catch { body = {}; }
    const goalId = decodeURIComponent(goalIdM[1]);
    return handleNodeRetry(req, res, req.url!, {
      body,
      getNodeRun: (runId) => deps.getGatewayDb().listNodeRuns(goalId).find((r: any) => r.id === runId) ?? null,
      retryNodeRun: (g, runId) => deps.goalDriver()!.retryNodeRun(g, runId),
    });
  });

  // GET /api/goals/:id/plan — W1 计划审阅（须在 dashboard /api/goals* 兜底之前）。
  // 联合分支拆成两个 op 后仍把**原始 req.url** 交给 handleGoalPlan 内部分流；
  // body 只在 POST 预读（与 legacy 完全一致）。
  registry.attachHandler('goals.plan', async (req: IncomingMessage, res: ServerResponse) => {
    let body: any = {};
    if (req.method === 'POST') {
      try { body = JSON.parse(await readRouteBody(req)); } catch { body = {}; }
    }
    return handleGoalPlan(req, res, req.url!, {
      body,
      loadState: (goalId) => {
        const mafwDir = deps.goalDriverMafwDirCache().get(goalId)
          ?? deps.findGoalStatePath(goalId)?.info.mafwDir;
        return mafwDir ? loadGoalState(mafwDir, goalId) : null;
      },
      approvePlan: (g, approvalId, opts) => deps.goalDriver()!.approvePlan(g, approvalId, opts),
      rejectPlan: (g, feedback, approvalId) => deps.goalDriver()!.rejectPlan(g, feedback, approvalId),
    });
  });

  // POST /api/goals/:id/plan-approval — 计划批准/驳回（同一 handleGoalPlan 分流）。
  registry.attachHandler('goals.planApproval', async (req: IncomingMessage, res: ServerResponse) => {
    let body: any = {};
    if (req.method === 'POST') {
      try { body = JSON.parse(await readRouteBody(req)); } catch { body = {}; }
    }
    return handleGoalPlan(req, res, req.url!, {
      body,
      loadState: (goalId) => {
        const mafwDir = deps.goalDriverMafwDirCache().get(goalId)
          ?? deps.findGoalStatePath(goalId)?.info.mafwDir;
        return mafwDir ? loadGoalState(mafwDir, goalId) : null;
      },
      approvePlan: (g, approvalId, opts) => deps.goalDriver()!.approvePlan(g, approvalId, opts),
      rejectPlan: (g, feedback, approvalId) => deps.goalDriver()!.rejectPlan(g, feedback, approvalId),
    });
  });

  // POST /api/work/{goalId}/validate — MCP calls when agent completes goal creation
  registry.attachHandler('goals.validate', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    try {
      const goalId = params.goalId;
      const body = await readRouteBody(req);
      const data = body ? JSON.parse(body) : {};
      const result = await deps.handleValidate(goalId, data);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (err: any) {
      const status = err.message === 'Goal already exists' ? 409 : 400;
      res.writeHead(status);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // POST /api/work/{goalId}/complete — MCP calls when agent completes a phase
  registry.attachHandler('goals.complete', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    try {
      const goalId = params.goalId;
      const body = await readRouteBody(req);
      const data = body ? JSON.parse(body) : {};
      const result = await deps.handleComplete(goalId, data);
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}
