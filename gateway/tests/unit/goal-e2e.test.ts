import * as fs from 'fs';
import * as path from 'path';
import { makeHarness, seedGoal } from './helpers/goal-driver-harness';
import { nodeArtifactPaths } from '../../src/core/goal/node-prompts';
import { recoverGoals } from '../../src/core/goal/recovery';

const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

describe('goal 端到端（fake runtime）', () => {
  it('全链路：plan → execute → review PASS → archive_success，产物/事件/node_runs 齐全', async () => {
    const h = makeHarness();
    seedGoal(h, 'e2e');
    await h.driver.advance('e2e'); // plan

    const a = nodeArtifactPaths(h.mafwDir, 'e2e', 1);
    fs.writeFileSync(a.waves, JSON.stringify({ waves: [{ id: 'w1', title: 't', tasks: ['x'] }], status: 'ready' }), 'utf-8');
    await h.fireIdle(); await settle();
    expect(h.load('e2e')!.nodeSession?.phase).toBe('execute');

    fs.mkdirSync(path.dirname(a.receipt), { recursive: true });
    fs.writeFileSync(a.receipt, JSON.stringify({ goalId: 'e2e', timestamp: 't', receipts: [{ taskId: 'w1-t1', status: 'done', summary: 'ok', files: [] }] }), 'utf-8');
    await h.fireIdle(); await settle();
    expect(h.load('e2e')!.nodeSession?.phase).toBe('review');

    fs.writeFileSync(a.review, '```mafw-review\n{"verdict":"PASS","feedback":"done"}\n```\n', 'utf-8');
    await h.fireIdle(); await settle();

    const st = h.load('e2e')!;
    expect(st.nextAction).toBe('COMPLETED');
    expect(st.phase).toBe('ARCHIVED');
    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'PASS', rounds: 1 });
    expect(h.nodeRuns.filter((r) => r.status === 'succeeded').map((r) => r.node)).toEqual(['plan', 'execute', 'review']);
    expect(h.events.filter((e) => e.type === 'goal_node' && e.transition === 'finished')).toHaveLength(3);
    expect(h.calls.filter((c) => c.op === 'delete')).toHaveLength(3);
  });

  it('askUser 中断恢复：need_clarification → 应答 → 回 plan → 继续到 PASS', async () => {
    const h = makeHarness();
    seedGoal(h, 'e2e');
    await h.driver.advance('e2e');
    const a = nodeArtifactPaths(h.mafwDir, 'e2e', 1);
    fs.writeFileSync(a.waves, JSON.stringify({ status: 'need_clarification', ambiguities: ['用哪个方案?'] }), 'utf-8');
    await h.fireIdle(); await settle();
    expect(h.load('e2e')!.phase).toBe('ASKING_USER');

    const qid = h.load('e2e')!.pendingQuestion!.questionId;
    expect(h.driver.handleAnswer('e2e', qid, '方案B')).toBe(true);
    await settle();
    expect(h.load('e2e')!.nodeSession?.phase).toBe('plan');

    fs.writeFileSync(a.waves, JSON.stringify({ waves: [], status: 'ready' }), 'utf-8');
    await h.fireIdle(); await settle();
    fs.mkdirSync(path.dirname(a.receipt), { recursive: true });
    fs.writeFileSync(a.receipt, JSON.stringify({ goalId: 'e2e', receipts: [] }), 'utf-8');
    await h.fireIdle(); await settle();
    fs.writeFileSync(a.review, '```mafw-review\n{"verdict":"PASS","feedback":"ok"}\n```\n', 'utf-8');
    await h.fireIdle(); await settle();
    expect(h.load('e2e')!.nextAction).toBe('COMPLETED');
  });

  it('崩溃恢复：节点飞行中"重启"（丢监听）→ 产物已出 → 兑现完成继续', async () => {
    const h = makeHarness();
    seedGoal(h, 'e2e');
    await h.driver.advance('e2e');
    const a = nodeArtifactPaths(h.mafwDir, 'e2e', 1);
    fs.writeFileSync(a.waves, JSON.stringify({ waves: [], status: 'ready' }), 'utf-8');
    // 模拟重启：新 driver 实例（监听随旧实例消失），从 state 恢复
    const NewCtor = h.driver.constructor as any;
    const driver2 = new NewCtor(h.deps);
    driver2.registerGoalDir('e2e', h.mafwDir);
    await recoverGoals({ driver: driver2, states: [{ goalId: 'e2e', mafwDir: h.mafwDir }] });
    await settle();
    expect(h.load('e2e')!.nodeSession?.phase).toBe('execute'); // plan 兑现，推进 execute
  });
});
