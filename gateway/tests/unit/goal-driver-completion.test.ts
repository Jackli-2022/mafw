import * as fs from 'fs';
import * as path from 'path';
import { makeHarness, seedGoal } from './helpers/goal-driver-harness';
import { nodeArtifactPaths } from '../../src/core/goal/node-prompts';

describe('completeNode 产物双门', () => {
  it('plan 完成 + waves ready → nextNode=execute；node_run succeeded', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    const sid = await h.startAndIdle('g9');
    const a = nodeArtifactPaths(h.mafwDir, 'g9', 1);
    fs.writeFileSync(a.waves, JSON.stringify({ waves: [{ id: 'w1', title: 't', tasks: [] }], status: 'ready' }), 'utf-8');
    await h.fireIdle(sid);
    const st = h.load('g9')!;
    expect(st.nextNode).toBe('execute');
    expect(st.nodeSession?.phase).toBe('execute'); // plan 完成后 advance 已链式启动 execute
    expect(h.nodeRuns[0].status).toBe('succeeded'); // plan run
    expect(h.nodeRuns[1]?.node).toBe('execute');
  });

  it('plan need_clarification → pendingQuestion + askUser 执行 + ledger asked', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    const sid = await h.startAndIdle('g9');
    const a = nodeArtifactPaths(h.mafwDir, 'g9', 1);
    fs.writeFileSync(a.waves, JSON.stringify({ status: 'need_clarification', ambiguities: ['A?'] }), 'utf-8');
    await h.fireIdle(sid);
    const st = h.load('g9')!;
    expect(st.pendingQuestion).toMatchObject({ node: 'plan', questions: ['A?'] });
    expect(h.ledgerEvents.some((e) => e.type === 'asked')).toBe(true);
    expect(st.phase).toBe('ASKING_USER');
  });

  it('idle 但产物缺失 → artifact_missing → archive_fail', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    const sid = await h.startAndIdle('g9');
    await h.fireIdle(sid); // 不写 waves.json
    const st = h.load('g9')!;
    expect(st.lastError).toContain('artifact_missing');
    expect(h.nodeRuns[0].status).toBe('failed');
    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'FAIL' });
  });

  it('产物非法 JSON → artifact_invalid', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    const sid = await h.startAndIdle('g9');
    fs.writeFileSync(path.join(h.mafwDir, 'waves.json'), '{broken', 'utf-8');
    await h.fireIdle(sid);
    expect(h.load('g9')!.lastError).toContain('artifact_invalid');
  });

  it('review PASS → round+1 → archive_success（verdict 优先于 maxRounds）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9', { patch: { nextNode: 'review', wavePlanPath: 'x' } });
    const sid = await h.startAndIdle('g9');
    const a = nodeArtifactPaths(h.mafwDir, 'g9', 1);
    fs.writeFileSync(a.review, '# r\n\n```mafw-review\n{"verdict":"PASS","feedback":"ok"}\n```\n', 'utf-8');
    await h.fireIdle(sid);
    const st = h.load('g9')!;
    expect(st.round).toBe(2);
    expect(st.nextAction).toBe('COMPLETED');
    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'PASS' });
  });

  it('review FAIL round<max → nextNode=plan（下一轮）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9', { patch: { nextNode: 'review', round: 1, wavePlanPath: 'x' } });
    const sid = await h.startAndIdle('g9');
    const r = path.join(h.mafwDir, 'reviews', 'g9-loop1.md');
    fs.writeFileSync(r, '```mafw-review\n{"verdict":"FAIL","feedback":"fix tests"}\n```\n', 'utf-8');
    await h.fireIdle(sid);
    const st = h.load('g9')!;
    expect(st.round).toBe(2);
    expect(st.nextNode).toBe('plan');
  });

  it('review FAIL round+1>=maxRounds → archive_max_retries', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9', { patch: { nextNode: 'review', round: 2, wavePlanPath: 'x' } });
    const sid = await h.startAndIdle('g9');
    const r = path.join(h.mafwDir, 'reviews', 'g9-loop2.md');
    fs.writeFileSync(r, '```mafw-review\n{"verdict":"FAIL","feedback":"still broken"}\n```\n', 'utf-8');
    await h.fireIdle(sid);
    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'MAX_RETRIES' });
  });

  it('stale idle（非当前 nodeSession）被忽略', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    await h.driver.advance('g9');
    h.driver.onSessionIdle('ses_stale_999');
    await new Promise((r) => setImmediate(r));
    expect(h.load('g9')!.nodeSession).not.toBeNull(); // 未被误伤
  });
});
