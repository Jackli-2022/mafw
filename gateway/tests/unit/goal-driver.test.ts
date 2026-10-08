import { makeHarness, seedGoal } from './helpers/goal-driver-harness';

describe('NodeDriver advance（启动侧）', () => {
  it('fresh goal → 启动 plan：建会话/绑身份/发 prompt/写 state/注册监听/INSERT node_run', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    await h.driver.advance('g1');

    const pa = h.calls.find((c) => c.op === 'promptAsync');
    expect(pa.agent).toBe('mafw-plan');            // 身份绑定
    expect(pa.parts[0].text).toContain('waves.json');
    expect(pa.parts[0].text).not.toContain('/skill');
    const st = h.load('g1')!;
    expect(st.nodeSession).not.toBeNull();
    expect(st.nodeSession!.phase).toBe('plan');
    expect(st.phase).toBe('PLANNING');
    expect(h.nodeRuns).toHaveLength(1);
    expect(h.nodeRuns[0].node).toBe('plan');
    expect(h.nodeRuns[0].status).toBe('running');
    expect(h.events[0]).toMatchObject({ type: 'goal_node', node: 'plan', transition: 'started', goalId: 'g1' });
  });

  it('幂等：nodeSession 在飞时 advance 短路（不重复建会话）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    await h.driver.advance('g1');
    await h.driver.advance('g1');
    expect(h.calls.filter((c) => c.op === 'create')).toHaveLength(1);
  });

  it('终态 goal：advance 空转', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { nextAction: 'COMPLETED', phase: 'ARCHIVED' } });
    await h.driver.advance('g1');
    expect(h.calls).toHaveLength(0);
  });

  it('promptAsync 抛错 → failNode：lastError + archive_fail', async () => {
    const h = makeHarness({ promptAsyncThrows: true });
    seedGoal(h, 'g1');
    await h.driver.advance('g1');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const st = h.load('g1')!;
    expect(st.lastError).toContain('boom');
    expect(st.nextAction).toBe('FAILED');
    expect(h.nodeRuns[0].status).toBe('failed');
    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'FAIL' });
  });

  it('nextNode=execute 时直接启动 execute（绑 mafw-execute）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { nextNode: 'execute', wavePlanPath: 'x' } });
    await h.driver.advance('g1');
    expect(h.calls.find((c: any) => c.op === 'promptAsync').agent).toBe('mafw-execute');
    expect(h.load('g1')!.phase).toBe('EXECUTING');
  });
});
