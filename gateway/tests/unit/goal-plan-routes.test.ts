// gateway/tests/unit/goal-plan-routes.test.ts
// W1 计划审阅 HTTP 路由：GET /api/goals/:id/plan + POST /api/goals/:id/plan-approval。
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleGoalPlan } from '../../src/routes/goal-plan';
import { ensureGoalState } from '../../src/core/goal/state-v3';

// 极薄 res harness（照抄 goal-node-retry 测试模式：直接调用 handler + 收集 json）
function makeRes() {
  const out = { status: 0, body: '' as any };
  const res = {
    writeHead(status: number) { out.status = status; },
    end(body?: string) { out.body = body ? JSON.parse(body) : null; },
    setHeader() {},
  } as unknown as http.ServerResponse;
  return { res, out };
}

function makeDeps(opts?: { approveResult?: boolean; rejectResult?: boolean }) {
  const mafwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-plan-route-'));
  fs.mkdirSync(path.join(mafwDir, 'goals'), { recursive: true });
  const wavesPath = path.join(mafwDir, 'waves.json');
  fs.writeFileSync(wavesPath, JSON.stringify({ status: 'ready', waves: [{ id: 'w1', title: 't', tasks: ['a'], riskNote: 'r' }] }), 'utf-8');
  const calls: any[] = [];
  const deps = {
    loadState: (goalId: string) => {
      if (goalId !== 'g1') return null;
      const s = ensureGoalState(mafwDir, 'g1', { projectDir: 'C:/p', maxRounds: 3 });
      return { ...s, wavePlanPath: wavesPath, planReview: 'manual' as const, planApproval: { status: 'pending' as const, round: 1 }, mafwDir };
    },
    approvePlan: async () => { calls.push('approve'); return opts?.approveResult ?? true; },
    rejectPlan: async (goalId: string, feedback: string) => { calls.push({ reject: feedback }); return opts?.rejectResult ?? true; },
  };
  return { mafwDir, wavesPath, calls, deps };
}

describe('GET /api/goals/:id/plan', () => {
  it('返回 waves + planReview/planApproval', async () => {
    const { deps } = makeDeps();
    const { res, out } = makeRes();
    const handled = await handleGoalPlan({ method: 'GET' } as http.IncomingMessage, res, '/api/goals/g1/plan', deps as any);
    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body.planReview).toBe('manual');
    expect(out.body.planApproval.status).toBe('pending');
    expect(out.body.waves.waves).toHaveLength(1);
    expect(out.body.wavePlanPath).toBeTruthy();
  });

  it('waves 文件缺失 → waves:null 且 200（不 500）', async () => {
    const { mafwDir, deps } = makeDeps();
    const s = deps.loadState('g1')!;
    fs.rmSync((s as any).wavePlanPath);
    const { res, out } = makeRes();
    await handleGoalPlan({ method: 'GET' } as http.IncomingMessage, res, '/api/goals/g1/plan', { ...deps, loadState: () => ({ ...s, wavePlanPath: null }) } as any);
    expect(out.status).toBe(200);
    expect(out.body.waves).toBeNull();
  });

  it('未知 goal → 404', async () => {
    const { deps } = makeDeps();
    const { res, out } = makeRes();
    await handleGoalPlan({ method: 'GET' } as http.IncomingMessage, res, '/api/goals/nope/plan', deps as any);
    expect(out.status).toBe(404);
  });

  it('不匹配的路径 → handled=false', async () => {
    const { deps } = makeDeps();
    const { res } = makeRes();
    const handled = await handleGoalPlan({ method: 'GET' } as http.IncomingMessage, res, '/api/goals/g1/other', deps as any);
    expect(handled).toBe(false);
  });
});

describe('POST /api/goals/:id/plan-approval', () => {
  async function post(body: any, deps: any) {
    const { res, out } = makeRes();
    const handled = await handleGoalPlan({ method: 'POST' } as http.IncomingMessage, res, '/api/goals/g1/plan-approval', { ...deps, body } as any);
    return { handled, out };
  }

  it('approve: pending → 200 且调 approvePlan', async () => {
    const { deps, calls } = makeDeps();
    const { out } = await post({ approve: true }, deps);
    expect(out.status).toBe(200);
    expect(out.body.success).toBe(true);
    expect(calls).toContain('approve');
  });

  it('reject: feedback 非空 → 200 且调 rejectPlan', async () => {
    const { deps, calls } = makeDeps();
    const { out } = await post({ approve: false, feedback: '拆太粗' }, deps);
    expect(out.status).toBe(200);
    expect(calls).toEqual([{ reject: '拆太粗' }]);
  });

  it('reject 无 feedback → 400', async () => {
    const { deps } = makeDeps();
    const { out } = await post({ approve: false }, deps);
    expect(out.status).toBe(400);
  });

  it('driver 返回 false（非 pending/终态）→ 409', async () => {
    const { deps } = makeDeps({ approveResult: false });
    const { out } = await post({ approve: true }, deps);
    expect(out.status).toBe(409);
  });

  it('未知 goal → 404', async () => {
    const { deps } = makeDeps();
    const { out } = await post({ approve: true }, { ...deps, loadState: () => null } as any);
    expect(out.status).toBe(404);
  });

  it('未知 goal reject → 404（不误报 400）', async () => {
    const { deps } = makeDeps();
    const { out } = await post({ approve: false, feedback: 'x' }, { ...deps, loadState: () => null } as any);
    expect(out.status).toBe(404);
  });
});
