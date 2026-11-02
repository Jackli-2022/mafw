// gateway/tests/unit/pod/plan-approval-hash.test.ts
// Task 13：批准绑定计划内容版本 + 计划任务编辑使旧批准失效。
// - PodTaskService 的 edit/add/delete 写回 waves.json 后必须让 planApproval 的 hash 对齐
//   （pending 刷新、approved 回 pending 并换 id）；
// - GET /plan 暴露 revision / goalEval / planHash / evalHash / stale；
// - POST /plan-approval 带过期 hash → 409 code=stale_plan。
import Database from 'better-sqlite3';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodTaskService } from '../../../src/core/pod/pod-task-service';
import { makeHarness, seedGoal, Harness } from '../helpers/goal-driver-harness';
import { loadGoalState } from '../../../src/core/goal/state-v3';
import { goalEvalArtifactPath, nodeArtifactPaths } from '../../../src/core/goal/node-prompts';
import {
  computeGoalEvalHash,
  computeWavesHash,
  validatePlanPackage,
} from '../../../src/core/goal/plan-package';
import { handleGoalPlan } from '../../../src/routes/goal-plan';

function goalEval(): any {
  return {
    outcome: '用户可以按项目切换会话标签',
    conditions: [
      { id: 'g1', statement: '标签按项目恢复', required: true, evidence: '冒烟截图', method: 'npm test' },
    ],
    failureConditions: ['刷新后标签丢失'],
    constraints: ['不改 gateway 契约'],
    nonGoals: ['不做跨项目拖拽'],
    mapping: { g1: { tasks: ['w1-t1'] } },
  };
}

function planDoc(taskTitle = '按项目保存标签'): any {
  return {
    status: 'ready',
    taskType: 'feature',
    waves: [{
      id: 'w1',
      title: '标签持久化',
      riskNote: '迁移易漏',
      tasks: [
        { taskId: 'w1-t1', title: taskTitle, acceptance: ['reload 后恢复'] },
        { taskId: 'w1-t2', title: '空项目空列表', acceptance: ['无 tab 时为空'] },
      ],
    }],
    goalEval: goalEval(),
  };
}

function writePlan(h: Harness, goalId = 'g1', doc: any = planDoc()): string {
  const a = nodeArtifactPaths(h.mafwDir, goalId, 1);
  fs.mkdirSync(path.dirname(a.waves), { recursive: true });
  fs.writeFileSync(a.waves, JSON.stringify(doc), 'utf-8');
  return a.waves;
}

function hashesOf(doc: any) {
  const pkg = validatePlanPackage(doc);
  return { planHash: computeWavesHash(pkg.waves), evalHash: computeGoalEvalHash(pkg.goalEval) };
}

/** manual planReview：启动 plan → 写 waves+goalEval → idle → 驻留待批（未接线 Pod 服务）。 */
async function parkPlan(h: Harness): Promise<string> {
  seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
  await h.driver.advance('g1');
  const sid = h.load('g1')!.nodeSession.id;
  writePlan(h, 'g1');
  await h.fireIdle(sid);
  return sid;
}

describe('plan edits invalidate the approval binding', () => {
  let dir: string;
  let db: Database.Database;
  let store: PodStore;
  let seq: number;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-plan-hash-'));
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    store.ensurePod({ id: 'pod_1', projectDir: 'C:/p', name: 'P', now: '2026-11-03T00:00:00.000Z' });
    seq = 0;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeService(h: Harness): PodTaskService {
    return new PodTaskService({
      store,
      now: () => '2026-11-03T00:00:00.000Z',
      newId: () => `task_${++seq}`,
      notify: () => {},
      resolveGoalPlan: (goalId) => {
        const state = loadGoalState(h.mafwDir, goalId);
        if (!state) return null;
        return {
          wavesPath: state.wavePlanPath ?? nodeArtifactPaths(h.mafwDir, goalId, state.round).waves,
          nextAction: state.nextAction,
          nodeSession: state.nodeSession,
        };
      },
      invalidatePlanApproval: (goalId) => { h.driver.refreshPlanApproval(goalId); },
    });
  }

  it('refreshes a pending approval hash when a plan task is edited', async () => {
    const h = makeHarness();
    await parkPlan(h);
    const service = makeService(h);
    const before = h.load('g1')!.planApproval!;
    const tasks = service.projectWaves('pod_1', 'g1', planDoc() as any);

    const updated = service.editPlanTask('pod_1', tasks[0].id, { title: '按项目保存标签（改）' });
    expect(updated.title).toBe('按项目保存标签（改）');

    const after = h.load('g1')!.planApproval!;
    expect(after.status).toBe('pending');
    expect(after.id).toBe(before.id); // 同一轮审阅，内容换了 → 让客户端重读后用新 hash
    expect(after.planHash).toBe(hashesOf(planDoc('按项目保存标签（改）')).planHash);
    expect(after.planHash).not.toBe(before.planHash);
    expect(after.evalHash).toBe(before.evalHash); // eval 没动

    await expect(h.driver.approvePlan('g1', before.id, { planHash: before.planHash }))
      .rejects.toMatchObject({ code: 'stale_plan' });
    await expect(h.driver.approvePlan('g1', after.id, { planHash: after.planHash })).resolves.toBe(true);
  });

  it('adding and deleting plan tasks also refresh the binding', async () => {
    const h = makeHarness();
    await parkPlan(h);
    const service = makeService(h);
    service.projectWaves('pod_1', 'g1', planDoc() as any);

    const pendingHash = h.load('g1')!.planApproval!.planHash;
    const added = service.addPlanTask('pod_1', 'g1', null, '新增任务', ['跑测试']);
    const afterAdd = h.load('g1')!.planApproval!;
    expect(afterAdd.status).toBe('pending');
    expect(afterAdd.planHash).not.toBe(pendingHash);

    service.deleteTask('pod_1', added.id);
    const afterDelete = h.load('g1')!.planApproval!;
    expect(afterDelete.planHash).not.toBe(afterAdd.planHash);
    expect(afterDelete.planHash).toBe(pendingHash); // 回到编辑前的计划内容
  });

  it('re-opens approval (new id, no decidedAt) when an approved plan is edited', async () => {
    const h = makeHarness();
    await parkPlan(h);
    const approved = h.load('g1')!.planApproval!;
    h.write('g1', {
      planApproval: { ...approved, status: 'approved', decidedAt: '2026-11-03T00:00:00.000Z' },
      nextAction: 'AWAIT_PLAN_APPROVAL',
      nodeSession: null,
    });
    const service = makeService(h);
    const tasks = service.projectWaves('pod_1', 'g1', planDoc() as any);

    service.editPlanTask('pod_1', tasks[0].id, { title: '改过' });

    const st = h.load('g1')!;
    expect(st.planApproval?.status).toBe('pending');
    expect(st.planApproval?.id).not.toBe(approved.id);
    expect(st.planApproval?.decidedAt).toBeUndefined();
    expect(st.nextAction).toBe('AWAIT_PLAN_APPROVAL'); // 重新驻留批准门
    expect(st.planApproval?.planHash).toBe(hashesOf(planDoc('改过')).planHash);
  });
});

describe('GET/POST /api/goals/:id/plan with content hashes', () => {
  function makeRes() {
    const out = { status: 0, body: '' as any };
    const res = {
      writeHead(status: number) { out.status = status; },
      end(body?: string) { out.body = body ? JSON.parse(body) : null; },
      setHeader() {},
    } as unknown as http.ServerResponse;
    return { res, out };
  }

  function deps(h: Harness, body?: any) {
    return {
      body,
      loadState: (goalId: string) => loadGoalState(h.mafwDir, goalId),
      approvePlan: (goalId: string, approvalId?: string, opts?: any) =>
        h.driver.approvePlan(goalId, approvalId, opts),
      rejectPlan: (goalId: string, feedback: string, approvalId?: string) =>
        h.driver.rejectPlan(goalId, feedback, approvalId),
    };
  }

  it('returns revision, goalEval and both hashes', async () => {
    const h = makeHarness();
    await parkPlan(h);
    const { res, out } = makeRes();
    await handleGoalPlan({ method: 'GET' } as http.IncomingMessage, res, '/api/goals/g1/plan', deps(h) as any);

    const doc = planDoc();
    expect(out.status).toBe(200);
    expect(out.body.revision).toBe(1);
    expect(out.body.goalEval).toEqual(validatePlanPackage(doc).goalEval);
    expect(out.body.goalEvalPath).toBe(goalEvalArtifactPath(h.mafwDir, 'g1', 1));
    expect(out.body.planHash).toBe(hashesOf(doc).planHash);
    expect(out.body.evalHash).toBe(hashesOf(doc).evalHash);
    expect(out.body.stale).toBe(false);
  });

  it('plans from a structured submission: minted hashes equal GET /plan and the first approve succeeds', async () => {
    const doc = planDoc();
    const h = makeHarness({ structured: async () => doc });
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    // 上一版计划还留在磁盘上（驳回重规划/重试）：结构化交卷必须覆盖它，否则
    // disk / hash / GET / approve 看到四份不同内容。
    writePlan(h, 'g1', planDoc('上一版标题'));
    await h.driver.advance('g1');
    const sid = h.load('g1')!.nodeSession.id;
    await h.fireIdle(sid);

    const st = h.load('g1')!;
    expect(st.planApproval?.status).toBe('pending');
    const onDisk = JSON.parse(fs.readFileSync(st.wavePlanPath!, 'utf-8'));
    expect(onDisk.waves[0].tasks[0].title).toBe('按项目保存标签'); // submitted 已落盘
    expect(st.planApproval?.planHash).toBe(hashesOf(onDisk).planHash);
    expect(st.planApproval?.evalHash).toBe(hashesOf(onDisk).evalHash);

    const read = makeRes();
    await handleGoalPlan({ method: 'GET' } as http.IncomingMessage, read.res, '/api/goals/g1/plan', deps(h) as any);
    expect(read.out.body.stale).toBe(false);
    expect(read.out.body.planHash).toBe(st.planApproval?.planHash);
    expect(read.out.body.evalHash).toBe(st.planApproval?.evalHash);

    const first = makeRes();
    await handleGoalPlan(
      { method: 'POST' } as http.IncomingMessage,
      first.res,
      '/api/goals/g1/plan-approval',
      deps(h, {
        approve: true,
        approvalId: st.planApproval!.id,
        planHash: read.out.body.planHash,
        evalHash: read.out.body.evalHash,
      }) as any,
    );
    expect(first.out.status).toBe(200);
    expect(h.load('g1')!.planApproval?.status).toBe('approved');
  });

  it('flags stale after the plan artifact is rewritten, and 409s a stale approve', async () => {
    const h = makeHarness();
    await parkPlan(h);
    const approvalId = h.load('g1')!.planApproval!.id;
    const oldHash = h.load('g1')!.planApproval!.planHash;
    writePlan(h, 'g1', planDoc('被改写'));

    const read = makeRes();
    await handleGoalPlan({ method: 'GET' } as http.IncomingMessage, read.res, '/api/goals/g1/plan', deps(h) as any);
    expect(read.out.body.stale).toBe(true);

    const stale = makeRes();
    await handleGoalPlan(
      { method: 'POST' } as http.IncomingMessage,
      stale.res,
      '/api/goals/g1/plan-approval',
      deps(h, { approve: true, approvalId, planHash: oldHash }) as any,
    );
    expect(stale.out.status).toBe(409);
    expect(stale.out.body.code).toBe('stale_plan');
    expect(stale.out.body.planHash).toBe(hashesOf(planDoc('被改写')).planHash);

    const fresh = makeRes();
    await handleGoalPlan(
      { method: 'POST' } as http.IncomingMessage,
      fresh.res,
      '/api/goals/g1/plan-approval',
      deps(h, { approve: true, approvalId }) as any,
    );
    expect(fresh.out.status).toBe(200);
    expect(fresh.out.body.success).toBe(true);
    expect(h.load('g1')!.planApproval?.status).toBe('approved');
  });
});
