import * as fs from 'fs';
import * as path from 'path';
import { makeHarness, seedGoal } from './helpers/goal-driver-harness';
import { nodeArtifactPaths } from '../../src/core/goal/node-prompts';

describe('completeNode 产物双门', () => {
  it('paused Pod does not create the next node', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    h.deps.canCreateNode = () => false;
    await h.driver.advance('g9');
    expect(h.calls.some((c) => c.op === 'create')).toBe(false);
    expect(h.load('g9')!.nodeSession).toBeNull();
  });

  it('paused Pod still archives a terminal route without a new session', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9', { patch: { nextNode: 'archive_success', nextAction: 'NEXT_archive_success' } });
    h.deps.canCreateNode = () => false;
    await h.driver.advance('g9');
    expect(h.calls.some((c) => c.op === 'create')).toBe(false);
    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'PASS' });
  });

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

  it('plan 完成时给任务补稳定 taskId（写回 waves.json）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    const sid = await h.startAndIdle('g9');
    const a = nodeArtifactPaths(h.mafwDir, 'g9', 1);
    fs.writeFileSync(a.waves, JSON.stringify({
      waves: [{ id: 'w1', title: 't', tasks: ['a', { title: 'b', acceptance: ['x'] }] }],
      status: 'ready',
    }), 'utf-8');
    await h.fireIdle(sid);
    const written = JSON.parse(fs.readFileSync(a.waves, 'utf-8'));
    expect(written.waves[0].tasks).toEqual([
      { title: 'a', taskId: 'w1-t1' },
      { title: 'b', acceptance: ['x'], taskId: 'w1-t2' },
    ]);
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

  it('plan structured 有效但 waves.json 缺失 → 成功（结构化优先）', async () => {
    const h = makeHarness({
      structured: async () => ({
        status: 'ready', taskType: 'feature',
        waves: [{ id: 'w1', title: 't', tasks: ['a'], riskNote: 'r' }],
      }),
    });
    seedGoal(h, 'g9');
    const sid = await h.startAndIdle('g9');
    await h.fireIdle(sid);
    const st = h.load('g9')!;
    expect(st.nextNode).toBe('execute');
    expect(h.nodeRuns[0].status).toBe('succeeded');
    expect(fs.existsSync(nodeArtifactPaths(h.mafwDir, 'g9', 1).waves)).toBe(true);
  });

  it('review structured 有效但 review 文件缺失 → PASS', async () => {
    const h = makeHarness({ structured: async () => ({ verdict: 'PASS', feedback: 'ok' }) });
    seedGoal(h, 'g9', { patch: { nextNode: 'review', wavePlanPath: 'x' } });
    const sid = await h.startAndIdle('g9');
    await h.fireIdle(sid);
    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'PASS' });
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

  it('review 缺 tasks 但 waves 有任务 → artifact_invalid', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9', { patch: { nextNode: 'review' } });
    const sid = await h.startAndIdle('g9');
    const a = nodeArtifactPaths(h.mafwDir, 'g9', 1);
    fs.mkdirSync(path.dirname(a.waves), { recursive: true });
    fs.writeFileSync(a.waves, JSON.stringify({ waves: [{ id: 'w1', tasks: ['a', 'b'] }], status: 'ready' }), 'utf-8');
    fs.writeFileSync(a.review, '# r\n\n```mafw-review\n{"verdict":"PASS","feedback":"ok"}\n```\n', 'utf-8');
    const st0 = h.load('g9')!;
    st0.wavePlanPath = a.waves;
    fs.writeFileSync(path.join(h.mafwDir, 'state', 'g9.json'), JSON.stringify(st0), 'utf-8');
    await h.fireIdle(sid);
    expect(h.load('g9')!.lastError).toContain('artifact_invalid');
  });

  it('review 覆盖全部任务 → PASS 正常归档', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9', { patch: { nextNode: 'review' } });
    const sid = await h.startAndIdle('g9');
    const a = nodeArtifactPaths(h.mafwDir, 'g9', 1);
    fs.mkdirSync(path.dirname(a.waves), { recursive: true });
    fs.writeFileSync(a.waves, JSON.stringify({ waves: [{ id: 'w1', tasks: ['a'] }], status: 'ready' }), 'utf-8');
    fs.writeFileSync(a.review, [
      '# r', '', '```mafw-review',
      JSON.stringify({ verdict: 'PASS', tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test' }], feedback: 'ok' }),
      '```', '',
    ].join('\n'), 'utf-8');
    const st0 = h.load('g9')!;
    st0.wavePlanPath = a.waves;
    fs.writeFileSync(path.join(h.mafwDir, 'state', 'g9.json'), JSON.stringify(st0), 'utf-8');
    await h.fireIdle(sid);
    const st = h.load('g9')!;
    expect(st.lastError ?? '').not.toContain('artifact_invalid');
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

  it('review FAIL 且本轮未复核 → 同轮 execute 修复（round 不变）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9', { patch: { nextNode: 'review', round: 1 } });
    const sid = await h.startAndIdle('g9');
    const a = nodeArtifactPaths(h.mafwDir, 'g9', 1);
    fs.writeFileSync(a.waves, JSON.stringify({
      waves: [{ id: 'w1', tasks: [{ title: 'a', acceptance: ['npm test 全绿'] }] }],
      status: 'ready',
    }), 'utf-8');
    fs.writeFileSync(a.review, '```mafw-review\n' + JSON.stringify({
      verdict: 'FAIL',
      tasks: [{ taskId: 'w1-t1', result: 'fail', evidence: 'npm test 红' }],
      feedback: '修一下',
    }) + '\n```\n', 'utf-8');
    const st0 = h.load('g9')!;
    st0.wavePlanPath = a.waves;
    fs.writeFileSync(path.join(h.mafwDir, 'state', 'g9.json'), JSON.stringify(st0), 'utf-8');

    await h.fireIdle(sid);

    const st = h.load('g9')!;
    expect(st.round).toBe(1);
    expect(st.reviewFix).toMatchObject({ round: 1 });
    expect(st.reviewFix.tasks).toEqual([{ taskId: 'w1-t1', evidence: 'npm test 红' }]);
    expect(st.nextNode).toBe('execute');
    expect(h.nodeRuns.at(-1)?.node).toBe('execute');
  });

  it('复核后再 PASS → 归档成功（不消耗新 round）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9', { patch: { nextNode: 'review', round: 1 } });
    const sid = await h.startAndIdle('g9');
    const a = nodeArtifactPaths(h.mafwDir, 'g9', 1);
    fs.writeFileSync(a.waves, JSON.stringify({
      waves: [{ id: 'w1', tasks: [{ title: 'a', acceptance: ['x'] }] }], status: 'ready',
    }), 'utf-8');
    fs.writeFileSync(a.review, '```mafw-review\n' + JSON.stringify({
      verdict: 'FAIL', tasks: [{ taskId: 'w1-t1', result: 'fail', evidence: '红' }], feedback: '修',
    }) + '\n```\n', 'utf-8');
    const st0 = h.load('g9')!;
    st0.wavePlanPath = a.waves;
    fs.writeFileSync(path.join(h.mafwDir, 'state', 'g9.json'), JSON.stringify(st0), 'utf-8');

    await h.fireIdle(sid); // → execute 修复模式
    const fixReceipt = nodeArtifactPaths(h.mafwDir, 'g9', 1, { fix: true }).receipt;
    fs.mkdirSync(path.dirname(fixReceipt), { recursive: true });
    fs.writeFileSync(fixReceipt, JSON.stringify({
      goalId: 'g9', timestamp: new Date().toISOString(),
      receipts: [{ taskId: 'w1-t1', status: 'done', summary: 'fix', files: [] }],
    }), 'utf-8');
    await h.fireIdle(); // 修复 execute 完成 → review（fix 产物）
    const fixReview = nodeArtifactPaths(h.mafwDir, 'g9', 1, { fix: true }).review;
    fs.writeFileSync(fixReview, '```mafw-review\n' + JSON.stringify({
      verdict: 'PASS', tasks: [{ taskId: 'w1-t1', result: 'pass', evidence: 'npm test 绿' }], feedback: 'ok',
    }) + '\n```\n', 'utf-8');
    await h.fireIdle(); // 复核 review 完成 → archive

    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'PASS' });
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
