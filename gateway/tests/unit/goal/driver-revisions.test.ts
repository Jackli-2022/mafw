// gateway/tests/unit/goal/driver-revisions.test.ts
// Task 12：NodeDriver 的 revision 感知 + Tech Lead 讨论会话复用。
// - `existingNodeSession` 命中时不建 runtime 会话，直接复用并登记 run/session 绑定；
// - 节点会话/run/事件/产物路径都带 revision（legacy 缺省 1）。
import * as fs from 'fs';
import * as path from 'path';
import { makeHarness, seedGoal, Harness } from '../helpers/goal-driver-harness';
import { ensureGoalState, loadGoalState } from '../../../src/core/goal/state-v3';
import { nodeArtifactPaths } from '../../../src/core/goal/node-prompts';

/** 建 revision N 的 goal（无现有 state 时直接建，已有则归档旧版后重建）。 */
function seedRevision(h: Harness, goalId: string, revision: number): void {
  ensureGoalState(h.mafwDir, goalId, {
    revision,
    projectDir: 'C:/p',
    maxRounds: 3,
  });
  h.driver.registerGoalDir(goalId, h.mafwDir);
  h.charter(goalId);
}

function writePlanWaves(h: Harness, goalId: string, round: number, revision: number): string {
  const a = nodeArtifactPaths(h.mafwDir, goalId, round, { revision });
  fs.mkdirSync(path.dirname(a.waves), { recursive: true });
  fs.writeFileSync(a.waves, JSON.stringify({
    status: 'ready',
    taskType: 'feature',
    waves: [{ id: 'w1', title: 'w', tasks: ['t'], riskNote: 'r' }],
  }), 'utf-8');
  return a.waves;
}

describe('NodeDriver revision awareness', () => {
  it('reuses the existing Tech Lead session for plan without creating a runtime session (Step 1)', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    const asked: Array<{ goalId: string; node: string; revision: number }> = [];
    h.deps.existingNodeSession = (goalId, node, revision) => {
      asked.push({ goalId, node, revision });
      return node === 'plan' ? 'ses_tech_lead' : null;
    };

    await h.driver.advance('g1');

    expect(h.calls.filter((c) => c.op === 'create')).toHaveLength(0);
    expect(h.calls.find((c) => c.op === 'promptAsync')).toMatchObject({
      sessionID: 'ses_tech_lead',
      agent: 'mafw-plan',
    });
    expect(h.calls.find((c) => c.op === 'onSessionCreated')).toMatchObject({
      goalId: 'g1',
      sessionId: 'ses_tech_lead',
      phase: 'plan',
      revision: 1,
    });
    expect(h.nodeRuns).toHaveLength(1);
    expect(h.nodeRuns[0]).toMatchObject({
      goalId: 'g1',
      node: 'plan',
      revision: 1,
      sessionId: 'ses_tech_lead',
      attempt: 1,
    });
    expect(asked).toEqual([{ goalId: 'g1', node: 'plan', revision: 1 }]);
    expect(h.load('g1')!.nodeSession).toMatchObject({
      id: 'ses_tech_lead',
      phase: 'plan',
      revision: 1,
      attempt: 1,
    });
  });

  it('keeps creating fresh sessions for execute/review when the hook returns null', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { nextNode: 'execute' } });
    h.deps.existingNodeSession = (goalId, node) => (node === 'plan' ? 'ses_tech_lead' : null);

    await h.driver.advance('g1');

    expect(h.calls.filter((c) => c.op === 'create')).toHaveLength(1);
    const started = h.calls.filter((c) => c.op === 'promptAsync');
    expect(started).toHaveLength(1);
    expect(started[0].sessionID).not.toBe('ses_tech_lead');
    expect(started[0].agent).toBe('mafw-execute');
  });

  it('does not delete a reused session when the node completes', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    h.deps.existingNodeSession = (goalId, node) => (node === 'plan' ? 'ses_tech_lead' : null);

    await h.driver.advance('g1');
    writePlanWaves(h, 'g1', 1, 1);
    await h.fireIdle('ses_tech_lead');

    expect(h.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
    // plan 完成 → 已推进到 execute（新会话），Tech Lead 会话仍由 supervisor 持有。
    expect(h.load('g1')!.nodeSession!.phase).toBe('execute');
    expect(h.calls.find((c) => c.op === 'delete')).toBeUndefined();
  });

  it('still deletes a freshly created session when the node completes (legacy)', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');

    const sid = await h.startAndIdle('g1');
    writePlanWaves(h, 'g1', 1, 1);
    await h.fireIdle(sid);

    expect(h.calls.filter((c) => c.op === 'delete')).toEqual([{ op: 'delete', sid }]);
  });

  it('threads state.revision into node runs, events and the session ref', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    ensureGoalState(h.mafwDir, 'g1', { revision: 2, projectDir: 'C:/p', maxRounds: 3 });
    // revision 1 already consumed several plan attempts; revision 2 starts counting from scratch.
    h.nodeRuns.push({
      id: 900, goalId: 'g1', revision: 1, loop: 1, node: 'plan',
      attempt: 4, sessionId: 'ses_rev1', status: 'succeeded',
    });

    await h.driver.advance('g1');

    expect(loadGoalState(h.mafwDir, 'g1')!.revision).toBe(2);
    expect(h.nodeRuns.filter((r) => r.goalId === 'g1' && r.revision === 2)).toHaveLength(1);
    expect(h.nodeRuns[1]).toMatchObject({ revision: 2, node: 'plan', attempt: 1 });
    expect(h.events[0]).toMatchObject({
      type: 'goal_node', goalId: 'g1', node: 'plan', transition: 'started', revision: 2,
    });
    expect(h.phases[0]).toMatchObject({ phase: 'PLANNING', revision: 2 });
    expect(h.load('g1')!.nodeSession).toMatchObject({ revision: 2, attempt: 1 });
  });

  it('writes per-revision artifact paths and records them in state', async () => {
    const h = makeHarness();
    seedRevision(h, 'g1', 2);

    await h.driver.advance('g1');
    const prompt = h.calls.find((c) => c.op === 'promptAsync')!.parts[0].text as string;
    const a = nodeArtifactPaths(h.mafwDir, 'g1', 1, { revision: 2 });
    expect(prompt).toContain(a.waves);
    expect(prompt).toContain('rev 2');

    const sid = h.load('g1')!.nodeSession.id;
    // 隔离产物目录在节点启动时就已建好（模型可直接写）。
    expect(fs.existsSync(path.dirname(a.waves))).toBe(true);
    writePlanWaves(h, 'g1', 1, 2);
    await h.fireIdle(sid);
    expect(h.load('g1')!.wavePlanPath).toBe(a.waves);
  });

  it('does not delete a reused session when the node fails either', async () => {
    const h = makeHarness({ promptAsyncThrows: true });
    seedGoal(h, 'g1');
    h.deps.existingNodeSession = (goalId, node) => (node === 'plan' ? 'ses_tech_lead' : null);

    await h.driver.advance('g1');
    await h.fireError('ses_tech_lead', 'boom');

    expect(h.calls.filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(h.nodeRuns[0].status).toBe('failed');
  });

  it('legacy callers without the hook keep revision 1 and the old artifact paths', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');

    await h.driver.advance('g1');
    const prompt = h.calls.find((c) => c.op === 'promptAsync')!.parts[0].text as string;

    expect(h.calls.filter((c) => c.op === 'create')).toHaveLength(1);
    expect(h.nodeRuns[0].revision).toBe(1);
    expect(prompt).not.toContain('rev ');
    expect(prompt).toContain(nodeArtifactPaths(h.mafwDir, 'g1', 1).waves);
    expect(loadGoalState(h.mafwDir, 'g1')!.nodeSession).toMatchObject({ revision: 1 });
  });

  it('treats a throwing existingNodeSession hook as no reuse (fail-open)', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    h.deps.existingNodeSession = () => { throw new Error('tech lead unavailable'); };

    await h.driver.advance('g1');

    expect(h.calls.filter((c) => c.op === 'create')).toHaveLength(1);
    expect(h.calls.find((c) => c.op === 'promptAsync').sessionID).not.toBe('ses_tech_lead');
  });
});
