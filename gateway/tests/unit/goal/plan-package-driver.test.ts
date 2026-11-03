// gateway/tests/unit/goal/plan-package-driver.test.ts
// Task 13：PlanPackage 进入计划与批准。
// - 计划交卷 = waves + goalEval（Task 7 校验），两条腿各自落盘、各自 revision 化；
// - planApproval 绑定 planHash/evalHash；内容变了 approve 抛 stale_plan；
// - review 的必需 Goal 条件 id 来自 eval（Task 8 门），eval 坏了 fail closed；
// - 复用 Tech Lead 讨论会话的 idle 竞态（讨论回合的 idle 不误判 artifact_missing）；
// - revision ≥ 2 的复用 + 隔离产物。
import * as fs from 'fs';
import * as path from 'path';
import { makeHarness, seedGoal, Harness } from '../helpers/goal-driver-harness';
import { ensureGoalState } from '../../../src/core/goal/state-v3';
import { goalEvalArtifactPath, nodeArtifactPaths } from '../../../src/core/goal/node-prompts';
import {
  computeGoalEvalHash,
  computeWavesHash,
  validatePlanPackage,
} from '../../../src/core/goal/plan-package';

function goalEval(): any {
  return {
    outcome: '用户可以按项目切换会话标签',
    conditions: [
      { id: 'g1', statement: '标签按项目恢复', required: true, evidence: '冒烟截图 + 单测', method: 'npm test' },
      { id: 'g2', statement: '未加载项目显示空列表', required: false, evidence: 'store 单测', method: 'node --test' },
    ],
    failureConditions: ['刷新后标签丢失'],
    constraints: ['不改 gateway 契约'],
    nonGoals: ['不做跨项目拖拽'],
    mapping: { g1: { tasks: ['w1-t1'] } },
  };
}

function planDoc(overrides: { taskTitle?: string; eval?: any } = {}): any {
  return {
    status: 'ready',
    taskType: 'feature',
    waves: [{
      id: 'w1',
      title: '标签持久化',
      riskNote: 'localStorage 迁移易漏',
      tasks: [{ taskId: 'w1-t1', title: overrides.taskTitle ?? '按项目保存标签', acceptance: ['reload 后恢复'] }],
    }],
    goalEval: overrides.eval ?? goalEval(),
  };
}

function writePlan(
  h: Harness,
  goalId: string,
  opts: { round?: number; revision?: number; doc?: any } = {},
): string {
  const a = nodeArtifactPaths(h.mafwDir, goalId, opts.round ?? 1, { revision: opts.revision ?? 1 });
  fs.mkdirSync(path.dirname(a.waves), { recursive: true });
  fs.writeFileSync(a.waves, JSON.stringify(opts.doc ?? planDoc()), 'utf-8');
  return a.waves;
}

function hashesOf(doc: any) {
  const pkg = validatePlanPackage(doc);
  return { planHash: computeWavesHash(pkg.waves), evalHash: computeGoalEvalHash(pkg.goalEval) };
}

/** manual planReview：启动 plan 节点 → 写计划产物 → idle → 驻留待批。 */
async function parkPlan(
  h: Harness,
  opts: { goalId?: string; revision?: number; doc?: any } = {},
): Promise<{ goalId: string; sid: string; wavesPath: string }> {
  const goalId = opts.goalId ?? 'g1';
  const revision = opts.revision ?? 1;
  if (revision > 1) {
    ensureGoalState(h.mafwDir, goalId, { revision, projectDir: 'C:/p', maxRounds: 3 });
    h.driver.registerGoalDir(goalId, h.mafwDir);
    h.charter(goalId);
    h.write(goalId, { planReview: 'manual' });
  } else {
    seedGoal(h, goalId, { patch: { planReview: 'manual' } });
  }
  await h.driver.advance(goalId);
  const sid = h.load(goalId)!.nodeSession.id;
  const wavesPath = writePlan(h, goalId, { revision, doc: opts.doc });
  await h.fireIdle(sid);
  return { goalId, sid, wavesPath };
}

describe('PlanPackage at plan completion', () => {
  it('records plan+eval hashes and writes the eval artifact next to the revision', async () => {
    const h = makeHarness();
    const doc = planDoc();
    const { wavesPath } = await parkPlan(h, { doc });

    const st = h.load('g1')!;
    const expected = hashesOf(doc);
    expect(st.nextAction).toBe('AWAIT_PLAN_APPROVAL');
    expect(st.wavePlanPath).toBe(wavesPath);
    expect(st.planApproval).toMatchObject({
      status: 'pending',
      round: 1,
      revision: 1,
      planHash: expected.planHash,
      evalHash: expected.evalHash,
    });

    // 两条腿各自落盘：waves 原文 + 规范化后的 Goal Eval 独立产物。
    const evalPath = goalEvalArtifactPath(h.mafwDir, 'g1', 1);
    expect(evalPath).not.toBe(wavesPath);
    expect(JSON.parse(fs.readFileSync(evalPath, 'utf-8'))).toEqual(validatePlanPackage(doc).goalEval);
  });

  it('rejects an invalid embedded Goal Eval as artifact_invalid (no approval minted)', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    await h.driver.advance('g1');
    const sid = h.load('g1')!.nodeSession.id;

    writePlan(h, 'g1', { doc: planDoc({ eval: { ...goalEval(), conditions: [] } }) });
    await h.fireIdle(sid);

    expect(h.nodeRuns[0].status).toBe('failed');
    expect(h.nodeRuns[0].error).toContain('at least one condition');
    expect(h.load('g1')!.planApproval).toBeUndefined();
  });

  it('keeps legacy plans without goalEval parkable (plan hash only)', async () => {
    const h = makeHarness();
    const legacy = { status: 'ready', taskType: 'feature', waves: [{ id: 'w1', title: 'w', tasks: ['t'], riskNote: 'r' }] };
    const { wavesPath } = await parkPlan(h, { doc: legacy });

    const approval = h.load('g1')!.planApproval!;
    expect(approval).toMatchObject({ status: 'pending', round: 1 });
    // 交卷后 driver 会补齐稳定 taskId 并回写产物，hash 以落盘内容为准。
    const written = JSON.parse(fs.readFileSync(wavesPath, 'utf-8'));
    expect(approval.planHash).toBe(computeWavesHash(written.waves));
    expect(approval.evalHash).toBeNull();
  });

  it('fails closed when an existing eval file is unparseable', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    await h.driver.advance('g1');
    const sid = h.load('g1')!.nodeSession.id;
    const evalPath = goalEvalArtifactPath(h.mafwDir, 'g1', 1);
    fs.mkdirSync(path.dirname(evalPath), { recursive: true });
    fs.writeFileSync(evalPath, '{ not json', 'utf-8');

    // legacy 计划（waves 里没有 goalEval）+ 坏旁文件 → 不能静默当"没有 eval"。
    writePlan(h, 'g1', {
      doc: { status: 'ready', taskType: 'feature', waves: [{ id: 'w1', title: 'w', tasks: ['t'], riskNote: 'r' }] },
    });
    await h.fireIdle(sid);

    expect(h.nodeRuns[0].status).toBe('failed');
    expect(h.nodeRuns[0].error).toContain('not valid JSON');
  });
});

describe('approval is bound to plan and eval content', () => {
  it('approves the exact version that was submitted for review', async () => {
    const h = makeHarness();
    const doc = planDoc();
    await parkPlan(h, { doc });
    const approvalId = h.load('g1')!.planApproval!.id;
    const expected = hashesOf(doc);

    await expect(h.driver.approvePlan('g1', approvalId, { planHash: expected.planHash })).resolves.toBe(true);

    const st = h.load('g1')!;
    expect(st.planApproval).toMatchObject({
      status: 'approved',
      planHash: expected.planHash,
      evalHash: expected.evalHash,
    });
    expect(st.nodeSession?.phase).toBe('execute');
  });

  it('rejects an unknown planHash with stale_plan and refreshes the pending hash', async () => {
    const h = makeHarness();
    const doc = planDoc();
    const { sid } = await parkPlan(h, { doc });
    const approvalId = h.load('g1')!.planApproval!.id;
    const expected = hashesOf(doc);

    await expect(h.driver.approvePlan('g1', approvalId, { planHash: 'stale' }))
      .rejects.toMatchObject({ code: 'stale_plan' });

    const st = h.load('g1')!;
    expect(st.nextAction).toBe('AWAIT_PLAN_APPROVAL');
    expect(st.planApproval).toMatchObject({ status: 'pending', id: approvalId, planHash: expected.planHash });
    expect(st.nodeSession).toBeNull();
    expect(sid).toBeTruthy();

    // 客户端重新读取后用当前 hash 批准 → 放行。
    await expect(h.driver.approvePlan('g1', approvalId, { planHash: expected.planHash })).resolves.toBe(true);
    expect(h.load('g1')!.planApproval?.status).toBe('approved');
  });

  it('a rewritten waves artifact invalidates the stored approval (approve → stale_plan)', async () => {
    const h = makeHarness();
    await parkPlan(h);
    const approvalId = h.load('g1')!.planApproval!.id;
    const staleHash = h.load('g1')!.planApproval!.planHash;

    const rewritten = planDoc({ taskTitle: '按项目保存标签（改了）' });
    writePlan(h, 'g1', { doc: rewritten });

    await expect(h.driver.approvePlan('g1', approvalId, { planHash: staleHash }))
      .rejects.toMatchObject({ code: 'stale_plan' });

    const refreshed = h.load('g1')!.planApproval!;
    expect(refreshed.status).toBe('pending');
    expect(refreshed.planHash).toBe(hashesOf(rewritten).planHash);
    expect(refreshed.planHash).not.toBe(staleHash);

    await expect(h.driver.approvePlan('g1', approvalId)).resolves.toBe(true);
  });

  it('an eval-only change is stale too (evalHash covers the second leg)', async () => {
    const h = makeHarness();
    const doc = planDoc();
    await parkPlan(h, { doc });
    const approvalId = h.load('g1')!.planApproval!.id;

    const changedEval = validatePlanPackage(doc).goalEval;
    changedEval.conditions[0].statement = '标签按项目恢复（新口径）';
    const evalPath = goalEvalArtifactPath(h.mafwDir, 'g1', 1);
    fs.writeFileSync(evalPath, JSON.stringify(changedEval), 'utf-8');

    await expect(h.driver.approvePlan('g1', approvalId))
      .rejects.toMatchObject({ code: 'stale_plan' });

    const refreshed = h.load('g1')!.planApproval!;
    expect(refreshed.status).toBe('pending');
    expect(refreshed.planHash).toBe(hashesOf(doc).planHash); // waves 没变
    expect(refreshed.evalHash).toBe(computeGoalEvalHash(changedEval));
  });
});

describe('review rubric takes its required condition ids from the plan eval', () => {
  async function seedReview(h: Harness): Promise<string> {
    seedGoal(h, 'g1', { patch: { nextNode: 'review' } });
    writePlan(h, 'g1');
    const evalPath = goalEvalArtifactPath(h.mafwDir, 'g1', 1);
    fs.mkdirSync(path.dirname(evalPath), { recursive: true });
    fs.writeFileSync(evalPath, JSON.stringify(goalEval()), 'utf-8');
    await h.driver.advance('g1');
    return h.load('g1')!.nodeSession.id;
  }

  function writeReview(h: Harness, payload: unknown, round = 1): void {
    const a = nodeArtifactPaths(h.mafwDir, 'g1', round);
    fs.mkdirSync(path.dirname(a.review), { recursive: true });
    fs.writeFileSync(a.review, `\`\`\`mafw-review\n${JSON.stringify(payload)}\n\`\`\`\n`, 'utf-8');
  }

  it('lists the goal conditions in the review prompt', async () => {
    const h = makeHarness();
    await seedReview(h);
    const prompt = h.calls.find((c: any) => c.op === 'promptAsync')!.parts[0].text as string;
    expect(prompt).toContain('Goal 验收条件');
    expect(prompt).toContain('g1');
    expect(prompt).toContain('标签按项目恢复');
    expect(prompt).toContain('goalResults');
  });

  it('turns a review that skips a required goal condition into a same-round review FAIL (not artifact_invalid)', async () => {
    const h = makeHarness();
    const sid = await seedReview(h);
    writeReview(h, {
      verdict: 'PASS',
      tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test' }],
      feedback: 'ok',
    });
    await h.fireIdle(sid);

    // 评审内容缺必需条件 = 判定 FAIL，与失败任务同语义进入同轮定向修复；
    // 既不是终结性的产物错误，也不整轮重规划。
    expect(h.nodeRuns[0].status).toBe('succeeded');
    const st = h.load('g1')!;
    expect(st.reviewVerdict).toBe('FAIL');
    expect(st.reviewFeedback).toContain('g1');
    expect(st.nextNode).toBe('execute');
    expect(st.round).toBe(1);
    expect(st.reviewFix).toMatchObject({ round: 1 });
    expect(st.reviewFix?.omissions?.join(' ')).toContain('g1');
    expect(st.lastError).toBeNull();
    expect(h.calls.find((c: any) => c.op === 'archiveGoal')).toBeUndefined();
  });

  it('keeps unparseable review JSON as a terminal artifact failure', async () => {
    const h = makeHarness();
    const sid = await seedReview(h);
    const a = nodeArtifactPaths(h.mafwDir, 'g1', 1);
    fs.mkdirSync(path.dirname(a.review), { recursive: true });
    fs.writeFileSync(a.review, '```mafw-review\n{ not json\n```\n', 'utf-8');
    await h.fireIdle(sid);

    expect(h.nodeRuns[0].status).toBe('failed');
    expect(h.nodeRuns[0].error).toContain('mafw-review JSON block');
  });

  it('accepts a review that covers every required goal condition', async () => {
    const h = makeHarness();
    const sid = await seedReview(h);
    writeReview(h, {
      verdict: 'PASS',
      tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test' }],
      goalResults: [{ conditionId: 'g1', result: 'pass', evidence: '冒烟截图' }],
      feedback: 'ok',
    });
    await h.fireIdle(sid);

    expect(h.nodeRuns[0].status).toBe('succeeded');
    expect(h.load('g1')!.reviewVerdict).toBe('PASS');
    expect(h.calls.find((c: any) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'PASS' });
  });
});

describe('reused Tech Lead session', () => {
  it('ignores the discussion turn idle (no artifact yet) instead of failing the plan node', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    h.deps.existingNodeSession = (goalId, node) => (node === 'plan' ? 'ses_tech_lead' : null);
    await h.driver.advance('g1');

    // 讨论回合先结束：此时计划产物还不存在。
    await h.fireIdle('ses_tech_lead');
    expect(h.nodeRuns[0].status).toBe('running');
    expect(h.nodeRuns[0].error).toBeUndefined();
    expect(h.load('g1')!.nodeSession?.id).toBe('ses_tech_lead');

    // 计划回合真正写完 → 同一个 idle 通道完成。
    writePlan(h, 'g1');
    await h.fireIdle('ses_tech_lead');
    expect(h.load('g1')!.planApproval?.status).toBe('pending');
    expect(h.nodeRuns[0].status).toBe('succeeded');
  });

  it('still fails a reused session when a second idle produces no artifact', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    h.deps.existingNodeSession = (goalId, node) => (node === 'plan' ? 'ses_tech_lead' : null);
    await h.driver.advance('g1');

    await h.fireIdle('ses_tech_lead');
    await h.fireIdle('ses_tech_lead');

    expect(h.nodeRuns[0].status).toBe('failed');
    expect(h.nodeRuns[0].error).toContain('waves.json');
  });

  it('does not settle a re-planned node on the previous plan artifact', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    h.deps.existingNodeSession = (goalId, node) => (node === 'plan' ? 'ses_tech_lead' : null);

    await h.driver.advance('g1');
    writePlan(h, 'g1');
    await h.fireIdle('ses_tech_lead');
    const approvalId = h.load('g1')!.planApproval!.id;

    // 驳回 → 同 session 重跑 plan，旧 waves.json 还在磁盘上。
    await h.driver.rejectPlan('g1', '拆太粗', approvalId);
    const planRuns = () => h.nodeRuns.filter((r: any) => r.node === 'plan');
    expect(planRuns()).toHaveLength(2);

    await h.fireIdle('ses_tech_lead'); // 旧产物不算完成（宽容一次）
    expect(planRuns()[1].status).toBe('running');
    expect(h.load('g1')!.planApproval?.status).toBe('rejected');

    const second = planDoc({ taskTitle: '第二版计划' });
    writePlan(h, 'g1', { doc: second });
    await h.fireIdle('ses_tech_lead');

    const st = h.load('g1')!;
    expect(st.planApproval?.status).toBe('pending');
    expect(st.planApproval?.planHash).toBe(hashesOf(second).planHash);
  });

  it('reuses the discussion session for revision 2 and keeps artifacts isolated', async () => {
    const h = makeHarness();
    const asked: number[] = [];
    h.deps.existingNodeSession = (goalId, node, revision) => {
      asked.push(revision);
      return node === 'plan' ? 'ses_tech_lead' : null;
    };
    const doc = planDoc();
    await parkPlan(h, { revision: 2, doc });

    const a = nodeArtifactPaths(h.mafwDir, 'g1', 1, { revision: 2 });
    const prompt = h.calls.find((c: any) => c.op === 'promptAsync')!.parts[0].text as string;
    expect(asked).toEqual([2]);
    expect(h.calls.filter((c: any) => c.op === 'create')).toHaveLength(0);
    expect(prompt).toContain(a.waves);
    expect(prompt).toContain(goalEvalArtifactPath(h.mafwDir, 'g1', 2));

    const st = h.load('g1')!;
    expect(st.revision).toBe(2);
    expect(st.wavePlanPath).toBe(a.waves);
    expect(st.planApproval).toMatchObject({ status: 'pending', revision: 2, planHash: hashesOf(doc).planHash });
    expect(fs.existsSync(goalEvalArtifactPath(h.mafwDir, 'g1', 2))).toBe(true);
    // revision 1 的产物位置保持干净（隔离目录之外的 legacy 路径不被写入）。
    expect(fs.existsSync(nodeArtifactPaths(h.mafwDir, 'g1', 1).waves)).toBe(false);
    // 复用会话永不 delete（owner 是 Tech Lead supervisor）。
    expect(h.calls.filter((c: any) => c.op === 'delete')).toHaveLength(0);
    expect(h.calls.find((c: any) => c.op === 'promptAsync').sessionID).toBe('ses_tech_lead');
  });
});
