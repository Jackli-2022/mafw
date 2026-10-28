// gateway/tests/unit/goal-driver-plan-review.test.ts
// W1：manual 批准门——park / stray advance 守卫 / approve / reject / 幂等 / attempt 修正。
import * as fs from 'fs';
import * as path from 'path';
import { makeHarness, seedGoal } from './helpers/goal-driver-harness';
import { nodeArtifactPaths } from '../../src/core/goal/node-prompts';

function writeReadyWaves(h: ReturnType<typeof makeHarness>, goalId: string, round = 1) {
  const a = nodeArtifactPaths(h.mafwDir, goalId, round);
  fs.writeFileSync(a.waves, JSON.stringify({ status: 'ready', taskType: 'feature', waves: [{ id: 'w1', title: 't', tasks: ['a'], riskNote: 'r' }] }), 'utf-8');
}

describe('W1 plan-review gate: park', () => {
  it('manual + plan ready → AWAIT_PLAN_APPROVAL 驻留，不启动 execute', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const sid = await h.startAndIdle('g1');
    writeReadyWaves(h, 'g1');
    await h.fireIdle(sid);

    const st = h.load('g1')!;
    expect(st.nextAction).toBe('AWAIT_PLAN_APPROVAL');
    expect(st.planApproval).toMatchObject({ status: 'pending', round: 1 });
    expect(st.nextNode).toBe('execute');
    expect(h.calls.filter((c: any) => c.op === 'create')).toHaveLength(1); // 只有 plan 会话
    expect(h.phases.some((p: any) => p.phase === 'PLANNING_AWAIT_APPROVAL')).toBe(true);
    expect(h.nodeRuns[0].status).toBe('succeeded');
  });

  it('stray advance 不越门（advance/examineStaleNode 双路径）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const sid = await h.startAndIdle('g1');
    writeReadyWaves(h, 'g1');
    await h.fireIdle(sid);

    await h.driver.advance('g1');
    await h.driver.examineStaleNode('g1');
    expect(h.calls.filter((c: any) => c.op === 'create')).toHaveLength(1);
    expect(h.load('g1')!.nextAction).toBe('AWAIT_PLAN_APPROVAL');
  });

  it('plan 成功即清 planFeedback（清除点）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual', planFeedback: '上一版的意见' } });
    const sid = await h.startAndIdle('g1');
    writeReadyWaves(h, 'g1');
    await h.fireIdle(sid);
    expect(h.load('g1')!.planFeedback).toBeNull();
  });

  it('executeNode 建会话后调 bindModel（W1：身份模型绑定，v2 会话模型与 agent 解耦）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    await h.driver.advance('g1');
    const bind = h.calls.filter((c: any) => c.op === 'bindModel');
    expect(bind).toHaveLength(1);
    expect(bind[0].agent).toBe('mafw-plan');
    expect(bind[0].sessionId).toBeTruthy();
  });

  it('auto goal plan ready → 直接 execute（回归：无门）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1'); // 无 planReview = auto
    const sid = await h.startAndIdle('g1');
    writeReadyWaves(h, 'g1');
    await h.fireIdle(sid);
    const st = h.load('g1')!;
    expect(st.planApproval).toBeUndefined();
    expect(st.nodeSession?.phase).toBe('execute');
  });
});

describe('W1 plan-review gate: approve / reject', () => {
  async function park(h: ReturnType<typeof makeHarness>) {
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const sid = await h.startAndIdle('g1');
    writeReadyWaves(h, 'g1');
    await h.fireIdle(sid);
    return sid;
  }

  it('approvePlan → approved + 启动 execute', async () => {
    const h = makeHarness();
    await park(h);
    const ok = await h.driver.approvePlan('g1');
    expect(ok).toBe(true);
    const st = h.load('g1')!;
    expect(st.planApproval?.status).toBe('approved');
    expect(st.nodeSession?.phase).toBe('execute');
    expect(h.calls.filter((c: any) => c.op === 'create')).toHaveLength(2);
  });

  it('rejectPlan → planFeedback + 同 round 重跑 plan（attempt 修正 = 2）', async () => {
    const h = makeHarness();
    await park(h);
    const ok = await h.driver.rejectPlan('g1', 'wave 1 拆太粗');
    expect(ok).toBe(true);
    const st = h.load('g1')!;
    expect(st.planApproval?.status).toBe('rejected');
    expect(st.planFeedback).toBe('wave 1 拆太粗');
    expect(st.nodeSession?.phase).toBe('plan');
    const planRuns = h.nodeRuns.filter((r: any) => r.node === 'plan');
    expect(planRuns).toHaveLength(2);
    expect(planRuns[1].attempt).toBe(2); // 上一行 succeeded 也 +1（推导修正）
    expect(planRuns[1].loop).toBe(1);
  });

  it('非 pending：approve/reject 返回 false，state 不变', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual' } });
    const sid = await h.startAndIdle('g1');
    writeReadyWaves(h, 'g1');
    await h.fireIdle(sid);
    await h.driver.approvePlan('g1');
    const ok1 = await h.driver.approvePlan('g1');
    const ok2 = await h.driver.rejectPlan('g1', 'x');
    expect(ok1).toBe(false);
    expect(ok2).toBe(false);
    expect(h.load('g1')!.planApproval?.status).toBe('approved');
  });

  it('终态 goal：approvePlan 返回 false（防批准复活）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { planReview: 'manual', nextAction: 'FAILED', phase: 'ARCHIVED', planApproval: { status: 'pending', round: 1 } } });
    const ok = await h.driver.approvePlan('g1');
    expect(ok).toBe(false);
    expect(h.load('g1')!.nextAction).toBe('FAILED');
  });

  it('未知 goal：approve/reject 返回 false', async () => {
    const h = makeHarness();
    expect(await h.driver.approvePlan('nope')).toBe(false);
    expect(await h.driver.rejectPlan('nope', 'x')).toBe(false);
  });
});
